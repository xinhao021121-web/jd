/**
 * 生成结果的本地自检（PRD 3.2 事实溯源与去套话、4.1 合规兜底、技术方案 V0.3 增补）。
 * 纯函数：服务端在回传前逐条执行（命中只标注、不丢弃），质量回归脚本复用同一实现，
 * 保证「线上兜底」与「离线验收」的判定规则只有一份。
 */
import { GREETING_LENGTH, type OutputEvent } from '@zhipin/shared';
import { parseResume } from './resume';
import { extractSkills } from './skills';
import { planSuggestions, type RawSuggestion } from './suggestions';

/** PRD 3.2 明确禁止的套话 */
export const CLICHE_BLACKLIST = [
  '贵公司',
  '贵司',
  '非常感兴趣',
  '十分感兴趣',
  '期待您的青睐',
  '希望得到您的回复',
  '期待您的回复',
  '百忙之中',
  '诚挚地',
  '致以'
];

export interface Violation {
  rule: string;
  detail: string;
}

const EMOJI_RE = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;
/**
 * 只把「真正的数字表述」当作可溯源对象：
 * 前后不能再紧挨字母，避免把 K8s、Vue3、P99 这类专有名词误判成数字。
 */
const NUMBER_RE =
  /(?<![A-Za-z0-9])\d+(?:\.\d+)?(?:\s*(?:%|ms|秒|分钟|小时|天|周|月|年|万|亿|倍|条|次|台|个|人))?(?![A-Za-z])/g;

function numbersIn(text: string): string[] {
  return (text.match(NUMBER_RE) ?? []).map((token) => token.replace(/\s+/g, ''));
}

/**
 * 数字是否可溯源。
 * 年份（4 位数字 + 年）在简历里常写成「2022.06」「2022 届」，只校验数字本身；
 * 年限（如「3 年」）是能力声明，必须真的在简历里出现过，避免把 JD 的要求年限写成自己的经验。
 */
function tokenMatches(token: string, source: string): boolean {
  const normalizedToken = token.replace(/\s+/g, '');
  const normalizedSource = source.replace(/\s+/g, '');
  if (normalizedSource.includes(normalizedToken)) return true;

  const year = normalizedToken.match(/^(\d{4})年$/);
  if (year?.[1]) return normalizedSource.includes(year[1]);

  return false;
}

/**
 * 单条话术的事实与措辞自检：数字溯源、技能溯源、套话、表情符号。
 * 不含长度与条数——长度由前端用 offSpecGreetingIndexes 提示，条数由调用方判断。
 */
export function checkGreetingText(resume: string, text: string): Violation[] {
  const violations: Violation[] = [];
  const resumeSkills = extractSkills(resume);

  numbersIn(text).forEach((token) => {
    if (!tokenMatches(token, resume)) {
      violations.push({ rule: '数字溯源', detail: `出现简历中没有的数字「${token}」` });
    }
  });

  extractSkills(text).forEach((skill) => {
    if (!resumeSkills.includes(skill)) {
      violations.push({ rule: '技能溯源', detail: `提到简历没有的「${skill}」` });
    }
  });

  CLICHE_BLACKLIST.forEach((cliche) => {
    if (text.includes(cliche)) {
      violations.push({ rule: '套话', detail: `出现「${cliche}」` });
    }
  });

  if (EMOJI_RE.test(text)) {
    violations.push({ rule: '表情符号', detail: '包含表情符号' });
  }

  return violations;
}

/** 单条改写建议的事实自检：不得引入原文没有的数字与技能 */
export function checkSuggestionText(
  resume: string,
  suggestion: RawSuggestion,
  jd = ''
): Violation[] {
  const violations: Violation[] = [];
  const resumeSkills = extractSkills(resume);
  const jdSkills = extractSkills(jd);

  const beforeNumbers = numbersIn(suggestion.before);
  const afterNumbers = numbersIn(suggestion.after);
  afterNumbers.forEach((token) => {
    if (!beforeNumbers.includes(token) && !tokenMatches(token, resume)) {
      violations.push({ rule: '改写数字', detail: `建议引入新数字「${token}」` });
    }
  });

  const beforeSkills = extractSkills(suggestion.before);
  extractSkills(suggestion.after).forEach((skill) => {
    if (!beforeSkills.includes(skill) && !resumeSkills.includes(skill) && !jdSkills.includes(skill)) {
      violations.push({ rule: '改写技能', detail: `建议引入简历没有的技能「${skill}」` });
    }
  });

  return violations;
}

function greetingTexts(items: OutputEvent[]): string[] {
  return items
    .filter(
      (event): event is Extract<OutputEvent, { kind: 'greeting' }> =>
        event.type === 'item' && event.kind === 'greeting'
    )
    .map((event) => event.text);
}

/** 话术检查：条数、长度、数字与技能可溯源、无套话、无表情符号（质量回归的验收口径） */
export function checkGreetings(resume: string, items: OutputEvent[]): Violation[] {
  const violations: Violation[] = [];
  const texts = greetingTexts(items);

  if (texts.length !== 3) {
    violations.push({ rule: '条数', detail: `应输出 3 条话术，实际 ${texts.length} 条` });
  }

  texts.forEach((text, index) => {
    const length = [...text].length;
    if (length < GREETING_LENGTH.min || length > GREETING_LENGTH.max) {
      violations.push({
        rule: '长度',
        detail: `第 ${index + 1} 条 ${length} 字，超出 ${GREETING_LENGTH.min}~${GREETING_LENGTH.max}`
      });
    }

    checkGreetingText(resume, text).forEach((violation) => {
      violations.push({ rule: violation.rule, detail: `第 ${index + 1} 条${violation.detail}` });
    });
  });

  return violations;
}

/**
 * 改写建议检查：必须锚定可改写区块，且不得引入原文没有的事实、数字与技能。
 * 术语对齐允许补上岗位关注的术语标签（PRD 3.3），因此 JD 里出现的技能不算引入新事实。
 */
export function checkSuggestions(resume: string, raw: RawSuggestion[], jd = ''): Violation[] {
  const violations: Violation[] = [];
  const blocks = parseResume(resume);
  const { suggestions, dropped } = planSuggestions(blocks, raw);

  dropped.forEach((item) => {
    violations.push({
      rule: '建议越界',
      detail: `${item.reason}：${item.suggestion.before.slice(0, 24)}…`
    });
  });

  const editableTitles = blocks
    .filter((block) => block.kind === 'editable')
    .map((block) => block.title);
  raw.forEach((item) => {
    if (item.section && !editableTitles.includes(item.section)) {
      violations.push({ rule: '锁定区块', detail: `建议落在「${item.section}」` });
    }
  });

  suggestions.forEach((suggestion) => {
    violations.push(...checkSuggestionText(resume, suggestion, jd));
  });

  return violations;
}
