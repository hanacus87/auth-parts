import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { z } from "zod";
import type { AppEnv } from "../../types";
import { admins, adminSessions } from "../../db/schema";
import {
  adminSessionExpiresAt,
  clearAdminSessionCookie,
  getAdminSessionCookie,
  setAdminSessionCookie,
} from "../../lib/admin-session";
import { generateId } from "../../lib/crypto";
import { CSRF_FIELD, ensureCsrfToken, getCsrfCookie, verifyCsrf } from "../../lib/csrf";
import { verifyPasswordConstantTime } from "../../lib/password";
import { requireAdmin, getCurrentAdmin } from "../../lib/admin-middleware";
import { emailField, passwordField, zodBadRequest } from "../../lib/validation";
import { rateLimit } from "../../lib/rate-limit";

export const apiAdminSessionRouter = new Hono<AppEnv>();

const adminLoginRateLimit = rateLimit({
  bucket: "admin-login",
  windowSec: 900,
  limit: 10,
  description:
    "管理者ログインの試行回数が上限に達しました。15 分ほど時間をおいてから再度お試しください。",
});

const adminLoginSchema = z.object({
  email: emailField,
  password: passwordField,
});

/**
 * `GET /api/admin/session` — 管理画面 SPA が最初に呼ぶ。
 * 現在ログイン中の管理者情報と新規 CSRF トークン (Cookie も同時発行) を返す。
 */
apiAdminSessionRouter.get("/admin/session", requireAdmin, (c) => {
  const admin = getCurrentAdmin(c);
  const csrfToken = ensureCsrfToken(c);
  return c.json({
    admin: { id: admin.id, email: admin.email, name: admin.name, role: admin.role },
    csrfToken,
  });
});

/**
 * `POST /api/admin/login` — 管理者ログイン。
 * ログイン前なのでセッションが無く CSRF 検証は行わない。
 */
apiAdminSessionRouter.post("/admin/login", adminLoginRateLimit, async (c) => {
  const db = c.var.db;
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;

  const parsed = adminLoginSchema.safeParse(body);
  if (!parsed.success) return zodBadRequest(c, parsed.error);
  const input = parsed.data;

  const admin = await db.query.admins.findFirst({ where: eq(admins.email, input.email) });
  const passwordValid = await verifyPasswordConstantTime(input.password, admin?.passwordHash);

  if (!admin || !passwordValid) {
    return c.json(
      {
        error: "invalid_credentials",
        error_description: "メールアドレスまたはパスワードが正しくありません",
      },
      400,
    );
  }

  const sessionId = generateId();
  await db.insert(adminSessions).values({
    id: sessionId,
    adminId: admin.id,
    expiresAt: adminSessionExpiresAt(),
  });

  setAdminSessionCookie(c, sessionId);
  return c.json({ redirectUrl: "/admin" });
});

/** `POST /api/admin/logout` — CSRF 検証後、管理者セッションと Cookie を破棄する。 */
apiAdminSessionRouter.post("/admin/logout", async (c) => {
  const db = c.var.db;
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  if (
    !verifyCsrf(
      getCsrfCookie(c),
      typeof body[CSRF_FIELD] === "string" ? body[CSRF_FIELD] : undefined,
    )
  ) {
    return c.json({ error: "invalid_csrf" }, 403);
  }
  const sessionId = getAdminSessionCookie(c);
  if (sessionId) {
    await db.delete(adminSessions).where(eq(adminSessions.id, sessionId));
  }
  clearAdminSessionCookie(c);
  return c.json({ redirectUrl: "/admin/login" });
});
