import { Hono } from "hono";
import { db } from "../db/index";
import { opSessions, accessTokens, refreshTokens, clients } from "../db/schema";
import { eq } from "drizzle-orm";
import { clearSessionCookie, getSessionCookie } from "../lib/session";
import { verifyIdTokenHint, signLogoutToken } from "../lib/jwt";
import { generateId } from "../lib/crypto";

export const logoutRouter = new Hono();

// GET/POST /logout — OIDC RP-Initiated Logout 1.0
async function handleLogout(c: any) {
  const params =
    c.req.method === "POST"
      ? await c.req.parseBody()
      : Object.fromEntries(new URL(c.req.url).searchParams);

  const idTokenHint = params["id_token_hint"] ? String(params["id_token_hint"]) : undefined;
  const postLogoutRedirectUri = params["post_logout_redirect_uri"]
    ? String(params["post_logout_redirect_uri"])
    : undefined;
  const state = params["state"] ? String(params["state"]) : undefined;

  // id_token_hint の署名を検証してユーザーを特定
  // 期限切れでも受け付ける (OIDC RP-Initiated Logout §2)
  let hintUserId: string | undefined;
  if (idTokenHint) {
    const payload = await verifyIdTokenHint(idTokenHint);
    if (payload?.sub) {
      hintUserId = payload.sub;
    }
    // 署名検証失敗時もログアウト処理は続行（id_token_hint は OPTIONAL）
  }

  // OP セッション Cookie からセッションを特定
  const sessionId = getSessionCookie(c);
  if (sessionId) {
    const session = await db.query.opSessions.findFirst({
      where: eq(opSessions.id, sessionId),
    });

    if (session) {
      // id_token_hint のユーザーとセッションのユーザーが一致するか確認
      // 不一致の場合はセッションを無効化しない（別ユーザーのトークンで他人をログアウトさせない）
      const shouldInvalidate = !hintUserId || hintUserId === session.userId;

      if (shouldInvalidate) {
        // Access Token / Refresh Token を無効化
        await db
          .update(accessTokens)
          .set({ revoked: true })
          .where(eq(accessTokens.userId, session.userId));

        await db
          .update(refreshTokens)
          .set({ revoked: true })
          .where(eq(refreshTokens.userId, session.userId));

        // OP セッションを削除
        await db.delete(opSessions).where(eq(opSessions.id, sessionId));

        // Back-Channel Logout: 全クライアントにログアウト通知
        const allRegisteredClients = await db.query.clients.findMany();
        const backchannelClients = allRegisteredClients.filter((cl) => cl.backchannelLogoutUri);

        const notifications = backchannelClients.map(async (cl) => {
          const logoutToken = await signLogoutToken({
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
            });
          } catch {
            // 通知失敗はログアウト処理をブロックしない
          } finally {
            clearTimeout(timeoutId);
          }
        });

        await Promise.allSettled(notifications);
      }
    }
  }

  // OP セッション Cookie を削除
  clearSessionCookie(c);

  // post_logout_redirect_uri が指定されていればリダイレクト
  // 登録済み redirectUris の origin と照合し、不一致ならリダイレクトしない（オープンリダイレクト防止）
  // OIDC RP-Initiated Logout では本来 post_logout_redirect_uris を別途登録するが、
  // 本実装では redirect_uris の origin と一致すれば許可する
  if (postLogoutRedirectUri) {
    try {
      const logoutOrigin = new URL(postLogoutRedirectUri).origin;
      const allClients = await db.query.clients.findMany();
      const registeredOrigins = allClients.flatMap((cl) =>
        cl.redirectUris.map((uri) => new URL(uri).origin),
      );
      if (registeredOrigins.includes(logoutOrigin)) {
        const url = new URL(postLogoutRedirectUri);
        if (state) url.searchParams.set("state", state);
        return c.redirect(url.toString());
      }
    } catch {
      // 不正な URL フォーマットは無視
    }
    // 不一致の場合はリダイレクトせずログアウト完了画面を表示
  }

  // リダイレクト先がなければログアウト完了画面を表示
  return c.html(`<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>ログアウト完了</title>
  <style>
    body { font-family: sans-serif; max-width: 400px; margin: 80px auto; padding: 0 16px; text-align: center; }
    h1 { font-size: 1.5rem; margin-bottom: 16px; }
    p { color: #555; }
  </style>
</head>
<body>
  <h1>ログアウト完了</h1>
  <p>セッションは正常に終了しました。</p>
</body>
</html>`);
}

logoutRouter.get("/logout", handleLogout);
logoutRouter.post("/logout", handleLogout);
