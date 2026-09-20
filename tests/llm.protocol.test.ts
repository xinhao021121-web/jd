import { describe, expect, it, vi } from 'vitest';
import {
  LlmUpstreamError,
  NdjsonDecoder,
  buildMessages,
  createLlmClient,
  decodeNdjsonLine,
  type FetchLike
} from '@zhipin/llm';
import type { OutputEvent } from '@zhipin/shared';
import { SAMPLE_JD, SAMPLE_RESUME } from './fixtures';

const greetingLine = JSON.stringify({
  type: 'item',
  kind: 'greeting',
  index: 0,
  style: '技能匹配型',
  text: '您好，我有 3 年 Java 后端经验，熟悉 Redis 与 Kafka。'
});

const suggestionLine = JSON.stringify({
  type: 'item',
  kind: 'suggestion',
  index: 0,
  section: '工作经历',
  before: '主导订单查询接口性能优化',
  after: '主导订单查询接口性能优化（高并发场景）',
  reason: '补上岗位关注的术语标签'
});

describe('decodeNdjsonLine', () => {
  it('解析合法的话术与建议事件', () => {
    expect(decodeNdjsonLine(greetingLine).event).toMatchObject({ kind: 'greeting', index: 0 });
    expect(decodeNdjsonLine(suggestionLine).event).toMatchObject({ kind: 'suggestion' });
  });

  it('容忍 Markdown 围栏与 data: 前缀', () => {
    expect(decodeNdjsonLine('```json').event).toBeNull();
    expect(decodeNdjsonLine(`data: ${greetingLine}`).event).toMatchObject({ kind: 'greeting' });
  });

  it('非法 JSON、空行与缺字段的行被丢弃', () => {
    expect(decodeNdjsonLine('不是 JSON').event).toBeNull();
    expect(decodeNdjsonLine('   ').event).toBeNull();
    expect(decodeNdjsonLine('{"type":"item","kind":"greeting"}').event).toBeNull();
    expect(
      decodeNdjsonLine('{"type":"item","kind":"greeting","index":0,"style":"未知风格","text":"x"}')
        .event
    ).toBeNull();
  });
});

describe('NdjsonDecoder', () => {
  it('跨 chunk 的行会被拼回完整事件', () => {
    const decoder = new NdjsonDecoder();
    const mid = Math.floor(greetingLine.length / 2);

    expect(decoder.push(greetingLine.slice(0, mid))).toHaveLength(0);
    expect(decoder.push(`${greetingLine.slice(mid)}\n`)).toHaveLength(1);
    expect(decoder.invalidLines).toBe(0);
  });

  it('一次推送多行时按顺序返回，并统计无效行', () => {
    const decoder = new NdjsonDecoder();
    const events = decoder.push(`${greetingLine}\n坏行\n${suggestionLine}\n`);

    expect(events.filter((e) => e.type === 'item').map((e) => e.kind)).toEqual([
      'greeting',
      'suggestion'
    ]);
    expect(decoder.invalidLines).toBe(1);
  });

  it('flush 会处理没有换行结尾的最后一行', () => {
    const decoder = new NdjsonDecoder();
    expect(decoder.push(greetingLine)).toHaveLength(0);
    expect(decoder.flush()).toHaveLength(1);
    expect(decoder.flush()).toHaveLength(0);
  });
});

