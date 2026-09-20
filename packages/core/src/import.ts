/**
 * 导入解析的纯逻辑（技术方案增补 二、五）：文件类型嗅探、文本解码、
 * PDF 文本重排、docx 段落规整与视觉识别结果清洗。
 * 这些函数不碰文件与浏览器 API，浏览器适配层只负责把字节读进来。
 */
import { MIN_TEXT_LENGTH } from '@zhipin/shared';

export type SniffedFileType = 'pdf' | 'docx' | 'text' | 'unknown';

const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46, 0x2d]; // %PDF-
const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04]; // PK..（docx 是 zip 容器）
const UTF8_BOM = [0xef, 0xbb, 0xbf];

/** 文本判定阈值：可打印字节占比，低于它按二进制处理 */
const TEXT_BYTE_RATIO = 0.9;

function startsWith(bytes: Uint8Array, magic: number[]): boolean {
  if (bytes.length < magic.length) return false;
  return magic.every((byte, index) => bytes[index] === byte);
}

function looksLikeText(bytes: Uint8Array): boolean {
  if (!bytes.length) return false;

  let printable = 0;
  for (const byte of bytes) {
    // NUL 只会出现在二进制里（含 UTF-16 文本），直接判定为非文本，避免乱码进草稿
    if (byte === 0) return false;
    if (byte === 0x09 || byte === 0x0a || byte === 0x0d || byte >= 0x20) printable += 1;
  }
  return printable / bytes.length >= TEXT_BYTE_RATIO;
}

/** 按文件实际内容判断类型，不信任扩展名与 MIME（技术方案增补 二） */
export function sniffFileType(bytes: Uint8Array): SniffedFileType {
  if (startsWith(bytes, PDF_MAGIC)) return 'pdf';
  if (startsWith(bytes, ZIP_MAGIC)) return 'docx';
  return looksLikeText(bytes) ? 'text' : 'unknown';
}

function normalizeNewlines(text: string): string {
  return text.replace(/\r\n?/g, '\n');
}

function decodeWith(label: string, bytes: Uint8Array): string | null {
  try {
    return new TextDecoder(label).decode(bytes);
  } catch {
    return null;
  }
}

/** 先 UTF-8 严格解码，失败回退 GBK（中文 txt 常见编码，技术方案增补 一） */
export function decodeTextFile(bytes: Uint8Array): string {
  const body = startsWith(bytes, UTF8_BOM) ? bytes.subarray(UTF8_BOM.length) : bytes;

  try {
    return normalizeNewlines(new TextDecoder('utf-8', { fatal: true }).decode(body));
  } catch {
    // GBK 解码器不可用时退化为宽松 UTF-8，至少不让整条导入路径失败
    const fallback = decodeWith('gbk', body) ?? new TextDecoder('utf-8').decode(body);
    return normalizeNewlines(fallback);
  }
}

/** pdf.js 的 text item 子集：坐标取 transform 的 e / f（PDF 用户空间，y 向上为正） */
export interface PdfTextItem {
  str: string;
  x: number;
  y: number;
  width?: number;
  /** 页码；缺省视为同一页 */
  page?: number;
}

export interface RebuildPdfTextOptions {
  /** 页宽，用于判定双栏（同一行内 x 间隙超过页宽 15%） */
  pageWidth?: number;
  /** 同一行的 y 容差，默认 3 */
  lineTolerance?: number;
}

/** 双栏判定：同一行内 x 间隙超过页宽的 15% */
const TWO_COLUMN_RATIO = 0.15;
const DEFAULT_LINE_TOLERANCE = 3;
/** 同一行内两段文本的横向间隙超过该值就补一个空格 */
const SPACE_GAP = 1.5;

/** 句末标点：命中就不与下一行合并段落 */
const TERMINAL_PUNCTUATION = /[。！？!?；;：:）)】」』]$/;
/** 项目符号或编号开头：视为新段落，不与上一行合并 */
const PARAGRAPH_START = /^([-•·*]|\d{1,2}\s*[.、)）]|[一二三四五六七八九十]+\s*[、.])/;
/** 上一行短于该长度时按小标题处理，不与下一行合并（简历的区块识别依赖小标题独立成行） */
const MIN_WRAP_LENGTH = 12;

