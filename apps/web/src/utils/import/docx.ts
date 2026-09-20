/**
 * docx 正文提取（技术方案增补 五）：fflate 解包 + 浏览器内置 DOMParser，
 * 只取 word/document.xml 的正文段落，页眉页脚、文本框与图片中的文字不处理。
 */
import { assembleDocxParagraphs } from '@zhipin/core';
import { ImportError } from './errors';

const WORDPROCESSINGML_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const ELEMENT_NODE = 1;

function collectText(node: Element, parts: string[]): void {
  Array.from(node.childNodes).forEach((child) => {
    if (child.nodeType !== ELEMENT_NODE) return;

    const element = child as Element;
    switch (element.localName) {
      case 't':
        parts.push(element.textContent ?? '');
        return;
      case 'br':
        parts.push('\n');
        return;
      case 'tab':
        parts.push(' ');
        return;
      default:
        collectText(element, parts);
    }
  });
}

export async function parseDocx(bytes: Uint8Array): Promise<string> {
  const { unzipSync } = await import('fflate');

  let xml: string;
  try {
    const entry = unzipSync(bytes)['word/document.xml'];
    // 不是 docx 的 zip（或加密包）拿不到正文入口
    if (!entry) throw new ImportError('PARSE_EMPTY');
    xml = new TextDecoder('utf-8').decode(entry);
  } catch (error) {
    if (error instanceof ImportError) throw error;
    throw new ImportError('PARSE_EMPTY');
  }

  const document = new DOMParser().parseFromString(xml, 'application/xml');
  if (document.getElementsByTagName('parsererror').length > 0) {
    throw new ImportError('PARSE_EMPTY');
  }

  const paragraphs = Array.from(
    document.getElementsByTagNameNS(WORDPROCESSINGML_NS, 'p')
  ).map((paragraph) => {
    const parts: string[] = [];
    collectText(paragraph, parts);
    return parts.join('');
  });

  const text = assembleDocxParagraphs(paragraphs);
  if (!text) throw new ImportError('PARSE_EMPTY');
  return text;
}
