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

/**
 * Vite 默认只接受本机 Host，隧道预览或自定义域名会被 403 拦截。
 * 部署时用 PREVIEW_ALLOWED_HOSTS 注入域名（逗号分隔）；本地开发留空即保持默认防护。
 */
const allowedHosts = (process.env.PREVIEW_ALLOWED_HOSTS ?? '')
  .split(',')
  .map((host) => host.trim())
  .filter(Boolean);

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@zhipin/core': resolveFromRoot('../../packages/core/src/index.ts'),
      '@zhipin/shared': resolveFromRoot('../../packages/shared/src/index.ts')
    }
  },
  server: { port: 5173, proxy: apiProxy, allowedHosts },
  preview: { port: 4173, proxy: apiProxy, allowedHosts },
  build: { outDir: 'dist', emptyOutDir: true }
});
