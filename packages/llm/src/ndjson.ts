/**
 * NDJSON 输出协议：每行一个完整 JSON 事件，单行校验通过即可渲染。
 * 校验失败的行丢弃并计数，不做模糊猜测（技术方案 5.2、七.1）。
 */
import { OutputEventSchema, type OutputEvent } from '@zhipin/shared';

const FENCE_RE = /^```(?:json|ndjson)?$/i;

/** 模型偶尔会带 Markdown 围栏或 data: 前缀，这里做最小清洗 */
function normalizeLine(line: string): string {
  let text = line.trim();
  if (!text || FENCE_RE.test(text)) return '';
  if (text.startsWith('data:')) text = text.slice(5).trim();
  if (!text || text === '[DONE]') return '';
  return text;
}

export interface NdjsonDecodedLine {
  line: string;
  event: OutputEvent | null;
}

export function decodeNdjsonLine(line: string): NdjsonDecodedLine {
  const normalized = normalizeLine(line);
  if (!normalized) return { line, event: null };

  let parsed: unknown;
  try {
    parsed = JSON.parse(normalized);
  } catch {
    return { line, event: null };
  }

  const result = OutputEventSchema.safeParse(parsed);
  return { line, event: result.success ? result.data : null };
}

/** 把模型返回的文本片段按行切分并逐行校验 */
export class NdjsonDecoder {
  private buffer = '';
  private invalid = 0;

  push(chunk: string): OutputEvent[] {
    this.buffer += chunk;
    const events: OutputEvent[] = [];
    let index = this.buffer.indexOf('\n');

    while (index >= 0) {
      const line = this.buffer.slice(0, index);
      this.buffer = this.buffer.slice(index + 1);
      const { line: raw, event } = decodeNdjsonLine(line);
      if (event) events.push(event);
      else if (raw.trim()) this.invalid += 1;
      index = this.buffer.indexOf('\n');
    }

    return events;
  }

  flush(): OutputEvent[] {
    const rest = this.buffer;
    this.buffer = '';
    if (!rest.trim()) return [];
    const { line, event } = decodeNdjsonLine(rest);
    if (event) return [event];
    if (line.trim()) this.invalid += 1;
    return [];
  }

  get invalidLines(): number {
    return this.invalid;
  }
}
