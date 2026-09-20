import { describe, expect, it } from 'vitest';
import { analyzeMatch, extractSkills, hasKeyword } from '@zhipin/core';
import { DESIGNER_RESUME, SAMPLE_JD, SAMPLE_RESUME } from './fixtures';

describe('analyzeMatch', () => {
  it('拆出 JD 关键要求、已命中与未覆盖三组', () => {
    const result = analyzeMatch(SAMPLE_RESUME, SAMPLE_JD);

    expect(result.matched).toContain('Java');
    expect(result.matched).toContain('Redis');
    expect(result.missing).toContain('高并发');
    expect(result.missing).toContain('分布式');
    expect(result.lowMatch).toBe(false);
  });

  it('简历与岗位没有直接匹配点时标记低匹配，且不宣称命中', () => {
    const result = analyzeMatch(DESIGNER_RESUME, SAMPLE_JD);

    expect(result.lowMatch).toBe(true);
    expect(result.matched).toHaveLength(0);
    expect(result.missing.length).toBeGreaterThan(0);
  });

  it('英文关键词按词边界匹配，不误判 javascript / good', () => {
    expect(extractSkills('熟悉 JavaScript 与 a good sense')).not.toContain('Java');
    expect(extractSkills('熟悉 JavaScript')).not.toContain('Go');
    expect(extractSkills('使用 Golang 开发')).toContain('Go');
  });

  it('无技能关键词时返回空数组', () => {
    expect(extractSkills('负责团队日常沟通')).toEqual([]);
  });

  it('关键词匹配忽略大小写，空文本不抛错', () => {
    expect(hasKeyword('使用 JAVA 与 spring boot 开发', 'java')).toBe(true);
    expect(hasKeyword('', 'Java')).toBe(false);
  });
});
