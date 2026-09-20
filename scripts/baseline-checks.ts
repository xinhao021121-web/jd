/**
 * 纯规则基线（差距诊断 G11）：用关键词匹配 + 模板生成话术与改写建议，
 * 回答「把模型拿掉，这套产品还剩下什么」。
 *
 * 基线是刻意做认真的：它复用产品自己的匹配分析与本地自检，只填简历原文里
 * 存在的技能与数字。所以它不会靠「编造」输掉对比——如果它输了，输在哪就是
 * 要测量的东西。
 */
import {
  analyzeMatch,
  checkGreetings,
  checkSuggestions,
  parseResume,
  type Violation
} from '@zhipin/core';
import { GREETING_STYLES, SUGGESTION_TYPES, type OutputEvent } from '@zhipin/shared';

export interface ResumeProfile {
  /** 例如「4 年经验」；抽不到时为空串 */
  years: string;
  /** 岗位方向，取自简历首行的第二段 */
  title: string;
  /** 专业技能区块里的技能，按原文顺序 */
  skills: string[];
  /** 含数字的量化行，用于给话术提供证据 */
  achievements: string[];
}

export interface TemplateSuggestion {
  section: string;
  before: string;
  after: string;
  reason: string;
  suggestionType: (typeof SUGGESTION_TYPES)[number];
}

const stripBullet = (line: string): string => line.replace(/^[-•·]\s*/, '').trim();

export function extractProfile(resume: string): ResumeProfile {
  const lines = resume.split('\n').map((line) => line.trim()).filter(Boolean);
  const head = lines[0] ?? '';
  const blocks = parseResume(resume).filter((block) => block.kind === 'editable');

  const bodyLines = blocks
    .flatMap((block) => block.lines)
    .map((line) => line.trim())
    .filter((line) => line && !blocks.some((block) => block.title === line));

  const skillBlock = blocks.find((block) => block.title.includes('技能'));
  const skills = skillBlock
    ? skillBlock.lines
        .filter((line) => line.trim() && line.trim() !== skillBlock.title)
        .flatMap((line) => line.split(/[、,，/]/))
        .map((item) => item.trim())
        .filter(Boolean)
    : [];

  return {
    years: head.match(/(\d+\s*年(?:以上)?(?:工作)?经验)/)?.[1] ?? '',
    title: head.split('|')[1]?.trim() ?? '',
    skills,
    // 含数字的行才算量化证据；以日期开头的行（「2022.03 - 至今 某公司」）要排掉
    achievements: bodyLines
      .filter((line) => /\d/.test(line) && !/^\d{4}[.\-/年]?\d{0,2}\s*[-–—]/.test(line))
      .map(stripBullet)
  };
}

/**
 * 三条模板话术：骨架固定，只有槽位随简历与 JD 变化。
 * 这正是「模板」的定义，也是它和模型输出的区别所在。
 */
export function buildTemplateGreetings(resume: string, jd: string): string[] {
  const profile = extractProfile(resume);
  const analysis = analyzeMatch(resume, jd);
  const matched = analysis.matched.length ? analysis.matched : profile.skills;
  const skillText = matched.slice(0, 5).join('、') || profile.skills.slice(0, 5).join('、');
  const evidence = profile.achievements[0] ?? '';
  const second = profile.achievements[1] ?? '';
  const requirement = analysis.requirements[0] ?? '岗位要求';
  const years = profile.years || '相关';
  const title = profile.title || '求职者';

  return [
    `您好，我有 ${years}，技术栈以 ${skillText} 为主。${evidence}。看到岗位方向与我的经历比较接近，希望进一步沟通。`,
    `您好，我在上一份工作中的主要工作包括：${evidence}${second ? `；${second}` : ''}。这些内容与岗位要求的 ${requirement} 相关，希望有机会详细聊聊。`,
    `您好，我是有 ${years}的${title}，主要使用 ${skillText}。${evidence}。看到岗位在招人，想进一步沟通。`
  ];
}

/**
 * 模板建议：在「含有已命中关键词」的行尾追加「JD 关注且简历确实拥有」的术语。
 * 只处理可改写区块，且不改动锁定区块——上半部分的规则和产品一致。
 */
