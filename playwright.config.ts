import { defineConfig } from '@playwright/test';

/**
 * 端到端测试：前端走 vite preview，服务端走真实路由，模型替换为本地 mock（技术方案 八）。
 * 运行：pnpm test:e2e（脚本会先构建前端）
 */
export default defineConfig({
  testDir: './tests/e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:4173',
    permissions: ['clipboard-read', 'clipboard-write'],
    trace: 'off'
  },
  webServer: [
    {
      command: 'pnpm --filter @zhipin/api exec tsx src/mock-model.ts',
      url: 'http://127.0.0.1:8788/healthz',
      reuseExistingServer: true,
      timeout: 60_000,
      env: { MOCK_MODEL_PORT: '8788' }
    },
    {
      command: 'pnpm --filter @zhipin/api exec tsx src/server.ts',
      url: 'http://127.0.0.1:8787/healthz',
      reuseExistingServer: true,
      timeout: 60_000,
      env: {
        DEEPSEEK_API_KEY: 'sk-e2e-local',
        DEEPSEEK_BASE_URL: 'http://127.0.0.1:8788/v1',
        DEEPSEEK_MODEL: 'mock-chat',
        PORT: '8787'
      }
    },
    {
      command: 'pnpm --filter @zhipin/web preview',
      url: 'http://127.0.0.1:4173',
      reuseExistingServer: true,
      timeout: 60_000
    }
  ]
});
