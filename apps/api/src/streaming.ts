/** 服务端内部使用的小型异步事件队列，把回调式的模型输出转成可拉取的流 */
export class AsyncEventQueue<T> {
  private buffer: T[] = [];
  private waiters: ((result: IteratorResult<T>) => void)[] = [];
  private failure: unknown = null;
  private closed = false;

  push(value: T): void {
    if (this.closed) return;
    const waiter = this.waiters.shift();
    if (waiter) waiter({ value, done: false });
    else this.buffer.push(value);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.waiters.splice(0).forEach((waiter) =>
      waiter({ value: undefined as unknown as T, done: true })
    );
  }

  fail(error: unknown): void {
    this.failure = error;
    this.close();
  }

  next(): Promise<IteratorResult<T>> {
    const buffered = this.buffer.shift();
    if (buffered !== undefined) return Promise.resolve({ value: buffered, done: false });
    if (this.closed) {
      return this.failure
        ? Promise.reject(this.failure)
        : Promise.resolve({ value: undefined as unknown as T, done: true });
    }
    return new Promise((resolve) => this.waiters.push(resolve));
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return { next: () => this.next() };
  }
}
