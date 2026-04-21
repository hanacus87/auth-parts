import { base64urlEncode } from "./crypto";

/** `code_verifier` の形式を検証する。43〜128 文字の unreserved chars のみ許可 (RFC 7636 §4.1)。 */
export function validateCodeVerifier(verifier: string): boolean {
  return /^[A-Za-z0-9\-._~]{43,128}$/.test(verifier);
}

/**
 * PKCE の `code_challenge` と `code_verifier` を照合する。
 * RFC 7636 §4.6 に従い `BASE64URL(SHA-256(ASCII(code_verifier))) == code_challenge` を検証する。
 * `method=plain` は RFC 9700 で非推奨のため、S256 のみ受け付ける。
 */
export async function verifyPKCE(
  verifier: string,
  challenge: string,
  method: string,
): Promise<boolean> {
  if (method !== "S256") return false;
  if (!validateCodeVerifier(verifier)) return false;

  const data = new TextEncoder().encode(verifier);
  const digest = await crypto.subtle.digest("SHA-256", data);
  const computed = base64urlEncode(new Uint8Array(digest));
  return computed === challenge;
}
