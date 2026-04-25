import { base64urlEncode } from "../crypto/base64url";

/**
 * CSRF 防止用 state パラメータ (RFC 6749 §10.12 / RFC 9700 §4.5.3.1) を生成する。
 * SPA では sessionStorage の pending と突合するため十分なエントロピー (128 bit) を確保。
 */
export function generateState(): string {
  const array = new Uint8Array(16);
  crypto.getRandomValues(array);
  return base64urlEncode(array);
}

/**
 * リプレイ攻撃防止用 nonce (OIDC Core §3.1.2.1) を生成する。
 * id_token の nonce クレームと突合するため十分なエントロピーを確保する。
 */
export function generateNonce(): string {
  const array = new Uint8Array(16);
  crypto.getRandomValues(array);
  return base64urlEncode(array);
}
