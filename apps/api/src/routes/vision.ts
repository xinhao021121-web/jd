/**
 * JD 图片识别路由：POST /api/vision（技术方案增补 3.1、3.2）。
 * 职责：校验入参 → 限流与用量 → 调用视觉模型 → 清洗识别文本 → 映射错误码。
 * 图片只在当次请求内转发：不落盘、不写日志、不进缓存，日志只记字节数与结果状态。
 */
import type { Context, Hono } from 'hono';
import { z } from 'zod';
import { sanitizeOcrText } from '@zhipin/core';
import { LlmUpstreamError } from '@zhipin/llm';
import {
  ERROR_HTTP_STATUS,
  ERROR_MESSAGES,
  MAX_IMAGE_DATA_URL_LENGTH,
  VISION_INPUT_MESSAGE,
  VISION_TIMEOUT_MS
} from '@zhipin/shared';
import { clientIpFromHeaders } from '../client-ip';
import { hashIp, type Logger } from '../logger';
import type { RateLimiter } from '../ratelimit';
import type { UsageGuard } from '../usage';

/** 单张图片的 data URL；长度上限按 32 MiB 图片折算（技术方案增补 三.3.1、四） */
export const VisionRequestSchema = z.object({
  image: z
    .string()
    .min(1)
    .max(MAX_IMAGE_DATA_URL_LENGTH)
    .refine((value) => value.startsWith('data:image/'), {
      message: VISION_INPUT_MESSAGE
    })
});

export type VisionRequest = z.infer<typeof VisionRequestSchema>;

export interface VisionResult {
  text: string;
  elapsedMs: number;
}

/** 只依赖这一个方法，便于测试注入假模型 */
export interface VisionRunner {
  recognize(imageDataUrl: string, options?: { signal?: AbortSignal }): Promise<VisionResult>;
}

export interface VisionRouteDeps {
  vision: VisionRunner;
  limiter: RateLimiter;
  logger: Logger;
  usage?: UsageGuard;
  /** 服务端超时上限，默认 15 秒（PRD 增补 4.3 目标为单张 ≤8 秒） */
  timeoutMs?: number;
  now?: () => number;
  clientIp?: (c: Context) => string;
}

/** 与 /api/llm 共用同一份取键实现：CF-Connecting-IP → XFF 第一跳 → X-Real-IP → unknown */
function defaultClientIp(c: Context): string {
  return clientIpFromHeaders((name) => c.req.header(name));
}

export function registerVisionRoute(app: Hono, deps: VisionRouteDeps): void {
  const timeoutMs = deps.timeoutMs ?? VISION_TIMEOUT_MS;
  const now = deps.now ?? (() => Date.now());
  const clientIp = deps.clientIp ?? defaultClientIp;

  app.post('/api/vision', async (c: Context) => {
    const startedAt = now();
    const ip = clientIp(c);
    const ipHash = hashIp(ip);

    // 限流先于模型调用：超限不消耗任何模型额度，也不单列图片识别配额
    const decision = await deps.limiter.check(ip);
    if (!decision.allowed) {
      deps.logger.warn({ event: 'rate_limited', task: 'vision', ipHash, errorType: decision.limit });
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

    const parsed = VisionRequestSchema.safeParse(payload);
    if (!parsed.success) {
      deps.logger.warn({ event: 'invalid_input', task: 'vision', ipHash, errorType: 'INVALID_INPUT' });
      return c.json(
        { code: 'INVALID_INPUT', message: VISION_INPUT_MESSAGE },
        ERROR_HTTP_STATUS.INVALID_INPUT as 400
      );
    }

    // 全局单日用量：口径与 /api/llm 一致，放在入参校验之后，只统计真正会发起模型调用的请求
    if (deps.usage) {
      const usage = await deps.usage.check();
      if (usage.exceeded) {
        deps.logger.warn({ event: 'rate_limited', task: 'vision', ipHash, errorType: 'DAILY_CAP' });
        return c.json(
          { code: 'RATE_LIMITED', message: ERROR_MESSAGES.RATE_LIMITED },
          ERROR_HTTP_STATUS.RATE_LIMITED as 429
        );
      }
      if (usage.alert) {
        deps.logger.warn({
          event: 'usage_alert',
          task: 'vision',
          ipHash,
          errorType: 'DAILY_CALL_ALERT',
          count: (await deps.usage.snapshot()).count
        });
      }
    }

    const { image } = parsed.data;
    // 只估算字节数用于日志与排查，图片本体不写日志
    const imageBytes = Math.floor((image.length * 3) / 4);
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), timeoutMs);

    try {
      const result = await deps.vision.recognize(image, { signal: abort.signal });
      const text = sanitizeOcrText(result.text);
      const elapsedMs = now() - startedAt;

      if (!text) {
        deps.logger.warn({
          event: 'error',
          task: 'vision',
          ipHash,
          imageBytes,
          elapsedMs,
          errorType: 'VISION_EMPTY'
        });
        return c.json(
          { code: 'VISION_EMPTY', message: ERROR_MESSAGES.VISION_EMPTY },
          ERROR_HTTP_STATUS.VISION_EMPTY as 502
        );
      }

      deps.logger.log({ event: 'ok', task: 'vision', ipHash, imageBytes, elapsedMs });
      return c.json({ text, elapsedMs });
    } catch (error) {
      const errorType = abort.signal.aborted
        ? 'VISION_TIMEOUT'
        : error instanceof LlmUpstreamError
          ? 'UPSTREAM_ERROR'
          : 'UNKNOWN_ERROR';
      deps.logger.warn({
        event: 'error',
        task: 'vision',
        ipHash,
        imageBytes,
        elapsedMs: now() - startedAt,
        errorType
      });
      return c.json(
        { code: 'VISION_FAILED', message: ERROR_MESSAGES.VISION_FAILED },
        ERROR_HTTP_STATUS.VISION_FAILED as 502
      );
    } finally {
      clearTimeout(timer);
    }
  });
}
