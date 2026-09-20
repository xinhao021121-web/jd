/**
 * Word 保真导出：把已采纳的改写建议回填进原 docx 的 word/document.xml（技术方案 V0.4 增补 三）。
 *
 * 只在字符串层面替换文本节点的内容，其余字节原样保留，因此页眉页脚、图片、表格、样式
 * 与未被改写的文字都与原文件逐字一致。不用 DOMParser + XMLSerializer 往返有两个原因：
 * 序列化会重排命名空间与属性顺序，破坏「未改动即原样」；且 Node 测试环境没有 DOMParser，
 * 跨片段替换这类分支恰恰最需要单测。
 *
 * 定位过程依赖 normalizeLineWithSpans 给出的坐标映射：模型看到的是规整后的文本，
 * 而这里要改的是文件里的原文，两者靠 spans 对齐。
 */
import { normalizeLineWithSpans } from './text-normalize';

export interface FillSuggestion {
  before: string;
  after: string;
}

export interface DocxFillResult {
  /** 回填后的 word/document.xml；一条都没应用时与入参逐字相同 */
  xml: string;
  applied: number;
  /** 定位不到、区间重叠或结构不支持而被跳过的条数 */
  skipped: number;
  /** 命名空间探测失败等结构性问题：不做任何替换，导出原文件的副本 */
  fallback: boolean;
}

const WORDPROCESSINGML_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * 探测 wordprocessingml 的标签前缀。Word、WPS、LibreOffice 都输出 `w`，
 * 但这里按命名空间声明判断，`w`、其他前缀与无前缀三种情况都支持；
 * 探测不到就返回 null，交由调用方降级为「导出原件副本」。
 */
function detectPrefix(xml: string): string | null {
  const prefixed = new RegExp(
    `xmlns:([^\\s=]+)=["']${escapeRegExp(WORDPROCESSINGML_NS)}["']`
  ).exec(xml);
  if (prefixed?.[1]) return prefixed[1];

  if (new RegExp(`xmlns=["']${escapeRegExp(WORDPROCESSINGML_NS)}["']`).test(xml)) return '';
  return null;
}

/* --------------------------- 文本节点的编解码 --------------------------- */

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'"
};

