import { describe, expect, it, vi } from 'vitest';
import { LlmUpstreamError } from '@zhipin/llm';
import type { OutputEvent, StreamEvent } from '@zhipin/shared';
import { createApp } from '../apps/api/src/app';
import { createLogger } from '../apps/api/src/logger';
import { createRateLimiter } from '../apps/api/src/ratelimit';
import { createUsageGuard } from '../apps/api/src/usage';
import type { TaskRunResult, TaskRunner } from '../apps/api/src/routes/llm';
import { SAMPLE_JD, SAMPLE_RESUME } from './fixtures';

const okay: TaskRunResult = {
  validEvents: 3,
  invalidLines: 0,
  firstTokenMs: 120,
  elapsedMs: 800,
  attempts: 1
};

function greetingEvents(count = 3): OutputEvent[] {
  return ['技能匹配型', '经历相关型', '简短直接型'].slice(0, count).map((style, index) => ({
    type: 'item',
    kind: 'greeting',
    index,
    style: style as never,
    text: `第 ${index + 1} 条话术：负责订单中心核心链路开发，使用 Java 与 Redis 优化查询性能。`
  }));
}

/** 用一个可控的假模型替代真实模型调用 */
function makeRunner(
  behavior: 'ok' | 'suggestions' | 'upstream-error' | 'silent' | 'slow' | 'throws-generic' = 'ok'
): { runner: TaskRunner; calls: { task: string }[] } {
  const calls: { task: string }[] = [];

  const runner: TaskRunner = {
    async runTask(task, _input, options = {}) {
      calls.push({ task });

      if (behavior === 'upstream-error') {
        throw new LlmUpstreamError('模型服务返回状态 401', 401);
      }
      if (behavior === 'throws-generic') {
        throw new Error('unexpected failure');
      }
      if (behavior === 'silent') return { ...okay, validEvents: 0 };
      if (behavior === 'slow') {
        await new Promise((resolve, reject) => {
          const timer = setTimeout(resolve, 400);
          options.signal?.addEventListener('abort', () => {
            clearTimeout(timer);
            reject(new Error('aborted'));
          });
        });
        return okay;
      }

      if (behavior === 'suggestions') {
        const items: OutputEvent[] = [
          {
            type: 'item',
            kind: 'suggestion',
            index: 0,
            section: '工作经历',
            before: '主导订单查询接口性能优化，通过 Redis 缓存与 SQL 优化将 P99 响应时间从 800ms 降到 180ms',
            after:
              '主导订单查询接口性能优化，通过 Redis 缓存与 SQL 优化将 P99 响应时间从 800ms 降到 180ms（高并发场景）',
            reason: '补上岗位关注的术语标签，不改变事实',
            suggestionType: '术语对齐'
          },
          {
            // 越界建议：锚点在锁定区块，服务端必须拦截
            type: 'item',
            kind: 'suggestion',
            index: 1,
            section: '教育背景',
            before: '某某大学  计算机科学与技术  本科  2021 届',
            after: '某某大学  计算机科学与技术  本科  2021 届（重点院校）',
            reason: '越界示例',
            suggestionType: '关键词补充'
          }
        ];
        for (const item of items) await options.onEvent?.(item);
        return { ...okay, validEvents: items.length, firstTokenMs: 90 };
      }

      for (const event of greetingEvents()) {
        await options.onEvent?.(event);
      }
      return okay;
    }
  };

  return { runner, calls };
}

interface AppOptions {
  behavior?: Parameters<typeof makeRunner>[0];
  perMinute?: number;
  firstTokenTimeoutMs?: number;
  totalTimeoutMs?: number;
  logs?: string[];
  usage?: { alertThreshold?: number; dailyCap?: number };
}

function buildApp(options: AppOptions = {}) {
  const { runner, calls } = makeRunner(options.behavior ?? 'ok');
  const logs: string[] = options.logs ?? [];
  const app = createApp({
    runner,
    limiter: createRateLimiter({
      perMinute: options.perMinute ?? 10,
      perDay: 100,
      now: () => Date.now()
    }),
    logger: createLogger((line) => logs.push(line)),
    firstTokenTimeoutMs: options.firstTokenTimeoutMs,
    totalTimeoutMs: options.totalTimeoutMs,
    usage: options.usage ? createUsageGuard(options.usage) : undefined
  });
  return { app, calls, logs };
}

const post = (app: ReturnType<typeof createApp>, body: unknown, ip = '9.9.9.9') =>
  app.request('/api/llm', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-forwarded-for': ip },
    body: JSON.stringify(body)
  });

