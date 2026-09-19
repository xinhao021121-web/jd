/**
 * 只声明用到的 Workers 运行时类型。
 * 引入 @cloudflare/workers-types 会与 tsconfig 现有的 DOM / node 类型互相覆盖
 * （Request、Response 等形状不同），这里按需最小声明，保持全局类型不变。
 */
export interface DurableObjectStorage {
  get<T>(key: string): Promise<T | undefined>;
  put<T>(key: string, value: T): Promise<void>;
}

export interface DurableObjectState {
  storage: DurableObjectStorage;
}

export interface DurableObjectStub {
  fetch(input: string, init?: { method?: string; body?: string }): Promise<Response>;
}

export interface DurableObjectNamespace {
  idFromName(name: string): unknown;
  get(id: unknown): DurableObjectStub;
}

export interface Fetcher {
  fetch(request: Request): Promise<Response>;
}
