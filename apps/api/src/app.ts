import { Hono } from 'hono';
import { ERROR_MESSAGES } from '@zhipin/shared';
import { registerLlmRoute, type LlmRouteDeps } from './routes/llm';
import { registerVisionRoute, type VisionRunner } from './routes/vision';

export type AppDeps = LlmRouteDeps & {
  /** 视觉识别依赖；未提供时不注册 /api/vision（不需要图片识别的单测与本地调试用不到） */
  vision?: VisionRunner;
  visionTimeoutMs?: number;
};

export function createApp(deps: AppDeps): Hono {
  const app = new Hono();

  // 两个业务路由，健康检查供部署与端到端测试使用
  app.get('/healthz', (c) => c.json({ ok: true }));
  registerLlmRoute(app, deps);
  if (deps.vision) {
    registerVisionRoute(app, {
      vision: deps.vision,
      limiter: deps.limiter,
      logger: deps.logger,
      usage: deps.usage,
      timeoutMs: deps.visionTimeoutMs,
      now: deps.now,
      clientIp: deps.clientIp
    });
  }

  app.notFound((c) => c.json({ code: 'NOT_FOUND', message: '接口不存在' }, 404));
  app.onError((error, c) => {
    deps.logger.warn({ event: 'error', ipHash: 'unknown', errorType: error.name });
    return c.json(
      { code: 'UPSTREAM_ERROR', message: ERROR_MESSAGES.UPSTREAM_ERROR },
      502
    );
  });

  return app;
}
