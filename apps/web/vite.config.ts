import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const resolveFromRoot = (relativePath: string) =>
  fileURLToPath(new URL(relativePath, import.meta.url));

/** 前端只调用自建代理，密钥与服务地址都在服务端（技术方案 4） */
const apiProxy = {
  '/api': {
    target: 'http://127.0.0.1:8787',
    changeOrigin: true
  }
};

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@zhipin/core': resolveFromRoot('../../packages/core/src/index.ts'),
      '@zhipin/shared': resolveFromRoot('../../packages/shared/src/index.ts')
    }
  },
  server: { port: 5173, proxy: apiProxy },
  preview: { port: 4173, proxy: apiProxy },
  build: { outDir: 'dist', emptyOutDir: true }
});
