import { serve } from '@hono/node-server';
import { fileURLToPath } from 'node:url';
import { createLlmClient, createVisionClient } from '@zhipin/llm';
import { RATE_LIMIT } from '@zhipin/shared';
import { createApp } from './app';
import { loadEnvFile, readEnv } from './env';
import { createLogger } from './logger';
import { createRateLimiter } from './ratelimit';
import { createUsageGuard } from './usage';

// 本地开发读取仓库根目录的 .env；已存在的环境变量优先，部署时无需该文件
loadEnvFile(fileURLToPath(new URL('../../../.env', import.meta.url)));

const env = readEnv();
const client = createLlmClient({
  baseUrl: env.baseUrl,
  apiKey: env.apiKey,
  model: env.model
});
// 视觉识别与文本生成共用同一把密钥与端点，只是模型不同（技术方案增补 四）
const vision = createVisionClient({
  baseUrl: env.baseUrl,
  apiKey: env.apiKey,
  model: env.visionModel
});

const app = createApp({
  runner: client,
  vision,
  limiter: createRateLimiter({ perMinute: RATE_LIMIT.perMinute, perDay: RATE_LIMIT.perDay }),
  logger: createLogger(),
  usage: createUsageGuard({
    alertThreshold: env.dailyCallAlert,
    dailyCap: env.dailyCallCap
  })
});

serve({ fetch: app.fetch, port: env.port }, (info) => {
  console.log(
    JSON.stringify({ level: 'info', event: 'listening', port: info.port, model: env.model })
  );
});
