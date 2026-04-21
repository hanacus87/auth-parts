import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { z } from "zod";
import type { AppEnv } from "../types";
import { users } from "../db/schema";
import { verifyLoginChallenge } from "../lib/session";
import { finalizeLoginAndRedirect } from "../lib/post-login";
import { verifyPasswordConstantTime } from "../lib/password";
import { emailField, passwordField, zodBadRequest } from "../lib/validation";

export const apiLoginRouter = new Hono<AppEnv>();

const loginSchema = z.object({
  email: emailField,
  password: passwordField,
  login_challenge: z
    .string({ error: "login_challenge が必要です" })
    .min(1, "login_challenge が必要です"),
});

/**
 * `GET /api/login/context` — SPA のログイン画面が最初に呼ぶ。
 * クエリ `login_challenge` の署名と期限を検証する。
 */
apiLoginRouter.get("/login/context", async (c) => {
  const loginChallenge = c.req.query("login_challenge");
  if (!loginChallenge) {
    return c.json({ valid: false, error: "missing_challenge" }, 400);
  }
  try {
    await verifyLoginChallenge(c.env, loginChallenge);
    return c.json({ valid: true });
  } catch {
    return c.json({ valid: false, error: "invalid_or_expired_challenge" }, 400);
  }
});

/**
 * `POST /api/login` — メール + パスワードで認証し、成功したら OP セッションを発行して
 * 認可コード or consent 画面へのリダイレクト URL を JSON で返す。
 * メール未確認ユーザーは 403 + `email_not_verified` (OIDC Core §5.1 準拠)。
 */
apiLoginRouter.post("/login", async (c) => {
  const db = c.var.db;
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;

  const parsed = loginSchema.safeParse(body);
  if (!parsed.success) return zodBadRequest(c, parsed.error);
  const input = parsed.data;

  let challengePayload;
  try {
    challengePayload = await verifyLoginChallenge(c.env, input.login_challenge);
  } catch {
    return c.json(
      { error: "invalid_challenge", error_description: "login_challenge が無効または期限切れです" },
      400,
    );
  }

  const user = await db.query.users.findFirst({ where: eq(users.email, input.email) });
  const passwordValid = await verifyPasswordConstantTime(input.password, user?.passwordHash);

  if (!user || !passwordValid) {
    return c.json(
      {
        error: "invalid_credentials",
        error_description: "メールアドレスまたはパスワードが正しくありません",
      },
      400,
    );
  }

  if (!user.emailVerified) {
    return c.json(
      {
        error: "email_not_verified",
        error_description: "メールアドレスの確認が完了していません",
        email: user.email,
      },
      403,
    );
  }

  const response = await finalizeLoginAndRedirect(c, user.id, challengePayload);
  return convertRedirectToJson(response, c);
});

/**
 * Hono の `c.redirect()` が返す Response を `{ redirectUrl }` JSON に変換する。
 * SPA 側で `window.location.replace(redirectUrl)` して遷移させる目的。
 */
function convertRedirectToJson(response: Response, c: any): Response {
  if (response.status >= 300 && response.status < 400) {
    const location = response.headers.get("Location");
    if (location) {
      return c.json({ redirectUrl: location });
    }
  }
  return response;
}
