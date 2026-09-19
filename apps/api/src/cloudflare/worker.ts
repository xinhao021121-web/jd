/**
 * Cloudflare Workers 入口（技术方案 十.1 的迁移路径）。
 * 同一个地址提供前端静态资源与 /api/llm：前端与 API 同域，无需 CORS，
 * 密钥来自 Worker Secret，限流与每日配额由 Durable Object 保存。
 */
import { createLlmClient } from '@zhipin/llm';
import { createApp } from '../app';
import { createLogger } from '../logger';
import { Counters, createCountersClient } from './counters';
import type { DurableObjectNamespace, Fetcher } from './types';

export { Counters };

export interface WorkerEnv {
  ASSETS: Fetcher;
  COUNTERS: DurableObjectNamespace;
  DEEPSEEK_API_KEY: string;
  DEEPSEEK_BASE_URL?: string;
  DEEPSEEK_MODEL?: string;
}

/** 只有 /api/* 与健康检查进服务端，其余交给静态资源 */
function isApiPath(pathname: string): boolean {
  return pathname === '/healthz' || pathname.startsWith('/api/');
}

export default {
  async fetch(request: Request, env: WorkerEnv): Promise<Response> {
    if (!isApiPath(new URL(request.url).pathname)) {
      return env.ASSETS.fetch(request);
    }

    const counters = createCountersClient(env.COUNTERS);
    const app = createApp({
      runner: createLlmClient({
        baseUrl: env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com/v1',
        apiKey: env.DEEPSEEK_API_KEY,
        model: env.DEEPSEEK_MODEL ?? 'deepseek-chat'
      }),
      limiter: counters.limiter,
      logger: createLogger(),
      usage: counters.usage
    });

    return app.fetch(request);
  }
};
