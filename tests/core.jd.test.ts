import { describe, expect, it } from 'vitest';
import { extractJdTitle } from '@zhipin/core';
import { SAMPLE_JD } from './fixtures';

describe('extractJdTitle', () => {
  it('优先读取 JD 中的公司字段与岗位字段', () => {
    expect(extractJdTitle(SAMPLE_JD)).toBe('某电商科技有限公司 · Java 后端开发工程师');
    expect(extractJdTitle('公司：某电商科技有限公司\n岗位：Java 后端开发工程师（高级）')).toBe(
      '某电商科技有限公司 · Java 后端开发工程师'
    );
  });

  it('没有明确字段时按特征词识别公司与岗位', () => {
    const title = extractJdTitle('招聘岗位：产品经理\n某智能科技有限公司\n负责需求分析');
    expect(title).toContain('产品经理');
    expect(title).toContain('某智能科技有限公司');
  });

  it('识别不出公司时只输出岗位', () => {
    expect(extractJdTitle('招聘岗位：产品经理\n负责需求分析')).toBe('产品经理');
  });

  it('都无法识别时取 JD 第一行，空 JD 有兜底名称', () => {
    expect(extractJdTitle('急招！\n待遇从优')).toBe('急招！');
    expect(extractJdTitle('')).toBe('未命名岗位');
  });

  it('过长字段截断到 22 字', () => {
    const long = `公司：${'某'.repeat(40)}科技有限公司\n岗位：后端开发工程师`;
    const title = extractJdTitle(long);
    expect(title.split(' · ')[0]).toHaveLength(22);
  });
});
