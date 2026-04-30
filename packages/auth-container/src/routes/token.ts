import { Hono } from "hono";
import type { AppContext, AppEnv } from "../types";
import type { DB } from "../db";
import {
  authorizationCodes,
  accessTokens,
  refreshTokens,
  clients,
  users,
  opSessions,
} from "../db/schema";
import { and, eq } from "drizzle-orm";
import { verifyPKCE } from "../lib/pkce";
import { signAccessToken, signIdToken } from "../lib/jwt";
import { generateId, generateRandomString } from "../lib/crypto";
import { safeEqual } from "../lib/safe-equal";
import { sha256Hex } from "../lib/token-hash";
import { rateLimit } from "../lib/rate-limit";

export const tokenRouter = new Hono<AppEnv>();

const tokenRateLimit = rateLimit({ bucket: "token", windowSec: 60, limit: 30 });

/**
 * `/token` エンドポイント。grant_type を振り分けて authorization_code / refresh_token を処理する。
 * 準拠: RFC 6749 §3.2, RFC 7636 §4.6, OIDC Core §3.1.3。
 */
tokenRouter.post("/token", tokenRateLimit, async (c) => {
  const body = await c.req.parseBody();
  const grantType = String(body["grant_type"] ?? "");

  const creds = extractClientCredentials(c, body);

  if (grantType === "authorization_code") {
    return handleAuthorizationCodeGrant(c, body, creds);
  }

  if (grantType === "refresh_token") {
    return handleRefreshTokenGrant(c, body, creds);
  }

  return tokenError(c, "unsupported_grant_type", "Unsupported grant_type");
});

interface ClientCredentials {
  clientId: string;
  clientSecret: string | undefined;
  method: "client_secret_basic" | "client_secret_post" | "none";
  multipleAuth: boolean;
}

/**
 * `Authorization: Basic` ヘッダと body から client 認証情報を抽出する。
 * Basic と body の両方に client_secret が含まれていれば RFC 6749 §2.3 に従い multipleAuth=true を返す。
 */
function extractClientCredentials(c: AppContext, body: Record<string, any>): ClientCredentials {
  const authHeader = c.req.header("Authorization") ?? "";
  const bodyClientId = String(body["client_id"] ?? "");
  const bodyClientSecret = body["client_secret"] ? String(body["client_secret"]) : undefined;

  if (authHeader.startsWith("Basic ")) {
    try {
      const decoded = atob(authHeader.slice(6));
      const colonIndex = decoded.indexOf(":");
      if (colonIndex !== -1) {
        return {
          clientId: decodeURIComponent(decoded.slice(0, colonIndex)),
          clientSecret: decodeURIComponent(decoded.slice(colonIndex + 1)),
          method: "client_secret_basic",
          multipleAuth: bodyClientSecret !== undefined,
        };
      }
    } catch {}
  }

  return {
    clientId: bodyClientId,
    clientSecret: bodyClientSecret,
    method: bodyClientSecret !== undefined ? "client_secret_post" : "none",
    multipleAuth: false,
  };
}

/**
 * クライアント認証を行う。登録済み `tokenEndpointAuthMethod` とリクエスト方式を照合し、
 * ダウングレード攻撃を防ぐ。secret は定数時間比較で検証する。
 *
 * @returns 認証成功時は `{ client, error: null }`、失敗時は `{ client: null, error: <理由> }`
 */