/** 短行且没有句末标点：多半是小标题（如「工作经历」），必须独立成行 */
function looksLikeHeading(line: string): boolean {
  return line.length < MIN_WRAP_LENGTH && !TERMINAL_PUNCTUATION.test(line);
}

function groupByPage(items: PdfTextItem[]): PdfTextItem[][] {
  const pages = new Map<number, PdfTextItem[]>();
  items.forEach((item) => {
    const page = item.page ?? 1;
    const list = pages.get(page) ?? [];
    list.push(item);
    pages.set(page, list);
  });
  return [...pages.entries()].sort((a, b) => a[0] - b[0]).map(([, list]) => list);
}

/** 按 y 聚类成行：y 越大越靠上，行内按 x 升序 */
function clusterLines(items: PdfTextItem[], tolerance: number): PdfTextItem[][] {
  const sorted = [...items].sort((a, b) => b.y - a.y || a.x - b.x);
  const lines: { y: number; items: PdfTextItem[] }[] = [];

  sorted.forEach((item) => {
    const line = lines.find((candidate) => Math.abs(candidate.y - item.y) <= tolerance);
    if (line) line.items.push(item);
    else lines.push({ y: item.y, items: [item] });
  });

  return lines.map((line) => [...line.items].sort((a, b) => a.x - b.x));
}

function lineText(items: PdfTextItem[]): string {
  let out = '';
  let last: PdfTextItem | null = null;

  items.forEach((item) => {
    if (!item.str.trim()) return;
    if (last && item.x - (last.x + (last.width ?? 0)) > SPACE_GAP) out += ' ';
    out += item.str;
    last = item;
  });

  return out.replace(/[ \t]+/g, ' ').trim();
}

/** 一行内 x 间隙超过页宽 15% 时按双栏切开，避免左右栏文字被拼成一句 */
function splitColumns(items: PdfTextItem[], pageWidth: number): PdfTextItem[][] {
  if (!pageWidth || pageWidth <= 0) return [items];

  const threshold = pageWidth * TWO_COLUMN_RATIO;
  const segments: PdfTextItem[][] = [];
  let current: PdfTextItem[] = [];

  items.forEach((item) => {
    const previous = current[current.length - 1];
    if (previous && item.x - (previous.x + (previous.width ?? 0)) > threshold) {
      segments.push(current);
      current = [];
    }
    current.push(item);
  });
  if (current.length) segments.push(current);

  return segments;
}

interface PdfLine {
  text: string;
  /** 单栏行才参与「按句末标点合并段落」；双栏切出来的行各自独立，避免跨栏拼接 */
  mergeable: boolean;
}

function joinWrapped(previous: string, line: string): string {
  // 英文换行处补空格，中文直接拼接
  return /[A-Za-z0-9]$/.test(previous) ? `${previous} ${line}` : `${previous}${line}`;
}

/** 按句末标点合并段落：上一行没有句末标点且下一行不是新段落起点时接回同一段 */
function mergeParagraphs(lines: PdfLine[]): string[] {
  const merged: string[] = [];
  let previousMergeable = false;

  lines.forEach((line) => {
    const previous = merged[merged.length - 1];
    if (
      previous &&
      previousMergeable &&
      line.mergeable &&
      previous.length >= MIN_WRAP_LENGTH &&
      !TERMINAL_PUNCTUATION.test(previous) &&
      !looksLikeHeading(line.text) &&
      !PARAGRAPH_START.test(line.text)
    ) {
      merged[merged.length - 1] = joinWrapped(previous, line.text);
      return;
    }
    merged.push(line.text);
    previousMergeable = line.mergeable;
  });

  return merged;
}

function inferPageWidth(items: PdfTextItem[]): number {
  return items.reduce((width, item) => Math.max(width, item.x + (item.width ?? 0)), 0);
}

