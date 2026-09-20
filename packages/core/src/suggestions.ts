/**
 * 改写建议的绑定、锚点替换与合成。
 * 模型只负责给出「原文 → 建议写法」，区块归属、越界拦截与最终合成全部由本地确定性代码完成，
 * 因此「锁定区块逐字不变」「未采纳即与原件一致」「建议不越界」都是可单测的普通逻辑。
 */
import {
  classifyBlock,
  joinBlocks,
  parseResume,
  type ResumeBlock
} from './resume';
import type { SuggestionType } from '@zhipin/shared';

export interface RawSuggestion {
  section?: string;
  before: string;
  after: string;
  reason: string;
  suggestionType?: SuggestionType;
}

/**
 * 改写建议的长度口径（PRD V0.4 增补 三）。改写只有在行内原地替换才能保住原版面，
 * 行变长会让 Word 重新折行，所以提示词要求模型「最多比原文长 20%」。
 *
 * 本地自检另取一条更宽的**红线**：实测（8 组样本 31 条建议）模型在 20% 要求下的自然
 * 增量多数落在 26%~35%（最大 +50%），用目标值判定会把四成正常改写标成问题、把回归报告淹掉；
 * 红线取 40%，只拦明显撑长原文行的情况。两个比例都定义在这里，避免口径漂移——
 * 这与话术「提示词给 120~150 的目标区间、自检按 100~160 判定」是同一套做法。
 */
export const SUGGESTION_LENGTH_TARGET_RATIO = 0.2;
export const SUGGESTION_LENGTH_LIMIT_RATIO = 0.4;

/** 短句按比例只能多一两个字，会把正常改写框死，因此设一个固定下限 */
const MIN_LENGTH_MARGIN = 5;

/** 提示词里的目标：模型应把增长控制在这个比例内 */
export const SUGGESTION_LENGTH_TARGET_PERCENT = SUGGESTION_LENGTH_TARGET_RATIO * 100;

/** 本地自检的上限：超出即判为「改写长度」违规 */
export function suggestionLengthLimit(
  before: string,
  ratio = SUGGESTION_LENGTH_LIMIT_RATIO
): number {
  const length = [...before].length;
  return length + Math.max(Math.ceil(length * ratio), MIN_LENGTH_MARGIN);
}

export interface Suggestion {
  id: string;
  section: string;
  blockIndex: number;
  lineIndex: number;
  before: string;
  after: string;
  reason: string;
  suggestionType?: SuggestionType;
  /** 本地自检命中的问题（服务端回填），命中只提示不丢弃 */
  issues?: string[];
  adopted: boolean;
}

export interface DroppedSuggestion {
  suggestion: RawSuggestion;
  reason: string;
}

export interface PlanSuggestionsResult {
  suggestions: Suggestion[];
  dropped: DroppedSuggestion[];
}

/**
 * 合规兜底：判断一段原文是否落在可改写区块内。
 * 服务端在回传前用它对每条建议做二次校验，避免任何模型输出绕过锁定规则（PRD 4.1）。
 */
export function isEditableAnchor(blocks: ResumeBlock[], before: string): boolean {
  const anchor = (before || '').trim();
  if (!anchor || anchor.includes('\n')) return false;
  return blocks.some(
    (block) => block.kind === 'editable' && block.lines.some((line) => line.includes(anchor))
  );
}

/**
 * 把模型返回的建议绑定到区块：
 * - 只允许落在可改写区块，锁定区块与未识别区块一律丢弃；
 * - 建议不得跨区块，`before` 必须能在某个区块的某一行里完整找到；
 * - 原文匹配不上的建议直接丢弃，不做模糊替换。
 */
export function planSuggestions(
  blocks: ResumeBlock[],
  rawSuggestions: RawSuggestion[]
): PlanSuggestionsResult {
  const suggestions: Suggestion[] = [];
  const dropped: DroppedSuggestion[] = [];
  const seen = new Set<string>();

  rawSuggestions.forEach((raw) => {
    const before = (raw.before || '').trim();
    const after = (raw.after || '').trim();
    const reason = (raw.reason || '').trim();

    if (!before || !after) {
      dropped.push({ suggestion: raw, reason: '建议缺少原文或建议写法' });
      return;
    }
    if (before === after) {
      dropped.push({ suggestion: raw, reason: '建议与原文一致，无需改写' });
      return;
    }
    if (before.includes('\n')) {
      dropped.push({ suggestion: raw, reason: '建议跨行，不得跨区块改写' });
      return;
    }

    const section = (raw.section || '').trim();
    const candidates = blocks
      .map((block, index) => ({ block, index }))
      .filter((item) => item.block.kind === 'editable')
      .filter((item) => (section ? item.block.title === section : true));

    if (!candidates.length) {
      dropped.push({ suggestion: raw, reason: `建议落在锁定区块或未识别区块：${section || '未标注'}` });
      return;
    }

    let bound: { blockIndex: number; lineIndex: number } | null = null;
    for (const candidate of candidates) {
      const lineIndex = candidate.block.lines.findIndex((line) => line.includes(before));
      if (lineIndex >= 0) {
        bound = { blockIndex: candidate.index, lineIndex };
        break;
      }
    }

    if (!bound) {
      dropped.push({ suggestion: raw, reason: '原文在可改写区块中匹配不上，已丢弃' });
      return;
    }

    const key = `${bound.blockIndex}:${bound.lineIndex}:${before}->${after}`;
    if (seen.has(key)) {
      dropped.push({ suggestion: raw, reason: '重复建议' });
      return;
    }
    seen.add(key);

    const block = blocks[bound.blockIndex] as ResumeBlock;
    suggestions.push({
      id: `s${suggestions.length}`,
      section: block.title,
      blockIndex: bound.blockIndex,
      lineIndex: bound.lineIndex,
      before,
      after,
      reason,
      suggestionType: raw.suggestionType,
      adopted: false
    });
  });

  return { suggestions, dropped };
}

/**
 * 锚点替换：只改写被采纳的建议所在的可改写区块，锁定区块逐字输出。
 * 匹配不上原文的建议直接丢弃（不写入任何内容）。
 */
export function applySuggestions(
  blocks: ResumeBlock[],
  adopted: Suggestion[]
): ResumeBlock[] {
  const next = blocks.map((block) => ({ ...block, lines: block.lines.slice() }));

  adopted.forEach((suggestion) => {
    const block = next[suggestion.blockIndex];
    if (!block || classifyBlock(block.title) !== 'editable') return;

    const before = suggestion.before;
    const lineIndex = block.lines.findIndex((line) => line.includes(before));
    if (lineIndex < 0) return;

    const line = block.lines[lineIndex] as string;
    const at = line.indexOf(before);
    // 用切片拼接而不是 String.replace，避免建议文本里的 $& 等符号被当作替换模式
    block.lines[lineIndex] = line.slice(0, at) + suggestion.after + line.slice(at + before.length);
  });

  return next;
}

/**
 * 对外统一入口：合成定制简历。
 * 未采纳任何建议时，输出必须与原件完全一致（PRD 5.2.1 自动测试项）。
 */
export function composeCustomResume(resume: string, adopted: Suggestion[]): string {
  const effective = adopted.filter((suggestion) => suggestion.adopted !== false);
  if (!effective.length) return resume;
  return joinBlocks(applySuggestions(parseResume(resume), effective));
}
