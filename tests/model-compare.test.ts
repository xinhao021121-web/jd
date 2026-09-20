/**
 * 模型选型对比的汇总逻辑（差距诊断 G6 / G7）。
 * 真实调用要花钱，所以纯逻辑必须能离线验证。
 */
import { describe, expect, it } from 'vitest';
import {
  costPerGeneration,
  parseModels,
  summarizeByModel,
  type RunRecord
} from '../scripts/model-compare-checks';

const record = (
  model: string,
  sample: string,
  task: 'greeting' | 'suggestions',
  values: Partial<RunRecord> = {}
): RunRecord => ({
  model,
  sample,
  task,
  violations: 0,
  firstTokenMs: 100,
  elapsedMs: 1000,
  promptTokens: 1000,
  completionTokens: 100,
  ...values
});

describe('parseModels', () => {
  it('按逗号拆分并去掉空白', () => {
    expect(parseModels('a, b ,c', ['x'])).toEqual(['a', 'b', 'c']);
  });

  it('没传参数时用默认模型', () => {
    expect(parseModels(undefined, ['x', 'y'])).toEqual(['x', 'y']);
    expect(parseModels('', ['x'])).toEqual(['x']);
    expect(parseModels(' , ', ['x'])).toEqual(['x']);
  });
});

describe('summarizeByModel', () => {
  const records: RunRecord[] = [
    record('A', 'S1', 'greeting', {
      firstTokenMs: 100,
      elapsedMs: 1000,
      promptTokens: 1000,
      completionTokens: 100
    }),
    record('A', 'S1', 'suggestions', {
      violations: 1,
      firstTokenMs: 200,
      elapsedMs: 2000,
      promptTokens: 800,
      completionTokens: 200
    }),
    record('A', 'S2', 'greeting', {
      firstTokenMs: 300,
      elapsedMs: 1200,
      promptTokens: 1100,
      completionTokens: 120
    }),
    record('A', 'S2', 'suggestions', {
      firstTokenMs: 400,
      elapsedMs: 2200,
      promptTokens: 900,
      completionTokens: 210
    }),
    record('B', 'S1', 'greeting', {
      firstTokenMs: 900,
      elapsedMs: 3000,
      promptTokens: 0,
      completionTokens: 0
    })
  ];

  it('按模型分别汇总运行次数、样本数与违规数', () => {
    const [a, b] = summarizeByModel(records);

    expect(a?.model).toBe('A');
    expect(a?.runs).toBe(4);
    expect(a?.samples).toBe(2);
    expect(a?.violations).toBe(1);

    expect(b?.runs).toBe(1);
    expect(b?.violations).toBe(0);
  });

  it('逐次均值按运行次数算，token 与耗时都取平均', () => {
    const [a] = summarizeByModel(records);

    expect(a?.avgFirstTokenMs).toBe(250);
    expect(a?.avgElapsedMs).toBe(1600);
    expect(a?.avgPromptTokens).toBe(950);
    expect(a?.avgCompletionTokens).toBe(157.5);
  });

  it('一次完整生成＝同一样本下话术与建议的合计再平均', () => {
    const [a] = summarizeByModel(records);

    // S1：1800 + 300 tokens / 3000 ms；S2：2000 + 330 tokens / 3400 ms
    expect(a?.perGeneration).toEqual({
      promptTokens: 1900,
      completionTokens: 315,
      elapsedMs: 3200
    });
  });

  it('端点没返回用量时标记为不可用，而不是当成 0 成本', () => {
    const [a, b] = summarizeByModel(records);
    const c = summarizeByModel([
      record('C', 'S1', 'greeting', { promptTokens: 0, completionTokens: 0 })
    ]);

    expect(a?.usageAvailable).toBe(true);
    expect(b?.usageAvailable).toBe(false);
    expect(c[0]?.usageAvailable).toBe(false);
  });

  it('全部拿不到首字时间时返回 null，而不是 0', () => {
    const [only] = summarizeByModel([record('D', 'S1', 'greeting', { firstTokenMs: null })]);

    expect(only?.avgFirstTokenMs).toBeNull();
  });

  it('没有记录时返回空数组', () => {
    expect(summarizeByModel([])).toEqual([]);
  });
});

describe('costPerGeneration', () => {
  it('按输入输出单价折算单次成本', () => {
    const [summary] = summarizeByModel([
      record('A', 'S1', 'greeting', { promptTokens: 1_000_000, completionTokens: 1_000_000 })
    ]);

    // 一百万输入 + 一百万输出，单价之和即单次成本
    expect(costPerGeneration(summary!, 0.15, 0.6)).toBe(0.75);
  });

  it('小额用量的成本不会被取整抹成 0', () => {
    const [summary] = summarizeByModel([
      record('A', 'S1', 'greeting', { promptTokens: 2000, completionTokens: 300 })
    ]);

    expect(costPerGeneration(summary!, 0.15, 0.6)).toBe(0.00048);
  });
});