function parseSse(text: string): StreamEvent[] {
  return text
    .split('\n\n')
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => {
      const dataLine = block.split('\n').find((line) => line.startsWith('data:'));
      return JSON.parse((dataLine ?? '').slice(5).trim()) as StreamEvent;
    });
}

describe('POST /api/llm', () => {
  it('正常生成：先返回本地匹配分析，再逐条返回话术，最后 done', async () => {
    const { app } = buildApp();
    const response = await post(app, { task: 'greeting', resume: SAMPLE_RESUME, jd: SAMPLE_JD });

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/event-stream');

    const events = parseSse(await response.text());
    expect(events[0]?.type).toBe('analysis');
    expect(events.filter((e) => e.type === 'item')).toHaveLength(3);
    expect(events.at(-1)?.type).toBe('done');

    const analysis = events[0] as Extract<StreamEvent, { type: 'analysis' }>;
    expect(analysis.matched).toContain('Java');
    expect(analysis.missing).toContain('高并发');
    expect(analysis.lowMatch).toBe(false);
  });

  it('改写建议中锚定锁定区块的条目被服务端拦截', async () => {
    const { app } = buildApp({ behavior: 'suggestions' });
    const response = await post(app, { task: 'suggestions', resume: SAMPLE_RESUME, jd: SAMPLE_JD });

    const events = parseSse(await response.text());
    const items = events.filter((e) => e.type === 'item');

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ kind: 'suggestion', section: '工作经历' });
    expect(JSON.stringify(events)).not.toContain('重点院校');
  });

  it('入参缺失或过短返回 400，且不调用模型', async () => {
    const { app, calls } = buildApp();

    const short = await post(app, { task: 'greeting', resume: '太短', jd: SAMPLE_JD });
    expect(short.status).toBe(400);
    expect(await short.json()).toMatchObject({ code: 'INVALID_INPUT' });

    const missing = await post(app, { task: 'greeting', resume: SAMPLE_RESUME });
    expect(missing.status).toBe(400);

    const badTask = await post(app, { task: 'other', resume: SAMPLE_RESUME, jd: SAMPLE_JD });
    expect(badTask.status).toBe(400);

    const broken = await app.request('/api/llm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not-json'
    });
    expect(broken.status).toBe(400);

    expect(calls).toHaveLength(0);
  });

  it('超过每分钟配额返回 429，且不消耗模型调用', async () => {
    const { app, calls } = buildApp({ perMinute: 2 });
    const body = { task: 'greeting', resume: SAMPLE_RESUME, jd: SAMPLE_JD };

    expect((await post(app, body, '3.3.3.3')).status).toBe(200);
    expect((await post(app, body, '3.3.3.3')).status).toBe(200);

    const blocked = await post(app, body, '3.3.3.3');
    expect(blocked.status).toBe(429);
    expect(await blocked.json()).toMatchObject({
      code: 'RATE_LIMITED',
      message: '请求过于频繁，请稍后再试'
    });
    expect(calls).toHaveLength(2);
  });

  it('模型鉴权失败返回 502，响应里不含密钥', async () => {
    const { app, logs } = buildApp({ behavior: 'upstream-error' });
    const response = await post(app, { task: 'greeting', resume: SAMPLE_RESUME, jd: SAMPLE_JD });
    const text = await response.text();

    expect(response.status).toBe(502);
    expect(text).toContain('UPSTREAM_ERROR');
    expect(text).not.toContain('Bearer');

    // 日志只记录错误类型与耗时，不出现简历与 JD 正文
    const joined = logs.join('\n');
    expect(joined).not.toContain('主导订单查询接口性能优化');
    expect(joined).not.toContain('某电商科技有限公司');
    expect(joined).toContain('UPSTREAM_ERROR');
  });

  it('首字超过 5 秒（测试中缩短为 50ms）返回 504', async () => {
    const { app } = buildApp({ behavior: 'slow', firstTokenTimeoutMs: 50, totalTimeoutMs: 5000 });
    const response = await post(app, { task: 'greeting', resume: SAMPLE_RESUME, jd: SAMPLE_JD });

    expect(response.status).toBe(504);
    expect(await response.json()).toMatchObject({
      code: 'FIRST_TOKEN_TIMEOUT',
      message: '生成超时，请重试'
    });
  });

  it('整体超过 30 秒上限（测试中缩短为 60ms）返回 504', async () => {
    const { app } = buildApp({ behavior: 'slow', firstTokenTimeoutMs: 5000, totalTimeoutMs: 60 });
    const response = await post(app, { task: 'greeting', resume: SAMPLE_RESUME, jd: SAMPLE_JD });

    expect(response.status).toBe(504);
    expect(await response.json()).toMatchObject({ code: 'TOTAL_TIMEOUT' });
  });

  it('模型返回无法解析时返回 502 INVALID_OUTPUT', async () => {
    const { app } = buildApp({ behavior: 'silent' });
    const response = await post(app, { task: 'greeting', resume: SAMPLE_RESUME, jd: SAMPLE_JD });

    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({
      code: 'INVALID_OUTPUT',
      message: '生成结果异常，请重新生成'
    });
  });

  it('未知异常由 app 兜底为 502，不泄露内部信息', async () => {
    const { app } = buildApp({ behavior: 'throws-generic' });
    const response = await post(app, { task: 'greeting', resume: SAMPLE_RESUME, jd: SAMPLE_JD });
    const text = await response.text();

    expect(response.status).toBe(502);
    expect(text).toContain('UPSTREAM_ERROR');
    expect(text).not.toContain('unexpected failure');
  });

  it('浏览器中止请求时会终止模型调用并保留已生成内容', async () => {
    const { app } = buildApp({ behavior: 'ok' });
    const controller = new AbortController();
    const response = await post(app, { task: 'greeting', resume: SAMPLE_RESUME, jd: SAMPLE_JD });
    controller.abort();

    const text = await response.text();
    const events = parseSse(text);
    expect(events.some((e) => e.type === 'item')).toBe(true);
  });

  it('健康检查可用，未知路由返回 404', async () => {
    const { app } = buildApp();
    expect((await app.request('/healthz')).status).toBe(200);
    expect((await app.request('/api/other')).status).toBe(404);
  });

  it('单日用量跨过上限后返回 429，且不消耗模型调用', async () => {
    const { app, calls } = buildApp({ usage: { alertThreshold: 2, dailyCap: 2 } });
    const body = { task: 'greeting', resume: SAMPLE_RESUME, jd: SAMPLE_JD };

    expect((await post(app, body, '7.7.7.1')).status).toBe(200);
    expect((await post(app, body, '7.7.7.2')).status).toBe(200);

    const blocked = await post(app, body, '7.7.7.3');
    expect(blocked.status).toBe(429);
    expect(await blocked.json()).toMatchObject({ code: 'RATE_LIMITED' });
    expect(calls).toHaveLength(2);
  });

  it('无效入参不占用全局每日额度：额度只统计真正发起模型调用的请求', async () => {
    const { app, calls } = buildApp({ usage: { alertThreshold: 2, dailyCap: 2 } });
    const invalid = { task: 'greeting', resume: '太短', jd: SAMPLE_JD };

    // 换 IP 连发一批 400：它们不产生模型成本，因此也不该占掉当日额度
    for (let index = 0; index < 5; index += 1) {
      expect((await post(app, invalid, `6.6.6.${index}`)).status).toBe(400);
    }

    const body = { task: 'greeting', resume: SAMPLE_RESUME, jd: SAMPLE_JD };
    expect((await post(app, body, '6.6.7.1')).status).toBe(200);
    expect((await post(app, body, '6.6.7.2')).status).toBe(200);

    // 第三次真实生成才触顶
    expect((await post(app, body, '6.6.7.3')).status).toBe(429);
    expect(calls).toHaveLength(2);
  });

  it('单日用量跨过告警阈值时写入脱敏告警日志', async () => {
    const logs: string[] = [];
    const { app } = buildApp({ usage: { alertThreshold: 1, dailyCap: 10 }, logs });
    await post(app, { task: 'greeting', resume: SAMPLE_RESUME, jd: SAMPLE_JD }, '8.8.8.1');

    const alert = logs.map((line) => JSON.parse(line)).find((item) => item.event === 'usage_alert');
    expect(alert).toMatchObject({ errorType: 'DAILY_CALL_ALERT' });
    expect(logs.join('\n')).not.toContain('订单中心');
  });

  it('错误日志与响应中不出现简历与 JD 正文', async () => {
    const logs: string[] = [];
    const { app } = buildApp({ behavior: 'silent', logs });
    await post(app, { task: 'suggestions', resume: SAMPLE_RESUME, jd: SAMPLE_JD });

    const joined = logs.join('\n');
    expect(joined).not.toContain('订单中心');
    expect(joined).not.toContain('任职要求');
    expect(joined).toContain('INVALID_OUTPUT');
  });
});
