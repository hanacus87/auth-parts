import { Hono } from "hono";
import { and, eq, gt } from "drizzle-orm";
import { z } from "zod";
import type { AppEnv } from "../types";
import { accessTokens, opSessions, passwordResetTokens, refreshTokens, users } from "../db/schema";
import { generateRandomString } from "../lib/crypto";
import { hashPassword } from "../lib/password";
import { sendPasswordResetEmail } from "../lib/email";
import { emailField, passwordField, zodBadRequest } from "../lib/validation";

export const apiResetPasswordRouter = new Hono<AppEnv>();

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
 * `POST /api/forgot-password` — パスワードリセットリンクをメール送信する。
 * ユーザー列挙対策のためレスポンスは常に `{ ok: true }`。
 * 対象ユーザーが存在し、かつ直近 5 分以内に発行済みのリセットトークンが無い場合のみ、新規トークンを発行してメール送信する。
 */
apiResetPasswordRouter.post("/forgot-password", async (c) => {
  const db = c.var.db;
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;

  const parsed = forgotSchema.safeParse(body);
  if (!parsed.success) return zodBadRequest(c, parsed.error);

  const user = await db.query.users.findFirst({ where: eq(users.email, parsed.data.email) });
  if (user) {
    const recentCutoff = new Date(Date.now() - RATE_LIMIT_MS);
    const recent = await db.query.passwordResetTokens.findFirst({
      where: and(
        eq(passwordResetTokens.userId, user.id),
        gt(passwordResetTokens.createdAt, recentCutoff),
      ),
    });
    if (!recent) {
      const token = generateRandomString(32);
      await db.insert(passwordResetTokens).values({
        token,
        userId: user.id,
        expiresAt: new Date(Date.now() + TTL_MS),
      });
      try {
        await sendPasswordResetEmail(c.env, {
          to: user.email,
          userName: user.name,
          resetUrl: `${c.env.ISSUER}/reset-password?token=${encodeURIComponent(token)}`,
          expiresInMinutes: TTL_MINUTES,
        });
      } catch (err) {
        console.error("sendPasswordResetEmail failed:", err);
        await db
          .delete(passwordResetTokens)
          .where(eq(passwordResetTokens.token, token))
          .catch(() => {});
      }
    }
  }

  return c.json({ ok: true });
});

/**
 * `POST /api/reset-password` — リセットトークンを検証し、ユーザーのパスワードを更新する。
 * 成功時は RFC 6819 §5.2.2.1 に従い、当該ユーザーの access/refresh トークンと OP セッション、
 * リセットトークンをすべて無効化・削除する。
 */
apiResetPasswordRouter.post("/reset-password", async (c) => {
  const db = c.var.db;
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;

  const parsed = resetSchema.safeParse(body);
  if (!parsed.success) return zodBadRequest(c, parsed.error);
  const { token, password } = parsed.data;

  const row = await db.query.passwordResetTokens.findFirst({
    where: eq(passwordResetTokens.token, token),
  });
  if (!row) {
    return c.json({ error: "invalid", error_description: "トークンが無効です" }, 400);
  }
  if (row.expiresAt < new Date()) {
    await db
      .delete(passwordResetTokens)
      .where(eq(passwordResetTokens.token, token))
      .catch(() => {});
    return c.json({ error: "expired", error_description: "トークンの有効期限が切れています" }, 400);
  }

  const user = await db.query.users.findFirst({ where: eq(users.id, row.userId) });
  if (!user) {
    return c.json({ error: "invalid", error_description: "トークンが無効です" }, 400);
  }

  const newHash = await hashPassword(password);

  await db.batch([
    db
      .update(users)
      .set({ passwordHash: newHash, updatedAt: new Date() })
      .where(eq(users.id, user.id)),
    db.update(accessTokens).set({ revoked: true }).where(eq(accessTokens.userId, user.id)),
    db.update(refreshTokens).set({ revoked: true }).where(eq(refreshTokens.userId, user.id)),
    db.delete(opSessions).where(eq(opSessions.userId, user.id)),
    db.delete(passwordResetTokens).where(eq(passwordResetTokens.userId, user.id)),
  ]);

  return c.json({ ok: true });
});
