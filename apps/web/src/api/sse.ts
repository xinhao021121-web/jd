/** 解析服务端 text/event-stream：按空行分块，取 data 行并校验事件结构 */
import { StreamEventSchema, type StreamEvent } from '@zhipin/shared';

function parseBlock(block: string): StreamEvent | null {
  const data = block
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trim())
    .join('');

  if (!data) return null;

  try {
    const parsed = StreamEventSchema.safeParse(JSON.parse(data));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function createSseDecoder() {
  let buffer = '';

  return {
    push(chunk: string): StreamEvent[] {
      buffer += chunk.replace(/\r\n/g, '\n');
      const events: StreamEvent[] = [];
      let index = buffer.indexOf('\n\n');

      while (index >= 0) {
        const block = buffer.slice(0, index);
        buffer = buffer.slice(index + 2);
        const event = parseBlock(block);
        if (event) events.push(event);
        index = buffer.indexOf('\n\n');
      }

      return events;
    },

    flush(): StreamEvent[] {
      const rest = buffer;
      buffer = '';
      const event = parseBlock(rest);
      return event ? [event] : [];
    }
  };
}
