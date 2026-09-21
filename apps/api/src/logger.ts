/**
 * 脱敏日志：只记录错误类型、耗时、任务类型与 IP 哈希，绝不记录简历与 JD 正文（PRD 4.1、技术方案 5.3）。
 */
import { createHash } from 'node:crypto';

export interface LogRecord {
  event: 'ok' | 'rate_limited' | 'invalid_input' | 'error' | 'usage_alert';
  task?: string | null;
  ipHash: string;
  /** 图片识别只记录字节数，不记录图片内容与识别文本 */
  imageBytes?: number;
  elapsedMs?: number;
  /**
   * 只出现在 usage_alert 上：当日的累计调用数。
   * 早先借用了 elapsedMs 承载这个值，读日志的人会把它当成耗时，因此拆成独立字段。
   */
  count?: number;
  errorType?: string;
  attempts?: number;
}

export interface Logger {
  log(record: LogRecord): void;
  warn(record: LogRecord): void;
}

export function hashIp(ip: string): string {
  return createHash('sha256').update(ip).digest('hex').slice(0, 12);
}

export function createLogger(sink: (line: string) => void = console.log): Logger {
  const write = (level: string, record: LogRecord) => {
    sink(JSON.stringify({ level, ...record }));
  };
  return {
    log: (record) => write('info', record),
    warn: (record) => write('warn', record)
  };
}
