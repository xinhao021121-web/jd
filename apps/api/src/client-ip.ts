/**
 * 客户端 IP 解析：限流与每日额度的取键来源（PRD 4.1、技术方案 5.3）。
 *
 * 优先级：`CF-Connecting-IP` → `X-Forwarded-For` 第一跳 → `X-Real-IP` → `unknown`。
 *
 * 顺序的原因：两处限流都按这个值分桶，取错等于把限流交给调用方。
 * - `CF-Connecting-IP` 由 Cloudflare 在边缘写入，请求里原有的同名头会被它覆盖，调用方伪造不了；
 * - `X-Forwarded-For` 是**追加**语义，第一跳很可能就是调用方自己塞进来的值，因此排在 CF 头之后；
 * - 两个头都没有时落到 `unknown` 同一个桶：直连 Node 端口（没有反向代理注入这些头）时
 *   按 IP 的限额会退化成全局限额，这是部署形态决定的，见 README「边界说明」。
 *
 * 放在单一实现里由两个路由共用：取键口径只能有一份，否则 /api/llm 与 /api/vision
 * 会各建一套桶，同一个调用方在两处各拿一份额度。
 */
export type HeaderLookup = (name: string) => string | undefined;

export const UNKNOWN_CLIENT_IP = 'unknown';

export function clientIpFromHeaders(header: HeaderLookup): string {
  const cfConnectingIp = header('cf-connecting-ip')?.trim();
  if (cfConnectingIp) return cfConnectingIp;

  // 反向代理链里第一跳是最接近调用方的地址，后续各跳是中间代理
  const forwarded = header('x-forwarded-for');
  const firstHop = forwarded?.split(',')[0]?.trim();
  if (firstHop) return firstHop;

  const realIp = header('x-real-ip')?.trim();
  if (realIp) return realIp;

  return UNKNOWN_CLIENT_IP;
}
