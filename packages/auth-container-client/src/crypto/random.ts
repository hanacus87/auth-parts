import { base64urlEncode } from "./base64url";

/**
 * CSRF 防止用 state パラメータ (RFC 6749 §10.12) を生成する。
 * 128 ビットエントロピーで OAuth2 実装として十分。
 */
export function generateState(): string {
  const array = new Uint8Array(16);
  crypto.getRandomValues(array);
  return base64urlEncode(array);
}

/**
 * リプレイ攻撃防止用 nonce (OIDC Core §3.1.2.1) を生成する。
 * id_token の nonce クレームと突合するため十分なエントロピー (128 bit) を確保する。
 */
export function generateNonce(): string {
  const array = new Uint8Array(16);
  crypto.getRandomValues(array);
  return base64urlEncode(array);
}
