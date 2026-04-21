import type { Context } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { redis } from "./redis";
import { generateSessionId } from "./crypto";

const SESSION_COOKIE = "bff_session_sub";
const SESSION_TTL = 60 * 60 * 24; // 24 時間
const PENDING_AUTH_TTL = 60 * 10; // 10 分
const KEY_PREFIX = "bff-sub";

// ── セッションデータ ─────────────────────────────────────────

export interface SessionData {
  userId: string;
  // OIDC Core §5.1.4: ID Token の sid クレーム (OP 側の op_session.id)
  opSessionId: string | null;
  accessToken: string;
  refreshToken: string | null;
  idToken: string;
  accessTokenExpiresAt: number;
  createdAt: number;
}

function sessionKey(sessionId: string): string {
  return `${KEY_PREFIX}:session:${sessionId}`;
}

function userSessionsKey(userId: string): string {
  return `${KEY_PREFIX}:user-sessions:${userId}`;
}

// OIDC BCL §2.4: sid を単位としたログアウト伝播用の逆引き index
function sidToSessionKey(sid: string): string {
  return `${KEY_PREFIX}:sid-to-session:${sid}`;
}

export async function createSession(data: SessionData): Promise<string> {
  const id = generateSessionId();
  await redis.set(sessionKey(id), JSON.stringify(data), "EX", SESSION_TTL);
  await redis.sadd(userSessionsKey(data.userId), id);
  await redis.expire(userSessionsKey(data.userId), SESSION_TTL);
  if (data.opSessionId) {
    await redis.set(sidToSessionKey(data.opSessionId), id, "EX", SESSION_TTL);
  }
  return id;
}

export async function getSession(sessionId: string): Promise<SessionData | null> {
  const raw = await redis.get(sessionKey(sessionId));
  return raw ? (JSON.parse(raw) as SessionData) : null;
}

export async function updateSession(sessionId: string, data: SessionData): Promise<void> {
  // TTL を維持したまま値を更新 (KEEPTTL)
  await redis.set(sessionKey(sessionId), JSON.stringify(data), "KEEPTTL");
}

export async function destroySession(sessionId: string): Promise<void> {
  const session = await getSession(sessionId);
  if (session) {
    await redis.srem(userSessionsKey(session.userId), sessionId);
    if (session.opSessionId) {
      await redis.del(sidToSessionKey(session.opSessionId));
    }
  }
  await redis.del(sessionKey(sessionId));
}

/** OIDC BCL §2.4: logout_token.sid で指定された単一セッションを破棄する */
export async function destroySessionBySid(sid: string): Promise<void> {
  const sessionId = await redis.get(sidToSessionKey(sid));
  if (!sessionId) return;
  await destroySession(sessionId);
}

/** logout_token.sid が無い場合のフォールバック: userId 配下の全セッションを破棄 */
export async function destroyUserSessions(userId: string): Promise<void> {
  const key = userSessionsKey(userId);
  const sessionIds = await redis.smembers(key);
  if (sessionIds.length === 0) return;
  for (const id of sessionIds) {
    const session = await getSession(id);
    if (session?.opSessionId) {
      await redis.del(sidToSessionKey(session.opSessionId));
    }
  }
  const sessionKeys = sessionIds.map((id) => sessionKey(id));
  await redis.del(...sessionKeys, key);
}

// ── PendingAuth (認証フロー中の一時データ) ───────────────────

export interface PendingAuth {
  codeVerifier: string;
  nonce: string;
}

// Redis キー: "{prefix}:pending:{state}"
function pendingKey(state: string): string {
  return `${KEY_PREFIX}:pending:${state}`;
}

export async function savePendingAuth(state: string, data: PendingAuth): Promise<void> {
  await redis.set(pendingKey(state), JSON.stringify(data), "EX", PENDING_AUTH_TTL);
}

/** PendingAuth を取得し、同時に削除する（1 回限りの使用、アトミック操作） */
export async function consumePendingAuth(state: string): Promise<PendingAuth | null> {
  // GETDEL: GET + DEL をアトミックに実行（Redis 6.2+）
  // 並行リクエストによる state の二重使用を防止
  const raw = await redis.getdel(pendingKey(state));
  if (!raw) return null;
  return JSON.parse(raw) as PendingAuth;
}

// ── Cookie ヘルパー ──────────────────────────────────────────

export function setSessionCookie(c: Context, sessionId: string): void {
  const isProduction = process.env.NODE_ENV === "production";
  setCookie(c, SESSION_COOKIE, sessionId, {
    httpOnly: true,
    secure: isProduction,
    sameSite: "Lax",
    path: "/",
    maxAge: SESSION_TTL,
  });
}

export function getSessionCookie(c: Context): string | undefined {
  return getCookie(c, SESSION_COOKIE);
}

export function clearSessionCookie(c: Context): void {
  deleteCookie(c, SESSION_COOKIE, { path: "/" });
}
