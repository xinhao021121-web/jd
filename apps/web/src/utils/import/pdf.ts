/**
 * PDF 文本层提取（技术方案增补 五）：pdf.js 动态加载，worker 单独成 chunk，
 * 只在用户点导入时加载，首屏预算不受影响。文件不离开本机。
 */
import { hasUsableTextLayer, rebuildPdfText, type PdfTextItem } from '@zhipin/core';
import { ImportError } from './errors';

/** 最多处理前 10 页；超限只提示不报错（技术方案增补 五） */
export const MAX_PDF_PAGES = 10;

export async function parsePdf(bytes: Uint8Array): Promise<string> {
  const pdfjs = await import('pdfjs-dist');
  // 用 new URL 让打包器把 worker 一并产出，避免产物里 worker 路径失效
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    'pdfjs-dist/build/pdf.worker.mjs',
    import.meta.url
  ).href;

  const task = pdfjs.getDocument({ data: bytes });
  let document: Awaited<typeof task.promise>;
  try {
    document = await task.promise;
  } catch {
    throw new ImportError('PARSE_EMPTY');
  }

  try {
    const pageCount = Math.min(document.numPages, MAX_PDF_PAGES);
    const items: PdfTextItem[] = [];
    let pageWidth = 0;

    for (let index = 1; index <= pageCount; index += 1) {
      const page = await document.getPage(index);
      pageWidth = Math.max(pageWidth, page.getViewport({ scale: 1 }).width);
      const content = await page.getTextContent();

      content.items.forEach((item) => {
        if (!('str' in item)) return;
        const [, , , , x, y] = item.transform;
        items.push({ str: item.str, x, y, width: item.width, page: index });
      });
    }

    const text = rebuildPdfText(items, { pageWidth });
    // 中文乱码或没有文本层（扫描件）都要挡在草稿之外（技术方案增补 五）
    if (!hasUsableTextLayer(text)) throw new ImportError('NO_TEXT_LAYER');

    return text;
  } finally {
    // 释放 worker 与文档资源：v6 的 destroy 在 loading task 上
    await task.destroy();
  }
}
