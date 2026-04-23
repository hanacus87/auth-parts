import { Hono } from "hono";
import { deleteCookie } from "hono/cookie";
import { eq } from "drizzle-orm";
import type { AppEnv } from "../types";
import { accessTokens, clients, opSessions, refreshTokens } from "../db/schema";
import { clearSessionCookie, getSessionCookie } from "../lib/session";
import { signLogoutToken, verifyIdTokenHint } from "../lib/jwt";
import { generateId } from "../lib/crypto";
import { isPublicHttpsUrl } from "../lib/url-policy";
import {
  CSRF_FIELD,
  LOGOUT_CSRF_COOKIE,
  ensureLogoutCsrfToken,
  getLogoutCsrfCookie,
  verifyCsrf,
} from "../lib/csrf";

export const apiLogoutRouter = new Hono<AppEnv>();

interface LogoutParams {
  idTokenHint?: string;
  postLogoutRedirectUri?: string;
  state?: string;
}

/**
 * `GET /api/logout/context` — SPA 側の `/logout` ページが最初に呼ぶ。
 * セッション有無・ヒント先クライアント名・CSRF トークンを返す。
 */
apiLogoutRouter.get("/logout/context", async (c) => {
  const db = c.var.db;
  const url = new URL(c.req.url);
  const idTokenHint = url.searchParams.get("id_token_hint") ?? undefined;
  const postLogoutRedirectUri = url.searchParams.get("post_logout_redirect_uri") ?? undefined;

  const sessionId = getSessionCookie(c);
  if (!sessionId) {
    return c.json({ alreadyLoggedOut: true, postLogoutRedirectUri });
  }

  let clientName: string | undefined;
  if (idTokenHint) {
    const payload = await verifyIdTokenHint(db, c.env, idTokenHint);
    if (payload?.aud) {
      const aud = Array.isArray(payload.aud) ? payload.aud[0] : payload.aud;
      const client = await db.query.clients.findFirst({ where: eq(clients.id, String(aud)) });
      clientName = client?.name;
    }
  }

  const csrfToken = ensureLogoutCsrfToken(c);
  return c.json({
    alreadyLoggedOut: false,
    clientName,
    csrfToken,
  });
});

/**
 * `POST /api/logout` — RP-Initiated Logout (OIDC RP-Initiated Logout §2)。
 * CSRF 検証後、現セッションのユーザーを対象に access / refresh / OP セッションを無効化し、
 * Back-Channel Logout 1.0 に従って backchannelLogoutUri が登録された全クライアントに logout_token を POST する
 * (タイムアウト 5 秒、失敗はログアウト処理をブロックしない)。
 * `post_logout_redirect_uri` は事前登録との完全一致でのみリダイレクト URL を返す。
 */
apiLogoutRouter.post("/logout", async (c) => {
  const db = c.var.db;
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const str = (v: unknown): string | undefined => (typeof v === "string" && v ? v : undefined);

  if (!verifyCsrf(getLogoutCsrfCookie(c), str(body[CSRF_FIELD]))) {
    return c.json({ error: "invalid_csrf" }, 403);
  }
  deleteCookie(c, LOGOUT_CSRF_COOKIE, { path: "/" });

  const params: LogoutParams = {
    idTokenHint: str(body["id_token_hint"]),
    postLogoutRedirectUri: str(body["post_logout_redirect_uri"]),
    state: str(body["state"]),
  };

  let hintUserId: string | undefined;
  if (params.idTokenHint) {
    const payload = await verifyIdTokenHint(db, c.env, params.idTokenHint);
    if (payload?.sub) hintUserId = payload.sub;
  }

  const sessionId = getSessionCookie(c);
  if (sessionId) {
    const session = await db.query.opSessions.findFirst({
      where: eq(opSessions.id, sessionId),
    });

    if (session) {
      const shouldInvalidate = !hintUserId || hintUserId === session.userId;
      if (shouldInvalidate) {
        await db.batch([
          db
            .update(accessTokens)
            .set({ revoked: true })
            .where(eq(accessTokens.userId, session.userId)),
          db
            .update(refreshTokens)
            .set({ revoked: true })
            .where(eq(refreshTokens.userId, session.userId)),
          db.delete(opSessions).where(eq(opSessions.id, sessionId)),
        ]);

        const isDev = c.env.ENVIRONMENT === "development";
        const allRegisteredClients = await db.query.clients.findMany();
        const backchannelClients = allRegisteredClients.filter(
          (cl) =>
            cl.backchannelLogoutUri &&
            isPublicHttpsUrl(cl.backchannelLogoutUri, {
              allowHttp: isDev,
              allowLoopback: isDev,
            }),
        );
        const notifications = backchannelClients.map(async (cl) => {
          const logoutToken = await signLogoutToken(db, c.env, {
            sub: session.userId,
            aud: cl.id,
            jti: generateId(),
            sid: sessionId,
          });
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 5000);
          try {
            await fetch(cl.backchannelLogoutUri!, {
              method: "POST",
              headers: { "Content-Type": "application/x-www-form-urlencoded" },
              body: new URLSearchParams({ logout_token: logoutToken }),
              signal: controller.signal,
              redirect: "error",
            });
          } catch {
          } finally {
            clearTimeout(timeoutId);
          }
        });
        await Promise.allSettled(notifications);
      }
    }
  }

  clearSessionCookie(c);

  if (params.postLogoutRedirectUri) {
    const allClients = await db.query.clients.findMany();
    const allRegistered = new Set(allClients.flatMap((cl) => cl.postLogoutRedirectUris));
    if (allRegistered.has(params.postLogoutRedirectUri)) {
      try {
        const url = new URL(params.postLogoutRedirectUri);
        if (params.state) url.searchParams.set("state", params.state);
        return c.json({ redirectUrl: url.toString() });
      } catch {}
    }
  }

  return c.json({ completed: true });
});
