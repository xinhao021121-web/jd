import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const resolveFromRoot = (relativePath: string) =>
  fileURLToPath(new URL(relativePath, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@zhipin/core': resolveFromRoot('./packages/core/src/index.ts'),
      '@zhipin/llm': resolveFromRoot('./packages/llm/src/index.ts'),
      '@zhipin/shared': resolveFromRoot('./packages/shared/src/index.ts'),
      // Word 往返测试要解包真实样本；复用 web 侧已有的 fflate，不给根目录新增依赖
      fflate: resolveFromRoot('./apps/web/node_modules/fflate')
    }
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts']
  }
});
