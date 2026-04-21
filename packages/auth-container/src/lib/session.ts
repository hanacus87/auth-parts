import { SignJWT, jwtVerify } from "jose";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import type { AppContext, Bindings } from "../types";

const OP_SESSION_COOKIE = "op_session";
const OP_SESSION_TTL_SEC = 60 * 60 * 24;

/** `SESSION_SECRET` を HS256 鍵として利用するためにバイト列へ変換する。 */
function getSessionKey(env: Bindings): Uint8Array {
  return new TextEncoder().encode(env.SESSION_SECRET);
}

/** OP 側ログインセッションの Cookie を発行する。 */
export function setSessionCookie(c: AppContext, sessionId: string): void {
  setCookie(c, OP_SESSION_COOKIE, sessionId, {
    httpOnly: true,
    secure: c.env.ENVIRONMENT !== "development",
    sameSite: "Lax",
    path: "/",
    maxAge: OP_SESSION_TTL_SEC,
  });
}

/** OP セッション Cookie の値を取得する。 */
export function getSessionCookie(c: AppContext): string | undefined {
  return getCookie(c, OP_SESSION_COOKIE);
}

/** OP セッション Cookie を削除する。 */
export function clearSessionCookie(c: AppContext): void {
  deleteCookie(c, OP_SESSION_COOKIE, { path: "/" });
}

export interface LoginChallengePayload {
  type: "login_challenge";
  client_id: string;
  redirect_uri: string;
  scope: string;
  state?: string;
  nonce?: string;
  code_challenge: string;
  code_challenge_method: string;
  prompt?: string;
  max_age?: string;
}

export interface ConsentChallengePayload {
  type: "consent_challenge";
  user_id: string;
  session_id: string;
  auth_time: number;
  client_id: string;
  redirect_uri: string;
  scope: string;
  state?: string;
  nonce?: string;
  code_challenge: string;
  code_challenge_method: string;
}

/** `/authorize` から `/login` へ受け渡す login_challenge JWT を発行する (TTL 10 分, HS256)。 */
export async function createLoginChallenge(
  env: Bindings,
  payload: Omit<LoginChallengePayload, "type">,
): Promise<string> {
  return new SignJWT({ ...payload, type: "login_challenge" })
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime("10m")
    .setIssuedAt()
    .sign(getSessionKey(env));
}

/**
 * login_challenge JWT を検証して元のペイロードを取り出す。
 * @throws JWT 検証失敗、または `type` が `login_challenge` 以外の場合
 */
export async function verifyLoginChallenge(
  env: Bindings,
  token: string,
): Promise<LoginChallengePayload> {
  const { payload } = await jwtVerify(token, getSessionKey(env));
  if (payload["type"] !== "login_challenge") {
    throw new Error("Invalid challenge type");
  }
  return payload as unknown as LoginChallengePayload;
}

/** `/authorize` から `/consent` へ受け渡す consent_challenge JWT を発行する (TTL 10 分, HS256)。 */
export async function createConsentChallenge(
  env: Bindings,
  payload: Omit<ConsentChallengePayload, "type">,
): Promise<string> {
  return new SignJWT({ ...payload, type: "consent_challenge" })
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime("10m")
    .setIssuedAt()
    .sign(getSessionKey(env));
}

/**
 * consent_challenge JWT を検証して元のペイロードを取り出す。
 * @throws JWT 検証失敗、または `type` が `consent_challenge` 以外の場合
 */
export async function verifyConsentChallenge(
  env: Bindings,
  token: string,
): Promise<ConsentChallengePayload> {
  const { payload } = await jwtVerify(token, getSessionKey(env));
  if (payload["type"] !== "consent_challenge") {
    throw new Error("Invalid challenge type");
  }
  return payload as unknown as ConsentChallengePayload;
}
