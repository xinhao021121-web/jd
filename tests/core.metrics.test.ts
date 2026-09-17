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
