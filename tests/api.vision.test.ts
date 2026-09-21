import { describe, expect, it } from 'vitest';
import { LlmUpstreamError } from '@zhipin/llm';
import { MAX_IMAGE_DATA_URL_LENGTH } from '@zhipin/shared';
import { createApp } from '../apps/api/src/app';
import { createLogger } from '../apps/api/src/logger';
import { createRateLimiter } from '../apps/api/src/ratelimit';
import { createUsageGuard } from '../apps/api/src/usage';
import type { VisionRunner } from '../apps/api/src/routes/vision';

const IMAGE = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQ==';
const JD_TEXT = '公司：某电商科技有限公司\n岗位：Java 后端开发工程师';

function makeVision(behavior: 'ok' | 'empty' | 'upstream' | 'timeout' | 'generic' = 'ok'): {
  vision: VisionRunner;
  calls: string[];
} {
  const calls: string[] = [];

  const vision: VisionRunner = {
    async recognize(image, options = {}) {
      calls.push(image);

      if (behavior === 'upstream') throw new LlmUpstreamError('视觉模型返回状态 401', 401);
      if (behavior === 'generic') throw new Error('unexpected failure');
      if (behavior === 'empty') return { text: '```\n```', elapsedMs: 12 };
      if (behavior === 'timeout') {
        await new Promise((_resolve, reject) => {
          options.signal?.addEventListener('abort', () => reject(new Error('aborted')));
        });
      }
      // 带上前缀，验证服务端会先做 sanitizeOcrText
      return { text: `以下是识别结果：\n${JD_TEXT}`, elapsedMs: 900 };
    }
  };

  return { vision, calls };
}

interface AppOptions {
  behavior?: Parameters<typeof makeVision>[0];
  perMinute?: number;
  timeoutMs?: number;
  logs?: string[];
  usage?: { alertThreshold?: number; dailyCap?: number };
}

function buildApp(options: AppOptions = {}) {
  const { vision, calls } = makeVision(options.behavior ?? 'ok');
  const logs: string[] = options.logs ?? [];
  const app = createApp({
    // /api/vision 与 /api/llm 共用限流与用量，runner 在这里只需要占位
    runner: { runTask: async () => ({ validEvents: 0, invalidLines: 0, firstTokenMs: null, elapsedMs: 0, attempts: 1 }) },
    vision,
    visionTimeoutMs: options.timeoutMs,
    limiter: createRateLimiter({ perMinute: options.perMinute ?? 10, perDay: 100 }),
    logger: createLogger((line) => logs.push(line)),
    usage: options.usage ? createUsageGuard(options.usage) : undefined
  });
  return { app, calls, logs };
}

const post = (app: ReturnType<typeof createApp>, body: unknown, ip = '9.9.9.9') =>
  app.request('/api/vision', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-forwarded-for': ip },
    body: JSON.stringify(body)
  });

