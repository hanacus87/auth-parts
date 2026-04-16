import { Hono } from "hono";
import { db } from "../db/index";
import { authorizationCodes, consents, clients } from "../db/schema";
import { eq, and } from "drizzle-orm";
import { verifyConsentChallenge } from "../lib/session";
import { generateId, generateRandomString } from "../lib/crypto";

export const consentRouter = new Hono();

// GET /consent — 同意画面 HTML を返す
consentRouter.get("/consent", async (c) => {
  const consentChallenge = c.req.query("consent_challenge");
  if (!consentChallenge) {
    return c.html(renderConsentPage({ error: "consent_challenge が不正です" }), 400);
  }

  let payload;
  try {
    payload = await verifyConsentChallenge(consentChallenge);
  } catch {
    return c.html(renderConsentPage({ error: "consent_challenge が無効または期限切れです" }), 400);
  }

  // クライアント名を取得
  const client = await db.query.clients.findFirst({
    where: eq(clients.id, payload.client_id),
  });

  const scopes = payload.scope.split(" ").filter(Boolean);

  return c.html(
    renderConsentPage({
      consentChallenge,
      clientName: client?.name ?? payload.client_id,
      scopes,
    }),
  );
});

// POST /consent — 同意処理
consentRouter.post("/consent", async (c) => {
  const body = await c.req.parseBody();
  const consentChallenge = String(body["consent_challenge"] ?? "");
  const approved = String(body["approved"] ?? "");

  if (!consentChallenge) {
    return c.html(renderConsentPage({ error: "consent_challenge が不正です" }), 400);
  }

  let payload;
  try {
    payload = await verifyConsentChallenge(consentChallenge);
  } catch {
    return c.html(renderConsentPage({ error: "consent_challenge が無効または期限切れです" }), 400);
  }

  const scopes = payload.scope.split(" ").filter(Boolean);

  // ユーザーが拒否した場合
  if (approved !== "true") {
    const url = new URL(payload.redirect_uri);
    url.searchParams.set("error", "access_denied");
    url.searchParams.set("error_description", "The user denied the request");
    if (payload.state) url.searchParams.set("state", payload.state);
    return c.redirect(url.toString());
  }

  // 同意を DB に保存 (upsert)
  const existingConsent = await db.query.consents.findFirst({
    where: and(eq(consents.userId, payload.user_id), eq(consents.clientId, payload.client_id)),
  });

  if (existingConsent) {
    // 既存の同意にスコープをマージ
    const mergedScopes = [...new Set([...existingConsent.scopes, ...scopes])];
    await db
      .update(consents)
      .set({ scopes: mergedScopes, grantedAt: new Date() })
      .where(eq(consents.id, existingConsent.id));
  } else {
    await db.insert(consents).values({
      id: generateId(),
      userId: payload.user_id,
      clientId: payload.client_id,
      scopes,
    });
  }

  // 認可コードを生成して DB に保存
  const code = generateRandomString(32);
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10分

  await db.insert(authorizationCodes).values({
    code,
    clientId: payload.client_id,
    userId: payload.user_id,
    redirectUri: payload.redirect_uri,
    scopes,
    codeChallenge: payload.code_challenge,
    codeChallengeMethod: payload.code_challenge_method,
    nonce: payload.nonce,
    authTime: new Date(payload.auth_time * 1000),
    sessionId: payload.session_id,
    expiresAt,
  });

  // redirect_uri にリダイレクト
  const url = new URL(payload.redirect_uri);
  url.searchParams.set("code", code);
  if (payload.state) url.searchParams.set("state", payload.state);
  return c.redirect(url.toString());
});

// ── HTML レンダリング ──────────────────────────────────────

const SCOPE_DESCRIPTIONS: Record<string, string> = {
  openid: "あなたの識別情報（ID）",
  profile: "プロフィール情報（名前など）",
  email: "メールアドレス",
  offline_access: "オフラインアクセス（リフレッシュトークン）",
};

function renderConsentPage(props: {
  consentChallenge?: string;
  clientName?: string;
  scopes?: string[];
  error?: string;
}): string {
  const { consentChallenge = "", clientName = "", scopes = [], error } = props;

  const scopeListHtml = scopes
    .map((s) => `<li>${escapeHtml(SCOPE_DESCRIPTIONS[s] ?? s)}</li>`)
    .join("\n");

  return `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>アクセス許可</title>
  <style>
    body { font-family: sans-serif; max-width: 400px; margin: 80px auto; padding: 0 16px; }
    h1 { font-size: 1.5rem; margin-bottom: 8px; }
    p { color: #555; margin-bottom: 16px; }
    ul { margin-bottom: 24px; padding-left: 20px; }
    li { margin-bottom: 8px; }
    .buttons { display: flex; gap: 12px; }
    button { flex: 1; padding: 10px; border: none; border-radius: 4px; cursor: pointer; font-size: 1rem; }
    .approve { background: #4f46e5; color: white; }
    .approve:hover { background: #4338ca; }
    .deny { background: #e5e7eb; color: #374151; }
    .deny:hover { background: #d1d5db; }
    .error { color: #dc2626; margin-bottom: 16px; font-size: 0.9rem; }
  </style>
</head>
<body>
  <h1>アクセス許可</h1>
  ${error ? `<p class="error">${escapeHtml(error)}</p>` : ""}
  ${
    clientName
      ? `<p><strong>${escapeHtml(clientName)}</strong> が以下の情報へのアクセスを求めています：</p>
  <ul>${scopeListHtml}</ul>
  <form method="POST" action="/consent" class="buttons">
    <input type="hidden" name="consent_challenge" value="${escapeHtml(consentChallenge)}" />
    <button type="submit" name="approved" value="false" class="deny">拒否</button>
    <button type="submit" name="approved" value="true" class="approve">許可する</button>
  </form>`
      : ""
  }
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
