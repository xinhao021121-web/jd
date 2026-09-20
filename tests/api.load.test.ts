import { describe, expect, it } from 'vitest';
import type { OutputEvent } from '@zhipin/shared';
import { createApp } from '../apps/api/src/app';
import { createLogger } from '../apps/api/src/logger';
import { createRateLimiter } from '../apps/api/src/ratelimit';
import type { TaskRunner } from '../apps/api/src/routes/llm';
import { createUsageGuard } from '../apps/api/src/usage';
import { SAMPLE_JD, SAMPLE_RESUME } from './fixtures';

/**
 * 限流与配额的压测（项目评审标准 三.5「安全与成本」的自动化证据）。
 * 与既有单测的区别：这里打的是**完整路由**，且在同一个 IP 上并发，
 * 要证明的是「超限请求既不触达模型、也不把正文写进响应与日志」这条成本边界。
 * 数字会随实现漂移，因此断言只看不变量（调用数 = 配额、其余一律 429）。
 */

/** 干净话术：数字与技能都能在 SAMPLE_RESUME 里找到依据，不触发本地自检 */
const CLEAN_TEXT =
  '您好，我有 3 年 Java 后端开发经验，主导过订单查询接口性能优化，把 P99 响应时间从 800ms 降到 180ms，想和您聊聊这个岗位的具体需求。';

interface LoadOptions {
  perMinute?: number;
  perDay?: number;
  alertThreshold?: number;
  dailyCap?: number;
  /** 模拟模型耗时，用来观察并发下的排队与失败行为 */
  latencyMs?: number;
}

function buildLoadApp(options: LoadOptions = {}) {
  let modelCalls = 0;
  const logs: string[] = [];

  const runner: TaskRunner = {
    async runTask(_task, _input, runOptions = {}) {
      modelCalls += 1;
      if (options.latencyMs) await new Promise((resolve) => setTimeout(resolve, options.latencyMs));
      const events: OutputEvent[] = [{ type: 'item', kind: 'greeting', text: CLEAN_TEXT }];
      for (const event of events) await runOptions.onEvent?.(event);
      return {
        validEvents: events.length,
        invalidLines: 0,
        firstTokenMs: options.latencyMs ?? 1,
        elapsedMs: options.latencyMs ?? 2,
        attempts: 1
      };
    }
  };

  const app = createApp({
    runner,
    limiter: createRateLimiter({
      perMinute: options.perMinute ?? 10,
      perDay: options.perDay ?? 100
    }),
    usage: createUsageGuard({
      alertThreshold: options.alertThreshold,
      dailyCap: options.dailyCap
    }),
    logger: createLogger((line) => logs.push(line))
  });

  return { app, logs, modelCalls: () => modelCalls };
}

const post = (app: ReturnType<typeof createApp>, ip: string) =>
  app.request('/api/llm', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-forwarded-for': ip },
    body: JSON.stringify({ task: 'greeting', resume: SAMPLE_RESUME, jd: SAMPLE_JD })
  });

describe('限流与配额压测', () => {
  it('并发 40 个请求：模型调用数与每分钟配额一致，其余 429', async () => {
    const { app, modelCalls } = buildLoadApp({ perMinute: 10, perDay: 100, latencyMs: 5 });
    const startedAt = Date.now();

    const responses = await Promise.all(
      Array.from({ length: 40 }, () => post(app, '10.0.0.1'))
    );
    const elapsedMs = Date.now() - startedAt;

    const allowed = responses.filter((response) => response.status === 200);
    const limited = responses.filter((response) => response.status === 429);

    expect(allowed).toHaveLength(10);
    expect(limited).toHaveLength(30);
    // 成本边界：超限的 30 个请求一个都不能打到模型
    expect(modelCalls()).toBe(10);
    // 超限响应只说被限流，不回显简历与 JD 正文
    const bodies = await Promise.all(limited.map((response) => response.text()));
    for (const body of bodies) {
      expect(body).toContain('RATE_LIMITED');
      expect(body).not.toContain('Java');
      expect(body).not.toContain('某电商科技有限公司');
    }
    // 同进程内的 40 并发不应出现排队放大；给足余量，只拦住数量级退化
    expect(elapsedMs).toBeLessThan(5000);
  });

  it('每日硬上限：到上限后不再调用模型，并写一条告警日志', async () => {
    const { app, logs, modelCalls } = buildLoadApp({
      perMinute: 1000,
      perDay: 1000,
      alertThreshold: 5,
      dailyCap: 8
    });

    const statuses: number[] = [];
    for (let index = 0; index < 20; index += 1) {
      const response = await post(app, '10.0.0.2');
      statuses.push(response.status);
    }

    expect(statuses.filter((status) => status === 200)).toHaveLength(8);
    expect(statuses.filter((status) => status === 429)).toHaveLength(12);
    expect(modelCalls()).toBe(8);

    const records = logs.map((line) => JSON.parse(line) as { event: string; errorType: string });
    const alerts = records.filter((record) => record.event === 'usage_alert');
    expect(alerts).toHaveLength(1);
    expect(alerts[0]?.errorType).toBe('DAILY_CALL_ALERT');
    // 告警日志同样只带计数与 IP 哈希，不带正文
    expect(logs.join('\n')).not.toContain('某电商科技有限公司');
  });

  it('多 IP 并发：配额按 IP 隔离，互不占用', async () => {
    const { app, modelCalls } = buildLoadApp({ perMinute: 10, perDay: 100 });

    const responses = await Promise.all([
      ...Array.from({ length: 10 }, () => post(app, '10.0.0.3')),
      ...Array.from({ length: 10 }, () => post(app, '10.0.0.4'))
    ]);

    expect(responses.every((response) => response.status === 200)).toBe(true);
    expect(modelCalls()).toBe(20);
  });
});
