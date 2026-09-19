/**
 * 外部盲测的判定逻辑（评审标准六）：人数不足与均分不足都必须判不通过，
 * 回收的脏数据也不能混进结论。
 */
import { describe, expect, it } from 'vitest';
import {
  BLIND_TEST_THRESHOLD,
  parseResultJson,
  summarize,
  type BlindTestRating,
  type BlindTestResult
} from '../scripts/blind-test-checks';

const rating = (
  sample: string,
  humanLike: number,
  sendable: number,
  truthful: number
): BlindTestRating => ({ sample, humanLike, sendable, truthful });

const result = (tester: string, ratings: BlindTestRating[]): BlindTestResult => ({
  tester,
  ratings
});

describe('summarize', () => {
  it('没有收到任何评分时不通过', () => {
    const summary = summarize([]);

    expect(summary.passed).toBe(false);
    expect(summary.testers).toBe(0);
    expect(summary.reason).toContain('还没有收到');
  });

  it('人数不足时即使满分也不通过', () => {
    const summary = summarize([
      result('T1', [rating('S1', 5, 5, 5)]),
      result('T2', [rating('S1', 5, 5, 5)])
    ]);

    expect(summary.overall).toBe(5);
    expect(summary.passed).toBe(false);
    expect(summary.reason).toContain('2 位测试者');
  });

  it('三人且均分达到门槛时通过', () => {
    const summary = summarize([
      result('T1', [rating('S1', 5, 4, 5)]),
      result('T2', [rating('S1', 4, 4, 4)]),
      result('T3', [rating('S1', 5, 3, 4)])
    ]);

    expect(summary.testers).toBe(3);
    expect(summary.ratings).toBe(3);
    expect(summary.dimensions).toEqual({ humanLike: 4.67, sendable: 3.67, truthful: 4.33 });
    expect(summary.overall).toBe(4.22);
    expect(summary.passed).toBe(true);
  });

  it('三人但均分低于门槛时不通过', () => {
    const summary = summarize([
      result('T1', [rating('S1', 5, 5, 5)]),
      result('T2', [rating('S1', 1, 1, 1)]),
      result('T3', [rating('S1', 3, 3, 3)])
    ]);

    expect(summary.overall).toBe(3);
    expect(summary.overall).toBeLessThan(BLIND_TEST_THRESHOLD);
    expect(summary.passed).toBe(false);
    expect(summary.reason).toContain('低于门槛');
  });

  it('同一测试者的多组样本一起计入均值', () => {
    const summary = summarize([
      result('T1', [rating('S1', 5, 5, 5), rating('S2', 3, 3, 3)]),
      result('T2', [rating('S1', 4, 4, 4)]),
      result('T3', [rating('S1', 4, 4, 4)])
    ]);

    expect(summary.testers).toBe(3);
    expect(summary.ratings).toBe(4);
    expect(summary.dimensions.humanLike).toBe(4);
  });
});

describe('parseResultJson', () => {
  it('解析测试者导出的结果', () => {
    const parsed = parseResultJson(
      JSON.stringify({
        tester: 'T1',
        submittedAt: '2026-09-20T00:00:00.000Z',
        ratings: [{ sample: 'S1', humanLike: 4, sendable: 5, truthful: 5 }]
      }),
      'fallback'
    );

    expect(parsed?.tester).toBe('T1');
    expect(parsed?.ratings).toHaveLength(1);
  });

  it('非法 JSON 返回 null', () => {
    expect(parseResultJson('这不是 JSON', 'T1')).toBeNull();
  });

  it('超出 1–5 或缺失的评分被丢弃，全丢则返回 null', () => {
    const parsed = parseResultJson(
      JSON.stringify({
        tester: 'T1',
        ratings: [
          { sample: 'S1', humanLike: 9, sendable: 5, truthful: 5 },
          { sample: 'S2', humanLike: 4, sendable: 4 },
          { sample: 'S3', humanLike: 4, sendable: 4, truthful: 4 }
        ]
      }),
      'fallback'
    );

    expect(parsed?.ratings).toEqual([
      { sample: 'S3', humanLike: 4, sendable: 4, truthful: 4 }
    ]);

    expect(
      parseResultJson(JSON.stringify({ tester: 'T2', ratings: [{ sample: 'S1' }] }), 'T2')
    ).toBeNull();
  });

  it('未填代号时回退到文件名', () => {
    const parsed = parseResultJson(
      JSON.stringify({ ratings: [{ sample: 'S1', humanLike: 4, sendable: 4, truthful: 4 }] }),
      'T9'
    );

    expect(parsed?.tester).toBe('T9');
  });
});