async function authenticateClient(
  db: DB,
  creds: ClientCredentials,
): Promise<{ client: typeof clients.$inferSelect | null; error: string | null }> {
  if (creds.multipleAuth) {
    return { client: null, error: "Multiple client authentication methods are not allowed" };
  }
  if (!creds.clientId) {
    return { client: null, error: "client_id is required" };
  }

  const client = await db.query.clients.findFirst({
    where: eq(clients.id, creds.clientId),
  });

  if (!client) {
    return { client: null, error: "Unknown client" };
  }

  if (client.tokenEndpointAuthMethod !== creds.method) {
    return {
      client: null,
      error: `Client must authenticate using ${client.tokenEndpointAuthMethod}`,
    };
  }

  switch (client.tokenEndpointAuthMethod) {
    case "client_secret_basic":
    case "client_secret_post": {
      if (!creds.clientSecret || !client.secret) {
        return { client: null, error: "Invalid client credentials" };
      }
      if (!safeEqual(creds.clientSecret, client.secret)) {
        return { client: null, error: "Invalid client credentials" };
      }
      break;
    }
    case "none":
      break;
    default:
      return { client: null, error: "Unsupported token_endpoint_auth_method" };
  }

  return { client, error: null };
}

/**
 * `grant_type=authorization_code` を処理する (RFC 6749 §4.1.3, RFC 7636 §4.6, OIDC Core §3.1.3)。
 * 認可コードは single-use 条件付き UPDATE で TOCTOU race を排除し、再利用検知時は同 family の
 * access/refresh トークンを全 revoke する (RFC 6749 §4.1.2 最終段落に準拠)。
 *
 * refresh_token は OAuth 2.0 BCP for Browser-Based Apps §6.2 に従い、公開クライアント
 * (token_endpoint_auth_method=none) には発行しない。admin API 側で allowed_scopes から
 * offline_access を除外する一次防御 (computeAllowedScopesAndGrants) があるが、DB 直編集や
 * 移行漏れに備えた runtime での二次防御として token endpoint 側でも auth method を確認する。
 */
