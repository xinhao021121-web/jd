/**
 * 评分表模板与解析器的契约（评审标准六的外部盲测工具链）。
 *
 * 存在的理由：`parseResultJson` 对格式不符的结果是**静默丢弃**的——字段名一改，
 * 测试者辛苦填回来的评分会全部变成「无效」，而汇总脚本只会说「还没有收到任何评分结果」。
 * 这类失败没有报错、没有堆栈，只能靠契约测试拦住。
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseResultJson } from '../scripts/blind-test-checks';

const template = readFileSync(
  fileURLToPath(new URL('../scripts/blind-test-kit.html', import.meta.url)),
  'utf8'
);

/** 模板里 QUESTIONS 的 key，即评分表实际收集的维度 */
const questionKeys = [...template.matchAll(/key:\s*'(\w+)'/g)].map((match) => match[1]);

describe('评分表模板', () => {
  it('保留被生成脚本替换的两个占位符', () => {
    expect(template).toContain('__URL__');
    expect(template).toContain('__DATA__');
  });

  it('收集三个维度，且与解析器期望的字段同名', () => {
    expect(questionKeys).toEqual(['humanLike', 'sendable', 'truthful']);
  });

  it('导出结构含 tester、submittedAt 与 ratings', () => {
    expect(template).toContain('tester: tester');
    expect(template).toContain('submittedAt: new Date().toISOString()');
    expect(template).toContain('ratings: ratings');
    expect(template).toContain('rating[question.key]');
  });
});

describe('模板导出的结果能被解析器接受', () => {
  /** 按模板的导出逻辑拼一份结果：字段名与嵌套结构与评分表完全一致 */
  const exported = JSON.stringify({
    tester: 'T1',
    submittedAt: '2026-09-21T00:00:00.000Z',
    ratings: [
      {
        sample: 'S1',
        ...Object.fromEntries(questionKeys.map((key) => [key, 4]))
      }
    ]
  });

  it('三个维度都被保留，一条都没被丢弃', () => {
    const parsed = parseResultJson(exported, 'fallback');

    expect(parsed).not.toBeNull();
    expect(parsed?.tester).toBe('T1');
    expect(parsed?.ratings).toHaveLength(1);
    expect(Object.keys(parsed!.ratings[0]).sort()).toEqual(
      ['humanLike', 'sample', 'sendable', 'truthful'].sort()
    );
  });

  it('把维度 key 改名会让结果被丢弃（这就是要拦的静默失败）', () => {
    const renamed = JSON.stringify({
      tester: 'T1',
      ratings: [{ sample: 'S1', humanLike: 4, sendable: 4, truthfulness: 4 }]
    });

    expect(parseResultJson(renamed, 'T1')).toBeNull();
  });
});
