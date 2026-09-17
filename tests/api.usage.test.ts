import { describe, expect, it } from 'vitest';
import { createUsageGuard } from '../apps/api/src/usage';

describe('createUsageGuard', () => {
  it('跨过告警阈值时只告警一次', () => {
    let now = Date.UTC(2026, 8, 17, 1, 0, 0);
    const guard = createUsageGuard({ alertThreshold: 3, dailyCap: 5, now: () => now });

    expect(guard.check()).toEqual({ exceeded: false, alert: false });
    expect(guard.check()).toEqual({ exceeded: false, alert: false });
    expect(guard.check()).toEqual({ exceeded: false, alert: true });
    expect(guard.check()).toEqual({ exceeded: false, alert: false });
    expect(guard.snapshot()).toEqual({ day: '2026-09-17', count: 4, alerted: true });
  });

  it('跨过硬上限后直接拒绝，不再消耗模型调用', () => {
    const guard = createUsageGuard({ alertThreshold: 1, dailyCap: 2, now: () => 0 });

    expect(guard.check().exceeded).toBe(false);
    expect(guard.check().exceeded).toBe(false);
    expect(guard.check().exceeded).toBe(true);
    expect(guard.snapshot().count).toBe(2);
  });

  it('跨天后重新计数并恢复告警', () => {
    let now = Date.UTC(2026, 8, 17, 23, 0, 0);
    const guard = createUsageGuard({ alertThreshold: 1, dailyCap: 10, now: () => now });

    expect(guard.check().alert).toBe(true);
    now = Date.UTC(2026, 8, 18, 0, 30, 0);

    expect(guard.snapshot()).toEqual({ day: '2026-09-18', count: 0, alerted: false });
    expect(guard.check()).toEqual({ exceeded: false, alert: true });
  });
});
