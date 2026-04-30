/**
 * 2 つの文字列を定数時間で比較する。state / nonce の検証で timing 攻撃面を作らないために使う
 * (RFC 9700 §4.5.3.1 推奨)。Web Crypto には `timingSafeEqual` 等価が無いため XOR ループで自前実装。
 * 長さが異なる場合は即 false を返す (固定長トークンの比較を前提とした業界標準的妥協)。
 */
export function safeEqual(a: string, b: string): boolean {
  const ab = new TextEncoder().encode(a);
  const bb = new TextEncoder().encode(b);
  if (ab.byteLength !== bb.byteLength) return false;
  let diff = 0;
  for (let i = 0; i < ab.byteLength; i++) diff |= ab[i]! ^ bb[i]!;
  return diff === 0;
}
