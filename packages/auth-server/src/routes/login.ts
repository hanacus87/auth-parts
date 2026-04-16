import { Hono } from "hono";
import { db } from "../db/index";
import { users, opSessions, consents, authorizationCodes } from "../db/schema";
import { eq, and } from "drizzle-orm";
import { verifyLoginChallenge, createConsentChallenge, setSessionCookie } from "../lib/session";
import { generateId, generateRandomString } from "../lib/crypto";

export const loginRouter = new Hono();

// タイミング攻撃防止用ダミーハッシュ
// ユーザー未存在時もパスワード検証を実行し、応答時間の差によるユーザー列挙を防ぐ
const DUMMY_PASSWORD_HASH = await Bun.password.hash("dummy");

// GET /login — ログインフォーム HTML を返す
loginRouter.get("/login", async (c) => {
  const loginChallenge = c.req.query("login_challenge");
  if (!loginChallenge) {
    return c.html(renderLoginPage({ error: "login_challenge が不正です" }), 400);
  }

  // challenge を検証（改ざん・期限切れチェック）
  try {
    await verifyLoginChallenge(loginChallenge);
  } catch {
    return c.html(renderLoginPage({ error: "login_challenge が無効または期限切れです" }), 400);
  }

  return c.html(renderLoginPage({ loginChallenge }));
});

// POST /login — 認証処理
loginRouter.post("/login", async (c) => {
  const body = await c.req.parseBody();
  const email = String(body["email"] ?? "");
  const password = String(body["password"] ?? "");
  const loginChallenge = String(body["login_challenge"] ?? "");

  if (!loginChallenge) {
    return c.html(renderLoginPage({ error: "login_challenge が不正です" }), 400);
  }

  // login_challenge を検証して元の認可リクエストを復元
  let challengePayload;
  try {
    challengePayload = await verifyLoginChallenge(loginChallenge);
  } catch {
    return c.html(renderLoginPage({ error: "login_challenge が無効または期限切れです" }), 400);
  }

  // email / password を検証
  if (!email || !password) {
    return c.html(
      renderLoginPage({ loginChallenge, error: "メールアドレスとパスワードを入力してください" }),
      400,
    );
  }

  const user = await db.query.users.findFirst({
    where: eq(users.email, email),
  });

  // ユーザー未存在時もダミーハッシュで検証を実行（タイミング攻撃防止）
  const passwordValid = await Bun.password.verify(
    password,
    user?.passwordHash ?? DUMMY_PASSWORD_HASH,
  );

  if (!user || !passwordValid) {
    return c.html(
      renderLoginPage({
        loginChallenge,
        error: "メールアドレスまたはパスワードが正しくありません",
      }),
      400,
    );
  }

  // OP セッションを発行して DB に保存
  const sessionId = generateId();
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24時間
  await db.insert(opSessions).values({
    id: sessionId,
    userId: user.id,
    expiresAt,
  });

  setSessionCookie(c, sessionId);

  const requestedScopes = challengePayload.scope.split(" ").filter(Boolean);
  const authTime = Math.floor(Date.now() / 1000);

  // 同意済みチェック: 既に全スコープが同意済みなら /consent をスキップ
  const existingConsent = await db.query.consents.findFirst({
    where: and(eq(consents.userId, user.id), eq(consents.clientId, challengePayload.client_id)),
  });

  const needsConsent =
    challengePayload.prompt === "consent" ||
    !existingConsent ||
    !requestedScopes.every((s: string) => existingConsent.scopes.includes(s));

  if (!needsConsent) {
    // 同意済み: 認可コードを直接発行
    const code = generateRandomString(32);
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

    await db.insert(authorizationCodes).values({
      code,
      clientId: challengePayload.client_id,
      userId: user.id,
      redirectUri: challengePayload.redirect_uri,
      scopes: requestedScopes,
      codeChallenge: challengePayload.code_challenge,
      codeChallengeMethod: challengePayload.code_challenge_method,
      nonce: challengePayload.nonce,
      authTime: new Date(authTime * 1000),
      sessionId,
      expiresAt,
    });

    const url = new URL(challengePayload.redirect_uri);
    url.searchParams.set("code", code);
    if (challengePayload.state) url.searchParams.set("state", challengePayload.state);
    return c.redirect(url.toString());
  }

  // 未同意: consent_challenge を生成して同意画面にリダイレクト
  const consentChallenge = await createConsentChallenge({
    user_id: user.id,
    session_id: sessionId,
    auth_time: authTime,
    client_id: challengePayload.client_id,
    redirect_uri: challengePayload.redirect_uri,
    scope: challengePayload.scope,
    state: challengePayload.state,
    nonce: challengePayload.nonce,
    code_challenge: challengePayload.code_challenge,
    code_challenge_method: challengePayload.code_challenge_method,
  });

  return c.redirect(`/consent?consent_challenge=${encodeURIComponent(consentChallenge)}`);
});

// ── JSX レンダリング ──────────────────────────────────────

function renderLoginPage(props: { loginChallenge?: string; error?: string }): string {
  const { loginChallenge = "", error } = props;
  return `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>ログイン</title>
  <style>
    body { font-family: sans-serif; max-width: 400px; margin: 80px auto; padding: 0 16px; }
    h1 { font-size: 1.5rem; margin-bottom: 24px; }
    label { display: block; margin-bottom: 4px; font-size: 0.9rem; }
    input[type="email"], input[type="password"] {
      width: 100%; padding: 8px; margin-bottom: 16px;
      border: 1px solid #ccc; border-radius: 4px; box-sizing: border-box;
    }
    button { width: 100%; padding: 10px; background: #4f46e5; color: white;
      border: none; border-radius: 4px; cursor: pointer; font-size: 1rem; }
    button:hover { background: #4338ca; }
    .error { color: #dc2626; margin-bottom: 16px; font-size: 0.9rem; }
  </style>
</head>
<body>
  <h1>ログイン</h1>
  ${error ? `<p class="error">${escapeHtml(error)}</p>` : ""}
  <form method="POST" action="/login">
    <input type="hidden" name="login_challenge" value="${escapeHtml(loginChallenge)}" />
    <label for="email">メールアドレス</label>
    <input type="email" id="email" name="email" required autocomplete="email" />
    <label for="password">パスワード</label>
    <input type="password" id="password" name="password" required autocomplete="current-password" />
    <button type="submit">ログイン</button>
  </form>
</body>
</html>`;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