describe('POST /api/vision', () => {
  it('识别成功：返回清洗后的文本与耗时，且不回到图片本体', async () => {
    const { app } = buildApp();
    const response = await post(app, { image: IMAGE });
    const body = (await response.json()) as { text: string; elapsedMs: number };

    expect(response.status).toBe(200);
    expect(body.text).toBe(JD_TEXT);
    expect(typeof body.elapsedMs).toBe('number');
    expect(JSON.stringify(body)).not.toContain('data:image');
  });

  it('入参缺失、非图片 data URL 或超长时返回 400，且不调用视觉模型', async () => {
    const { app, calls } = buildApp();

    const missing = await post(app, {});
    expect(missing.status).toBe(400);

    const notImage = await post(app, { image: 'https://example.com/jd.png' });
    expect(notImage.status).toBe(400);
    expect(await notImage.json()).toMatchObject({ code: 'INVALID_INPUT' });

    const tooLong = await post(app, {
      image: `data:image/png;base64,${'A'.repeat(MAX_IMAGE_DATA_URL_LENGTH)}`
    });
    expect(tooLong.status).toBe(400);

    const broken = await app.request('/api/vision', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not-json'
    });
    expect(broken.status).toBe(400);

    expect(calls).toHaveLength(0);
  });

  it('识别结果为空时返回 502 VISION_EMPTY', async () => {
    const { app } = buildApp({ behavior: 'empty' });
    const response = await post(app, { image: IMAGE });

    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({
      code: 'VISION_EMPTY',
      message: '没有识别到文字，建议截取更清晰的范围'
    });
  });

  it('上游报错与未知异常统一映射为 502 VISION_FAILED', async () => {
    const upstream = buildApp({ behavior: 'upstream' });
    const upstreamResponse = await post(upstream.app, { image: IMAGE });
    expect(upstreamResponse.status).toBe(502);
    expect(await upstreamResponse.json()).toMatchObject({ code: 'VISION_FAILED' });

    const generic = buildApp({ behavior: 'generic' });
    const genericResponse = await post(generic.app, { image: IMAGE });
    const text = await genericResponse.text();
    expect(genericResponse.status).toBe(502);
    expect(text).toContain('VISION_FAILED');
    expect(text).not.toContain('unexpected failure');
  });

  it('超过服务端超时上限时中止识别并返回 502', async () => {
    const { app } = buildApp({ behavior: 'timeout', timeoutMs: 30 });
    const response = await post(app, { image: IMAGE });

    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({ code: 'VISION_FAILED' });
  });

  it('沿用现有 IP 限流：超限返回 429 且不消耗模型调用', async () => {
    const { app, calls } = buildApp({ perMinute: 1 });

    expect((await post(app, { image: IMAGE }, '3.3.3.3')).status).toBe(200);

    const blocked = await post(app, { image: IMAGE }, '3.3.3.3');
    expect(blocked.status).toBe(429);
    expect(await blocked.json()).toMatchObject({
      code: 'RATE_LIMITED',
      message: '请求过于频繁，请稍后再试'
    });
    expect(calls).toHaveLength(1);
  });

  it('全局单日用量跨过硬上限后同样拒绝', async () => {
    const { app, calls } = buildApp({ usage: { alertThreshold: 1, dailyCap: 1 } });

    expect((await post(app, { image: IMAGE }, '7.7.7.1')).status).toBe(200);

    const blocked = await post(app, { image: IMAGE }, '7.7.7.2');
    expect(blocked.status).toBe(429);
    expect(calls).toHaveLength(1);
  });

  it('无效入参不占用全局每日额度：口径与 /api/llm 一致', async () => {
    const { app, calls } = buildApp({ usage: { alertThreshold: 1, dailyCap: 1 } });

    for (let index = 0; index < 4; index += 1) {
      expect((await post(app, { image: 'https://example.com/a.png' }, `6.6.8.${index}`)).status).toBe(400);
    }

    expect((await post(app, { image: IMAGE }, '6.6.9.1')).status).toBe(200);
    expect((await post(app, { image: IMAGE }, '6.6.9.2')).status).toBe(429);
    expect(calls).toHaveLength(1);
  });

  it('日志只记任务类型、字节数、耗时与结果状态，不含图片内容与识别文本', async () => {
    const logs: string[] = [];
    const { app } = buildApp({ logs });
    await post(app, { image: IMAGE });

    const record = logs.map((line) => JSON.parse(line)).find((item) => item.event === 'ok');
    expect(record).toMatchObject({ task: 'vision', event: 'ok' });
    expect(typeof record.imageBytes).toBe('number');

    const joined = logs.join('\n');
    expect(joined).not.toContain('data:image');
    expect(joined).not.toContain('某电商科技有限公司');
    expect(joined).not.toContain('base64');
  });

  it('未注入视觉依赖时不注册该路由', async () => {
    const app = createApp({
      runner: { runTask: async () => ({ validEvents: 0, invalidLines: 0, firstTokenMs: null, elapsedMs: 0, attempts: 1 }) },
      limiter: createRateLimiter(),
      logger: createLogger(() => undefined)
    });

    expect((await post(app, { image: IMAGE })).status).toBe(404);
  });
});
