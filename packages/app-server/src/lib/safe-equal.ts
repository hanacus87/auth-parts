import { timingSafeEqual } from "node:crypto";

export function safeEqual(a: string, b: string): boolean {
  const ab = new TextEncoder().encode(a);
  const bb = new TextEncoder().encode(b);
  if (ab.byteLength !== bb.byteLength) return false;
  return timingSafeEqual(ab, bb);
}
