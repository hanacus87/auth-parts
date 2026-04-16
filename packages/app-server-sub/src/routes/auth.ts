import { Hono } from "hono";
import { createRemoteJWKSet, jwtVerify } from "jose";
import {
  generateCodeVerifier,
  generateCodeChallenge,
  generateState,
  generateNonce,
  basicAuthHeader,
} from "../lib/crypto";
import {
  createSession,
  getSession,
  updateSession,
  destroySession,
  destroyUserSessions,
  savePendingAuth,
  consumePendingAuth,
  setSessionCookie,
  getSessionCookie,
  clearSessionCookie,
} from "../lib/session";
import { refreshTokens } from "../lib/tokens";

const AUTH_SERVER = process.env.AUTH_SERVER_URL!;
const CLIENT_ID = process.env.CLIENT_ID!;
const REDIRECT_URI = process.env.REDIRECT_URI!;
const FRONTEND_URL = process.env.FRONTEND_URL!;

// JWKS を起動時にキャッシュ
const JWKS = createRemoteJWKSet(new URL(`${AUTH_SERVER}/jwks.json`));

export const authRouter = new Hono();

// ── GET /auth/login — OIDC 認証フロー開始 ────────────────────

authRouter.get("/login", async (c) => {
  // ── 既存セッションチェック: 有効なセッションがあれば OIDC フローをスキップ ──
  try {
    const existingSessionId = getSessionCookie(c);
    if (existingSessionId) {
      const session = await getSession(existingSessionId);
      if (session) {
        const now = Math.floor(Date.now() / 1000);
        if (session.accessTokenExpiresAt > now + 30) {
          return c.redirect(`${FRONTEND_URL}/dashboard`);
        }
        // access_token 期限切れ — リフレッシュ試行
        const refreshed = await refreshTokens(session);
        if (refreshed) {
          await updateSession(existingSessionId, refreshed);
          return c.redirect(`${FRONTEND_URL}/dashboard`);
        }
        // リフレッシュ失敗 — 古いセッションを破棄
        await destroySession(existingSessionId);
        clearSessionCookie(c);
      } else {
        // Cookie はあるが Redis にセッションなし — Cookie を掃除
        clearSessionCookie(c);
      }
    }
  } catch {
    // Redis 障害等の場合は通常の OIDC フローにフォールスルー
  }

  // ── 有効なセッションなし — 通常の OIDC フロー開始 ──
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = await generateCodeChallenge(codeVerifier);
  const state = generateState();
  const nonce = generateNonce();

  // PKCE verifier と nonce を Redis に保存（state をキーとして紐付け）
  await savePendingAuth(state, { codeVerifier, nonce });

  const params = new URLSearchParams({
    response_type: "code",
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    scope: "openid email offline_access",
    state,
    nonce,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
  });

  return c.redirect(`${AUTH_SERVER}/authorize?${params}`);
});

// ── GET /auth/callback — 認可コード受信 + トークン交換 ───────

