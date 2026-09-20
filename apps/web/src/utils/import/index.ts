/**
 * 浏览器侧的导入适配层（技术方案增补 二）：只做文件读取、类型校验与库调用，
 * 解析规则全部来自 @zhipin/core。这一层不写单测，由端到端覆盖。
 */
import { decodeTextFile, sniffFileType } from '@zhipin/core';
import {
  IMAGE_MIME_TYPES,
  MAX_IMAGE_BYTES,
  MAX_RESUME_FILE_BYTES,
  MIN_TEXT_LENGTH,
  RESUME_FILE_EXTENSIONS
} from '@zhipin/shared';
import { parseDocx } from './docx';
import { ImportError } from './errors';
import { parsePdf } from './pdf';

export { ImportError } from './errors';
export { compressImage } from './image';
export { MAX_PDF_PAGES } from './pdf';

/** 保真导出用的原文件模板：只在内存里留存于当次会话（PRD V0.4 增补 3.8） */
export interface ResumeTemplate {
  bytes: Uint8Array;
  fileName: string;
}

export interface ParsedResumeFile {
  text: string;
  /** 只有 .docx 来源带模板，其余来源为 null */
  template: ResumeTemplate | null;
}

export function fileExtension(name: string): string {
  const parts = (name ?? '').toLowerCase().split('.');
  return parts.length > 1 ? (parts[parts.length - 1] ?? '') : '';
}

/** 简历文件只在本机解析成纯文本：不写草稿、不保存、不上传（PRD 增补 3.6） */
export async function parseResumeFile(file: File): Promise<ParsedResumeFile> {
  if (file.size > MAX_RESUME_FILE_BYTES) throw new ImportError('FILE_TOO_LARGE');
  if (!(RESUME_FILE_EXTENSIONS as readonly string[]).includes(fileExtension(file.name))) {
    throw new ImportError('UNSUPPORTED_FILE');
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const type = sniffFileType(bytes);

  let text: string;
  if (type === 'pdf') text = await parsePdf(bytes);
  else if (type === 'docx') text = await parseDocx(bytes);
  else if (type === 'text') text = decodeTextFile(bytes);
  else throw new ImportError('UNSUPPORTED_FILE');

  const trimmed = text.trim();
  // 解析结果过短：不写草稿，先让用户确认文件内容
  if (trimmed.length < MIN_TEXT_LENGTH) throw new ImportError('PARSE_EMPTY');
  return {
    text: trimmed,
    template: type === 'docx' ? { bytes, fileName: file.name } : null
  };
}

/** 图片先校验格式与体积，再做压缩（PRD 增补 3.7） */
export function assertJdImage(file: File): void {
  if (!(IMAGE_MIME_TYPES as readonly string[]).includes(file.type)) {
    throw new ImportError('UNSUPPORTED_FILE');
  }
  if (file.size > MAX_IMAGE_BYTES) throw new ImportError('FILE_TOO_LARGE');
}
