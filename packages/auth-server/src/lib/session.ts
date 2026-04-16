import { SignJWT, jwtVerify } from "jose";
import type { Context } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";

const OP_SESSION_COOKIE = "op_session";

// SESSION_SECRET を TextEncoder でバイト列に変換してキーとして使う
function getSessionKey(): Uint8Array {
  return new TextEncoder().encode(process.env.SESSION_SECRET!);
}

// ── OP セッション Cookie ──────────────────────────────────

/** OP セッション Cookie を発行する */
export function setSessionCookie(c: Context, sessionId: string): void {
  const isProduction = process.env.NODE_ENV === "production";
  setCookie(c, OP_SESSION_COOKIE, sessionId, {
    httpOnly: true,
    secure: isProduction,
    sameSite: "Lax",
    path: "/",
    maxAge: 60 * 60 * 24, // 24時間
  });
}

/** OP セッション Cookie を取得する */
export function getSessionCookie(c: Context): string | undefined {
  return getCookie(c, OP_SESSION_COOKIE);
}

/** OP セッション Cookie を削除する */
export function clearSessionCookie(c: Context): void {
  deleteCookie(c, OP_SESSION_COOKIE, { path: "/" });
}

// ── login_challenge / consent_challenge (署名付き JWT) ───

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

/** login_challenge JWT を生成する (有効期限: 10分) */
export async function createLoginChallenge(
  payload: Omit<LoginChallengePayload, "type">,
): Promise<string> {
  return new SignJWT({ ...payload, type: "login_challenge" })
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime("10m")
    .setIssuedAt()
    .sign(getSessionKey());
}

/** login_challenge JWT を検証・デコードする */
export async function verifyLoginChallenge(token: string): Promise<LoginChallengePayload> {
  const { payload } = await jwtVerify(token, getSessionKey());
  if (payload["type"] !== "login_challenge") {
    throw new Error("Invalid challenge type");
  }
  return payload as unknown as LoginChallengePayload;
}

/** consent_challenge JWT を生成する (有効期限: 10分) */
export async function createConsentChallenge(
  payload: Omit<ConsentChallengePayload, "type">,
): Promise<string> {
  return new SignJWT({ ...payload, type: "consent_challenge" })
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime("10m")
    .setIssuedAt()
    .sign(getSessionKey());
}

/** consent_challenge JWT を検証・デコードする */
export async function verifyConsentChallenge(token: string): Promise<ConsentChallengePayload> {
  const { payload } = await jwtVerify(token, getSessionKey());
  if (payload["type"] !== "consent_challenge") {
    throw new Error("Invalid challenge type");
  }
  return payload as unknown as ConsentChallengePayload;
}
