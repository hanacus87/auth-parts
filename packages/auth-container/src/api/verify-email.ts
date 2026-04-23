import { Hono } from "hono";
import { and, desc, eq, gt } from "drizzle-orm";
import { z } from "zod";
import type { AppContext, AppEnv } from "../types";
import type { DB } from "../db";
import { emailVerificationTokens, users } from "../db/schema";
import { generateRandomString } from "../lib/crypto";
import { sendVerificationEmail } from "../lib/email";
import { emailField, zodBadRequest } from "../lib/validation";

export const apiVerifyEmailRouter = new Hono<AppEnv>();

const TOKEN_TTL_MINUTES = 60;
const TOKEN_TTL_MS = TOKEN_TTL_MINUTES * 60 * 1000;
const RESEND_COOLDOWN_MS = 5 * 60 * 1000;

/**
 * 新しい確認トークンを発行して DB に保存し、確認メールを送信する。
 * 登録 / 再送の両方から呼ばれる共通ロジック。
 *
 * @param db - drizzle ハンドル
 * @param env - Cloudflare Workers Bindings (ISSUER / RESEND_API_KEY / FROM_EMAIL を使用)
 * @param user - 対象ユーザー (id / email / name)
 * @throws Resend 送信失敗時は `sendVerificationEmail` の例外がそのまま伝搬する
 */
export async function issueVerificationAndSend(
  db: DB,
  env: AppContext["env"],
  user: { id: string; email: string; name: string },
): Promise<void> {
  const token = generateRandomString(32);
  const expiresAt = new Date(Date.now() + TOKEN_TTL_MS);
  await db.insert(emailVerificationTokens).values({
    token,
    userId: user.id,
    expiresAt,
  });
  const verificationUrl = `${env.ISSUER}/verify-email?token=${encodeURIComponent(token)}`;
  try {
    await sendVerificationEmail(env, {
      to: user.email,
      userName: user.name,
      verificationUrl,
      expiresInMinutes: TOKEN_TTL_MINUTES,
    });
  } catch (err) {
    await db
      .delete(emailVerificationTokens)
      .where(eq(emailVerificationTokens.token, token))
      .catch(() => {});
    throw err;
  }
}

/**
 * `POST /api/verify-email` — body の `token` を検証して `users.emailVerified=true` にする。
 * 成功時は該当ユーザーのトークンを全削除 (再利用防止)。既確認状態のトークンは `alreadyVerified: true` で応答。
 */
apiVerifyEmailRouter.post("/verify-email", async (c) => {
  const db = c.var.db;
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const token = typeof body["token"] === "string" ? body["token"] : "";
  if (!token) {
    return c.json({ error: "invalid", error_description: "トークンが指定されていません" }, 400);
  }

  const row = await db.query.emailVerificationTokens.findFirst({
    where: eq(emailVerificationTokens.token, token),
  });
  if (!row) {
    return c.json({ error: "invalid", error_description: "トークンが無効です" }, 400);
  }
  if (row.expiresAt < new Date()) {
    await db
      .delete(emailVerificationTokens)
      .where(eq(emailVerificationTokens.token, token))
      .catch(() => {});
    return c.json({ error: "expired", error_description: "トークンの有効期限が切れています" }, 400);
  }

  const user = await db.query.users.findFirst({ where: eq(users.id, row.userId) });
  if (!user) {
    return c.json({ error: "invalid" }, 400);
  }
  if (user.emailVerified) {
    await db
      .delete(emailVerificationTokens)
      .where(eq(emailVerificationTokens.token, token))
      .catch(() => {});
    return c.json({ ok: true, email: user.email, alreadyVerified: true });
  }

  await db.batch([
    db
      .update(users)
      .set({ emailVerified: true, updatedAt: new Date() })
      .where(eq(users.id, user.id)),
    db.delete(emailVerificationTokens).where(eq(emailVerificationTokens.userId, user.id)),
  ]);

  return c.json({ ok: true, email: user.email });
});

const resendSchema = z.object({ email: emailField });

/**
 * `POST /api/resend-verification` — 確認メールを再送する。
 * ユーザー列挙対策のため、未登録 / 既確認のメールアドレスに対しても 200 OK を返す (送信はしない)。
 * 5 分以内の再送要求は 429 を返す。
 */
apiVerifyEmailRouter.post("/resend-verification", async (c) => {
  const db = c.var.db;
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;

  const parsed = resendSchema.safeParse(body);
  if (!parsed.success) return zodBadRequest(c, parsed.error);
  const email = parsed.data.email;

  const user = await db.query.users.findFirst({ where: eq(users.email, email) });
  if (!user || user.emailVerified) {
    return c.json({ ok: true });
  }

  const recentCutoff = new Date(Date.now() - RESEND_COOLDOWN_MS);
  const recent = await db.query.emailVerificationTokens.findFirst({
    where: and(
      eq(emailVerificationTokens.userId, user.id),
      gt(emailVerificationTokens.createdAt, recentCutoff),
    ),
    orderBy: [desc(emailVerificationTokens.createdAt)],
  });
  if (recent) {
    return c.json(
      {
        error: "rate_limited",
        error_description:
          "確認メールの再送は 5 分に 1 回までです。少し時間をおいてから再度お試しください。",
      },
      429,
    );
  }

  try {
    await issueVerificationAndSend(db, c.env, {
      id: user.id,
      email: user.email,
      name: user.name,
    });
  } catch (err) {
    console.error("sendVerificationEmail failed:", err);
  }

  return c.json({ ok: true });
});
