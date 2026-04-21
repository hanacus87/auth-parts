/**
 * 2 つの文字列を定数時間で比較する (`node:crypto.timingSafeEqual` に依存しない Web Crypto 実装)。
 * 長さが異なる場合は即座に false を返す。
 */
export function safeEqual(a: string, b: string): boolean {
  const ab = new TextEncoder().encode(a);
  const bb = new TextEncoder().encode(b);
  if (ab.byteLength !== bb.byteLength) return false;
  let diff = 0;
  for (let i = 0; i < ab.byteLength; i++) diff |= ab[i]! ^ bb[i]!;
  return diff === 0;
}
