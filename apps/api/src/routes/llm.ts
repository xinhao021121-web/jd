/**
 * 唯一业务路由：POST /api/llm（技术方案 5.3、6）。
 * 职责：校验入参 → 限流 → 调用模型并流式回传 → 映射错误码。
 * 分析事件由本地 core 计算，模型只负责逐条输出内容。
 */
import type { Context, Hono } from 'hono';
import {
  analyzeMatch,
  checkGreetingText,
  checkSuggestionText,
  greetingStyleFor,
  isEditableAnchor,
  parseResume
} from '@zhipin/core';
import type { OutputEvent, TaskKind } from '@zhipin/shared';
import {
  ERROR_HTTP_STATUS,
  ERROR_MESSAGES,
  LATENCY_BUDGET,
  LlmRequestSchema,
  errorEvent,
  serializeSseEvent,
  type ErrorCode,
  type StreamEvent
} from '@zhipin/shared';
import { LlmUpstreamError } from '@zhipin/llm';
import { clientIpFromHeaders } from '../client-ip';
import type { RateLimiter } from '../ratelimit';
import { hashIp, type Logger } from '../logger';
import { AsyncEventQueue } from '../streaming';
import type { UsageGuard } from '../usage';

export interface TaskRunOptions {
  signal?: AbortSignal;
  onEvent?: (event: OutputEvent) => void | Promise<void>;
}

export interface TaskRunResult {
  validEvents: number;
  invalidLines: number;
  firstTokenMs: number | null;
  elapsedMs: number;
  attempts: number;
}

/** 只依赖这一个方法，便于测试注入 mock 模型 */
export interface TaskRunner {
  runTask(
    task: TaskKind,
    input: { resume: string; jd: string },
    options?: TaskRunOptions
  ): Promise<TaskRunResult>;
}

export interface LlmRouteDeps {
  runner: TaskRunner;
  limiter: RateLimiter;
  logger: Logger;
  firstTokenTimeoutMs?: number;
  totalTimeoutMs?: number;
  now?: () => number;
  clientIp?: (c: Context) => string;
  usage?: UsageGuard;
}

type StartOutcome = { ok: true } | { ok: false; code: ErrorCode };

const SSE_HEADERS = {
  'Content-Type': 'text/event-stream; charset=utf-8',
  'Cache-Control': 'no-cache, no-transform',
  Connection: 'keep-alive',
  'X-Accel-Buffering': 'no'
};

/**
 * 默认的 IP 来源：Cloudflare 上取 `CF-Connecting-IP`（调用方伪造不了），
 * 其他部署形态依次回退到 `X-Forwarded-For` 第一跳与 `X-Real-IP`。
 */
function defaultClientIp(c: Context): string {
  return clientIpFromHeaders((name) => c.req.header(name));
}