export function buildTemplateSuggestions(
  resume: string,
  jd: string,
  limit = 3
): TemplateSuggestion[] {
  const profile = extractProfile(resume);
  const analysis = analyzeMatch(resume, jd);
  const candidates = analysis.requirements.filter((item) =>
    profile.skills.some((skill) => skill === item || item.includes(skill) || skill.includes(item))
  );
  const blocks = parseResume(resume).filter((block) => block.kind === 'editable');
  const suggestions: TemplateSuggestion[] = [];

  for (const block of blocks) {
    if (suggestions.length >= limit) break;
    for (const raw of block.lines) {
      if (suggestions.length >= limit) break;
      const before = stripBullet(raw);
      if (!before || before === block.title || !/\d/.test(before)) continue;

      const missingHere = candidates.filter((item) => !before.includes(item));
      if (!missingHere.length) continue;

      suggestions.push({
        section: block.title,
        before,
        after: `${before}（涉及 ${missingHere.slice(0, 2).join('、')}）`,
        reason: '补上岗位关注的术语',
        suggestionType: '术语对齐'
      });
    }
  }

  return suggestions;
}

export function toGreetingEvents(texts: string[]): OutputEvent[] {
  return texts.map((text, index) => ({
    type: 'item',
    kind: 'greeting',
    index,
    style: GREETING_STYLES[index] ?? GREETING_STYLES[0],
    text
  }));
}

export interface BaselineRun {
  sample: string;
  greetingTexts: string[];
  suggestionReasons: string[];
  violations: Violation[];
}

/** 跑一个样本的完整规则基线：话术三条 + 改写建议若干，并用产品同一套自检判定 */
export function runTemplate(resume: string, jd: string, sample: string): BaselineRun {
  const greetingTexts = buildTemplateGreetings(resume, jd);
  const suggestions = buildTemplateSuggestions(resume, jd);

  return {
    sample,
    greetingTexts,
    suggestionReasons: suggestions.map((item) => item.reason),
    violations: [
      ...checkGreetings(resume, toGreetingEvents(greetingTexts)),
      ...checkSuggestions(resume, suggestions, jd)
    ]
  };
}

/** 字符 3-gram 的 Jaccard 相似度：0 表示毫无重合，1 表示完全一致 */
export function similarity(a: string, b: string): number {
  const grams = (text: string): Set<string> => {
    const set = new Set<string>();
    for (let index = 0; index + 3 <= text.length; index += 1) {
      set.add(text.slice(index, index + 3));
    }
    return set;
  };

  const left = grams(a);
  const right = grams(b);
  if (!left.size || !right.size) return 0;

  let intersection = 0;
  left.forEach((gram) => {
    if (right.has(gram)) intersection += 1;
  });
  return Math.round((intersection / (left.size + right.size - intersection)) * 1000) / 1000;
}

/** 跨样本的两两平均相似度：衡量「换一个岗位，产出有多像」 */
export function crossSampleSimilarity(rows: BaselineRun[]): number {
  const pairs: number[] = [];

  for (let i = 0; i < rows.length; i += 1) {
    for (let j = i + 1; j < rows.length; j += 1) {
      rows[i].greetingTexts.forEach((left) => {
        rows[j].greetingTexts.forEach((right) => pairs.push(similarity(left, right)));
      });
    }
  }

  if (!pairs.length) return 0;
  const mean = pairs.reduce((sum, value) => sum + value, 0) / pairs.length;
  return Math.round(mean * 1000) / 1000;
}

const splitSentences = (text: string): string[] =>
  text
    .split(/[。！？；]/)
    .map((item) => item.trim())
    .filter(Boolean);

/**
 * 重复句比例：把话术按标点切句，统计「在别处也原样出现过」的句子占比。
 *
 * 这是比相似度更贴切的指标。骨架在一条话术里只占两成，任何 n-gram 指标都会被
 * 内容差异稀释；但「换一个岗位，结尾那句一模一样」正是招聘者眼里的模板感来源。
 */
export function repeatedSentenceRate(rows: BaselineRun[]): number {
  const sentences = rows.flatMap((row) => row.greetingTexts.flatMap(splitSentences));
  if (!sentences.length) return 0;

  const counts = new Map<string, number>();
  sentences.forEach((sentence) => counts.set(sentence, (counts.get(sentence) ?? 0) + 1));

  const repeated = sentences.filter((sentence) => (counts.get(sentence) ?? 0) > 1).length;
  return Math.round((repeated / sentences.length) * 1000) / 1000;
}

/** 同一批 reason 的平均两两相似度：模板版所有 reason 完全相同，会得到 1 */
export function reasonSimilarity(rows: BaselineRun[]): number {
  const reasons = rows.flatMap((row) => row.suggestionReasons);
  if (reasons.length < 2) return 0;

  const pairs: number[] = [];
  for (let i = 0; i < reasons.length; i += 1) {
    for (let j = i + 1; j < reasons.length; j += 1) {
      pairs.push(similarity(reasons[i], reasons[j]));
    }
  }

  const mean = pairs.reduce((sum, value) => sum + value, 0) / pairs.length;
  return Math.round(mean * 1000) / 1000;
}