describe('buildMessages', () => {
  it('话术提示词包含事实溯源、长度与三种切入点', () => {
    const [system, user] = buildMessages('greeting', { resume: SAMPLE_RESUME, jd: SAMPLE_JD });

    expect(system?.content).toContain('事实溯源');
    expect(system?.content).toContain('100~160');
    expect(system?.content).toContain('技能匹配型');
    expect(system?.content).toContain('NDJSON');
    expect(user?.content).toContain('简历原文');
    expect(user?.content).toContain('Java');
  });

  it('改写提示词给出可改写区块清单与锁定约束', () => {
    const [system, user] = buildMessages('suggestions', { resume: SAMPLE_RESUME, jd: SAMPLE_JD });

    expect(system?.content).toContain('教育经历');
    expect(system?.content).toContain('不得跨行');
    expect(system?.content).toContain('撑长原文行');
    expect(user?.content).toContain('【工作经历】');
    expect(user?.content).toContain('【专业技能】');
    expect(user?.content).not.toContain('【教育背景】');
  });

  it('不让模型自检，也不要求输出本地已知的 index 与 style', () => {
    const [greeting, greetingUser] = buildMessages('greeting', {
      resume: SAMPLE_RESUME,
      jd: SAMPLE_JD
    });
    const [suggestions] = buildMessages('suggestions', { resume: SAMPLE_RESUME, jd: SAMPLE_JD });

    expect(greeting?.content).not.toContain('自检');
    expect(greeting?.content).not.toContain('"style"');
    expect(suggestions?.content).not.toContain('"index"');
    expect(greetingUser?.content).toContain('【简历原文】');
  });

  it('建议任务不再重复投喂简历全文，只发可改写区块与锁定标题', () => {
    const [, user] = buildMessages('suggestions', { resume: SAMPLE_RESUME, jd: SAMPLE_JD });
    const content = String(user?.content);

    // 锁定区块的正文不再进入请求体，只保留标题
    expect(content).not.toContain('某某大学  计算机科学与技术');
    expect(content).toContain('「教育背景」');
    // 可改写区块的原文只出现一次
    expect(content.split('主导订单查询接口性能优化，通过 Redis').length - 1).toBe(1);
  });
});

function sseResponse(lines: string[]): Response {
  const payload = lines
    .map((line) => `data: ${JSON.stringify({ choices: [{ delta: { content: line } }] })}\n\n`)
    .join('');
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(`${payload}data: [DONE]\n\n`));
      controller.close();
    }
  });
  return new Response(stream, { status: 200 });
}

/** 兼容端点在 include_usage 下把用量放在最后一个 chunk，且该 chunk 通常不带 content */
function sseResponseWithUsage(
  lines: string[],
  usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number }
): Response {
  const payload = lines
    .map((line) => `data: ${JSON.stringify({ choices: [{ delta: { content: line } }] })}\n\n`)
    .join('');
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(
        encoder.encode(
          `${payload}data: ${JSON.stringify({ choices: [], usage })}\n\ndata: [DONE]\n\n`
        )
      );
      controller.close();
    }
  });
  return new Response(stream, { status: 200 });
}

function makeClient(handler: FetchLike) {
  return createLlmClient({
    baseUrl: 'https://example.test/v1/',
    apiKey: 'sk-test-key',
    model: 'deepseek-chat',
    fetchImpl: handler
  });
}

