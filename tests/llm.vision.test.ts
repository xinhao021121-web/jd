import { describe, expect, it } from 'vitest';
import { LlmUpstreamError, buildVisionMessages, createVisionClient } from '@zhipin/llm';

const IMAGE = 'data:image/jpeg;base64,/9j/4AAQSkZJRg==';

interface CapturedCall {
  url: string;
  headers: Record<string, string>;
  body: {
    model?: string;
    stream?: boolean;
    messages?: { role: string; content: unknown }[];
  };
}

function makeFetch(payload: unknown, status = 200): { fetchImpl: never; calls: CapturedCall[] } {
  const calls: CapturedCall[] = [];

  const fetchImpl = async (url: string, init: { headers: Record<string, string>; body: string }) => {
    calls.push({ url, headers: init.headers, body: JSON.parse(init.body) as CapturedCall['body'] });
    return new Response(JSON.stringify(payload), {
      status,
      headers: { 'Content-Type': 'application/json' }
    });
  };

  return { fetchImpl: fetchImpl as never, calls };
}

describe('buildVisionMessages', () => {
  it('规则写 system，指令与图片写 user；图片不带 detail，保持默认识别精度', () => {
    const messages = buildVisionMessages(IMAGE);

    expect(messages).toHaveLength(2);
    expect(messages[0]?.role).toBe('system');
    expect(typeof messages[0]?.content).toBe('string');
    expect(messages[0]?.content).toContain('不总结、不改写、不补充');

    const user = messages[1];
    expect(user?.role).toBe('user');
    expect(Array.isArray(user?.content)).toBe(true);

    const blocks = user?.content as { type: string; text?: string; image_url?: unknown }[];
    expect(blocks[0]).toMatchObject({ type: 'text' });
    expect(blocks[1]).toEqual({ type: 'image_url', image_url: { url: IMAGE } });

    // 图片只能放在 user 消息里，system 里不能出现 data URL
    expect(String(messages[0]?.content)).not.toContain('data:image');
    expect(JSON.stringify(blocks)).not.toContain('detail');
  });
});

describe('createVisionClient', () => {
  const config = { baseUrl: 'https://api.deepseek.com/v1', apiKey: 'sk-test', model: 'deepseek-flash' };

  it('非流式调用聊天接口并返回识别文本与耗时', async () => {
    const { fetchImpl, calls } = makeFetch({
      choices: [{ message: { content: '公司：某电商科技\n岗位：Java 开发' } }]
    });
    const client = createVisionClient({ ...config, fetchImpl });

    const result = await client.recognize(IMAGE);

    expect(result.text).toBe('公司：某电商科技\n岗位：Java 开发');
    expect(result.elapsedMs).toBeGreaterThanOrEqual(0);

    expect(client.endpoint).toBe('https://api.deepseek.com/v1/chat/completions');
    expect(calls[0]?.url).toBe('https://api.deepseek.com/v1/chat/completions');
    expect(calls[0]?.headers.Authorization).toBe('Bearer sk-test');
    expect(calls[0]?.body).toMatchObject({ model: 'deepseek-flash', stream: false });
  });

  it('上游状态异常抛出 LlmUpstreamError，带上状态码', async () => {
    const { fetchImpl } = makeFetch({ error: 'invalid api key' }, 401);
    const client = createVisionClient({ ...config, fetchImpl });

    await expect(client.recognize(IMAGE)).rejects.toBeInstanceOf(LlmUpstreamError);
    await expect(client.recognize(IMAGE)).rejects.toMatchObject({ status: 401 });
  });

  it('没有 choices 时返回空文本，交给上层按 VISION_EMPTY 处理', async () => {
    const { fetchImpl } = makeFetch({});
    const client = createVisionClient({ ...config, fetchImpl });

    await expect(client.recognize(IMAGE)).resolves.toMatchObject({ text: '' });
  });
});
