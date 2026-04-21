import { Hono } from "hono";
import { and, eq, gt } from "drizzle-orm";
import { z } from "zod";
import type { AppEnv } from "../../types";
import { adminPasswordResetTokens, adminSessions, admins } from "../../db/schema";
import { generateRandomString } from "../../lib/crypto";
import { hashPassword } from "../../lib/password";
import { sendAdminPasswordResetEmail } from "../../lib/email";
import { emailField, passwordField, zodBadRequest } from "../../lib/validation";

export const apiAdminResetPasswordRouter = new Hono<AppEnv>();

const TTL_MINUTES = 15;
const TTL_MS = TTL_MINUTES * 60 * 1000;
const RATE_LIMIT_MS = 5 * 60 * 1000;

const forgotSchema = z.object({ email: emailField });

const resetSchema = z
  .object({
    token: z.string({ error: "トークンが必要です" }).min(1, "トークンが必要です"),
    password: passwordField,
    password_confirm: z.string({ error: "確認用パスワードを入力してください" }),
  })
  .refine((d) => d.password === d.password_confirm, {
    message: "パスワードと確認用が一致しません",
    path: ["password_confirm"],
  });

/**
 * `POST /api/admin/forgot-password` — admin 宛てにリセットリンクを送信する。
 * アカウント列挙対策のためレスポンスは常に `{ ok: true }`。5 分以内の再発行はスキップする。
 */
apiAdminResetPasswordRouter.post("/admin/forgot-password", async (c) => {
  const db = c.var.db;
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;

  const parsed = forgotSchema.safeParse(body);
  if (!parsed.success) return zodBadRequest(c, parsed.error);

  const admin = await db.query.admins.findFirst({ where: eq(admins.email, parsed.data.email) });
  if (admin) {
    const recentCutoff = new Date(Date.now() - RATE_LIMIT_MS);
    const recent = await db.query.adminPasswordResetTokens.findFirst({
      where: and(
        eq(adminPasswordResetTokens.adminId, admin.id),
        gt(adminPasswordResetTokens.createdAt, recentCutoff),
      ),
    });
    if (!recent) {
      const token = generateRandomString(32);
      await db.insert(adminPasswordResetTokens).values({
        token,
        adminId: admin.id,
        expiresAt: new Date(Date.now() + TTL_MS),
      });
      try {
        await sendAdminPasswordResetEmail(c.env, {
          to: admin.email,
          adminName: admin.name,
          resetUrl: `${c.env.ISSUER}/admin/reset-password?token=${encodeURIComponent(token)}`,
          expiresInMinutes: TTL_MINUTES,
        });
      } catch (err) {
        console.error("sendAdminPasswordResetEmail failed:", err);
      }
    }
  }

  return c.json({ ok: true });
});

/**
 * `POST /api/admin/reset-password` — リセットトークンを検証して admin のパスワードを更新する。
 * admin は OIDC トークンを持たないので `adminSessions` のみを削除し、メール到達実績を以て `emailVerified=true` に更新する。
 */
apiAdminResetPasswordRouter.post("/admin/reset-password", async (c) => {
  const db = c.var.db;
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;

  const parsed = resetSchema.safeParse(body);
  if (!parsed.success) return zodBadRequest(c, parsed.error);
  const { token, password } = parsed.data;

  const row = await db.query.adminPasswordResetTokens.findFirst({
    where: eq(adminPasswordResetTokens.token, token),
  });
  if (!row) {
    return c.json({ error: "invalid", error_description: "トークンが無効です" }, 400);
  }
  if (row.expiresAt < new Date()) {
    await db
      .delete(adminPasswordResetTokens)
      .where(eq(adminPasswordResetTokens.token, token))
      .catch(() => {});
    return c.json({ error: "expired", error_description: "トークンの有効期限が切れています" }, 400);
  }

  const admin = await db.query.admins.findFirst({ where: eq(admins.id, row.adminId) });
  if (!admin) {
    return c.json({ error: "invalid", error_description: "トークンが無効です" }, 400);
  }

  const newHash = await hashPassword(password);

  await db.batch([
    db
      .update(admins)
      .set({
        passwordHash: newHash,
        emailVerified: true,
        updatedAt: new Date(),
      })
      .where(eq(admins.id, admin.id)),
    db.delete(adminSessions).where(eq(adminSessions.adminId, admin.id)),
    db.delete(adminPasswordResetTokens).where(eq(adminPasswordResetTokens.adminId, admin.id)),
  ]);

  return c.json({ ok: true });
});
