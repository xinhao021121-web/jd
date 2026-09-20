import { describe, expect, it } from 'vitest';
import { GREETING_LENGTH } from '@zhipin/shared';
import {
  greetingLength,
  greetingStyleFor,
  isGreetingLengthOk,
  offSpecGreetingIndexes
} from '@zhipin/core';

describe('话术长度校验', () => {
  it('按码点统计字数，忽略首尾空白', () => {
    expect(greetingLength('  你好世界  ')).toBe(4);
    expect(greetingLength('')).toBe(0);
  });

  it('传入空值时按 0 字处理，不抛错', () => {
    expect(greetingLength(undefined as unknown as string)).toBe(0);
  });

  it('区间上下边界都算合规', () => {
    expect(isGreetingLengthOk('字'.repeat(GREETING_LENGTH.min))).toBe(true);
    expect(isGreetingLengthOk('字'.repeat(GREETING_LENGTH.max))).toBe(true);
    expect(isGreetingLengthOk('字'.repeat(GREETING_LENGTH.min - 1))).toBe(false);
    expect(isGreetingLengthOk('字'.repeat(GREETING_LENGTH.max + 1))).toBe(false);
  });

  it('返回超区间条目的下标，便于只提示有问题的卡片', () => {
    const items = [
      { text: '字'.repeat(GREETING_LENGTH.min) },
      { text: '字'.repeat(GREETING_LENGTH.min - 5) },
      { text: '字'.repeat(GREETING_LENGTH.max + 5) }
    ];
    expect(offSpecGreetingIndexes(items)).toEqual([1, 2]);
  });

  it('全部合规时返回空数组', () => {
    expect(offSpecGreetingIndexes([{ text: '字'.repeat(120) }])).toEqual([]);
  });
});

describe('话术风格本地赋值', () => {
  it('按输出顺序映射三种切入点，不依赖模型标注', () => {
    expect([0, 1, 2].map(greetingStyleFor)).toEqual(['技能匹配型', '经历相关型', '简短直接型']);
  });

  it('超出范围的序号回退到最后一种，不产生空标签', () => {
    expect(greetingStyleFor(3)).toBe('简短直接型');
    expect(greetingStyleFor(-1)).toBe('简短直接型');
  });
});
