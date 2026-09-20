import { describe, expect, it } from 'vitest';
import type { OutputEvent } from '@zhipin/shared';
import { checkGreetings, checkSuggestions } from '@zhipin/core';
import { SAMPLE_RESUME } from './fixtures';
import { SAMPLE_JD } from './fixtures';

const greeting = (text: string, index = 0): OutputEvent => ({
  type: 'item',
  kind: 'greeting',
  index,
  style: '技能匹配型',
  text
});

/** 构造一段刚好落在长度区间内、且事实可溯源的话术 */
const cleanText =
  '您好，我有后端方向的工作经验，Java、Redis 是我日常工作的主要部分。主导订单查询接口性能优化，将 P99 响应时间从 800ms 降到 180ms，看到岗位在找同方向的人，方便的话想和您具体聊聊。';

describe('checkGreetings', () => {
  it('长度、答案可溯源时判定通过', () => {
    const text = `${cleanText}${'好'.repeat(40)}`;
    const violations = checkGreetings(SAMPLE_RESUME, [
      greeting(text, 0),
      greeting(text, 1),
      greeting(text, 2)
    ]);
    expect(violations).toEqual([]);
  });

  it('抓出简历里没有的数字与技能', () => {
    const violations = checkGreetings(SAMPLE_RESUME, [
      greeting(`${cleanText}负责每日 9999 万次请求。`, 0),
      greeting(`${cleanText}熟悉 Kubernetes 与 Golang。`, 1),
      greeting(cleanText, 2)
    ]);

    expect(violations.map((item) => item.rule)).toContain('数字溯源');
    expect(violations.map((item) => item.rule)).toContain('技能溯源');
    expect(violations.some((item) => item.detail.includes('Go'))).toBe(true);
  });

  it('抓出套话与表情符号', () => {
    const violations = checkGreetings(SAMPLE_RESUME, [
      greeting(`${cleanText}贵公司岗位我非常感兴趣😀`, 0),
      greeting(`${cleanText}贵公司岗位非常匹配我的经历，期待您的回复。`, 1),
      greeting(cleanText, 2)
    ]);

    expect(violations.filter((item) => item.rule === '套话').length).toBeGreaterThan(0);
    expect(violations.map((item) => item.rule)).toContain('表情符号');
  });

  it('条数与长度不合规会被记录', () => {
    expect(checkGreetings(SAMPLE_RESUME, [greeting(cleanText)])[0]?.rule).toBe('条数');
    expect(checkGreetings(SAMPLE_RESUME, [greeting('太短了', 0), greeting(cleanText, 1), greeting(cleanText, 2)]).map((item) => item.rule)).toContain('长度');
  });

  it('K8s、Vue3 这类专有名词不会被当成数字', () => {
    const resumeWithK8s = `${SAMPLE_RESUME}\n\n专业技能\nDocker / K8s、Vue3`;
    const violations = checkGreetings(resumeWithK8s, [
      greeting(`${cleanText}熟悉 Docker / K8s 与 Vue3。`, 0),
      greeting(`${cleanText}熟悉 Docker / K8s。`, 1),
      greeting(`${cleanText}熟悉 Vue3。`, 2)
    ]);
    expect(violations.filter((item) => item.rule === '数字溯源')).toEqual([]);
  });

  it('年份允许简历里写成别的形式，但年限声明必须真的出现过', () => {
    const resume = '李某 | 前端开发工程师 | 3 年经验\n\n教育背景\n某某大学  本科  2022 届';

    const yearOk = checkGreetings(resume, [
      greeting(`${cleanText}2022 年毕业至今一直做前端开发工作。`, 0),
      greeting(cleanText, 1),
      greeting(cleanText, 2)
    ]);
    expect(yearOk.some((item) => item.detail.includes('2022'))).toBe(false);

    // JD 要求「3 年以上」，简历写「3 年经验」时可溯源；简历写 4 年时不能说 3 年
    const resumeFourYears = resume.replace('3 年经验', '4 年经验');
    const mismatched = checkGreetings(resumeFourYears, [
      greeting(`${cleanText}我有 3 年经验。`, 0),
      greeting(cleanText, 1),
      greeting(cleanText, 2)
    ]);
    expect(mismatched.map((item) => item.detail).join(' ')).toContain('3年');
  });
});

describe('checkSuggestions', () => {
  it('锚定可改写区块且不引入新事实时通过', () => {
    const violations = checkSuggestions(SAMPLE_RESUME, [
      {
        section: '工作经历',
        before: '主导订单查询接口性能优化，通过 Redis 缓存与 SQL 优化将 P99 响应时间从 800ms 降到 180ms',
        after:
          '主导订单查询接口性能优化，通过 Redis 缓存与 SQL 优化将 P99 响应时间从 800ms 降到 180ms（高并发场景）',
        reason: '补上岗位关注的术语标签'
      }
    ], SAMPLE_JD);
    expect(violations).toEqual([]);
  });

  it('落在锁定区块的建议被判定越界', () => {
    const violations = checkSuggestions(SAMPLE_RESUME, [
      {
        section: '教育背景',
        before: '某某大学  计算机科学与技术  本科  2021 届',
        after: '某某大学  计算机科学与技术  本科  2021 届（重点院校）',
        reason: '越界示例'
      }
    ], SAMPLE_JD);
    expect(violations.map((item) => item.rule)).toContain('建议越界');
    expect(violations.map((item) => item.rule)).toContain('锁定区块');
  });

  it('改写引入简历没有的数字或技能会被记录', () => {
    const violations = checkSuggestions(SAMPLE_RESUME, [
      {
        section: '工作经历',
        before: '参与微服务拆分，基于 Kafka 实现订单状态异步通知，日均处理消息 40 万条',
        after:
          '参与微服务拆分，基于 Kafka 实现订单状态异步通知，日均处理消息 40 万条，并发提升 300% 并引入 Golang 重构',
        reason: '强行加数据'
      }
    ], SAMPLE_JD);
    expect(violations.map((item) => item.rule)).toContain('改写数字');
    expect(violations.map((item) => item.rule)).toContain('改写技能');
  });

  it('改写明显撑长原文行时标注长度问题', () => {
    const before = '参与微服务拆分，基于 Kafka 实现订单状态异步通知，日均处理消息 40 万条';
    const section = '工作经历';

    const tooLong = checkSuggestions(
      SAMPLE_RESUME,
      [
        {
          section,
          before,
          after: `${before}，同时负责订单履约、库存扣减、对账清算与结算单推送等全链路改造`,
          reason: '补上全链路术语'
        }
      ],
      SAMPLE_JD
    );
    expect(tooLong.map((item) => item.rule)).toContain('改写长度');
    expect(tooLong.some((item) => item.detail.includes('允许的'))).toBe(true);
  });

  it('超出提示词目标但在自检红线内不标注，避免淹没正常改写', () => {
    const before = '参与微服务拆分，基于 Kafka 实现订单状态异步通知，日均处理消息 40 万条';

    // 增长 10 字（25%）：高于提示词的 20% 目标，低于自检的 40% 红线
    const withinLimit = checkSuggestions(
      SAMPLE_RESUME,
      [
        {
          section: '工作经历',
          before,
          after: `${before}（高并发与链路治理）`,
          reason: '补上术语标签'
        }
      ],
      SAMPLE_JD
    );
    expect(withinLimit.map((item) => item.rule)).not.toContain('改写长度');
  });
});
