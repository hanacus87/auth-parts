/** PKCE, state, nonce, クライアント認証ユーティリティ (BFF 側で実行) */

const CLIENT_ID = process.env.CLIENT_ID!;
const CLIENT_SECRET = process.env.CLIENT_SECRET!;

/** RFC 6749 §2.3.1: Authorization: Basic base64(urlEncode(client_id):urlEncode(client_secret)) */
export function basicAuthHeader(): string {
  const encoded = `${encodeURIComponent(CLIENT_ID)}:${encodeURIComponent(CLIENT_SECRET)}`;
  return "Basic " + btoa(encoded);
}

/** RFC 7636 §4.1: code_verifier は 43-128 文字の unreserved chars */
export function generateCodeVerifier(): string {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return base64urlEncode(array);
}

/** RFC 7636 §4.2: code_challenge = BASE64URL(SHA-256(ASCII(code_verifier))) */
export async function generateCodeChallenge(verifier: string): Promise<string> {
  const data = new TextEncoder().encode(verifier);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return base64urlEncode(new Uint8Array(digest));
}

/** CSRF 防止用 state パラメータ (RFC 6749 §10.12) */
export function generateState(): string {
  const array = new Uint8Array(16);
  crypto.getRandomValues(array);
  return base64urlEncode(array);
}

/** リプレイ攻撃防止用 nonce (OIDC Core §3.1.2.1) */
export function generateNonce(): string {
  const array = new Uint8Array(16);
  crypto.getRandomValues(array);
  return base64urlEncode(array);
}

/** セッション ID 生成 (256 ビットエントロピー) */
export function generateSessionId(): string {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return base64urlEncode(array);
}

function base64urlEncode(buffer: Uint8Array): string {
  return btoa(Array.from(buffer, (b) => String.fromCharCode(b)).join(""))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
}
