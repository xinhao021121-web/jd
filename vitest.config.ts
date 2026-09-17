import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const resolveFromRoot = (relativePath: string) =>
  fileURLToPath(new URL(relativePath, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@zhipin/core': resolveFromRoot('./packages/core/src/index.ts'),
      '@zhipin/llm': resolveFromRoot('./packages/llm/src/index.ts'),
      '@zhipin/shared': resolveFromRoot('./packages/shared/src/index.ts')
    }
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts']
  }
});
