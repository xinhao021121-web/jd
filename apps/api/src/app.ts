import { Hono } from 'hono';
import { ERROR_MESSAGES } from '@zhipin/shared';
import { registerLlmRoute, type LlmRouteDeps } from './routes/llm';

export type AppDeps = LlmRouteDeps;

export function createApp(deps: AppDeps): Hono {
  const app = new Hono();

  // 只有一个业务路由，健康检查供部署与端到端测试使用
  app.get('/healthz', (c) => c.json({ ok: true }));
  registerLlmRoute(app, deps);

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