export function registerLlmRoute(app: Hono, deps: LlmRouteDeps): void {
  const firstTokenTimeoutMs = deps.firstTokenTimeoutMs ?? LATENCY_BUDGET.firstTokenMs;
  const totalTimeoutMs = deps.totalTimeoutMs ?? LATENCY_BUDGET.totalMs;
  const now = deps.now ?? (() => Date.now());
  const clientIp = deps.clientIp ?? defaultClientIp;

  app.post('/api/llm', async (c: Context) => {
    const startedAt = now();
    const ip = clientIp(c);
    const ipHash = hashIp(ip);

    // 限流先于模型调用：超限不消耗任何模型额度
    const decision = await deps.limiter.check(ip);
    if (!decision.allowed) {
      deps.logger.warn({ event: 'rate_limited', ipHash, errorType: decision.limit });
      return c.json(
        { code: 'RATE_LIMITED', message: ERROR_MESSAGES.RATE_LIMITED },
        ERROR_HTTP_STATUS.RATE_LIMITED as 429
      );
    }

    let payload: unknown;
    try {
      payload = await c.req.json();
    } catch {
      payload = null;
    }

    const parsed = LlmRequestSchema.safeParse(payload);
    if (!parsed.success) {
      deps.logger.warn({ event: 'invalid_input', ipHash, errorType: 'INVALID_INPUT' });
      return c.json(
        { code: 'INVALID_INPUT', message: ERROR_MESSAGES.INVALID_INPUT },
        ERROR_HTTP_STATUS.INVALID_INPUT as 400
      );
    }

    // 全局单日用量：跨过硬上限直接拒绝，跨过告警阈值写一条告警日志（PRD 4.1）。
    // 位置放在入参校验之后，额度只统计「真正会发起模型调用的请求」：校验不过的请求不占用当日额度。
    // 否则任何人都能用一批 400 请求把公开部署的当日额度清零——按 IP 的限额挡不住换 IP 的调用方，
    // 而这类请求本身不产生任何模型成本，计数在里面只会让护栏变成可用性缺口。
    if (deps.usage) {
      const usage = await deps.usage.check();
      if (usage.exceeded) {
        deps.logger.warn({ event: 'rate_limited', ipHash, errorType: 'DAILY_CAP' });
        return c.json(
          { code: 'RATE_LIMITED', message: ERROR_MESSAGES.RATE_LIMITED },
          ERROR_HTTP_STATUS.RATE_LIMITED as 429
        );
      }
      if (usage.alert) {
        deps.logger.warn({
          event: 'usage_alert',
          ipHash,
          errorType: 'DAILY_CALL_ALERT',
          elapsedMs: (await deps.usage.snapshot()).count
        });
      }
    }

    const { task, resume, jd } = parsed.data;
    const queue = new AsyncEventQueue<StreamEvent>();
    const abort = new AbortController();
    // 用对象持有状态：闭包里读取时不会被 TypeScript 的流程分析误判为 never
    const startState: { outcome: StartOutcome | null } = { outcome: null };
    let resolveStart: (outcome: StartOutcome) => void = () => {};
    const started = new Promise<StartOutcome>((resolve) => {
      resolveStart = resolve;
    });
    const settle = (outcome: StartOutcome) => {
      if (startState.outcome) return;
      startState.outcome = outcome;
      resolveStart(outcome);
    };

    let timeoutCode: ErrorCode | null = null;

    const firstTokenTimer = setTimeout(() => {
      timeoutCode = 'FIRST_TOKEN_TIMEOUT';
      settle({ ok: false, code: 'FIRST_TOKEN_TIMEOUT' });
      abort.abort();
    }, firstTokenTimeoutMs);

    const totalTimer = setTimeout(() => {
      timeoutCode = 'TOTAL_TIMEOUT';
      // 已经开流就直接发错误事件，否则用 504 状态码收场
      if (startState.outcome?.ok) {
        queue.push(errorEvent('TOTAL_TIMEOUT'));
        queue.close();
      } else {
        settle({ ok: false, code: 'TOTAL_TIMEOUT' });
      }
      abort.abort();
    }, totalTimeoutMs);

    const clearTimers = () => {
      clearTimeout(firstTokenTimer);
      clearTimeout(totalTimer);
    };

    const analysis = analyzeMatch(resume, jd);
    // 合规兜底：改写建议必须锚定在可改写区块，否则不向前端回传（PRD 4.1）
    const blocks = task === 'suggestions' ? parseResume(resume) : [];
    let emittedItems = 0;
    let droppedItems = 0;
    let flaggedItems = 0;
    const analysisEvent: StreamEvent = {
      type: 'analysis',
      requirements: analysis.requirements,
      matched: analysis.matched,
      missing: analysis.missing,
      lowMatch: analysis.lowMatch
    };

    const pipeline = (async () => {
      try {
        const stats: TaskRunResult = await deps.runner.runTask(
          task,
          { resume, jd },
          {
            signal: abort.signal,
            onEvent: (event) => {
              if (event.type !== 'item') return;

              // 本地自检：命中只标注不丢弃，用户仍能拿到完整 3 条并自行核对（技术方案 V0.3 增补）
              const issues =
                event.kind === 'greeting'
                  ? checkGreetingText(resume, event.text)
                  : checkSuggestionText(
                      resume,
                      {
                        before: event.before,
                        after: event.after,
                        reason: event.reason,
                        suggestionType: event.suggestionType
                      },
                      jd
                    );

              if (event.kind === 'suggestion' && !isEditableAnchor(blocks, event.before)) {
                droppedItems += 1;
                return;
              }

              if (issues.length) flaggedItems += 1;

              // index / style 由本地按回传顺序赋值：模型不必输出，标错也不影响展示
              const guarded: OutputEvent =
                event.kind === 'greeting'
                  ? {
                      ...event,
                      index: emittedItems,
                      style: greetingStyleFor(emittedItems),
                      issues: issues.length ? issues.map((item) => item.detail) : undefined
                    }
                  : {
                      ...event,
                      index: emittedItems,
                      issues: issues.length ? issues.map((item) => item.detail) : undefined
                    };

              emittedItems += 1;
              if (!startState.outcome) {
                clearTimeout(firstTokenTimer);
                settle({ ok: true });
                queue.push(analysisEvent);
              }
              queue.push(guarded);
            }
          }
        );

        if (emittedItems === 0) {
          settle({ ok: false, code: 'INVALID_OUTPUT' });
          queue.close();
          return;
        }

        settle({ ok: true });
        queue.push({ type: 'done', elapsedMs: now() - startedAt });
        queue.close();
        const notes = [
          droppedItems ? `DROPPED_${droppedItems}` : '',
          flaggedItems ? `FLAGGED_${flaggedItems}` : ''
        ]
          .filter(Boolean)
          .join('_');
        deps.logger.log({
          event: 'ok',
          task,
          ipHash,
          elapsedMs: now() - startedAt,
          attempts: stats.attempts,
          errorType: notes || undefined
        });
      } catch (error) {
        if (timeoutCode) {
          // 超时：首字超时走 504，整体超时的事件已由计时器推送
          if (startState.outcome?.ok && timeoutCode === 'FIRST_TOKEN_TIMEOUT') {
            queue.push(errorEvent('FIRST_TOKEN_TIMEOUT'));
          }
          deps.logger.warn({
            event: 'error',
            task,
            ipHash,
            elapsedMs: now() - startedAt,
            errorType: timeoutCode
          });
        } else if (abort.signal.aborted) {
          // 用户中止或连接断开：保留已生成内容，不再推送错误
          deps.logger.log({
            event: 'ok',
            task,
            ipHash,
            elapsedMs: now() - startedAt,
            errorType: 'ABORTED'
          });
        } else {
          // 模型报错、鉴权失败以及其它未知异常统一按上游错误处理
          const streaming = startState.outcome?.ok === true;
          settle({ ok: false, code: 'UPSTREAM_ERROR' });
          // 已经开流时，把错误作为事件补发给浏览器
          if (streaming) queue.push(errorEvent('UPSTREAM_ERROR'));
          deps.logger.warn({
            event: 'error',
            task,
            ipHash,
            elapsedMs: now() - startedAt,
            errorType: error instanceof LlmUpstreamError ? 'UPSTREAM_ERROR' : 'UNKNOWN_ERROR'
          });
        }
        queue.close();
      } finally {
        clearTimers();
      }
    })();

    const outcome = await started;
    void pipeline.catch(() => undefined);

    if (!outcome.ok) {
      queue.close();
      deps.logger.warn({
        event: 'error',
        task,
        ipHash,
        elapsedMs: now() - startedAt,
        errorType: outcome.code
      });
      return c.json(
        { code: outcome.code, message: ERROR_MESSAGES[outcome.code] },
        ERROR_HTTP_STATUS[outcome.code] as 400 | 429 | 502 | 504
      );
    }

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const encoder = new TextEncoder();
        try {
          for await (const event of queue) {
            controller.enqueue(encoder.encode(serializeSseEvent(event)));
          }
        } catch {
          /* 队列异常结束，直接收尾 */
        } finally {
          controller.close();
        }
      },
      cancel() {
        abort.abort();
      }
    });

    return new Response(stream, { headers: SSE_HEADERS });
  });
}
