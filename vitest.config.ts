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
    include: ['tests/**/*.test.ts'],
    /**
     * 覆盖率口径（项目评审标准 三.7 的证据形式）：
     * - 范围是「单测能覆盖到的层」：三个包 + 服务端；前端组件由端到端用例覆盖，不计入这里；
     * - mock-model 只服务于本地联调与端到端，不做单测覆盖；
     * - 阈值取在实测值下方，作用是拦住大幅退化，不是逐行目标（core 的目标见评审记录）。
     */
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['packages/*/src/**', 'apps/api/src/**'],
      exclude: ['apps/api/src/mock-model.ts'],
      thresholds: {
        statements: 80,
        lines: 80,
        functions: 80,
        branches: 80
      }
    }
  }
});