const ENTITY_PATTERN = /&(#[xX][0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g;

function codePointOf(body: string): string | null {
  const code = body.startsWith('#')
    ? Number.parseInt(body.slice(body[1] === 'x' || body[1] === 'X' ? 2 : 1), body[1] === 'x' || body[1] === 'X' ? 16 : 10)
    : Number.NaN;
  if (!Number.isInteger(code) || code < 0 || code > 0x10ffff) return null;
  return String.fromCodePoint(code);
}

/** 匹配前按 XML 规则解码：命名实体与数字字符引用都要还原成真实字符 */
export function decodeXmlText(text: string): string {
  return text.replace(ENTITY_PATTERN, (all, body: string) => {
    if (body.startsWith('#')) return codePointOf(body) ?? all;
    return NAMED_ENTITIES[body] ?? all;
  });
}

/** 写回时重新编码；文本节点里只有这三个字符必须转义 */
export function encodeXmlText(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/* ------------------------------ token 扫描 ------------------------------ */

interface TextToken {
  kind: 'text';
  /** 整个 `<w:t>` 元素在 XML 中的区间，删除节点时用不到，留作定位依据 */
  tagStart: number;
  tagEnd: number;
  /** 文本内容在 XML 中的区间（不含标签） */
  contentStart: number;
  contentEnd: number;
  /** 解码后的内容 */
  content: string;
}

interface MarkToken {
  kind: 'br' | 'tab';
  tagStart: number;
  tagEnd: number;
}

type Token = TextToken | MarkToken;

type Event =
  | { at: number; kind: 'open' }
  | { at: number; kind: 'close' }
  | { at: number; kind: 'token'; token: Token };

function scanEvents(xml: string, prefix: string): Event[] {
  const name = (tag: string): string => (prefix ? `${prefix}:${tag}` : tag);
  const paragraph = escapeRegExp(name('p'));
  const text = escapeRegExp(name('t'));
  const br = escapeRegExp(name('br'));
  const tab = escapeRegExp(name('tab'));
  const events: Event[] = [];

  // 段落边界：`<w:p>` 与 `</w:p>`；`<w:pPr>` 这类同前缀标签由 (?=[\s/>]) 排除
  const paragraphRe = new RegExp(`<${paragraph}(?=[\\s/>])|</${paragraph}\\s*>`, 'g');
  for (const match of xml.matchAll(paragraphRe)) {
    events.push({ at: match.index, kind: match[0].startsWith('</') ? 'close' : 'open' });
  }

  // 文本节点：自闭合的 `<w:t/>` 内容为空；普通形式取标签之间的内容
  const textRe = new RegExp(
    `<${text}(?=[\\s/>])[^>]*?\\/>|<${text}(?=[\\s/>])[^>]*?>([\\s\\S]*?)<\\/${text}\\s*>`,
    'g'
  );
  for (const match of xml.matchAll(textRe)) {
    const raw = match[0];
    const content = match[1];
    if (content === undefined) {
      events.push({
        at: match.index,
        kind: 'token',
        token: {
          kind: 'text',
          tagStart: match.index,
          tagEnd: match.index + raw.length,
          contentStart: match.index + raw.length,
          contentEnd: match.index + raw.length,
          content: ''
        }
      });
      continue;
    }

    const contentStart = match.index + raw.indexOf('>') + 1;
    events.push({
      at: match.index,
      kind: 'token',
      token: {
        kind: 'text',
        tagStart: match.index,
        tagEnd: match.index + raw.length,
        contentStart,
        contentEnd: contentStart + content.length,
        content: decodeXmlText(content)
      }
    });
  }

  // 换行与制表符：导入时分别记作换行与空格，回填要按同一口径还原
  const markRe = new RegExp(`<${br}(?=[\\s/>])[^>]*>|<${tab}(?=[\\s/>])[^>]*>`, 'g');
  for (const match of xml.matchAll(markRe)) {
    events.push({
      at: match.index,
      kind: 'token',
      token: {
        kind: match[0].startsWith(`<${name('br')}`) ? 'br' : 'tab',
        tagStart: match.index,
        tagEnd: match.index + match[0].length
      }
    });
  }

  return events.sort((a, b) => a.at - b.at);
}

/**
 * 按段落分组。文本归属**最内层**段落：嵌套只出现在文本框里，导入解析时外层会连带收集
 * 文本框内的文字，回填不沿用这个口径——绝不重复修改、绝不误改，与「宁可少改也不越界」一致。
 */
function groupParagraphs(xml: string, prefix: string): Token[][] {
  const blocks: Token[][] = [];
  const stack: Token[][] = [];

  scanEvents(xml, prefix).forEach((event) => {
    if (event.kind === 'open') {
      const block: Token[] = [];
      blocks.push(block);
      stack.push(block);
      return;
    }
    if (event.kind === 'close') {
      stack.pop();
      return;
    }
    const top = stack[stack.length - 1];
    if (top) top.push(event.token);
  });

  return blocks;
}

/* ------------------------------ 块内定位 ------------------------------ */

type CharOrigin =
  | { kind: 'text'; token: TextToken; offset: number }
  | { kind: 'mark'; token: MarkToken };

interface BlockText {
  text: string;
  /** 与 text 等长：每个字符来自哪个文本节点或占位标记 */
  origins: CharOrigin[];
}

function buildBlockText(items: Token[]): BlockText {
  let text = '';
  const origins: CharOrigin[] = [];

  items.forEach((item) => {
    if (item.kind === 'text') {
      for (let offset = 0; offset < item.content.length; offset += 1) {
        origins.push({ kind: 'text', token: item, offset });
      }
      text += item.content;
      return;
    }
    origins.push({ kind: 'mark', token: item });
    text += item.kind === 'br' ? '\n' : ' ';
  });

  return { text, origins };
}

interface Line {
  text: string;
  start: number;
}

function splitLines(text: string): Line[] {
  const lines: Line[] = [];
  let start = 0;

  for (let index = 0; index <= text.length; index += 1) {
    if (index === text.length || text[index] === '\n') {
      lines.push({ text: text.slice(start, index), start });
      start = index + 1;
    }
  }

  return lines;
}

/* ------------------------------ 生成编辑 ------------------------------ */

interface NodeEdit {
  start: number;
  end: number;
  replacement: string;
}

interface Match {
  index: number;
  from: number;
  to: number;
}

/**
 * 把 [from, to) 这段原文换成 after：
 * 首个受影响的文本节点保留前缀后写入 after，完全落进区间的节点清空，末尾节点保留后缀；
 * 被覆盖的 `<w:tab>` 一并删掉（保留反而会让新文字错位）；覆盖到换行说明定位异常，直接放弃。
 */
function buildNodeEdits(match: Match, origins: CharOrigin[], after: string): NodeEdit[] | null {
  const edits: NodeEdit[] = [];
  const touched = new Map<TextToken, { min: number; max: number }>();

  for (let index = match.from; index < match.to; index += 1) {
    const origin = origins[index];
    if (!origin) return null;

    if (origin.kind === 'mark') {
      if (origin.token.kind === 'br') return null;
      edits.push({ start: origin.token.tagStart, end: origin.token.tagEnd, replacement: '' });
      continue;
    }

    const entry = touched.get(origin.token);
    if (entry) {
      entry.min = Math.min(entry.min, origin.offset);
      entry.max = Math.max(entry.max, origin.offset);
    } else {
      touched.set(origin.token, { min: origin.offset, max: origin.offset });
    }
  }

  // Map 的迭代顺序即插入顺序，也就是字符在段落里的先后
  const entries = [...touched.entries()];
  const first = entries[0];
  if (!first) return null;

  entries.forEach(([token, range], position) => {
    const head = position === 0 ? token.content.slice(0, range.min) + after : '';
    const tail = position === entries.length - 1 ? token.content.slice(range.max + 1) : '';
    edits.push({
      start: token.contentStart,
      end: token.contentEnd,
      replacement: encodeXmlText(head + tail)
    });
  });

  return edits;
}

/** 编辑按位置从后往前应用，前面的偏移不会失效 */
function applyEdits(xml: string, edits: NodeEdit[]): string {
  return [...edits]
    .sort((a, b) => b.start - a.start)
    .reduce((acc, edit) => acc.slice(0, edit.start) + edit.replacement + acc.slice(edit.end), xml);
}

/* -------------------------------- 入口 -------------------------------- */

/**
 * 回填入口。每条建议只应用一次（在文档里第一次能定位到的位置），
 * 区间重叠时保留靠前的那条，其余计入 skipped。
 */
export function fillDocxTemplate(
  documentXml: string,
  adopted: readonly FillSuggestion[]
): DocxFillResult {
  const total = adopted.length;
  if (!total) return { xml: documentXml, applied: 0, skipped: 0, fallback: false };

  const prefix = detectPrefix(documentXml);
  if (prefix === null) {
    return { xml: documentXml, applied: 0, skipped: total, fallback: true };
  }

  const edits: NodeEdit[] = [];
  const matched = new Set<number>();
  let applied = 0;

  groupParagraphs(documentXml, prefix).forEach((items) => {
    const block = buildBlockText(items);
    const matches: Match[] = [];

    splitLines(block.text).forEach((line) => {
      const normalized = normalizeLineWithSpans(line.text);
      if (!normalized.text) return;

      adopted.forEach((suggestion, index) => {
        if (matched.has(index) || !suggestion.before) return;
        const at = normalized.text.indexOf(suggestion.before);
        if (at < 0) return;

        const from = normalized.spans[at];
        const to = normalized.spans[at + suggestion.before.length - 1];
        if (!from || !to || from[0] >= to[1]) return;

        matched.add(index);
        matches.push({ index, from: line.start + from[0], to: line.start + to[1] });
      });
    });

    let lastEnd = -1;
    matches
      .sort((a, b) => a.from - b.from)
      .forEach((match) => {
        if (match.from < lastEnd) return;
        const suggestion = adopted[match.index] as FillSuggestion;
        const nodeEdits = buildNodeEdits(match, block.origins, suggestion.after);
        if (!nodeEdits) return;

        edits.push(...nodeEdits);
        lastEnd = match.to;
        applied += 1;
      });
  });

  return {
    xml: edits.length ? applyEdits(documentXml, edits) : documentXml,
    applied,
    skipped: total - applied,
    fallback: false
  };
}
