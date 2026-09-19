/**
 * Durable Object 计数器检查：迁移到 Workers 后，限流与单日硬上限必须仍按
 * 单实例语义生效，且单日用量要能扛住实例重启（技术方案 5.3、十.1）。
 */
import { describe, expect, it } from 'vitest';
import { Counters } from '../apps/api/src/cloudflare/counters';
import type { DurableObjectState } from '../apps/api/src/cloudflare/types';

function createState() {
  const store = new Map<string, unknown>();
  const state: DurableObjectState = {
    storage: {
      get: <T>(key: string) => Promise.resolve(store.get(key) as T | undefined),
      put: <T>(key: string, value: T) => {
        store.set(key, value);
        return Promise.resolve();
      }
    }
  };
  return { state, store };
}

async function call(counters: Counters, body: Record<string, unknown>): Promise<unknown> {
  const response = await counters.fetch(
    new Request('https://counters/', { method: 'POST', body: JSON.stringify(body) })
  );
  return response.json();
}

describe('Counters（Durable Object）', () => {
  it('按 IP 限流：配额用满后拒绝，且不同 IP 互不影响', async () => {
    const { state } = createState();
    const counters = new Counters(state);

    for (let i = 0; i < 10; i += 1) {
      expect(await call(counters, { op: 'rate', key: '1.1.1.1' })).toMatchObject({
        allowed: true
      });
    }

    const blocked = (await call(counters, { op: 'rate', key: '1.1.1.1' })) as {
      allowed: boolean;
      limit?: string;
    };
    expect(blocked.allowed).toBe(false);
    expect(blocked.limit).toBe('minute');

    expect(await call(counters, { op: 'rate', key: '2.2.2.2' })).toMatchObject({
      allowed: true
    });
  });

  it('单日硬上限跨实例重启依然成立', async () => {
    const { state, store } = createState();
    const env = { DAILY_CALL_ALERT: '1', DAILY_CALL_CAP: '2' };
    const counters = new Counters(state, env);

    expect(await call(counters, { op: 'usage' })).toMatchObject({ exceeded: false, alert: true });
    expect(await call(counters, { op: 'usage' })).toMatchObject({ exceeded: false, alert: false });
    expect(await call(counters, { op: 'usage' })).toMatchObject({ exceeded: true });

    // 模拟实例重启：用同一份存储新建对象，硬上限必须继续拦住调用
    const restarted = new Counters(state, env);
    expect(await call(restarted, { op: 'usage' })).toMatchObject({ exceeded: true });
    expect(store.has('usage')).toBe(true);
  });

  it('单日用量快照可按天读取', async () => {
    const { state } = createState();
    const counters = new Counters(state, { DAILY_CALL_ALERT: '1', DAILY_CALL_CAP: '10' });

    await call(counters, { op: 'usage' });
    await call(counters, { op: 'usage' });

    expect(await call(counters, { op: 'usage_snapshot' })).toMatchObject({
      day: new Date().toISOString().slice(0, 10),
      count: 2,
      alerted: true
    });
  });
});
