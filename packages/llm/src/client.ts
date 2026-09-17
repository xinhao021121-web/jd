/**
 * OpenAI 兼容的流式客户端（当前实现为 DeepSeek）。
 * 只依赖 baseUrl / apiKey / model 三个参数，换供应商时不需要改上层代码。
 */
import type { OutputEvent, TaskKind } from '@zhipin/shared';
import { NdjsonDecoder } from './ndjson';
import { buildMessages, type LlmMessage } from './prompts';

export type FetchLike = (
  input: string,
  init: {
    method: string;
    headers: Record<string, string>;
    body: string;
    signal?: AbortSignal;
  }
) => Promise<Response>;

export interface LlmClientConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  fetchImpl?: FetchLike;
  temperature?: number;
  /** 整份输出无法解析时的最大尝试次数（PRD 2.3.1：重试一次） */
  maxAttempts?: number;
}

export interface TaskInput {
  resume: string;
  jd: string;
}

export interface RunTaskOptions {
  signal?: AbortSignal;
  onEvent?: (event: OutputEvent) => void | Promise<void>;
  onFirstToken?: (elapsedMs: number) => void;
}

export interface RunTaskResult {
  validEvents: number;
  invalidLines: number;
  firstTokenMs: number | null;
  elapsedMs: number;
  attempts: number;
}

export class LlmUpstreamError extends Error {
  readonly status: number;

  constructor(message: string, status = 0) {
    super(message);
    this.name = 'LlmUpstreamError';
    this.status = status;
  }
}

/** 从一行 SSE 里取出增量文本，非 data 行与无法解析的行直接跳过 */
function parseSseLine(line: string): string | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith(':') || trimmed.startsWith('event:')) return null;
  if (!trimmed.startsWith('data:')) return null;

  const payload = trimmed.slice(5).trim();
  if (!payload || payload === '[DONE]') return null;

  try {
    const parsed = JSON.parse(payload) as {
      choices?: { delta?: { content?: string }; message?: { content?: string } }[];
    };
    const choice = parsed.choices?.[0];
    return choice?.delta?.content ?? choice?.message?.content ?? null;
  } catch {
    return null;
  }
}

async function* readContentDeltas(response: Response): AsyncGenerator<string> {
  const body = response.body;
  if (!body) throw new LlmUpstreamError('模型未返回响应体');

  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let index = buffer.indexOf('\n');
      while (index >= 0) {
        const line = buffer.slice(0, index);
        buffer = buffer.slice(index + 1);
        const delta = parseSseLine(line);
        if (delta) yield delta;
        index = buffer.indexOf('\n');
      }
    }

    const tail = parseSseLine(buffer);
    if (tail) yield tail;
  } finally {
    reader.releaseLock();
  }
}

export function createLlmClient(config: LlmClientConfig) {
  const fetchImpl = (config.fetchImpl ?? globalThis.fetch) as FetchLike;
  const maxAttempts = Math.max(1, config.maxAttempts ?? 2);
  const endpoint = `${config.baseUrl.replace(/\/+$/, '')}/chat/completions`;

  const callModel = async (
    messages: LlmMessage[],
    signal: AbortSignal | undefined
  ): Promise<Response> => {
    const response = await fetchImpl(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`
      },
      body: JSON.stringify({
        model: config.model,
        stream: true,
        temperature: config.temperature ?? 0.3,
        messages
      }),
      signal
    });

    if (!response.ok) {
      throw new LlmUpstreamError(`模型服务返回状态 ${response.status}`, response.status);
    }
    return response;
  };

  return {
    endpoint,

    async runTask(
      task: TaskKind,
      input: TaskInput,
      options: RunTaskOptions = {}
    ): Promise<RunTaskResult> {
      const startedAt = Date.now();
      let attempts = 0;
      let validEvents = 0;
      let invalidLines = 0;
      let firstTokenMs: number | null = null;

      while (attempts < maxAttempts) {
        attempts += 1;
        const decoder = new NdjsonDecoder();
        let attemptEvents = 0;
        const emit = async (event: OutputEvent) => {
          attemptEvents += 1;
          await options.onEvent?.(event);
        };

        const response = await callModel(buildMessages(task, input), options.signal);

        for await (const delta of readContentDeltas(response)) {
          if (firstTokenMs === null) {
            firstTokenMs = Date.now() - startedAt;
            options.onFirstToken?.(firstTokenMs);
          }
          for (const event of decoder.push(delta)) await emit(event);
        }
        for (const event of decoder.flush()) await emit(event);

        invalidLines += decoder.invalidLines;
        validEvents += attemptEvents;

        // 整份输出都无法解析时才重试（PRD 2.3.1）；单行失败只丢弃该行
        if (attemptEvents > 0) break;
      }

      return {
        validEvents,
        invalidLines,
        firstTokenMs,
        elapsedMs: Date.now() - startedAt,
        attempts
      };
    }
  };
}

export type LlmClient = ReturnType<typeof createLlmClient>;
