/**
 * 前端预览服务的部署配置检查。
 * 背景：隧道预览或自定义域名部署时，Vite 默认只接受本机 Host，外部访问会被 403 拦截；
 * 同时前端必须与服务端同域，否则会在浏览器侧引入额外的跨域与密钥暴露风险。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

async function loadWebConfig(previewAllowedHosts = '') {
  vi.resetModules();
  vi.stubEnv('PREVIEW_ALLOWED_HOSTS', previewAllowedHosts);
  const module = await import('../apps/web/vite.config');
  return module.default;
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('前端预览服务的部署配置', () => {
  it('前端只调用自建代理，保证与服务端同域', async () => {
    const config = await loadWebConfig();

    expect(config.server?.proxy?.['/api']).toBeDefined();
    expect(config.preview?.proxy?.['/api']).toBeDefined();
  });

  it('未注入域名时不放行任何外部 Host，保留默认防护', async () => {
    const config = await loadWebConfig();

    expect(config.server?.allowedHosts).toEqual([]);
    expect(config.preview?.allowedHosts).toEqual([]);
  });

  it('可从环境变量注入外部域名，供隧道预览与自定义域名部署使用', async () => {
    const config = await loadWebConfig(
      'demo.example.com, miami-evolution-cross-thu.trycloudflare.com'
    );

    expect(config.preview?.allowedHosts).toEqual([
      'demo.example.com',
      'miami-evolution-cross-thu.trycloudflare.com'
    ]);
    expect(config.server?.allowedHosts).toEqual([
      'demo.example.com',
      'miami-evolution-cross-thu.trycloudflare.com'
    ]);
  });
});
