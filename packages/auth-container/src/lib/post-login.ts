import { and, eq } from "drizzle-orm";
import type { AppContext } from "../types";
import type { DB } from "../db";
import { authorizationCodes, consents, opSessions } from "../db/schema";
import { createConsentChallenge, setSessionCookie, type LoginChallengePayload } from "./session";
import { generateId, generateRandomString } from "./crypto";

/**
 * ログイン / 登録成功後の共通後処理。
 *
 * OP セッションを発行して Cookie をセットし、既存 consent を確認する。
 * 既に全スコープが同意済みで `prompt=consent` も指定されていなければ、
 * 認可コードを直接発行して RP の redirect_uri にリダイレクトする。
 * 未同意スコープがあるか `prompt=consent` 指定なら consent_challenge を作り `/consent` にリダイレクトする。
 *
 * `/login` / `/register` 両方から呼ばれる。
 *
 * @param c - Hono のリクエストコンテキスト
 * @param userId - 認証したユーザー ID
 * @param challengePayload - `/authorize` で作成された login_challenge のペイロード
 */
export async function finalizeLoginAndRedirect(
  c: AppContext,
  userId: string,
  challengePayload: LoginChallengePayload,
): Promise<Response> {
  const db: DB = c.var.db;
  const sessionId = generateId();
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
  await db.insert(opSessions).values({
    id: sessionId,
    userId,
    expiresAt,
  });

  setSessionCookie(c, sessionId);

  const requestedScopes = challengePayload.scope.split(" ").filter(Boolean);
  const authTime = Math.floor(Date.now() / 1000);

  const existingConsent = await db.query.consents.findFirst({
    where: and(eq(consents.userId, userId), eq(consents.clientId, challengePayload.client_id)),
  });

  const needsConsent =
    challengePayload.prompt === "consent" ||
    !existingConsent ||
    !requestedScopes.every((s: string) => existingConsent.scopes.includes(s));

  if (!needsConsent) {
    const code = generateRandomString(32);
    const codeExpiresAt = new Date(Date.now() + 10 * 60 * 1000);

    await db.insert(authorizationCodes).values({
      code,
      clientId: challengePayload.client_id,
      userId,
      redirectUri: challengePayload.redirect_uri,
      scopes: requestedScopes,
      codeChallenge: challengePayload.code_challenge,
      codeChallengeMethod: challengePayload.code_challenge_method,
      nonce: challengePayload.nonce,
      authTime: new Date(authTime * 1000),
      sessionId,
      expiresAt: codeExpiresAt,
    });

    const url = new URL(challengePayload.redirect_uri);
    url.searchParams.set("code", code);
    if (challengePayload.state) url.searchParams.set("state", challengePayload.state);
    return c.redirect(url.toString());
  }

  const consentChallenge = await createConsentChallenge(c.env, {
    user_id: userId,
    session_id: sessionId,
    auth_time: authTime,
    client_id: challengePayload.client_id,
    redirect_uri: challengePayload.redirect_uri,
    scope: challengePayload.scope,
    state: challengePayload.state,
    nonce: challengePayload.nonce,
    code_challenge: challengePayload.code_challenge,
    code_challenge_method: challengePayload.code_challenge_method,
  });

  return c.redirect(`/consent?consent_challenge=${encodeURIComponent(consentChallenge)}`);
}
