/**
 * Durable Object 计数器（技术方案 5.3、十.1）。
 * 把按 IP 限流与全局单日用量从进程内存搬到单一 Durable Object：
 * 限流窗口保持单实例内存语义（与本地内存实现一致），单日用量额外落存储，
 * 使硬上限在实例重启或多实例并发下依然成立。
 */
import { createRateLimiter } from '../ratelimit';
import {
  DEFAULT_USAGE_LIMITS,
  createUsageGuard,
  type UsageDecision,
  type UsageSnapshot
} from '../usage';
import type { RateLimitDecision } from '../ratelimit';
import type { DurableObjectNamespace, DurableObjectState } from './types';

const USAGE_KEY = 'usage';
const COUNTER_NAME = 'global';

export interface CountersEnv {
  DAILY_CALL_ALERT?: string;
  DAILY_CALL_CAP?: string;
}

type CountersRequest =
  | { op: 'rate'; key: string }
  | { op: 'usage' }
  | { op: 'usage_snapshot' };

export class Counters {
  private readonly limiter = createRateLimiter();
  private guard: ReturnType<typeof createUsageGuard> | null = null;

  constructor(
    private readonly state: DurableObjectState,
    private readonly env: CountersEnv = {}
  ) {}

  /** 首次调用时从存储恢复当天计数；跨天由 createUsageGuard 自己重置 */
  private async guardOf(): Promise<ReturnType<typeof createUsageGuard>> {
    if (this.guard) return this.guard;

    const saved = await this.state.storage.get<UsageSnapshot>(USAGE_KEY);
    this.guard = createUsageGuard({
      alertThreshold: Number(this.env.DAILY_CALL_ALERT ?? DEFAULT_USAGE_LIMITS.alertThreshold),
      dailyCap: Number(this.env.DAILY_CALL_CAP ?? DEFAULT_USAGE_LIMITS.dailyCap),
      initial: saved
    });
    return this.guard;
  }

  async fetch(request: Request): Promise<Response> {
    const body = (await request.json()) as CountersRequest;

    if (body.op === 'rate') {
      return Response.json(this.limiter.check(body.key));
    }

    const guard = await this.guardOf();
    if (body.op === 'usage_snapshot') {
      return Response.json(guard.snapshot());
    }

    const decision = guard.check();
    await this.state.storage.put(USAGE_KEY, guard.snapshot());
    return Response.json(decision);
  }
}

/** 路由依赖的两个接口，通过同一个 Durable Object 实例访问 */
export function createCountersClient(namespace: DurableObjectNamespace) {
  const stub = namespace.get(namespace.idFromName(COUNTER_NAME));

  const call = async <T>(body: CountersRequest): Promise<T> => {
    const response = await stub.fetch('https://counters/', {
      method: 'POST',
      body: JSON.stringify(body)
    });
    return (await response.json()) as T;
  };

  return {
    limiter: {
      check: (key: string) => call<RateLimitDecision>({ op: 'rate', key })
    },
    usage: {
      check: () => call<UsageDecision>({ op: 'usage' }),
      snapshot: () => call<UsageSnapshot>({ op: 'usage_snapshot' })
    }
  };
}
