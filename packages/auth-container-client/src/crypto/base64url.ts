/**
 * RFC 4648 §5: base64url (no padding) で Uint8Array を文字列化する。
 * 小さい入力 (<= 数 KB) しか扱わないので btoa を経由しても性能劣化は無視できる。
 */
export function base64urlEncode(buffer: Uint8Array): string {
  let bin = "";
  for (const byte of buffer) bin += String.fromCharCode(byte);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

/**
 * RFC 4648 §5: base64url 文字列を Uint8Array に復号する。パディング不要。
 */
export function base64urlDecode(input: string): Uint8Array {
  const pad = "=".repeat((4 - (input.length % 4)) % 4);
  const b64 = (input + pad).replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
