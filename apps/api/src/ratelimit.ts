/**
 * 按 IP 的限流与每日配额（PRD 4.1：每分钟 10 次、每日 100 次）。
 * 单实例内存滑动窗口实现；多实例部署时替换为 Redis / KV（技术方案 5.3、十.2）。
 */
import { RATE_LIMIT } from '@zhipin/shared';

export interface RateLimiterOptions {
  perMinute?: number;
  perDay?: number;
  now?: () => number;
}

export interface RateLimitDecision {
  allowed: boolean;
  limit?: 'minute' | 'day';
  retryAfterMs?: number;
}

const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** 路由只依赖 check 这一个方法；内存实现与远程计数器都满足该接口 */
export interface RateLimiter {
  check(key: string): RateLimitDecision | Promise<RateLimitDecision>;
}

/** 内存实现额外提供 size()，供本地排查与单测断言使用 */
export interface InMemoryRateLimiter extends RateLimiter {
  check(key: string): RateLimitDecision;
  size(): number;
}

export function createRateLimiter(options: RateLimiterOptions = {}): InMemoryRateLimiter {
  const perMinute = options.perMinute ?? RATE_LIMIT.perMinute;
  const perDay = options.perDay ?? RATE_LIMIT.perDay;
  const now = options.now ?? (() => Date.now());

  /** 每个 key 保留最近 24 小时内的命中时间戳 */
  const hits = new Map<string, number[]>();

  const prune = (timestamps: number[], current: number): number[] =>
    timestamps.filter((at) => current - at < DAY_MS);

  return {
    check(key: string): RateLimitDecision {
      const current = now();
      const recent = prune(hits.get(key) ?? [], current);

      const inLastMinute = recent.filter((at) => current - at < MINUTE_MS);
      if (inLastMinute.length >= perMinute) {
        const oldest = inLastMinute[0] as number;
        hits.set(key, recent);
        return { allowed: false, limit: 'minute', retryAfterMs: MINUTE_MS - (current - oldest) };
      }

      if (recent.length >= perDay) {
        const oldest = recent[0] as number;
        hits.set(key, recent);
        return { allowed: false, limit: 'day', retryAfterMs: DAY_MS - (current - oldest) };
      }

      recent.push(current);
      hits.set(key, recent);
      return { allowed: true };
    },

    size(): number {
      return hits.size;
    }
  };
}
