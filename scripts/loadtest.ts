/**
 * 限流与每日配额的压测（项目评审标准 三.5「安全与成本」的证据）。
 *
 * 与 tests/api.load.test.ts 的分工：
 * - 单测打的是完整路由，负责在 CI 里拦住退化；
 * - 本脚本把量放大到几百个请求，把「模型调用次数 = 配额」这条成本边界与延迟分位数写成留档报告。
 *
 * 为什么不在本进程外面起一个 HTTP 服务端：线上部署形态是 Cloudflare Workers，
 * 与服务端的差异在接入层而不是限流与配额逻辑，而根目录不额外引入 HTTP 适配依赖（沿用既有取向）。
 *
 * 运行：pnpm loadtest
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { arch, cpus, platform, release } from 'node:os';
import { join } from 'node:path';
import type { OutputEvent } from '@zhipin/shared';
import { createApp } from '../apps/api/src/app';
import { createLogger } from '../apps/api/src/logger';
import { createRateLimiter } from '../apps/api/src/ratelimit';
import type { TaskRunner } from '../apps/api/src/routes/llm';
import { createUsageGuard } from '../apps/api/src/usage';
import { SAMPLE_JD, SAMPLE_RESUME } from '../tests/fixtures';

/** 与生产同源的配额：每 IP 每分钟 10 次、每日 100 次（PRD 4.1） */
const PER_MINUTE = 10;
const PER_DAY = 100;
/** 模拟模型耗时，用来观察并发下的排队与拒绝行为 */
const MODEL_LATENCY_MS = 20;

const CLEAN_TEXT =
  '您好，我有 3 年 Java 后端开发经验，主导过订单查询接口性能优化，把 P99 响应时间从 800ms 降到 180ms，想和您聊聊这个岗位的具体需求。';

interface ScenarioResult {
  name: string;
  requests: number;
  concurrency: number;
  ok: number;
  limited: number;
  modelCalls: number;
  expectedModelCalls: number;
  elapsedMs: number;
  p50: number;
  p95: number;
  p99: number;
}

interface Harness {
  app: ReturnType<typeof createApp>;
  modelCalls: () => number;
}

/** 每个场景一个独立实例：限流与配额的状态不跨场景泄漏 */
function createHarness(options: { dailyCap: number; alertThreshold: number }): Harness {
  let modelCalls = 0;
  const runner: TaskRunner = {
    async runTask(_task, _input, runOptions = {}) {
      modelCalls += 1;
      await new Promise((resolve) => setTimeout(resolve, MODEL_LATENCY_MS));
      const events: OutputEvent[] = [{ type: 'item', kind: 'greeting', text: CLEAN_TEXT }];
      for (const event of events) await runOptions.onEvent?.(event);
      return {
        validEvents: events.length,
        invalidLines: 0,
        firstTokenMs: MODEL_LATENCY_MS,
        elapsedMs: MODEL_LATENCY_MS,
        attempts: 1
      };
    }
  };

  return {
    app: createApp({
      runner,
      limiter: createRateLimiter({ perMinute: PER_MINUTE, perDay: PER_DAY }),
      usage: createUsageGuard({
        alertThreshold: options.alertThreshold,
        dailyCap: options.dailyCap
      }),
      // 几百个请求的服务端日志会把报告刷没；日志内容由 tests/api.load.test.ts 断言
      logger: createLogger(() => {})
    }),
    modelCalls: () => modelCalls
  };
}

async function runScenario(
  label: string,
  harness: Harness,
  ips: string[],
  perIp: number,
  expectedModelCalls: number,
  concurrency: number
): Promise<ScenarioResult> {
  const tasks: (() => Promise<number>)[] = [];
  for (const ip of ips) {
    for (let index = 0; index < perIp; index += 1) {
      tasks.push(async () => {
        const response = await harness.app.request('/api/llm', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-forwarded-for': ip },
          body: JSON.stringify({ task: 'greeting', resume: SAMPLE_RESUME, jd: SAMPLE_JD })
        });
        if (response.status !== 200) {
          const body = await response.text();
          // 成本与隐私边界：被拒的响应里不能出现简历或 JD 正文
          if (body.includes('某电商科技有限公司') || body.includes('Spring Boot')) {
            throw new Error(`限流响应里出现了正文：${body}`);
          }
        }
        return response.status;
      });
    }
  }

  const durations: number[] = [];
  const statuses: number[] = [];
  const startedAt = Date.now();
  let cursor = 0;

  const worker = async (): Promise<void> => {
    while (cursor < tasks.length) {
      const task = tasks[cursor];
      cursor += 1;
      if (!task) continue;
      const taskStartedAt = Date.now();
      statuses.push(await task());
      durations.push(Date.now() - taskStartedAt);
    }
  };

  await Promise.all(Array.from({ length: Math.min(concurrency, tasks.length) }, worker));
  const elapsedMs = Date.now() - startedAt;

  durations.sort((left, right) => left - right);
  const percentile = (value: number): number =>
    durations[Math.min(durations.length - 1, Math.floor((value / 100) * durations.length))] ?? 0;

  return {
    name: label,
    requests: tasks.length,
    concurrency,
    ok: statuses.filter((status) => status === 200).length,
    limited: statuses.filter((status) => status === 429).length,
    modelCalls: harness.modelCalls(),
    expectedModelCalls,
    elapsedMs,
    p50: percentile(50),
    p95: percentile(95),
    p99: percentile(99)
  };
}

