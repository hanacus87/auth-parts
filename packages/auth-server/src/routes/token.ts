import { Hono } from "hono";
import { db } from "../db/index";
import { authorizationCodes, accessTokens, refreshTokens, clients, users } from "../db/schema";
import { eq } from "drizzle-orm";
import { verifyPKCE } from "../lib/pkce";
import { signAccessToken, signIdToken } from "../lib/jwt";
import { generateId, generateRandomString } from "../lib/crypto";
import { timingSafeEqual } from "node:crypto";

export const tokenRouter = new Hono();

// POST /token — RFC 6749 §3.2 + RFC 7636 §4.6 + OIDC Core §3.1.3
tokenRouter.post("/token", async (c) => {
  const body = await c.req.parseBody();
  const grantType = String(body["grant_type"] ?? "");

  // クライアント認証: client_secret_basic or body
  const { clientId, clientSecret } = extractClientCredentials(c, body);

  if (grantType === "authorization_code") {
    return handleAuthorizationCodeGrant(c, body, clientId, clientSecret);
  }

  if (grantType === "refresh_token") {
    return handleRefreshTokenGrant(c, body, clientId, clientSecret);
  }

  return tokenError(c, "unsupported_grant_type", "Unsupported grant_type");
});

// ── クライアント認証 ─────────────────────────────────────────

function extractClientCredentials(c: any, body: Record<string, any>) {
  // Authorization: Basic base64(client_id:client_secret)
  const authHeader = c.req.header("Authorization") ?? "";
  if (authHeader.startsWith("Basic ")) {
    try {
      const decoded = atob(authHeader.slice(6));
      const colonIndex = decoded.indexOf(":");
      if (colonIndex !== -1) {
        return {
          clientId: decodeURIComponent(decoded.slice(0, colonIndex)),
          clientSecret: decodeURIComponent(decoded.slice(colonIndex + 1)),
        };
      }
    } catch {
      // 不正な Base64 → Body のクレデンシャルにフォールバック
    }
  }
  // Body (public client)
  return {
    clientId: String(body["client_id"] ?? ""),
    clientSecret: body["client_secret"] ? String(body["client_secret"]) : undefined,
  };
}

async function authenticateClient(
  clientId: string,
  clientSecret: string | undefined,
): Promise<{ client: typeof clients.$inferSelect | null; error: string | null }> {
  if (!clientId) {
    return { client: null, error: "client_id is required" };
  }

  const client = await db.query.clients.findFirst({
    where: eq(clients.id, clientId),
  });

  if (!client) {
    return { client: null, error: "Unknown client" };
  }

  // client_secret_basic: secret 必須（定数時間比較でタイミング攻撃を防止）
  if (client.tokenEndpointAuthMethod === "client_secret_basic") {
    if (!clientSecret || !client.secret) {
      return { client: null, error: "Invalid client credentials" };
    }
    const a = new TextEncoder().encode(clientSecret);
    const b = new TextEncoder().encode(client.secret);
    if (a.byteLength !== b.byteLength || !timingSafeEqual(a, b)) {
      return { client: null, error: "Invalid client credentials" };
    }
  }

  // token_endpoint_auth_method=none: public client (PKCE で保護)
  // secret チェック不要

  return { client, error: null };
}

// ── authorization_code grant ─────────────────────────────────

