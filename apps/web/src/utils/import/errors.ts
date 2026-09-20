/** 导入失败：错误码与全局文案同源，UI 直接取 ERROR_MESSAGES[code]（技术方案增补 3.2） */
import { ERROR_MESSAGES, type ErrorCode } from '@zhipin/shared';

export class ImportError extends Error {
  readonly code: ErrorCode;

  constructor(code: ErrorCode) {
    super(ERROR_MESSAGES[code]);
    this.name = 'ImportError';
    this.code = code;
  }
}