/** 把已提取的 text item 重排成纯文本：按页 → 按行 → 按栏 → 合并段落 */
export function rebuildPdfText(
  items: PdfTextItem[],
  options: RebuildPdfTextOptions = {}
): string {
  const tolerance = options.lineTolerance ?? DEFAULT_LINE_TOLERANCE;
  const pageWidth = options.pageWidth ?? inferPageWidth(items);

  return groupByPage(items)
    .map((pageItems) => {
      const lines: PdfLine[] = clusterLines(pageItems, tolerance)
        .flatMap((line) => {
          const segments = splitColumns(line, pageWidth);
          return segments.map((segment) => ({
            text: lineText(segment),
            mergeable: segments.length === 1
          }));
        })
        .filter((line) => line.text.length > 0);
      return mergeParagraphs(lines).join('\n');
    })
    .filter((page) => page.length > 0)
    .join('\n\n')
    .trim();
}

const BULLET_PATTERN = /^\s*[•·▪◦●○‣∙※*]\s*/;
const NUMBER_PATTERN = /^(\d{1,2})\s*[.、．)）]\s*(?=\S)/;

function normalizeParagraphLine(line: string): string {
  return line
    .replace(/[\u00a0\u3000]/g, ' ')
    .replace(BULLET_PATTERN, '- ')
    .replace(NUMBER_PATTERN, '$1. ')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

/** docx 正文段落规整：压缩空行、统一项目符号与编号写法，保持段落顺序 */
export function assembleDocxParagraphs(paragraphs: string[]): string {
  return paragraphs
    .flatMap((paragraph) => (paragraph ?? '').split('\n'))
    .map((line) => normalizeParagraphLine(line))
    .filter((line) => line.length > 0)
    .join('\n')
    .trim();
}

/** 视觉识别结果长度上限：正常 JD 远小于该值，超出按截断处理 */
export const MAX_OCR_TEXT_LENGTH = 8000;

const CODE_FENCE_PATTERN = /^```[^\n]*\n([\s\S]*?)\n?```$/;
const OCR_PREFIX_PATTERN =
  /^(以下是|下面是|这是)?(图片中的|图中|截图中的)?(识别|提取|OCR)?(结果|文字|内容)(如下)?\s*[:：]?$/;

/** 去掉代码块包裹与「以下是识别结果」这类前缀，压缩空行并截断超长文本 */
export function sanitizeOcrText(text: string, limit = MAX_OCR_TEXT_LENGTH): string {
  const trimmed = normalizeNewlines(text ?? '').trim();
  const fenced = CODE_FENCE_PATTERN.exec(trimmed);
  const lines = (fenced?.[1] ?? trimmed).split('\n');

  while (lines.length && OCR_PREFIX_PATTERN.test((lines[0] ?? '').trim())) lines.shift();

  return lines
    .map((line) => line.replace(/[ \t]+$/, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, limit)
    .trim();
}

const REPLACEMENT_PATTERN = /\uFFFD/g;
const MEANINGFUL_PATTERN = /[\u3400-\u4dbf\u4e00-\u9fff\u3040-\u30ffA-Za-z0-9]/g;
/** 替换字符占比超过该值按「提取失败」处理（技术方案增补 五） */
const MAX_REPLACEMENT_RATIO = 0.01;

/**
 * 判断 PDF 是否真的提取到了可用文本层：内容过短、替换字符过多或几乎没有
 * 有效字符（中文 / 拉丁 / 数字）时，按 NO_TEXT_LAYER 兜底，而不是把乱码灌进草稿。
 */
export function hasUsableTextLayer(text: string, minLength = MIN_TEXT_LENGTH): boolean {
  const trimmed = (text ?? '').trim();
  if (trimmed.length < minLength) return false;

  const replaced = trimmed.match(REPLACEMENT_PATTERN)?.length ?? 0;
  if (replaced / trimmed.length > MAX_REPLACEMENT_RATIO) return false;

  const meaningful = trimmed.match(MEANINGFUL_PATTERN)?.length ?? 0;
  return meaningful / trimmed.length >= 0.5;
}
