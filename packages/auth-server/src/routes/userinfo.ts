import { Hono } from "hono";
import { db } from "../db/index";
import { accessTokens, users } from "../db/schema";
import { eq } from "drizzle-orm";

export const userinfoRouter = new Hono();

// GET /userinfo — OIDC Core §5.3
userinfoRouter.get("/userinfo", async (c) => {
  // Bearer トークンを取得 (RFC 6750 §2.1)
  const authHeader = c.req.header("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) {
    c.header(
      "WWW-Authenticate",
      'Bearer realm="oidc", error="invalid_request", error_description="Missing Bearer token"',
    );
    return c.json({ error: "invalid_request" }, 401);
  }

  const token = authHeader.slice(7);

  // Access Token を DB で検索
  const storedToken = await db.query.accessTokens.findFirst({
    where: eq(accessTokens.token, token),
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

  // ユーザー情報を取得
  const user = await db.query.users.findFirst({
    where: eq(users.id, storedToken.userId),
  });

  if (!user) {
    return c.json({ error: "invalid_token" }, 401);
  }

  // スコープに応じてクレームを返す (sub は常に必須)
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
    claims.email_verified = false;
  }

  return c.json(claims);
});
