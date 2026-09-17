import { describe, expect, it } from 'vitest';
import {
  EDITABLE_TITLES,
  RESUME_HEAD_TITLE,
  classifyBlock,
  parseResume
} from '@zhipin/core';
import { SAMPLE_RESUME } from './fixtures';

describe('parseResume / classifyBlock', () => {
  it('按小标题切分区块，保留原始顺序与原文', () => {
    const blocks = parseResume(SAMPLE_RESUME);

    expect(blocks[0]?.title).toBe(RESUME_HEAD_TITLE);
    expect(blocks.map((b) => b.title)).toEqual([
      RESUME_HEAD_TITLE,
      '工作经历',
      '专业技能',
      '教育背景'
    ]);
    expect(blocks.map((b) => b.lines.join('\n')).join('\n')).toBe(SAMPLE_RESUME);
  });

  it('经历类、自我评价与技能类区块可改写', () => {
    EDITABLE_TITLES.forEach((title) => {
      expect(classifyBlock(title)).toBe('editable');
    });
    expect(parseResume(SAMPLE_RESUME).filter((b) => b.kind === 'editable').map((b) => b.title)).toEqual(
      ['工作经历', '专业技能']
    );
  });

  it('个人信息、教育经历与未识别小标题一律锁定', () => {
    ['个人信息', '基本信息', '教育经历', '教育背景', '学历'].forEach((title) => {
      expect(classifyBlock(title)).toBe('locked');
    });
    expect(classifyBlock('获奖情况')).toBe('locked');
    expect(classifyBlock('我的项目')).toBe('locked');
    expect(classifyBlock(RESUME_HEAD_TITLE)).toBe('locked');
  });

  it('识别带括号、方括号与全角冒号的小标题写法', () => {
    const blocks = parseResume('【项目经历】：\n负责订单系统\n\n专业技能:\nJava');
    expect(blocks.map((b) => b.title)).toEqual([RESUME_HEAD_TITLE, '项目经历', '专业技能']);
    expect(blocks.map((b) => b.kind)).toEqual(['locked', 'editable', 'editable']);
  });

  it('没有小标题时整体作为锁定的开头区块', () => {
    const blocks = parseResume('李某某 Java 工程师 3 年经验');
    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.kind).toBe('locked');
  });
});
