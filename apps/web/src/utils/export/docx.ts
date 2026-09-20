/**
 * Word 保真导出的浏览器适配层（技术方案 V0.4 增补 五）：
 * 解包原文件 → 交给 core 把已采纳的建议回填进正文 → 重新打包成新的 docx。
 * 全程在本机完成，不发起任何网络请求，断网也能导出。
 */
import { fillDocxTemplate } from '@zhipin/core';
import type { ResumeTemplate } from '../import';

export const DOCX_MIME =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

const DOCUMENT_ENTRY = 'word/document.xml';

export interface DocxExportResult {
  blob: Blob;
  /** 成功写回的建议条数 */
  applied: number;
  /** 没能定位到、按原文保留的条数 */
  skipped: number;
  /** 模板结构无法识别，导出的是原文件副本 */
  fallback: boolean;
}

export async function exportDocx(
  template: ResumeTemplate,
  adopted: readonly { before: string; after: string }[]
): Promise<DocxExportResult> {
  // 与导入共用同一个 fflate chunk，首屏预算不受影响
  const { unzipSync, zipSync } = await import('fflate');

  const entries = unzipSync(template.bytes);
  const document = entries[DOCUMENT_ENTRY];
  if (!document) throw new Error('MISSING_DOCUMENT_XML');

  const result = fillDocxTemplate(new TextDecoder().decode(document), adopted);
  const patched = { ...entries, [DOCUMENT_ENTRY]: new TextEncoder().encode(result.xml) };

  return {
    blob: new Blob([zipSync(patched)], { type: DOCX_MIME }),
    applied: result.applied,
    skipped: result.skipped,
    fallback: result.fallback
  };
}

/** 导出文件名：在原文件名后加后缀，便于用户覆盖自己的旧版本（PRD V0.4 增补 待确认 22） */
export function exportedFileName(original: string): string {
  return `${original.replace(/\.docx$/i, '')}_定制.docx`;
}
