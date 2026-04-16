import { ulid } from "ulid";

/** ULID を生成する */
export function generateId(): string {
  return ulid();
}

/** 指定バイト数の暗号学的乱数を Base64URL エンコードした文字列を返す */
export function generateRandomString(bytes: number): string {
  const array = new Uint8Array(bytes);
  crypto.getRandomValues(array);
  return base64urlEncode(array);
}

export function base64urlEncode(buffer: Uint8Array): string {
  return btoa(Array.from(buffer, (b) => String.fromCharCode(b)).join(""))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
}
