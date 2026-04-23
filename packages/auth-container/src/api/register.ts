import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { z } from "zod";
import type { AppEnv } from "../types";
import { users } from "../db/schema";
import { verifyLoginChallenge } from "../lib/session";
import { generateId } from "../lib/crypto";
import { hashPassword } from "../lib/password";
import {
  emailField,
  passwordField,
  nameField,
  optionalNameField,
  zodBadRequest,
} from "../lib/validation";
import { issueVerificationAndSend } from "./verify-email";
import { rateLimit } from "../lib/rate-limit";

export const apiRegisterRouter = new Hono<AppEnv>();

const registerRateLimit = rateLimit({
  bucket: "register",
  windowSec: 3600,
  limit: 5,
  description:
    "登録リクエストの回数が上限に達しました。1 時間ほど時間をおいてから再度お試しください。",
});

const registerSchema = z
  .object({
    email: emailField,
    password: passwordField,
    password_confirm: z.string({ error: "確認用パスワードを入力してください" }),
    name: nameField,
    given_name: optionalNameField,
    family_name: optionalNameField,
  })
  .refine((d) => d.password === d.password_confirm, {
    message: "パスワードと確認用が一致しません",
    path: ["password_confirm"],
  });

/**
 * `GET /api/register/context` — SPA の登録画面が最初に呼ぶ。
 * `login_challenge` が付いている場合のみ署名と期限を検証し、`{ loginChallengeValid }` で返す。
 */
apiRegisterRouter.get("/register/context", async (c) => {
  const loginChallenge = c.req.query("login_challenge") ?? "";
  if (!loginChallenge) {
    return c.json({ loginChallengeValid: null });
  }
  try {
    await verifyLoginChallenge(c.env, loginChallenge);
    return c.json({ loginChallengeValid: true });
  } catch {
    return c.json({ loginChallengeValid: false });
  }
});

/**
 * `POST /api/register` — 新規ユーザー登録 + 確認メール送信。
 * 重複メールは 409。送信失敗は SPA 側の再送ボタンで復旧させるためログのみ残して登録は成功扱い。
 */
apiRegisterRouter.post("/register", registerRateLimit, async (c) => {
  const db = c.var.db;
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;

  const parsed = registerSchema.safeParse(body);
  if (!parsed.success) return zodBadRequest(c, parsed.error);
  const input = parsed.data;

  const existing = await db.query.users.findFirst({ where: eq(users.email, input.email) });
  if (existing) {
    return c.json(
      {
        error: "already_registered",
        error_description: "このメールアドレスは既に登録されています",
      },
      409,
    );
  }

  const userId = generateId();
  await db.insert(users).values({
    id: userId,
    email: input.email,
    passwordHash: await hashPassword(input.password),
    name: input.name,
    givenName: input.given_name,
    familyName: input.family_name,
  });

  try {
    await issueVerificationAndSend(db, c.env, {
      id: userId,
      email: input.email,
      name: input.name,
    });
  } catch (err) {
    console.error("sendVerificationEmail failed:", err);
  }

  return c.json({ emailSent: true, email: input.email });
});
