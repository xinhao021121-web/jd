/**
 * 纯规则基线（差距诊断 G11）：用关键词匹配 + 模板生成内容，量化「去掉 AI 会怎样」。
 *
 * 这里最要紧的一条是「基线不是稻草人」：模板话术必须能通过产品自己的本地自检，
 * 否则对比就变成了拿一个故意做坏的方案去衬托模型。
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { checkGreetings, parseResume } from '@zhipin/core';
import {
  buildTemplateGreetings,
  buildTemplateSuggestions,
  crossSampleSimilarity,
  extractProfile,
  reasonSimilarity,
  repeatedSentenceRate,
  runTemplate,
  similarity,
  toGreetingEvents
} from '../scripts/baseline-checks';

interface Sample {
  id: string;
  note: string;
  resume: string;
  jd: string;
}

const samples = JSON.parse(
  readFileSync(fileURLToPath(new URL('../tests/samples/quality-samples.json', import.meta.url)), 'utf8')
) as Sample[];
const first = samples[0]!;

describe('extractProfile', () => {
  it('从简历里抽出年限、技能与量化成就', () => {
    const profile = extractProfile(first.resume);

    expect(profile.years).toBe('4 年经验');
    expect(profile.title).toBe('Java 后端开发工程师');
    expect(profile.skills).toContain('Java');
    expect(profile.skills).toContain('Kafka');
    expect(profile.achievements.join()).toContain('P99');
  });

  it('不把「2022.03 - 至今」这类日期行当成量化成就', () => {
    const profile = extractProfile(first.resume);

    expect(profile.achievements.some((line) => line.startsWith('2022.03'))).toBe(false);
  });
});

describe('buildTemplateGreetings', () => {
  it('输出三条，且都能通过产品自己的自检（基线不是稻草人）', () => {
    const texts = buildTemplateGreetings(first.resume, first.jd);

    expect(texts).toHaveLength(3);
    expect(checkGreetings(first.resume, toGreetingEvents(texts))).toEqual([]);
  });

  it('只用简历里真实存在的技能与数字', () => {
    const texts = buildTemplateGreetings(first.resume, first.jd).join('\n');

    expect(texts).toContain('Java');
    expect(texts).toContain('P99');
    expect(texts).not.toContain('Docker');
    expect(texts).not.toContain('Kubernetes');
  });
});

describe('buildTemplateSuggestions', () => {
  it('建议落在可改写区块里，before 是原文片段', () => {
    const suggestions = buildTemplateSuggestions(first.resume, first.jd);
    const editable = parseResume(first.resume)
      .filter((block) => block.kind === 'editable')
      .map((block) => block.title);

    expect(suggestions.length).toBeGreaterThan(0);
    suggestions.forEach((item) => {
      expect(editable).toContain(item.section);
      expect(first.resume).toContain(item.before);
    });
  });

  it('不碰锁定区块的正文', () => {
    const suggestions = buildTemplateSuggestions(first.resume, first.jd);
    const locked = parseResume(first.resume)
      .filter((block) => block.kind === 'locked')
      .flatMap((block) => block.lines)
      .join('\n');

    suggestions.forEach((item) => {
      expect(locked.includes(item.before)).toBe(false);
    });
  });

  it('reason 是固定文案，这正是模板与模型的分界线', () => {
    const suggestions = buildTemplateSuggestions(first.resume, first.jd);
    const reasons = new Set(suggestions.map((item) => item.reason));

    expect(reasons.size).toBe(1);
  });
});

describe('similarity', () => {
  it('相同文本为 1，毫无重合为 0', () => {
    expect(similarity('完全相同的一段话', '完全相同的一段话')).toBe(1);
    expect(similarity('abc123', 'xyz789')).toBe(0);
  });

  it('短于 3 个字符的文本返回 0，不做越界切片', () => {
    expect(similarity('ab', 'ab')).toBe(0);
    expect(similarity('', '任意内容')).toBe(0);
  });
});

describe('模板版的差异指标', () => {
  const runs = samples.slice(0, 4).map((sample) => runTemplate(sample.resume, sample.jd, sample.id));

  it('模板话术跨样本高度相似：换一个岗位，产出长得差不多', () => {
    const similarityScore = crossSampleSimilarity(runs);

    expect(similarityScore).toBeGreaterThan(0);
    expect(similarityScore).toBeLessThan(1);
  });

  it('模板话术里有大段原样复用的句子——这是招聘者眼里的模板感来源', () => {
    expect(repeatedSentenceRate(runs)).toBeGreaterThan(0.3);
  });

  it('reason 完全重复，相似度为 1', () => {
    expect(reasonSimilarity(runs)).toBe(1);
  });
});
