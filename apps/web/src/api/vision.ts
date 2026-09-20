/**
 * 调用服务端的图片识别接口（技术方案增补 3.1）。
 * 前端逐张调用、逐张显示进度；失败自动重试 1 次，仍失败就交给用户改用粘贴。
 */
import { ERROR_CODES, type ErrorCode } from '@zhipin/shared';

export interface RecognizeOptions {
  signal?: AbortSignal;
  /** 总尝试次数，默认 2（PRD 增补 3.7：识别失败自动重试 1 次） */
  attempts?: number;
}

export type VisionOutcome =
  | { status: 'ok'; text: string; elapsedMs: number }
  | { status: 'aborted' }
  | { status: 'error'; code: ErrorCode };

async function readErrorCode(response: Response): Promise<ErrorCode> {
  try {
    const body = (await response.json()) as { code?: ErrorCode };
    if (body.code && (ERROR_CODES as readonly string[]).includes(body.code)) return body.code;
  } catch {
    /* 兜底为识别失败 */
  }
  return 'VISION_FAILED';
}

export async function recognizeImage(
  image: string,
  options: RecognizeOptions = {}
): Promise<VisionOutcome> {
  const attempts = Math.max(1, options.attempts ?? 2);
  let lastCode: ErrorCode = 'VISION_FAILED';

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    let response: Response;
    try {
      response = await fetch('/api/vision', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image }),
        signal: options.signal
      });
    } catch (error) {
      if ((error as Error)?.name === 'AbortError') return { status: 'aborted' };
      // 请求根本没到服务端（断网、服务未启动）与识别失败是两回事，文案也不一样
      lastCode = 'VISION_UNAVAILABLE';
      continue;
    }

    if (!response.ok) {
      lastCode = await readErrorCode(response);
      // 限流属于配额问题，重试没有意义，直接把提示交给用户
      if (lastCode === 'RATE_LIMITED') return { status: 'error', code: lastCode };
      continue;
    }

    try {
      const body = (await response.json()) as { text?: string; elapsedMs?: number };
      return { status: 'ok', text: body.text ?? '', elapsedMs: body.elapsedMs ?? 0 };
    } catch {
      lastCode = 'VISION_FAILED';
    }
  }

  return { status: 'error', code: lastCode };
}
