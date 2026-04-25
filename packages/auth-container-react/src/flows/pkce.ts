import { base64urlEncode } from "../crypto/base64url";

/**
 * RFC 7636 §4.1: code_verifier は 43-128 文字の unreserved chars。
 * 32 バイトのランダム値を base64url エンコードして 43 文字の文字列を返す。
 */
export function generateCodeVerifier(): string {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return base64urlEncode(array);
}

/**
 * RFC 7636 §4.2: code_challenge = BASE64URL(SHA-256(ASCII(code_verifier)))。
 * auth-container は S256 必須 (plain 非対応) のため常にこの関数経由で生成する。
 */
export async function generateCodeChallenge(verifier: string): Promise<string> {
  const data = new TextEncoder().encode(verifier);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return base64urlEncode(new Uint8Array(digest));
}
