import { timingSafeEqual } from "node:crypto";

/**
 * 長さ比較込みの定時間文字列比較。
 * state や nonce の検証で timing 攻撃面を作らないために使う (RFC 9700 §4.5.3.1 推奨)。
 */
export function safeEqual(a: string, b: string): boolean {
  const ab = new TextEncoder().encode(a);
  const bb = new TextEncoder().encode(b);
  if (ab.byteLength !== bb.byteLength) return false;
  return timingSafeEqual(ab, bb);
}