authRouter.get("/callback", async (c) => {
  const errorParam = c.req.query("error");
  if (errorParam) {
    const desc = c.req.query("error_description") ?? errorParam;
    const errorUrl = new URL("/callback", FRONTEND_URL);
    errorUrl.searchParams.set("error", errorParam);
    errorUrl.searchParams.set("error_description", desc);
    return c.redirect(errorUrl.toString());
  }

  const code = c.req.query("code");
  const state = c.req.query("state");

  if (!code || !state) {
    return c.redirect(
      `${FRONTEND_URL}/callback?error=invalid_request&error_description=Missing+code+or+state`,
    );
  }

  // state を検証し、PendingAuth を取得（1 回限り）
  const pending = await consumePendingAuth(state);
  if (!pending) {
    return c.redirect(
      `${FRONTEND_URL}/callback?error=invalid_state&error_description=Invalid+or+expired+state`,
    );
  }

  // サーバー間でトークン交換 (auth-server の /token エンドポイント)
  // Confidential client: Authorization: Basic ヘッダーでクライアント認証
  const tokenBody = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: REDIRECT_URI,
    code_verifier: pending.codeVerifier,
  });

  const tokenRes = await fetch(`${AUTH_SERVER}/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: basicAuthHeader(),
    },
    body: tokenBody,
  });

  if (!tokenRes.ok) {
    const err = await tokenRes.json().catch(() => ({}));
    const desc = (err as Record<string, string>).error_description ?? "Token exchange failed";
    return c.redirect(
      `${FRONTEND_URL}/callback?error=token_error&error_description=${encodeURIComponent(desc)}`,
    );
  }

  const tokens = (await tokenRes.json()) as {
    access_token: string;
    token_type: string;
    expires_in: number;
    refresh_token?: string;
    id_token: string;
    scope: string;
  };

  // ID Token 検証 (OIDC Core §3.1.3.7)
  try {
    const { payload } = await jwtVerify(tokens.id_token, JWKS, {
      issuer: AUTH_SERVER,
      audience: CLIENT_ID,
    });

    // nonce 検証
    if (payload["nonce"] !== pending.nonce) {
      return c.redirect(
        `${FRONTEND_URL}/callback?error=invalid_nonce&error_description=Nonce+mismatch`,
      );
    }

    // セッション作成、トークンを Redis に保持
    const sessionId = await createSession({
      userId: payload.sub!,
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token ?? null,
      idToken: tokens.id_token,
      accessTokenExpiresAt: Math.floor(Date.now() / 1000) + tokens.expires_in,
      createdAt: Math.floor(Date.now() / 1000),
    });

    // HttpOnly Cookie 発行
    setSessionCookie(c, sessionId);

    return c.redirect(`${FRONTEND_URL}/dashboard`);
  } catch {
    return c.redirect(
      `${FRONTEND_URL}/callback?error=id_token_error&error_description=ID+token+verification+failed`,
    );
  }
});

// ── GET /auth/status — ログイン状態確認 ──────────────────────

authRouter.get("/status", async (c) => {
  const sessionId = getSessionCookie(c);
  if (!sessionId) {
    return c.json({ loggedIn: false });
  }

  const session = await getSession(sessionId);
  if (!session) {
    clearSessionCookie(c);
    return c.json({ loggedIn: false });
  }

  return c.json({ loggedIn: true, user: { sub: session.userId } });
});

// ── POST /auth/logout — ログアウト ──────────────────────────

authRouter.post("/logout", async (c) => {
  const sessionId = getSessionCookie(c);
  let idToken: string | undefined;

  if (sessionId) {
    const session = await getSession(sessionId);
    if (session) {
      idToken = session.idToken;
      await destroySession(sessionId);
    }
  }

  clearSessionCookie(c);

  // auth-server のログアウト URL を構築
  const postLogoutUri = `${REDIRECT_URI.replace(/\/auth\/callback$/, "")}/auth/post-logout`;
  const logoutParams = new URLSearchParams({
    post_logout_redirect_uri: postLogoutUri,
  });
  if (idToken) {
    logoutParams.set("id_token_hint", idToken);
  }

  return c.json({ logoutUrl: `${AUTH_SERVER}/logout?${logoutParams}` });
});

// ── GET /auth/post-logout — auth-server ログアウト後のリダイレクト先 ──

authRouter.get("/post-logout", (c) => {
  return c.redirect(FRONTEND_URL);
});

// ── POST /auth/backchannel-logout — OIDC Back-Channel Logout 1.0 ──

authRouter.post("/backchannel-logout", async (c) => {
  const body = await c.req.parseBody();
  const logoutToken = body["logout_token"];

  if (!logoutToken || typeof logoutToken !== "string") {
    return c.json({ error: "invalid_request" }, 400);
  }

  try {
    const { payload } = await jwtVerify(logoutToken, JWKS, {
      issuer: AUTH_SERVER,
      audience: CLIENT_ID,
    });

    // events クレーム検証
    const events = payload["events"] as Record<string, unknown> | undefined;
    if (!events || !("http://schemas.openid.net/event/backchannel-logout" in events)) {
      return c.json({ error: "invalid_logout_token" }, 400);
    }

    if (!payload.sub) {
      return c.json({ error: "invalid_logout_token" }, 400);
    }

    await destroyUserSessions(payload.sub);

    c.header("Cache-Control", "no-store");
    return c.text("", 200);
  } catch {
    return c.json({ error: "invalid_logout_token" }, 400);
  }
});