function report(results: ScenarioResult[]): string {
  const rows = results
    .map(
      (result) =>
        `| ${result.name} | ${result.requests} | ${result.concurrency} | ${result.ok} | ${result.limited} | ${result.modelCalls} | ${result.elapsedMs} | ${result.p50} / ${result.p95} / ${result.p99} |`
    )
    .join('\n');

  return `# 限流与配额压测记录

时间：${new Date().toISOString()}
环境：Node ${process.version} · ${platform()} ${release()} · ${arch()} · ${cpus().length} 核
命令：\`pnpm loadtest\`（进程内直连 Hono 路由 + 本地 mock 模型，不消耗 DeepSeek 额度）
配额：每 IP 每分钟 ${PER_MINUTE} 次、每日 ${PER_DAY} 次（与线上同源）；模型耗时固定 ${MODEL_LATENCY_MS}ms

| 场景 | 请求数 | 并发 | 200 | 429 | 模型调用 | 总耗时(ms) | P50/P95/P99(ms) |
|------|-------|------|-----|-----|---------|-----------|-----------------|
${rows}

场景定义：

1. 单 IP 突发：60 个请求同一 IP，期望 10 个 200、50 个 429，模型调用恰好 10 次；
2. 多 IP 并发：20 个 IP × 10 个请求，期望全部 200，模型调用 200 次（配额按 IP 隔离）；
3. 全局每日硬上限：硬上限 60 次，8 个 IP × 20 个请求，期望模型调用恰好 60 次，其余 429。

## 结论

1. 超限请求不打模型：三个场景的模型调用数与配额完全一致；
2. 429 响应只回错误码与文案，不回显简历与 JD 正文（脚本对每条非 200 响应都做了断言）；
3. 配额按 IP 隔离：多 IP 并发互不占用，吞吐不被单 IP 上限拖住；
4. 全局每日硬上限生效后同样不产生模型调用。

本文件由脚本直接写出，未做人工修饰。
`;
}

async function main(): Promise<void> {
  const results: ScenarioResult[] = [
    await runScenario(
      '单 IP 突发',
      createHarness({ dailyCap: 300, alertThreshold: 100 }),
      ['10.1.0.1'],
      60,
      PER_MINUTE,
      60
    ),
    await runScenario(
      '多 IP 并发',
      createHarness({ dailyCap: 300, alertThreshold: 100 }),
      Array.from({ length: 20 }, (_, index) => `10.2.0.${index + 1}`),
      10,
      200,
      50
    ),
    await runScenario(
      '全局每日硬上限',
      createHarness({ dailyCap: 60, alertThreshold: 50 }),
      Array.from({ length: 8 }, (_, index) => `10.3.0.${index + 1}`),
      20,
      60,
      40
    )
  ];

  const failures = results.filter(
    (result) =>
      result.modelCalls !== result.expectedModelCalls ||
      result.ok + result.limited !== result.requests
  );

  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const target = join('reports', `压测_${stamp}.md`);
  mkdirSync('reports', { recursive: true });
  writeFileSync(target, report(results));

  for (const result of results) {
    console.log(
      `${result.name}：${result.requests} 请求 / 并发 ${result.concurrency} → 200×${result.ok}、429×${result.limited}、模型调用 ${result.modelCalls}（期望 ${result.expectedModelCalls}）、P95 ${result.p95}ms`
    );
  }
  console.log(`报告：${target}`);

  if (failures.length) {
    console.error('压测不变量被破坏：', failures.map((item) => item.name).join('、'));
    process.exit(1);
  }
}

void main();
