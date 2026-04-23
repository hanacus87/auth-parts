import { Hono } from "hono";
import type { AppEnv } from "../types";
import { listPublicJwks } from "../lib/jwt";

export const jwksRouter = new Hono<AppEnv>();

/** JWKS エンドポイント。active + deprecated 状態の RS256 公開鍵を JWK Set 形式 (RFC 7517 §5) で返す。 */
jwksRouter.get("/jwks.json", async (c) => {
  const jwks = await listPublicJwks(c.var.db);
  c.header("Cache-Control", "public, max-age=3600");
  return c.json(jwks);
});
