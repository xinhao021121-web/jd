import { describe, expect, it } from 'vitest';
import { createRateLimiter } from '../apps/api/src/ratelimit';

describe('createRateLimiter', () => {
  it('每分钟配额用满后拒绝，且按 IP 隔离', () => {
    let now = 0;
    const limiter = createRateLimiter({ perMinute: 10, perDay: 100, now: () => now });

    for (let i = 0; i < 10; i += 1) {
      expect(limiter.check('1.1.1.1').allowed).toBe(true);
    }

    const blocked = limiter.check('1.1.1.1');
    expect(blocked.allowed).toBe(false);
    expect(blocked.limit).toBe('minute');
    expect(blocked.retryAfterMs).toBeGreaterThan(0);

    expect(limiter.check('2.2.2.2').allowed).toBe(true);
  });

  it('滑动窗口：一分钟后自动恢复', () => {
    let now = 0;
    const limiter = createRateLimiter({ perMinute: 2, perDay: 100, now: () => now });

    expect(limiter.check('ip').allowed).toBe(true);
    expect(limiter.check('ip').allowed).toBe(true);
    expect(limiter.check('ip').allowed).toBe(false);

    now = 61_000;
    expect(limiter.check('ip').allowed).toBe(true);
  });

  it('每日配额生效，且优先返回当前最紧的限制', () => {
    let now = 0;
    const limiter = createRateLimiter({ perMinute: 1000, perDay: 3, now: () => now });

    expect(limiter.check('ip').allowed).toBe(true);
    now += 61_000;
    expect(limiter.check('ip').allowed).toBe(true);
    now += 61_000;
    expect(limiter.check('ip').allowed).toBe(true);
    now += 61_000;

    const blocked = limiter.check('ip');
    expect(blocked.allowed).toBe(false);
    expect(blocked.limit).toBe('day');
  });

  it('超过 24 小时的记录会被清理，不会无限增长', () => {
    let now = 0;
    const limiter = createRateLimiter({ perMinute: 2, perDay: 2, now: () => now });

    limiter.check('ip');
    limiter.check('ip');
    expect(limiter.check('ip').allowed).toBe(false);

    now += 25 * 60 * 60 * 1000;
    expect(limiter.check('ip').allowed).toBe(true);
    expect(limiter.size()).toBe(1);
  });
});
