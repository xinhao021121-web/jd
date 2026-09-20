import { describe, expect, it } from 'vitest';
import type { OutputEvent, StreamEvent } from '@zhipin/shared';
import { createApp } from '../apps/api/src/app';
import { createLogger } from '../apps/api/src/logger';
import { createRateLimiter } from '../apps/api/src/ratelimit';
import type { TaskRunner } from '../apps/api/src/routes/llm';
import { SAMPLE_JD, SAMPLE_RESUME } from './fixtures';

/** 干净话术：数字与技能都能在 SAMPLE_RESUME 里找到依据 */
const CLEAN_TEXT =
  '您好，我有 3 年 Java 后端开发经验，主导过订单查询接口性能优化，把 P99 响应时间从 800ms 降到 180ms，想和您聊聊这个岗位的具体需求。';

function buildApp(events: OutputEvent[], logs: string[] = []) {
  const runner: TaskRunner = {
    async runTask(_task, _input, options = {}) {
      for (const event of events) await options.onEvent?.(event);
      return {
        validEvents: events.length,
        invalidLines: 0,
        firstTokenMs: 10,
        elapsedMs: 20,
        attempts: 1
      };
    }
  };

  const app = createApp({
    runner,
    limiter: createRateLimiter({ perMinute: 10, perDay: 100 }),
    logger: createLogger((line) => logs.push(line))
  });
  return { app, logs };
}

const post = (app: ReturnType<typeof createApp>, task: 'greeting' | 'suggestions') =>
  app.request('/api/llm', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '5.5.5.5' },
    body: JSON.stringify({ task, resume: SAMPLE_RESUME, jd: SAMPLE_JD })
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

function greetingItems(events: StreamEvent[]) {
  return events.filter(
    (event): event is Extract<StreamEvent, { kind: 'greeting' }> =>
      event.type === 'item' && event.kind === 'greeting'
  );
}

describe('话术事件的本地赋值', () => {
  it('index 与 style 按回传顺序重写，模型标错也不影响展示', async () => {
    const { app } = buildApp([
      // 模型把第一条标成「简短直接型」且 index 重复
      { type: 'item', kind: 'greeting', index: 7, style: '简短直接型', text: CLEAN_TEXT },
      { type: 'item', kind: 'greeting', index: 7, style: '简短直接型', text: `${CLEAN_TEXT}（第二条）` },
      { type: 'item', kind: 'greeting', index: 7, style: '简短直接型', text: `${CLEAN_TEXT}（第三条）` }
    ]);

    const items = greetingItems(parseSse(await (await post(app, 'greeting')).text()));

    expect(items.map((item) => item.index)).toEqual([0, 1, 2]);
    expect(items.map((item) => item.style)).toEqual(['技能匹配型', '经历相关型', '简短直接型']);
  });

  it('模型不输出 index / style 时由服务端补齐，不再因此丢行', async () => {
    const { app } = buildApp([{ type: 'item', kind: 'greeting', text: CLEAN_TEXT }]);

    const items = greetingItems(parseSse(await (await post(app, 'greeting')).text()));

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ index: 0, style: '技能匹配型' });
  });
});

describe('逐条本地自检', () => {
  it('合规话术不带 issues 字段', async () => {
    const { app } = buildApp([
      { type: 'item', kind: 'greeting', text: CLEAN_TEXT },
      { type: 'item', kind: 'greeting', text: `${CLEAN_TEXT}（第二条）` },
      { type: 'item', kind: 'greeting', text: `${CLEAN_TEXT}（第三条）` }
    ]);

    const items = greetingItems(parseSse(await (await post(app, 'greeting')).text()));

    expect(items.every((item) => item.issues === undefined)).toBe(true);
  });

  it('编造数字、技能与套话会被标注，但仍回传给用户去核对', async () => {
    const { app, logs } = buildApp([
      {
        type: 'item',
        kind: 'greeting',
        text: `${CLEAN_TEXT}贵公司岗位我非常感兴趣，负责日均 9999 万次请求，熟悉 Golang。`
      }
    ]);

    const items = greetingItems(parseSse(await (await post(app, 'greeting')).text()));
    const issues = items[0]?.issues ?? [];

    expect(items).toHaveLength(1);
    expect(issues.join(' ')).toContain('9999万');
    expect(issues.join(' ')).toContain('Go');
    expect(issues.join(' ')).toContain('贵公司');

    // 日志只记命中条数，不记话术正文
    const ok = logs.map((line) => JSON.parse(line)).find((record) => record.event === 'ok');
    expect(ok.errorType).toBe('FLAGGED_1');
    expect(logs.join('\n')).not.toContain('9999');
  });

  it('模型自带 issues 会被本地结果覆盖，无法伪造通过自检', async () => {
    const { app } = buildApp([
      {
        type: 'item',
        kind: 'greeting',
        issues: [],
        // 模型声称没有 skills 问题，但 「Golang」 确实不在简历里
        text: `${CLEAN_TEXT}熟悉 Golang。`
      } as OutputEvent
    ]);

    const items = greetingItems(parseSse(await (await post(app, 'greeting')).text()));

    expect(items[0]?.issues?.join(' ')).toContain('Go');
  });

  it('改写建议引入新数字时被标注，越界建议仍直接丢弃', async () => {
    const { app } = buildApp([
      {
        type: 'item',
        kind: 'suggestion',
        section: '工作经历',
        before: '主导订单查询接口性能优化，通过 Redis 缓存与 SQL 优化将 P99 响应时间从 800ms 降到 180ms',
        after:
          '主导订单查询接口性能优化，通过 Redis 缓存与 SQL 优化将 P99 响应时间从 800ms 降到 180ms，QPS 提升 300%',
        reason: '补一个结果指标'
      },
      {
        type: 'item',
        kind: 'suggestion',
        section: '教育背景',
        before: '某某大学  计算机科学与技术  本科  2021 届',
        after: '某某大学  计算机科学与技术  本科  2021 届（重点院校）',
        reason: '越界示例'
      }
    ]);

    const responses = parseSse(await (await post(app, 'suggestions')).text());
    const suggestions = responses.filter(
      (event): event is Extract<StreamEvent, { kind: 'suggestion' }> =>
        event.type === 'item' && event.kind === 'suggestion'
    );

    expect(suggestions).toHaveLength(1);
    expect(suggestions[0]?.issues?.join(' ')).toContain('300%');
    expect(JSON.stringify(responses)).not.toContain('重点院校');
  });
});