describe('createLlmClient', () => {
  it('按行解析流式内容并回调事件', async () => {
    const fetchImpl = vi.fn<FetchLike>(async () =>
      sseResponse([`${greetingLine}\n`, `${suggestionLine}\n`])
    );
    const client = makeClient(fetchImpl);
    const events: OutputEvent[] = [];

    const result = await client.runTask(
      'greeting',
      { resume: SAMPLE_RESUME, jd: SAMPLE_JD },
      { onEvent: (event) => void events.push(event) }
    );

    expect(events.filter((e) => e.type === 'item').map((e) => e.kind)).toEqual([
      'greeting',
      'suggestion'
    ]);
    expect(result).toMatchObject({ validEvents: 2, invalidLines: 0, attempts: 1 });
    expect(result.firstTokenMs).not.toBeNull();
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe('https://example.test/v1/chat/completions');
    expect(init.headers.Authorization).toBe('Bearer sk-test-key');
    expect(JSON.parse(init.body)).toMatchObject({
      model: 'deepseek-chat',
      stream: true,
      stream_options: { include_usage: true }
    });
  });

  it('把 token 用量带回结果，供成本观测使用', async () => {
    const client = makeClient(async () =>
      sseResponseWithUsage([`${greetingLine}\n`], {
        prompt_tokens: 1200,
        completion_tokens: 90,
        total_tokens: 1290
      })
    );
    const result = await client.runTask('greeting', { resume: SAMPLE_RESUME, jd: SAMPLE_JD });

    expect(result.tokenUsage).toEqual({
      promptTokens: 1200,
      completionTokens: 90,
      totalTokens: 1290
    });
  });

  it('端点不返回用量时保持 0，不报错也不阻断生成', async () => {
    const client = makeClient(async () => sseResponse([`${greetingLine}\n`]));
    const result = await client.runTask('greeting', { resume: SAMPLE_RESUME, jd: SAMPLE_JD });

    expect(result.validEvents).toBe(1);
    expect(result.tokenUsage).toEqual({ promptTokens: 0, completionTokens: 0, totalTokens: 0 });
  });

  it('重试时两次用量一起计入：上游两次都已经计费', async () => {
    let attempt = 0;
    const client = makeClient(async () => {
      attempt += 1;
      return attempt === 1
        ? sseResponseWithUsage(['完全不是 JSON 的回复\n'], {
            prompt_tokens: 100,
            completion_tokens: 10,
            total_tokens: 110
          })
        : sseResponseWithUsage([`${greetingLine}\n`], {
            prompt_tokens: 100,
            completion_tokens: 20,
            total_tokens: 120
          });
    });
    const result = await client.runTask('greeting', { resume: SAMPLE_RESUME, jd: SAMPLE_JD });

    expect(result.attempts).toBe(2);
    expect(result.tokenUsage).toEqual({
      promptTokens: 200,
      completionTokens: 30,
      totalTokens: 230
    });
  });

  it('整份输出无法解析时重试一次，第二次成功则正常返回', async () => {
    const fetchImpl = vi.fn<FetchLike>(async (input) =>
      input ? sseResponse(['这不是 NDJSON\n', '```json\n', '```\n']) : sseResponse([])
    );
    let attempt = 0;
    const handler: FetchLike = async (url, init) => {
      attempt += 1;
      if (attempt === 1) return sseResponse(['完全不是 JSON 的回复\n']);
      return sseResponse([`${greetingLine}\n`]);
    };
    void fetchImpl;

    const client = makeClient(handler);
    const events: OutputEvent[] = [];
    const result = await client.runTask(
      'greeting',
      { resume: SAMPLE_RESUME, jd: SAMPLE_JD },
      { onEvent: (event) => void events.push(event) }
    );

    expect(result.attempts).toBe(2);
    expect(events).toHaveLength(1);
    expect(result.validEvents).toBe(1);
  });

  it('两次都无法解析时返回 0 个有效事件，交给上层报错', async () => {
    const client = makeClient(async () => sseResponse(['坏行一\n', '坏行二\n']));
    const result = await client.runTask('greeting', { resume: SAMPLE_RESUME, jd: SAMPLE_JD });

    expect(result.attempts).toBe(2);
    expect(result.validEvents).toBe(0);
    expect(result.invalidLines).toBe(4);
  });

  it('模型返回非 2xx 时抛出 LlmUpstreamError', async () => {
    const client = makeClient(async () => new Response('unauthorized', { status: 401 }));

    await expect(
      client.runTask('greeting', { resume: SAMPLE_RESUME, jd: SAMPLE_JD })
    ).rejects.toBeInstanceOf(LlmUpstreamError);
  });

  it('data 行里出现非法 JSON 时跳过该行，不影响后面的内容', async () => {
    const encoder = new TextEncoder();
    const client = makeClient(async () => {
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(encoder.encode('data: {这不是 JSON\n\n'));
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({ choices: [{ delta: { content: `${greetingLine}\n` } }] })}\n\n`
            )
          );
          controller.enqueue(encoder.encode('data: [DONE]\n\n'));
          controller.close();
        }
      });
      return new Response(stream, { status: 200 });
    });

    const result = await client.runTask('greeting', { resume: SAMPLE_RESUME, jd: SAMPLE_JD });

    expect(result.validEvents).toBe(1);
    expect(result.invalidLines).toBe(0);
  });

  it('请求头与请求体里带上密钥，但密钥不会出现在返回结果中', async () => {
    let captured = '';
    const client = makeClient(async (_url, init) => {
      captured = init.body;
      return sseResponse([`${greetingLine}\n`]);
    });

    const result = await client.runTask('greeting', { resume: SAMPLE_RESUME, jd: SAMPLE_JD });
    expect(captured).toContain('messages');
    expect(JSON.stringify(result)).not.toContain('sk-test-key');
  });
});
