import { describe, expect, it } from 'vitest';
import {
  EDITABLE_TITLES,
  RESUME_HEAD_TITLE,
  classifyBlock,
  diffResumeLines,
  isHeading,
  parseResume
} from '@zhipin/core';
import { SAMPLE_RESUME } from './fixtures';

describe('parseResume / classifyBlock', () => {
  it('小标题判定只认整行标题，行内的同名词不算标题', () => {
    expect(isHeading('工作经历')).toBe(true);
    expect(isHeading('  【专业技能】  ')).toBe(true);
    expect(isHeading('工作经历：负责订单中心开发')).toBe(false);
    expect(isHeading('负责订单中心核心链路开发')).toBe(false);
  });

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

describe('diffResumeLines', () => {
  const RESUME = [
    '李某某 | Java 后端开发工程师 | 3 年经验',
    '',
    '工作经历',
    '- 主导订单查询接口性能优化，P99 从 800ms 降到 180ms',
    '- 参与微服务拆分，基于 Kafka 实现订单状态异步通知'
  ].join('\n');

  it('逐行比出被改动的行，行序与原文一致', () => {
    const content = RESUME.replace('P99 从 800ms 降到 180ms', 'P99 从 800ms 降到 180ms（高并发场景）');
    const changes = diffResumeLines(RESUME, content);

    expect(changes).toEqual([
      {
        before: '- 主导订单查询接口性能优化，P99 从 800ms 降到 180ms',
        after: '- 主导订单查询接口性能优化，P99 从 800ms 降到 180ms（高并发场景）'
      }
    ]);
  });

  it('两行都改时按行序返回，未改的行不进结果', () => {
    const content = [
      '李某某 | Java 后端开发工程师 | 3 年经验',
      '',
      '工作经历',
      '- 主导订单查询接口性能优化，P99 从 800ms 降到 180ms（高并发场景）',
      '- 参与微服务拆分，基于 Kafka 实现订单状态异步通知（分布式场景）'
    ].join('\n');

    expect(diffResumeLines(RESUME, content).map((change) => change.after)).toEqual([
      '- 主导订单查询接口性能优化，P99 从 800ms 降到 180ms（高并发场景）',
      '- 参与微服务拆分，基于 Kafka 实现订单状态异步通知（分布式场景）'
    ]);
  });

  it('内容与原始简历一致时返回空，用于「没有可回填的改动」', () => {
    expect(diffResumeLines(RESUME, RESUME)).toEqual([]);
  });

  it('原文里重复出现的行不参与比对，避免错位替换', () => {
    const resume = '- 负责订单系统\n- 负责订单系统\n- 负责对账系统';
    const content = '- 负责订单系统（高并发）\n- 负责订单系统\n- 负责对账系统';

    expect(diffResumeLines(resume, content)).toEqual([]);
  });

  it('行数不一致时直接放弃，不做可能错位的比对', () => {
    const content = `${RESUME}\n- 新加的一行`;
    expect(diffResumeLines(RESUME, content)).toEqual([]);

    const shorter = RESUME.split('\n').slice(0, 3).join('\n');
    expect(diffResumeLines(RESUME, shorter)).toEqual([]);
  });

  it('插入空行会打乱行对齐，同样放弃', () => {
    expect(diffResumeLines(RESUME, RESUME.replace('工作经历\n', '工作经历\n\n'))).toEqual([]);
  });
});
