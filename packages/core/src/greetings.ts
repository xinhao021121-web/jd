/**
 * 话术长度校验（PRD 3.2 生成规则与异常流程）。
 * 纯函数：前端用它判断是否需要提示重新生成，质量回归脚本用它做验收。
 */
import { GREETING_LENGTH } from '@zhipin/shared';

export function greetingLength(text: string): number {
  return [...(text ?? '').trim()].length;
}

export function isGreetingLengthOk(text: string): boolean {
  const length = greetingLength(text);
  return length >= GREETING_LENGTH.min && length <= GREETING_LENGTH.max;
}

/** 返回长度超出区间的条目下标，便于提示"只展示有效条目"并引导重新生成 */
export function offSpecGreetingIndexes(items: { text: string }[]): number[] {
  return items
    .map((item, index) => (isGreetingLengthOk(item.text) ? -1 : index))
    .filter((index) => index >= 0);
}