async function handleAuthorizationCodeGrant(
  c: any,
  body: Record<string, any>,
  clientId: string,
  clientSecret: string | undefined,
) {
  const code = String(body["code"] ?? "");
  const redirectUri = String(body["redirect_uri"] ?? "");
  const codeVerifier = String(body["code_verifier"] ?? "");

  if (!code || !redirectUri || !codeVerifier) {
    return tokenError(c, "invalid_request", "code, redirect_uri, and code_verifier are required");
  }

  // クライアント認証
  const { client, error: authError } = await authenticateClient(clientId, clientSecret);
  if (authError || !client) {
    return tokenError(c, "invalid_client", authError ?? "Client authentication failed");
  }

  // grant_type 許可チェック
  if (!client.allowedGrantTypes.includes("authorization_code")) {
    return tokenError(
      c,
      "unauthorized_client",
      "Client is not allowed to use authorization_code grant",
    );
  }

  // 認可コードを検索
  const authCode = await db.query.authorizationCodes.findFirst({
    where: eq(authorizationCodes.code, code),
  });

  if (!authCode) {
    return tokenError(c, "invalid_grant", "Invalid authorization code");
  }

  // 使用済みチェック (RFC 6749 §4.1.2)
  // 再利用検知時はそのコードで発行済みの全トークンを revoke する [SHOULD]
  if (authCode.used) {
    await db
      .update(accessTokens)
      .set({ revoked: true })
      .where(eq(accessTokens.userId, authCode.userId));
    await db
      .update(refreshTokens)
      .set({ revoked: true })
      .where(eq(refreshTokens.userId, authCode.userId));
    return tokenError(c, "invalid_grant", "Authorization code has already been used");
  }

  // 期限切れチェック
  if (authCode.expiresAt < new Date()) {
    return tokenError(c, "invalid_grant", "Authorization code has expired");
  }

  // client_id 一致確認
  if (authCode.clientId !== client.id) {
    return tokenError(c, "invalid_grant", "Authorization code was issued to a different client");
  }

  // redirect_uri 一致確認 (RFC 6749 §4.1.3)
  if (authCode.redirectUri !== redirectUri) {
    return tokenError(c, "invalid_grant", "redirect_uri does not match");
  }

  // PKCE 検証 (RFC 7636 §4.6)
  const pkceValid = await verifyPKCE(
    codeVerifier,
    authCode.codeChallenge,
    authCode.codeChallengeMethod,
  );
  if (!pkceValid) {
    return tokenError(c, "invalid_grant", "PKCE verification failed");
  }

  // 認可コードを使用済みにマーク
  await db.update(authorizationCodes).set({ used: true }).where(eq(authorizationCodes.code, code));

  // ユーザー情報を取得（ID Token のクレーム用）
  const user = await db.query.users.findFirst({
    where: eq(users.id, authCode.userId),
  });

  if (!user) {
    return tokenError(c, "invalid_grant", "User not found");
  }

  // Access Token 生成
  const jti = generateId();
  const accessTokenTTL = Number(process.env.ACCESS_TOKEN_TTL) || 3600;
  const accessTokenExpiresAt = new Date(Date.now() + accessTokenTTL * 1000);

  const accessTokenJwt = await signAccessToken({
    sub: user.id,
    aud: client.id,
    scope: authCode.scopes.join(" "),
    jti,
  });

  await db.insert(accessTokens).values({
    token: accessTokenJwt,
    jti,
    clientId: client.id,
    userId: user.id,
    scopes: authCode.scopes,
    expiresAt: accessTokenExpiresAt,
  });

  // ID Token 生成
  const authTime = authCode.authTime
    ? Math.floor(authCode.authTime.getTime() / 1000)
    : Math.floor(Date.now() / 1000);
  const idTokenPayload: Parameters<typeof signIdToken>[0] = {
    sub: user.id,
    aud: client.id,
    auth_time: authTime,
    nonce: authCode.nonce ?? undefined,
    sid: authCode.sessionId ?? undefined,
  };

  const idToken = await signIdToken(idTokenPayload);

  // Refresh Token 生成（offline_access スコープがある場合）
  let refreshToken: string | undefined;
  if (authCode.scopes.includes("offline_access")) {
    refreshToken = generateRandomString(32);
    const refreshTokenTTL = Number(process.env.REFRESH_TOKEN_TTL) || 2592000;
    await db.insert(refreshTokens).values({
      token: refreshToken,
      clientId: client.id,
      userId: user.id,
      scopes: authCode.scopes,
      expiresAt: new Date(Date.now() + refreshTokenTTL * 1000),
    });
  }

  // レスポンス (RFC 6749 §5.1 + OIDC Core §3.1.3.3)
  c.header("Cache-Control", "no-store");
  c.header("Pragma", "no-cache");

  return c.json({
    access_token: accessTokenJwt,
    token_type: "Bearer",
    expires_in: accessTokenTTL,
    ...(refreshToken ? { refresh_token: refreshToken } : {}),
    id_token: idToken,
    scope: authCode.scopes.join(" "),
  });
}

// ── refresh_token grant ──────────────────────────────────────

