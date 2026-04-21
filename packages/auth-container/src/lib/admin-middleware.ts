import { createMiddleware } from "hono/factory";
import type { AppContext, AppEnv } from "../types";
import { resolveAdminFromCookie, type AdminContext } from "./admin-session";

const ADMIN_CONTEXT_KEY = "admin" as const;

/**
 * `admin_session` Cookie を検証する Hono ミドルウェア。
 * 未ログインなら 401 JSON を返し、認証済みなら `c.set("admin", ...)` で管理者情報を公開する。
 * SPA 化後は API 専用のため redirect ではなく 401 を返し、SPA 側で `/admin/login` に誘導する。
 */
export const requireAdmin = createMiddleware<AppEnv>(async (c, next) => {
  const admin = await resolveAdminFromCookie(c, c.var.db);
  if (!admin) {
    return c.json({ error: "unauthorized" }, 401);
  }
  c.set(ADMIN_CONTEXT_KEY, admin);
  await next();
});

/**
 * `requireAdmin` + `role === "super"` 限定のミドルウェア。
 * 一般ユーザー管理 / admin 管理など SuperAdmin 専用機能で使用する。
 */
export const requireSuperAdmin = createMiddleware<AppEnv>(async (c, next) => {
  const admin = await resolveAdminFromCookie(c, c.var.db);
  if (!admin) {
    return c.json({ error: "unauthorized" }, 401);
  }
  if (admin.role !== "super") {
    return c.json({ error: "forbidden", error_description: "SuperAdmin 権限が必要です" }, 403);
  }
  c.set(ADMIN_CONTEXT_KEY, admin);
  await next();
});

/**
 * `requireAdmin` ミドルウェア通過後のハンドラで現在の管理者コンテキストを取得する。
 *
 * @throws ミドルウェア適用外で呼んだ場合 ( `c.var.admin` が未設定 )
 */
export function getCurrentAdmin(c: AppContext): AdminContext {
  const admin = c.get(ADMIN_CONTEXT_KEY);
  if (!admin) {
    throw new Error("getCurrentAdmin called outside requireAdmin middleware");
  }
  return admin;
}
