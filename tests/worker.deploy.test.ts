/**
 * 部署配置契约检查。
 * Workers 是无状态的：限流与每日配额一旦离开 Durable Object 就不再成立（PRD 4.1 的成本边界）。
 * 这里把关键配置钉住，避免后续改动把这道边界静默改没了。
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const wrangler = readFileSync(new URL('../apps/api/wrangler.toml', import.meta.url), 'utf8');
const worker = readFileSync(
  new URL('../apps/api/src/cloudflare/worker.ts', import.meta.url),
  'utf8'
);

describe('Cloudflare 部署配置', () => {
  it('保留限流与每日配额所需的 Durable Object 绑定', () => {
    expect(wrangler).toContain('name = "COUNTERS"');
    expect(wrangler).toContain('class_name = "Counters"');
    // 免费计划的 Durable Object 必须用 SQLite 存储后端，换成 new_classes 会部署失败
    expect(wrangler).toContain('new_sqlite_classes = ["Counters"]');
  });

  it('前端静态资源与 API 同域，Worker 先接请求', () => {
    expect(wrangler).toContain('binding = "ASSETS"');
    expect(wrangler).toContain('run_worker_first = true');
    expect(worker).toContain('env.ASSETS.fetch');
  });

  it('公开部署的每日上限是有限值，不会退化成无限制', () => {
    const matched = /DAILY_CALL_CAP\s*=\s*"(\d+)"/.exec(wrangler);
    expect(matched).not.toBeNull();

    const cap = Number(matched?.[1]);
    expect(cap).toBeGreaterThan(0);
    expect(cap).toBeLessThanOrEqual(1000);
  });

  it('自定义域名与 workers.dev 地址同时保留', () => {
    expect(wrangler).toContain('custom_domain = true');
    expect(wrangler).toContain('workers_dev = true');
  });
});
