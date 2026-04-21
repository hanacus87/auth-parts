import { Hono } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
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
  destroySessionBySid,
  destroyUserSessions,
  savePendingAuth,
  consumePendingAuth,
  setSessionCookie,
  getSessionCookie,
  clearSessionCookie,
} from "../lib/session";
import { safeEqual } from "../lib/safe-equal";
import { refreshTokens } from "../lib/tokens";

const AUTH_SERVER = process.env.AUTH_SERVER_URL!;
const CLIENT_ID = process.env.CLIENT_ID!;
const REDIRECT_URI = process.env.REDIRECT_URI!;
const FRONTEND_URL = process.env.FRONTEND_URL!;

const JWKS = createRemoteJWKSet(new URL(`${AUTH_SERVER}/jwks.json`));

// RFC 9700 §4.5.3.1: state は user-agent にバインドする必要がある
const STATE_COOKIE = "oauth_state";
const STATE_COOKIE_PATH = "/auth";
const STATE_COOKIE_TTL = 60 * 10;

export const authRouter = new Hono();

authRouter.get("/login", async (c) => {
  try {
    const existingSessionId = getSessionCookie(c);
    if (existingSessionId) {
      const session = await getSession(existingSessionId);
      if (session) {
        const now = Math.floor(Date.now() / 1000);
        if (session.accessTokenExpiresAt > now + 30) {
          return c.redirect(`${FRONTEND_URL}/dashboard`);
        }
        const refreshed = await refreshTokens(session);
        if (refreshed) {
          await updateSession(existingSessionId, refreshed);
          return c.redirect(`${FRONTEND_URL}/dashboard`);
        }
        await destroySession(existingSessionId);
        clearSessionCookie(c);
      } else {
        clearSessionCookie(c);
      }
    }
  } catch {
    // Redis 障害時は通常の OIDC フローにフォールスルー
  }

  const codeVerifier = generateCodeVerifier();
  const codeChallenge = await generateCodeChallenge(codeVerifier);
  const state = generateState();
  const nonce = generateNonce();

  await savePendingAuth(state, { codeVerifier, nonce });

  setCookie(c, STATE_COOKIE, state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "Lax",
    path: STATE_COOKIE_PATH,
    maxAge: STATE_COOKIE_TTL,
  });

  const params = new URLSearchParams({
    response_type: "code",
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    scope: "openid profile email offline_access",
    state,
    nonce,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
  });

  return c.redirect(`${AUTH_SERVER}/authorize?${params}`);
});

authRouter.get("/callback", async (c) => {
  const cookieState = getCookie(c, STATE_COOKIE);
  deleteCookie(c, STATE_COOKIE, { path: STATE_COOKIE_PATH });

  const errorParam = c.req.query("error");
  const code = c.req.query("code");
  const state = c.req.query("state");

  // RFC 9700 §4.5.3.1: state は URL パラメータと Cookie 両方で一致する必要がある
  // error パラメータ処理より先に state バインディングを検証する
  // (攻撃者が ?error=... で Cookie を消費させる DoS を避けるため)
  if (!state || !cookieState || !safeEqual(cookieState, state)) {
    return c.redirect(
      `${FRONTEND_URL}/callback?error=invalid_state&error_description=State+binding+failed`,
    );
  }

  if (errorParam) {
    const desc = c.req.query("error_description") ?? errorParam;
    const errorUrl = new URL("/callback", FRONTEND_URL);
    errorUrl.searchParams.set("error", errorParam);
    errorUrl.searchParams.set("error_description", desc);
    return c.redirect(errorUrl.toString());
  }

  if (!code) {
    return c.redirect(
      `${FRONTEND_URL}/callback?error=invalid_request&error_description=Missing+code`,
    );
  }

  const pending = await consumePendingAuth(state);
  if (!pending) {
    return c.redirect(
      `${FRONTEND_URL}/callback?error=invalid_state&error_description=Invalid+or+expired+state`,
    );
  }

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

  // OIDC Core §3.1.3.7: ID Token の署名・iss・aud・有効期限を検証
  try {
    const { payload } = await jwtVerify(tokens.id_token, JWKS, {
      issuer: AUTH_SERVER,
      audience: CLIENT_ID,
    });

    if (payload["nonce"] !== pending.nonce) {
      return c.redirect(
        `${FRONTEND_URL}/callback?error=invalid_nonce&error_description=Nonce+mismatch`,
      );
    }

    const sessionId = await createSession({
      userId: payload.sub!,
      opSessionId: (payload["sid"] as string | undefined) ?? null,
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token ?? null,
      idToken: tokens.id_token,
      accessTokenExpiresAt: Math.floor(Date.now() / 1000) + tokens.expires_in,
      createdAt: Math.floor(Date.now() / 1000),
    });

    setSessionCookie(c, sessionId);

    return c.redirect(`${FRONTEND_URL}/dashboard`);
  } catch {
    return c.redirect(
      `${FRONTEND_URL}/callback?error=id_token_error&error_description=ID+token+verification+failed`,
    );
  }
});

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

  // OIDC RP-Initiated Logout: post_logout_redirect_uri は OP 側で事前登録済みの URI と
  // 照合されるため、FRONTEND_URL ではなく BFF の /auth/post-logout を経由させる
  const postLogoutUri = `${REDIRECT_URI.replace(/\/auth\/callback$/, "")}/auth/post-logout`;
  const logoutParams = new URLSearchParams({
    post_logout_redirect_uri: postLogoutUri,
  });
  if (idToken) {
    logoutParams.set("id_token_hint", idToken);
  }

  return c.json({ logoutUrl: `${AUTH_SERVER}/logout?${logoutParams}` });
});

authRouter.get("/post-logout", (c) => {
  return c.redirect(FRONTEND_URL);
});

// OIDC Back-Channel Logout 1.0 §2.5
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

    const events = payload["events"] as Record<string, unknown> | undefined;
    if (!events || !("http://schemas.openid.net/event/backchannel-logout" in events)) {
      return c.json({ error: "invalid_logout_token" }, 400);
    }

    // OIDC BCL §2.4: sub または sid のいずれか (または両方) が必須
    const sub = payload["sub"] as string | undefined;
    const sid = payload["sid"] as string | undefined;
    if (!sub && !sid) {
      return c.json({ error: "invalid_logout_token" }, 400);
    }

    // sid があれば該当セッション 1 件のみ破棄 (SSO の他セッションへの波及を回避)
    if (sid) {
      await destroySessionBySid(sid);
    } else if (sub) {
      await destroyUserSessions(sub);
    }

    c.header("Cache-Control", "no-store");
    return c.text("", 200);
  } catch {
    return c.json({ error: "invalid_logout_token" }, 400);
  }
});
