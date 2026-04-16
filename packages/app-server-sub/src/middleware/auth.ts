import type { MiddlewareHandler } from "hono";
import {
  getSession,
  getSessionCookie,
  clearSessionCookie,
  updateSession,
  destroySession,
} from "../lib/session";
import { refreshTokens } from "../lib/tokens";

export const sessionAuthMiddleware: MiddlewareHandler = async (c, next) => {
  const sessionId = getSessionCookie(c);
  if (!sessionId) {
    return c.json({ error: "unauthorized", error_description: "No session" }, 401);
  }

  let session = await getSession(sessionId);
  if (!session) {
    clearSessionCookie(c);
    return c.json({ error: "unauthorized", error_description: "Invalid session" }, 401);
  }

  // access_token の有効期限チェック (30 秒のバッファを持たせる)
  const now = Math.floor(Date.now() / 1000);
  if (session.accessTokenExpiresAt <= now + 30) {
    const refreshed = await refreshTokens(session);
    if (!refreshed) {
      await destroySession(sessionId);
      clearSessionCookie(c);
      return c.json({ error: "unauthorized", error_description: "Session expired" }, 401);
    }
    session = refreshed;
    await updateSession(sessionId, session);
  }

  c.set("user", { sub: session.userId, accessToken: session.accessToken });
  await next();
};
