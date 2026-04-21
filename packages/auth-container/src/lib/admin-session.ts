import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { and, eq, gt } from "drizzle-orm";
import type { AppContext } from "../types";
import type { DB } from "../db";
import { adminSessions, admins } from "../db/schema";
import type { AdminRole } from "./admin-constants";

const ADMIN_SESSION_COOKIE = "admin_session";
const ADMIN_SESSION_TTL_SEC = 60 * 60 * 8;

/** 管理画面ログインセッションの Cookie を発行する。 */
export function setAdminSessionCookie(c: AppContext, sessionId: string): void {
  setCookie(c, ADMIN_SESSION_COOKIE, sessionId, {
    httpOnly: true,
    secure: c.env.ENVIRONMENT !== "development",
    sameSite: "Strict",
    path: "/",
    maxAge: ADMIN_SESSION_TTL_SEC,
  });
}

/** `admin_session` Cookie の値を取得する。 */
export function getAdminSessionCookie(c: AppContext): string | undefined {
  return getCookie(c, ADMIN_SESSION_COOKIE);
}

/** `admin_session` Cookie を削除する。 */
export function clearAdminSessionCookie(c: AppContext): void {
  deleteCookie(c, ADMIN_SESSION_COOKIE, { path: "/" });
}

/** 管理者セッションの失効時刻 (今から TTL 経過後) を計算する。 */
export function adminSessionExpiresAt(): Date {
  return new Date(Date.now() + ADMIN_SESSION_TTL_SEC * 1000);
}

export interface AdminContext {
  id: string;
  email: string;
  name: string;
  role: AdminRole;
}

/**
 * `admin_session` Cookie を解決して管理者コンテキストを返す。
 * 期限切れ / 未存在の場合は非同期で行を掃除しつつ null を返す。
 */
export async function resolveAdminFromCookie(c: AppContext, db: DB): Promise<AdminContext | null> {
  const sessionId = getAdminSessionCookie(c);
  if (!sessionId) return null;

  const [row] = await db
    .select({
      id: admins.id,
      email: admins.email,
      name: admins.name,
      role: admins.role,
    })
    .from(adminSessions)
    .innerJoin(admins, eq(adminSessions.adminId, admins.id))
    .where(and(eq(adminSessions.id, sessionId), gt(adminSessions.expiresAt, new Date())))
    .limit(1);

  if (!row) {
    db.delete(adminSessions)
      .where(eq(adminSessions.id, sessionId))
      .catch(() => {});
    return null;
  }

  return row;
}
