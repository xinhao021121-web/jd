import { describe, expect, it } from 'vitest';
import {
  composeCustomResume,
  parseResume,
  planSuggestions,
  type RawSuggestion
} from '@zhipin/core';
import { SAMPLE_RESUME } from './fixtures';

const quantifyLine =
  '主导订单查询接口性能优化，通过 Redis 缓存与 SQL 优化将 P99 响应时间从 800ms 降到 180ms';

const makeSuggestion = (over: Partial<RawSuggestion> = {}): RawSuggestion => ({
  section: '工作经历',
  before: quantifyLine,
  after: `${quantifyLine}（高并发场景）`,
  reason: '补上岗位关注的术语标签，不改变事实',
  ...over
});

const plan = (raw: RawSuggestion | RawSuggestion[]) =>
  planSuggestions(parseResume(SAMPLE_RESUME), Array.isArray(raw) ? raw : [raw]);

describe('planSuggestions', () => {
  it('把建议绑定到可改写区块的具体行', () => {
    const { suggestions, dropped } = plan(makeSuggestion());

    expect(dropped).toHaveLength(0);
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0]?.section).toBe('工作经历');
    expect(suggestions[0]?.blockIndex).toBe(1);
    expect(suggestions[0]?.adopted).toBe(false);
  });

  it('落在锁定区块的建议一律丢弃', () => {
    const { suggestions, dropped } = plan(
      makeSuggestion({
        section: '教育背景',
        before: '某某大学  计算机科学与技术  本科  2021 届',
        after: '某某大学  计算机科学与技术  本科  2021 届（985）'
      })
    );

    expect(suggestions).toHaveLength(0);
    expect(dropped[0]?.reason).toContain('锁定区块');
  });

  it('标注区块缺失时不越界：只在可改写区块里找锚点', () => {
    const { suggestions } = plan(makeSuggestion({ section: '' }));
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0]?.section).toBe('工作经历');
  });

  it('原文匹配不上的建议直接丢弃', () => {
    const { suggestions, dropped } = plan(makeSuggestion({ before: '这段原文并不存在于简历里' }));
    expect(suggestions).toHaveLength(0);
    expect(dropped[0]?.reason).toContain('匹配不上');
  });

  it('跨行建议被丢弃', () => {
    const { suggestions, dropped } = plan(makeSuggestion({ before: `${quantifyLine}\n2021.07 - 2023.05` }));
    expect(suggestions).toHaveLength(0);
    expect(dropped[0]?.reason).toContain('跨行');
  });

  it('缺原文或建议写法、原文与建议一致的条目都被丢弃', () => {
    const missing = plan(makeSuggestion({ before: '' }));
    expect(missing.suggestions).toHaveLength(0);
    expect(missing.dropped[0]?.reason).toContain('缺少原文或建议写法');

    const noop = plan(makeSuggestion({ after: quantifyLine }));
    expect(noop.suggestions).toHaveLength(0);
    expect(noop.dropped[0]?.reason).toContain('无需改写');
  });

  it('同一行同一改法的重复建议只保留一条', () => {
    const { suggestions, dropped } = plan([makeSuggestion(), makeSuggestion()]);

    expect(suggestions).toHaveLength(1);
    expect(dropped).toHaveLength(1);
    expect(dropped[0]?.reason).toContain('重复建议');
  });
});

describe('composeCustomResume', () => {
  it('未采纳任何建议时与原件完全一致', () => {
    const { suggestions } = plan(makeSuggestion());
    expect(composeCustomResume(SAMPLE_RESUME, suggestions)).toBe(SAMPLE_RESUME);
    expect(composeCustomResume(SAMPLE_RESUME, [])).toBe(SAMPLE_RESUME);
    expect(composeCustomResume(SAMPLE_RESUME, [{ ...suggestions[0]!, adopted: false }])).toBe(
      SAMPLE_RESUME
    );
  });

  it('采纳后只替换锚点，个人信息与教育经历逐字不变', () => {
    const { suggestions } = plan(makeSuggestion());
    const composed = composeCustomResume(
      SAMPLE_RESUME,
      suggestions.map((s) => ({ ...s, adopted: true }))
    );

    expect(composed).toContain(`${quantifyLine}（高并发场景）`);
    const before = parseResume(SAMPLE_RESUME).filter((b) => b.kind === 'locked');
    const after = parseResume(composed).filter((b) => b.kind === 'locked');
    expect(after.map((b) => b.lines)).toEqual(before.map((b) => b.lines));
  });

  it('锚点替换不会被建议文本里的 $& 影响', () => {
    const { suggestions } = plan(makeSuggestion({ after: '$& 特殊符号' }));
    const composed = composeCustomResume(
      SAMPLE_RESUME,
      suggestions.map((s) => ({ ...s, adopted: true }))
    );
    expect(composed).toContain('$& 特殊符号');
    expect(composed).not.toContain(quantifyLine);
  });

  it('采纳的建议匹配不上锚点时被丢弃，输出仍是合法简历', () => {
    const { suggestions } = plan(makeSuggestion());
    const composed = composeCustomResume(SAMPLE_RESUME, [
      { ...suggestions[0]!, adopted: true, before: '已不存在的原文' }
    ]);
    expect(composed).toBe(SAMPLE_RESUME);
  });

  it('同一区块的多条建议可以叠加生效', () => {
    const lines = [
      makeSuggestion(),
      makeSuggestion({
        before: '参与微服务拆分，基于 Kafka 实现订单状态异步通知，日均处理消息 40 万条',
        after: '参与微服务拆分，基于 Kafka 实现订单状态异步通知，日均处理消息 40 万条（消息队列场景）'
      })
    ];
    const { suggestions } = plan(lines);
    const composed = composeCustomResume(
      SAMPLE_RESUME,
      suggestions.map((s) => ({ ...s, adopted: true }))
    );

    expect(suggestions).toHaveLength(2);
    expect(composed).toContain('（高并发场景）');
    expect(composed).toContain('（消息队列场景）');
  });
});
