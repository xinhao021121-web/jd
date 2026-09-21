/**
 * 限流取键的 IP 解析（技术方案 5.3）。
 * 背景：取错这个值等于把按 IP 的限流交给调用方——X-Forwarded-For 是追加语义，
 * 第一跳可能来自请求方；Cloudflare 会用边缘写入的 CF-Connecting-IP 覆盖同名头，因此优先用它。
 */
import { describe, expect, it } from 'vitest';
import { UNKNOWN_CLIENT_IP, clientIpFromHeaders } from '../apps/api/src/client-ip';

/** 用一组头构造查询函数，未给出的头一律返回 undefined */
const headers = (source: Record<string, string>) => (name: string) => source[name];

describe('clientIpFromHeaders', () => {
  it('优先取 CF-Connecting-IP', () => {
    const ip = clientIpFromHeaders(
      headers({
        'cf-connecting-ip': '203.0.113.7',
        'x-forwarded-for': '1.1.1.1, 2.2.2.2',
        'x-real-ip': '3.3.3.3'
      })
    );

    expect(ip).toBe('203.0.113.7');
  });

  it('没有 CF 头时取 X-Forwarded-For 的第一跳，忽略后续代理跳', () => {
    expect(clientIpFromHeaders(headers({ 'x-forwarded-for': '1.1.1.1, 2.2.2.2' }))).toBe('1.1.1.1');
    expect(clientIpFromHeaders(headers({ 'x-forwarded-for': ' 1.1.1.1 ,2.2.2.2' }))).toBe('1.1.1.1');
    expect(clientIpFromHeaders(headers({ 'x-forwarded-for': '1.1.1.1' }))).toBe('1.1.1.1');
  });

  it('没有前两者时回退到 X-Real-IP', () => {
    expect(clientIpFromHeaders(headers({ 'x-real-ip': '3.3.3.3' }))).toBe('3.3.3.3');
  });

  it('空值与空白按缺失处理，最终落到 unknown 同一个桶', () => {
    expect(clientIpFromHeaders(headers({}))).toBe(UNKNOWN_CLIENT_IP);
    expect(clientIpFromHeaders(headers({ 'cf-connecting-ip': '  ' }))).toBe(UNKNOWN_CLIENT_IP);
    expect(clientIpFromHeaders(headers({ 'x-forwarded-for': '   ' }))).toBe(UNKNOWN_CLIENT_IP);
    expect(clientIpFromHeaders(headers({ 'x-real-ip': '' }))).toBe(UNKNOWN_CLIENT_IP);
  });

  it('CF 头为空时继续回退，不被空值截断', () => {
    const ip = clientIpFromHeaders(
      headers({ 'cf-connecting-ip': '', 'x-forwarded-for': '1.1.1.1' })
    );

    expect(ip).toBe('1.1.1.1');
  });
});
