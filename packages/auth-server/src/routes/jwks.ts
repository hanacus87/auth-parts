import { Hono } from "hono";
import { getJWKS } from "../lib/jwt";

export const jwksRouter = new Hono();

// RFC 7517 §5 準拠: RS256 公開鍵を JWK Set 形式で返す
jwksRouter.get("/jwks.json", async (c) => {
  const jwks = await getJWKS();
  return c.json(jwks);
});
