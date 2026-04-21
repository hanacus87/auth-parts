import { Hono } from "hono";
import type { AppEnv } from "../types";
import { getJWKS } from "../lib/jwt";

export const jwksRouter = new Hono<AppEnv>();

/** JWKS エンドポイント。RS256 公開鍵を JWK Set 形式 (RFC 7517 §5) で返す。 */
jwksRouter.get("/jwks.json", async (c) => {
  const jwks = await getJWKS(c.var.db);
  return c.json(jwks);
});
