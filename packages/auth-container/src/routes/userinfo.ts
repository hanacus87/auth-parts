import { Hono } from "hono";
import type { AppContext, AppEnv } from "../types";
import { accessTokens, users } from "../db/schema";
import { eq } from "drizzle-orm";

export const userinfoRouter = new Hono<AppEnv>();

/**
 * UserInfo リクエストから Bearer アクセストークンを抽出する。
 *
 * 対応するのは RFC 6750 §2.1 (Authorization ヘッダ) と §2.2 (application/x-www-form-urlencoded の
 * `access_token` フィールド) のみ。§2.3 (URI クエリ) は情報漏洩リスクのため非対応。
 * RFC 6750 §2 に従い 2 つ以上の送信方式が同時に使われた場合は `multiple` を返す。
 *
 * @returns 成功時は `{ token, error: null }`、トークン欠如時は `error: "missing"`、方式併用時は `error: "multiple"`
 */
async function extractBearerToken(c: AppContext): Promise<{
  token: string | null;
  error: "missing" | "multiple" | null;
}> {
  const authHeader = c.req.header("Authorization") ?? "";
  const headerToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;

  let bodyToken: string | null = null;
  if (c.req.method === "POST") {
    const contentType = c.req.header("Content-Type") ?? "";
    if (contentType.includes("application/x-www-form-urlencoded")) {
      const body = await c.req.parseBody();
      const raw = body["access_token"];
      if (typeof raw === "string" && raw.length > 0) bodyToken = raw;
    }
  }

  if (headerToken && bodyToken) return { token: null, error: "multiple" };
  const token = headerToken ?? bodyToken;
  if (!token) return { token: null, error: "missing" };
  return { token, error: null };
}

/**
 * UserInfo エンドポイント (OIDC Core §5.3) の GET / POST 両方を処理する。
 * RFC 6750 §3 に従い、トークン検証エラー時は WWW-Authenticate ヘッダを付けて 401/400 を返す。
 * 返却クレームは付与スコープ (`profile` / `email`) に応じて絞り込み、`sub` のみ必須。
 */
async function handleUserinfo(c: AppContext) {
  const db = c.var.db;
  const { token, error } = await extractBearerToken(c);

  if (error === "missing") {
    c.header("WWW-Authenticate", 'Bearer realm="oidc"');
    return c.json({ error: "invalid_request" }, 401);
  }
  if (error === "multiple") {
    c.header(
      "WWW-Authenticate",
      'Bearer realm="oidc", error="invalid_request", error_description="Multiple token delivery methods"',
    );
    return c.json({ error: "invalid_request" }, 400);
  }

  const storedToken = await db.query.accessTokens.findFirst({
    where: eq(accessTokens.token, token!),
  });

  if (!storedToken) {
    c.header(
      "WWW-Authenticate",
      'Bearer realm="oidc", error="invalid_token", error_description="Unknown access token"',
    );
    return c.json({ error: "invalid_token" }, 401);
  }

  if (storedToken.revoked) {
    c.header(
      "WWW-Authenticate",
      'Bearer realm="oidc", error="invalid_token", error_description="Access token has been revoked"',
    );
    return c.json({ error: "invalid_token" }, 401);
  }

  if (storedToken.expiresAt < new Date()) {
    c.header(
      "WWW-Authenticate",
      'Bearer realm="oidc", error="invalid_token", error_description="Access token has expired"',
    );
    return c.json({ error: "invalid_token" }, 401);
  }

  const user = await db.query.users.findFirst({
    where: eq(users.id, storedToken.userId),
  });

  if (!user) {
    return c.json({ error: "invalid_token" }, 401);
  }

  const claims: Record<string, unknown> = {
    sub: user.id,
  };

  if (storedToken.scopes.includes("profile")) {
    claims.name = user.name;
    claims.given_name = user.givenName;
    claims.family_name = user.familyName;
    claims.updated_at = Math.floor(user.updatedAt.getTime() / 1000);
  }

  if (storedToken.scopes.includes("email")) {
    claims.email = user.email;
    claims.email_verified = user.emailVerified;
  }

  return c.json(claims);
}

userinfoRouter.get("/userinfo", handleUserinfo);
userinfoRouter.post("/userinfo", handleUserinfo);
