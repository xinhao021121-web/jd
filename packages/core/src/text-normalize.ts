/**
 * 单行文本规整：导入解析与导出回填共用同一份规则。
 *
 * 导入时交给模型的是规整后的文本，模型返回的 before 也是规整后的写法；
 * 导出回填却要在**原始文件**里替换这段文字，因此必须知道规整后每个字符来自原文的哪一段。
 * 所以这里在规整的同时产出逐字符的来源区间 spans：spans[i] 是 text[i] 在入参原文中的 [start, end)。
 *
 * 区间按**码元**计数（与 String#slice / String#indexOf 同一坐标系），且只做替换与删除，
 * 不拆分代理对——所有规则匹配的都是 BMP 内的空白、项目符号与数字。
 */

export type TextSpan = readonly [number, number];

export interface NormalizedLine {
  text: string;
  /** 与 text 等长：spans[i] 对应 text[i] 在原文中的区间 */
  spans: TextSpan[];
}

/** 项目符号与编号的规整规则（与 PRD 增补 3.6 的导入口径同源） */
const BULLET_PATTERN = /^\s*[•·▪◦●○‣∙※*]\s*/;
const NUMBER_PATTERN = /^(\d{1,2})\s*[.、．)）]\s*(?=\S)/;
const FULLWIDTH_SPACE_PATTERN = /[\u00a0\u3000]/g;
const RUN_SPACE_PATTERN = /[ \t]+/;

interface Draft {
  chars: string[];
  spans: TextSpan[];
}

function mergeSpans(spans: TextSpan[], start: number, end: number): TextSpan {
  return [spans[start]?.[0] ?? 0, spans[end - 1]?.[1] ?? 0];
}

/**
 * 按正则替换：整段匹配区间被 build 的输出取代，输出字符的来源区间统一取整个匹配区间。
 * 插入产生的字符（如「• 」变成「- 」里的连字符与空格）因此带上被替代区间的坐标，
 * 回填时替换该区间就会连同原始的「•」一起换掉。
 */
function applyPattern(
  draft: Draft,
  pattern: RegExp,
  build: (match: RegExpExecArray) => string
): Draft {
  const text = draft.chars.join('');
  const flags = pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`;
  const regexp = new RegExp(pattern.source, flags);
  const chars: string[] = [];
  const spans: TextSpan[] = [];
  let cursor = 0;
  let match = regexp.exec(text);

  // 零宽匹配推进不了位置，遇到就停
  while (match && match[0].length > 0) {
    for (let index = cursor; index < match.index; index += 1) {
      chars.push(text[index] as string);
      spans.push(draft.spans[index] as TextSpan);
    }

    const span = mergeSpans(draft.spans, match.index, match.index + match[0].length);
    for (const char of build(match)) {
      chars.push(char);
      spans.push(span);
    }

    cursor = match.index + match[0].length;
    match = regexp.exec(text);
  }

  for (let index = cursor; index < text.length; index += 1) {
    chars.push(text[index] as string);
    spans.push(draft.spans[index] as TextSpan);
  }

  return { chars, spans };
}

const isSpace = (char: string | undefined): boolean => !!char && /\s/.test(char);

/** 去首尾空白；与 String#trim 同一口径，只裁掉字符、不改坐标 */
function trimDraft(draft: Draft): NormalizedLine {
  let start = 0;
  let end = draft.chars.length;

  while (start < end && isSpace(draft.chars[start])) start += 1;
  while (end > start && isSpace(draft.chars[end - 1])) end -= 1;

  return {
    text: draft.chars.slice(start, end).join(''),
    spans: draft.spans.slice(start, end)
  };
}

/**
 * 规整一行文本，并给出每个字符在原文中的来源区间。
 * 五步顺序与 V0.2 增补的导入口径完全一致，改造前的老实现在
 * tests/core.resume-export.test.ts 里作为参照逐条比对。
 */
export function normalizeLineWithSpans(raw: string): NormalizedLine {
  const chars = raw.split('');
  let draft: Draft = {
    chars,
    spans: chars.map((_, index) => [index, index + 1] as TextSpan)
  };

  draft = applyPattern(draft, FULLWIDTH_SPACE_PATTERN, () => ' ');
  draft = applyPattern(draft, BULLET_PATTERN, () => '- ');
  draft = applyPattern(draft, NUMBER_PATTERN, (match) => `${match[1]}. `);
  draft = applyPattern(draft, RUN_SPACE_PATTERN, () => ' ');

  return trimDraft(draft);
}

/** 规整后的文本：导入解析与导出回填看到的必须是同一份写法 */
export function normalizeParagraphLine(line: string): string {
  return normalizeLineWithSpans(line).text;
}
