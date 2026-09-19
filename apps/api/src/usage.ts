/**
 * 全局单日用量控制（PRD 4.1：单日调用量设置上限告警，避免密钥被滥用导致成本失控）。
 * 跨过告警阈值时写一条告警日志；跨过硬上限时直接拒绝，不消耗模型调用。
 * 按 UTC 自然日统计，多实例部署时替换为共享计数器（技术方案 十.2）。
 */
export interface UsageGuardOptions {
  alertThreshold?: number;
  dailyCap?: number;
  now?: () => number;
  /** 从持久化快照恢复计数：跨实例或冷启动后仍按同一自然日累计 */
  initial?: UsageSnapshot;
}

export interface UsageDecision {
  exceeded: boolean;
  alert: boolean;
}

export interface UsageSnapshot {
  day: string;
  count: number;
  alerted: boolean;
}

export const DEFAULT_USAGE_LIMITS = { alertThreshold: 500, dailyCap: 1500 } as const;

export interface UsageGuard {
  check(): UsageDecision | Promise<UsageDecision>;
  snapshot(): UsageSnapshot | Promise<UsageSnapshot>;
}

/** 内存实现同步返回，便于单测直接断言 */
export interface InMemoryUsageGuard extends UsageGuard {
  check(): UsageDecision;
  snapshot(): UsageSnapshot;
}

function dayKeyOf(timestamp: number): string {
  return new Date(timestamp).toISOString().slice(0, 10);
}

export function createUsageGuard(options: UsageGuardOptions = {}): InMemoryUsageGuard {
  const now = options.now ?? (() => Date.now());
  const alertThreshold = options.alertThreshold ?? DEFAULT_USAGE_LIMITS.alertThreshold;
  const dailyCap = options.dailyCap ?? DEFAULT_USAGE_LIMITS.dailyCap;

  let day = options.initial?.day ?? dayKeyOf(now());
  let count = options.initial?.count ?? 0;
  let alerted = options.initial?.alerted ?? false;

  const rollIfNeeded = (): void => {
    const current = dayKeyOf(now());
    if (current !== day) {
      day = current;
      count = 0;
      alerted = false;
    }
  };

  return {
    check(): UsageDecision {
      rollIfNeeded();
      if (count >= dailyCap) return { exceeded: true, alert: false };

      count += 1;
      if (!alerted && count >= alertThreshold) {
        alerted = true;
        return { exceeded: false, alert: true };
      }
      return { exceeded: false, alert: false };
    },

    snapshot(): UsageSnapshot {
      rollIfNeeded();
      return { day, count, alerted };
    }
  };
}