async function handleAuthorizationCodeGrant(
  c: AppContext,
  body: Record<string, any>,
  creds: ClientCredentials,
) {
  const db = c.var.db;
  const code = String(body["code"] ?? "");
  const redirectUri = String(body["redirect_uri"] ?? "");
  const codeVerifier = String(body["code_verifier"] ?? "");

  if (!code || !redirectUri || !codeVerifier) {
    return tokenError(c, "invalid_request", "code, redirect_uri, and code_verifier are required");
  }

  const { client, error: authError } = await authenticateClient(db, creds);
  if (authError || !client) {
    return tokenError(c, "invalid_client", authError ?? "Client authentication failed");
  }

  if (!client.allowedGrantTypes.includes("authorization_code")) {
    return tokenError(
      c,
      "unauthorized_client",
      "Client is not allowed to use authorization_code grant",
    );
  }

  const codeHash = await sha256Hex(code);
  const marked = await db
    .update(authorizationCodes)
    .set({ used: true })
    .where(and(eq(authorizationCodes.codeHash, codeHash), eq(authorizationCodes.used, false)))
    .returning();

  if (marked.length === 0) {
    await db.batch([
      db.update(accessTokens).set({ revoked: true }).where(eq(accessTokens.authCodeId, codeHash)),
      db.update(refreshTokens).set({ revoked: true }).where(eq(refreshTokens.authCodeId, codeHash)),
    ]);
    return tokenError(c, "invalid_grant", "Invalid or already-used authorization code");
  }

  const authCode = marked[0]!;

  if (authCode.expiresAt < new Date()) {
    return tokenError(c, "invalid_grant", "Authorization code has expired");
  }

  if (authCode.clientId !== client.id) {
    return tokenError(c, "invalid_grant", "Authorization code was issued to a different client");
  }

  if (authCode.redirectUri !== redirectUri) {
    return tokenError(c, "invalid_grant", "redirect_uri does not match");
  }

  const pkceValid = await verifyPKCE(
    codeVerifier,
    authCode.codeChallenge,
    authCode.codeChallengeMethod,
  );
  if (!pkceValid) {
    return tokenError(c, "invalid_grant", "PKCE verification failed");
  }

  const user = await db.query.users.findFirst({
    where: eq(users.id, authCode.userId),
  });

  if (!user) {
    return tokenError(c, "invalid_grant", "User not found");
  }

  const jti = generateId();
  const accessTokenTTL = Number(c.env.ACCESS_TOKEN_TTL) || 3600;
  const accessTokenExpiresAt = new Date(Date.now() + accessTokenTTL * 1000);

  const accessTokenJwt = await signAccessToken(db, c.env, {
    sub: user.id,
    aud: client.id,
    client_id: client.id,
    scope: authCode.scopes.join(" "),
    jti,
  });

  await db.insert(accessTokens).values({
    jti,
    clientId: client.id,
    userId: user.id,
    authCodeId: authCode.codeHash,
    scopes: authCode.scopes,
    expiresAt: accessTokenExpiresAt,
  });

  const authTime = authCode.authTime
    ? Math.floor(authCode.authTime.getTime() / 1000)
    : Math.floor(Date.now() / 1000);

  const idToken = await signIdToken(db, c.env, {
    sub: user.id,
    aud: client.id,
    auth_time: authTime,
    nonce: authCode.nonce ?? undefined,
    sid: authCode.sessionId ?? undefined,
  });

  let refreshToken: string | undefined;
  if (authCode.scopes.includes("offline_access") && client.tokenEndpointAuthMethod !== "none") {
    refreshToken = generateRandomString(32);
    const refreshTokenTTL = Number(c.env.REFRESH_TOKEN_TTL) || 2592000;
    await db.insert(refreshTokens).values({
      tokenHash: await sha256Hex(refreshToken),
      clientId: client.id,
      userId: user.id,
      scopes: authCode.scopes,
      authTime: authCode.authTime,
      sessionId: authCode.sessionId,
      authCodeId: authCode.codeHash,
      expiresAt: new Date(Date.now() + refreshTokenTTL * 1000),
    });
  }

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

/**
 * `grant_type=refresh_token` を処理する (RFC 6749 §6, RFC 9700 §4.14, OIDC Core §12.1-12.2)。
 * 失効済みトークンが提示された場合は rotation breach として同 family の全トークンと
 * OP セッションを revoke し、ブラウザに再認証を強制する。
 *
 * 公開クライアント (token_endpoint_auth_method=none) からの refresh_token grant は
 * OAuth 2.0 BCP for Browser-Based Apps §6.2 に従い拒否する。`allowed_grant_types` チェックで
 * 通常は弾かれるが、データ移行漏れ等に備えて auth method 側でも runtime で二重に防御する。
 */
async function handleRefreshTokenGrant(
  c: AppContext,
  body: Record<string, any>,
  creds: ClientCredentials,
) {
  const db = c.var.db;
  const refreshTokenValue = String(body["refresh_token"] ?? "");
  const requestedScope = body["scope"] ? String(body["scope"]) : undefined;

  if (!refreshTokenValue) {
    return tokenError(c, "invalid_request", "refresh_token is required");
  }

  const { client, error: authError } = await authenticateClient(db, creds);
  if (authError || !client) {
    return tokenError(c, "invalid_client", authError ?? "Client authentication failed");
  }

  if (!client.allowedGrantTypes.includes("refresh_token")) {
    return tokenError(c, "unauthorized_client", "Client is not allowed to use refresh_token grant");
  }

  if (client.tokenEndpointAuthMethod === "none") {
    return tokenError(c, "unauthorized_client", "Public clients cannot use refresh_token grant");
  }

  const refreshTokenHash = await sha256Hex(refreshTokenValue);
  const storedToken = await db.query.refreshTokens.findFirst({
    where: eq(refreshTokens.tokenHash, refreshTokenHash),
  });

  if (!storedToken) {
    return tokenError(c, "invalid_grant", "Invalid refresh token");
  }

  if (storedToken.revoked) {
    if (storedToken.authCodeId) {
      await db.batch([
        db
          .update(accessTokens)
          .set({ revoked: true })
          .where(eq(accessTokens.authCodeId, storedToken.authCodeId)),
        db
          .update(refreshTokens)
          .set({ revoked: true })
          .where(eq(refreshTokens.authCodeId, storedToken.authCodeId)),
      ]);
    }
    if (storedToken.sessionId) {
      await db.delete(opSessions).where(eq(opSessions.id, storedToken.sessionId));
    }
    return tokenError(c, "invalid_grant", "Refresh token has been revoked");
  }

  if (storedToken.expiresAt < new Date()) {
    return tokenError(c, "invalid_grant", "Refresh token has expired");
  }

  if (storedToken.clientId !== client.id) {
    return tokenError(c, "invalid_grant", "Refresh token was issued to a different client");
  }

  if (storedToken.sessionId) {
    const op = await db.query.opSessions.findFirst({
      where: eq(opSessions.id, storedToken.sessionId),
    });
    if (!op || op.expiresAt < new Date()) {
      return tokenError(c, "invalid_grant", "Login session has ended");
    }
  }

  let scopes = storedToken.scopes;
  if (requestedScope) {
    const requested = requestedScope.split(" ").filter(Boolean);
    const invalid = requested.filter((s) => !storedToken.scopes.includes(s));
    if (invalid.length > 0) {
      return tokenError(c, "invalid_scope", `Cannot expand scope: ${invalid.join(", ")}`);
    }
    scopes = requested;
  }

  const newRefreshToken = generateRandomString(32);
  const newRefreshTokenHash = await sha256Hex(newRefreshToken);
  const refreshTokenTTL = Number(c.env.REFRESH_TOKEN_TTL) || 2592000;

  await db
    .update(refreshTokens)
    .set({ revoked: true, replacedBy: newRefreshTokenHash })
    .where(eq(refreshTokens.tokenHash, refreshTokenHash));

  await db.insert(refreshTokens).values({
    tokenHash: newRefreshTokenHash,
    clientId: client.id,
    userId: storedToken.userId,
    scopes,
    authTime: storedToken.authTime,
    sessionId: storedToken.sessionId,
    authCodeId: storedToken.authCodeId,
    expiresAt: new Date(Date.now() + refreshTokenTTL * 1000),
  });

  const user = await db.query.users.findFirst({
    where: eq(users.id, storedToken.userId),
  });

  if (!user) {
    return tokenError(c, "invalid_grant", "User not found");
  }

  const jti = generateId();
  const accessTokenTTL = Number(c.env.ACCESS_TOKEN_TTL) || 3600;
  const accessTokenExpiresAt = new Date(Date.now() + accessTokenTTL * 1000);

  const accessTokenJwt = await signAccessToken(db, c.env, {
    sub: user.id,
    aud: client.id,
    client_id: client.id,
    scope: scopes.join(" "),
    jti,
  });

  await db.insert(accessTokens).values({
    jti,
    clientId: client.id,
    userId: user.id,
    authCodeId: storedToken.authCodeId,
    scopes,
    expiresAt: accessTokenExpiresAt,
  });

  const idToken = await signIdToken(db, c.env, {
    sub: user.id,
    aud: client.id,
    auth_time: storedToken.authTime ? Math.floor(storedToken.authTime.getTime() / 1000) : undefined,
    sid: storedToken.sessionId ?? undefined,
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

/**
 * `/token` 用のエラーレスポンスを組み立てる (RFC 6749 §5.1-5.2 に準拠)。
 * invalid_client は 401 + WWW-Authenticate ヘッダを付け、それ以外は 400 を返す。
 */
function tokenError(c: AppContext, error: string, description: string) {
  c.header("Cache-Control", "no-store");
  c.header("Pragma", "no-cache");
  if (error === "invalid_client") {
    c.header("WWW-Authenticate", 'Basic realm="token"');
    return c.json({ error, error_description: description }, 401);
  }
  return c.json({ error, error_description: description }, 400);
}
