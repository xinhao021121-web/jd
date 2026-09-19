import { describe, expect, it } from 'vitest';
import { calcMetrics } from '@zhipin/core';
import type { TelemetryEvent } from '@zhipin/shared';

describe('calcMetrics', () => {
  it('空记录返回全零指标', () => {
    expect(calcMetrics([])).toEqual({
      generateCount: 0,
      regenerateCount: 0,
      copyCount: 0,
      cleanCopyCount: 0,
      cleanCopyRate: 0,
      cleanCopySessionCount: 0,
      cleanCopySessionRate: 0,
      suggestGenerateCount: 0,
      adoptedSessionCount: 0,
      adoptionRate: 0,
      suggestionsPerSession: 0,
      adoptedSuggestionCount: 0,
      customResumeCount: 0,
      errorCount: 0
    });
  });

  it('零修改直接复制率 = 未编辑即复制 / 复制总数', () => {
    const events: TelemetryEvent[] = [
      { type: 'generate', at: 1 },
      { type: 'copy', at: 2, index: 0, edited: false },
      { type: 'copy', at: 3, index: 1, edited: true },
      { type: 'copy', at: 4, index: 2, edited: false },
      { type: 'regenerate', at: 5 },
      { type: 'suggest_adopt', at: 6, section: '工作经历', count: 2 },
      { type: 'custom_save', at: 7, count: 2 },
      { type: 'error', at: 8, errorType: 'RATE_LIMITED' }
    ];

    const metrics = calcMetrics(events);

    expect(metrics.generateCount).toBe(1);
    expect(metrics.regenerateCount).toBe(1);
    expect(metrics.copyCount).toBe(3);
    expect(metrics.cleanCopyCount).toBe(2);
    expect(metrics.cleanCopyRate).toBeCloseTo(2 / 3);
    expect(metrics.adoptedSuggestionCount).toBe(2);
    expect(metrics.customResumeCount).toBe(1);
    expect(metrics.errorCount).toBe(1);
  });

  it('没有复制行为时比率记为 0，不产生 NaN', () => {
    expect(calcMetrics([{ type: 'generate', at: 1 }]).cleanCopyRate).toBe(0);
  });
});

describe('会话级零修改复制率（PRD 1.1.3 主指标）', () => {
  const events: TelemetryEvent[] = [
    // 第 1 次生成：编辑过一条，但也直接复制了另一条 → 算拿到
    { type: 'generate', at: 1, sessionId: 'g1' },
    { type: 'copy', at: 2, sessionId: 'g1', index: 0, edited: true },
    { type: 'copy', at: 3, sessionId: 'g1', index: 1, edited: false },
    // 第 2 次生成：只复制了编辑后的话术 → 不算拿到
    { type: 'generate', at: 4, sessionId: 'g2' },
    { type: 'copy', at: 5, sessionId: 'g2', index: 0, edited: true },
    // 第 3 次生成：没有复制 → 不算拿到
    { type: 'generate', at: 6, sessionId: 'g3' }
  ];

  it('分子是有拿到未编辑话术的生成次数，分母是生成总次数', () => {
    const metrics = calcMetrics(events);

    expect(metrics.generateCount).toBe(3);
    expect(metrics.cleanCopySessionCount).toBe(1);
    expect(metrics.cleanCopySessionRate).toBeCloseTo(1 / 3);
    // 条级仍按复制条数算，作为辅助指标
    expect(metrics.cleanCopyRate).toBeCloseTo(1 / 3);
  });

  it('同一次生成里复制多条只算一次会话', () => {
    const metrics = calcMetrics([
      { type: 'generate', at: 1, sessionId: 'g1' },
      { type: 'copy', at: 2, sessionId: 'g1', index: 0, edited: false },
      { type: 'copy', at: 3, sessionId: 'g1', index: 1, edited: false }
    ]);

    expect(metrics.cleanCopySessionCount).toBe(1);
    expect(metrics.cleanCopySessionRate).toBe(1);
  });

  it('旧记录缺少会话标识时不计入会话口径，也不产生 NaN', () => {
    const metrics = calcMetrics([
      { type: 'generate', at: 1 },
      { type: 'copy', at: 2, index: 0, edited: false }
    ]);

    expect(metrics.cleanCopySessionCount).toBe(0);
    expect(metrics.cleanCopySessionRate).toBe(0);
  });
});

describe('改写建议的采纳指标', () => {
  const events: TelemetryEvent[] = [
    { type: 'suggest_generate', at: 1, sessionId: 's1', count: 4 },
    { type: 'suggest_adopt', at: 2, sessionId: 's1', section: '工作经历', count: 1 },
    { type: 'custom_save', at: 3, sessionId: 's1', count: 1 },
    { type: 'suggest_generate', at: 4, sessionId: 's2', count: 2 },
    // 采纳后又取消，净额为 0，这一份不算"至少采纳 1 条"
    { type: 'suggest_adopt', at: 5, sessionId: 's2', section: '专业技能', count: 1 },
    { type: 'suggest_adopt', at: 6, sessionId: 's2', section: '专业技能', count: -1 }
  ];

  it('采纳率 = 至少采纳 1 条的会话数 / 生成建议次数', () => {
    const metrics = calcMetrics(events);

    expect(metrics.suggestGenerateCount).toBe(2);
    expect(metrics.adoptedSessionCount).toBe(1);
    expect(metrics.adoptionRate).toBe(0.5);
  });

  it('平均每份可采纳建议数取每次生成建议条数的均值', () => {
    expect(calcMetrics(events).suggestionsPerSession).toBe(3);
  });

  it('没有生成建议时不产生 NaN', () => {
    const metrics = calcMetrics([{ type: 'custom_save', at: 1, count: 1 }]);

    expect(metrics.adoptionRate).toBe(0);
    expect(metrics.suggestionsPerSession).toBe(0);
  });
});
