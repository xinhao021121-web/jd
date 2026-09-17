/**
 * 唯一业务路由：POST /api/llm（技术方案 5.3、6）。
 * 职责：校验入参 → 限流 → 调用模型并流式回传 → 映射错误码。
 * 分析事件由本地 core 计算，模型只负责逐条输出内容。
 */
import type { Context, Hono } from 'hono';
import { analyzeMatch, isEditableAnchor, parseResume } from '@zhipin/core';
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
import type { RateLimiter } from '../ratelimit';
import { hashIp, type Logger } from '../logger';
import { AsyncEventQueue } from '../streaming';

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
}

type StartOutcome = { ok: true } | { ok: false; code: ErrorCode };

const SSE_HEADERS = {
  'Content-Type': 'text/event-stream; charset=utf-8',
  'Cache-Control': 'no-cache, no-transform',
  Connection: 'keep-alive',
  'X-Accel-Buffering': 'no'
};

/** 默认取 X-Forwarded-For 的第一跳，便于在反向代理后按真实 IP 限流 */
function defaultClientIp(c: Context): string {
  const forwarded = c.req.header('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0]!.trim();
  return c.req.header('x-real-ip') ?? 'unknown';
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
    const decision = deps.limiter.check(ip);
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
              if (event.kind === 'suggestion' && !isEditableAnchor(blocks, event.before)) {
                droppedItems += 1;
                return;
              }
              emittedItems += 1;
              if (!startState.outcome) {
                clearTimeout(firstTokenTimer);
                settle({ ok: true });
                queue.push(analysisEvent);
              }
              queue.push(event);
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
        deps.logger.log({
          event: 'ok',
          task,
          ipHash,
          elapsedMs: now() - startedAt,
          attempts: stats.attempts,
          errorType: droppedItems ? `DROPPED_${droppedItems}` : undefined
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