async function handleRefreshTokenGrant(
  c: any,
  body: Record<string, any>,
  clientId: string,
  clientSecret: string | undefined,
) {
  const refreshTokenValue = String(body["refresh_token"] ?? "");
  const requestedScope = body["scope"] ? String(body["scope"]) : undefined;

  if (!refreshTokenValue) {
    return tokenError(c, "invalid_request", "refresh_token is required");
  }

  // クライアント認証
  const { client, error: authError } = await authenticateClient(clientId, clientSecret);
  if (authError || !client) {
    return tokenError(c, "invalid_client", authError ?? "Client authentication failed");
  }

  // grant_type 許可チェック
  if (!client.allowedGrantTypes.includes("refresh_token")) {
    return tokenError(c, "unauthorized_client", "Client is not allowed to use refresh_token grant");
  }

  // Refresh Token を検索
  const storedToken = await db.query.refreshTokens.findFirst({
    where: eq(refreshTokens.token, refreshTokenValue),
  });

  if (!storedToken) {
    return tokenError(c, "invalid_grant", "Invalid refresh token");
  }

  if (storedToken.revoked) {
    return tokenError(c, "invalid_grant", "Refresh token has been revoked");
  }

  if (storedToken.expiresAt < new Date()) {
    return tokenError(c, "invalid_grant", "Refresh token has expired");
  }

  if (storedToken.clientId !== client.id) {
    return tokenError(c, "invalid_grant", "Refresh token was issued to a different client");
  }

  // スコープ: 元のスコープ以下に限定可能
  let scopes = storedToken.scopes;
  if (requestedScope) {
    const requested = requestedScope.split(" ").filter(Boolean);
    const invalid = requested.filter((s) => !storedToken.scopes.includes(s));
    if (invalid.length > 0) {
      return tokenError(c, "invalid_scope", `Cannot expand scope: ${invalid.join(", ")}`);
    }
    scopes = requested;
  }

  // Refresh Token Rotation: 古いトークンを無効化
  const newRefreshToken = generateRandomString(32);
  const refreshTokenTTL = Number(process.env.REFRESH_TOKEN_TTL) || 2592000;

  await db
    .update(refreshTokens)
    .set({ revoked: true, replacedBy: newRefreshToken })
    .where(eq(refreshTokens.token, refreshTokenValue));

  await db.insert(refreshTokens).values({
    token: newRefreshToken,
    clientId: client.id,
    userId: storedToken.userId,
    scopes,
    expiresAt: new Date(Date.now() + refreshTokenTTL * 1000),
  });

  // ユーザー情報取得
  const user = await db.query.users.findFirst({
    where: eq(users.id, storedToken.userId),
  });

  if (!user) {
    return tokenError(c, "invalid_grant", "User not found");
  }

  // 新しい Access Token
  const jti = generateId();
  const accessTokenTTL = Number(process.env.ACCESS_TOKEN_TTL) || 3600;
  const accessTokenExpiresAt = new Date(Date.now() + accessTokenTTL * 1000);

  const accessTokenJwt = await signAccessToken({
    sub: user.id,
    aud: client.id,
    scope: scopes.join(" "),
    jti,
  });

  await db.insert(accessTokens).values({
    token: accessTokenJwt,
    jti,
    clientId: client.id,
    userId: user.id,
    scopes,
    expiresAt: accessTokenExpiresAt,
  });

  // 新しい ID Token (OIDC Core §12.2: refresh 時は auth_time 不要)
  const idToken = await signIdToken({
    sub: user.id,
    aud: client.id,
  });

  c.header("Cache-Control", "no-store");
  c.header("Pragma", "no-cache");

  return c.json({
    access_token: accessTokenJwt,
    token_type: "Bearer",
    expires_in: accessTokenTTL,
    refresh_token: newRefreshToken,
    id_token: idToken,
    scope: scopes.join(" "),
  });
}

// ── エラーレスポンス ──────────────────────────────────────────

function tokenError(c: any, error: string, description: string) {
  // RFC 6749 §5.2: invalid_client は 401 を返し WWW-Authenticate ヘッダーを付与
  if (error === "invalid_client") {
    c.header("WWW-Authenticate", 'Basic realm="token"');
    return c.json({ error, error_description: description }, 401);
  }
  return c.json({ error, error_description: description }, 400);
}
