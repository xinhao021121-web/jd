/**
 * 调用服务端代理并解析流式事件（技术方案 5.4）。
 * 前端永不接触密钥与模型地址，只调用同域的 /api/llm。
 */
import type { ErrorCode, StreamEvent, TaskKind } from '@zhipin/shared';
import { createSseDecoder } from './sse';

export interface StreamTaskOptions {
  signal?: AbortSignal;
  onEvent: (event: StreamEvent) => void;
}

export type StreamOutcome =
  | { status: 'done' }
  | { status: 'aborted' }
  | { status: 'error'; code: ErrorCode };

async function readErrorCode(response: Response): Promise<ErrorCode> {
  try {
    const body = (await response.json()) as { code?: ErrorCode };
    if (body.code) return body.code;
  } catch {
    /* 兜底为上游错误 */
  }
  return 'UPSTREAM_ERROR';
}

export async function streamTask(
  task: TaskKind,
  input: { resume: string; jd: string },
  options: StreamTaskOptions
): Promise<StreamOutcome> {
  let response: Response;
  try {
    response = await fetch('/api/llm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ task, ...input }),
      signal: options.signal
    });
  } catch (error) {
    if ((error as Error)?.name === 'AbortError') return { status: 'aborted' };
    return { status: 'error', code: 'UPSTREAM_ERROR' };
  }

  if (!response.ok) {
    return { status: 'error', code: await readErrorCode(response) };
  }
  if (!response.body) {
    return { status: 'error', code: 'UPSTREAM_ERROR' };
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const sse = createSseDecoder();
  let failed: ErrorCode | null = null;

  const consume = (events: StreamEvent[]) => {
    events.forEach((event) => {
      if (event.type === 'error') failed = event.code;
      options.onEvent(event);
    });
  };

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      consume(sse.push(decoder.decode(value, { stream: true })));
    }
    consume(sse.flush());
  } catch (error) {
    if ((error as Error)?.name === 'AbortError') return { status: 'aborted' };
    return { status: 'error', code: 'UPSTREAM_ERROR' };
  } finally {
    reader.releaseLock();
  }

  if (failed) return { status: 'error', code: failed };
  return { status: 'done' };
}
