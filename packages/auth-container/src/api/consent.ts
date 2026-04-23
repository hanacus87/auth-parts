import { Hono } from "hono";
import { eq, and } from "drizzle-orm";
import type { AppEnv } from "../types";
import { authorizationCodes, clients, consents } from "../db/schema";
import { getSessionCookie, verifyConsentChallenge } from "../lib/session";
import { generateId, generateRandomString } from "../lib/crypto";
import { safeEqual } from "../lib/safe-equal";
import { sha256Hex } from "../lib/token-hash";

export const apiConsentRouter = new Hono<AppEnv>();

/**
 * `GET /api/consent/context` — consent 画面に必要な情報を返す。
 * consent_challenge を検証し、現 OP セッションとの紐付きを定数時間比較する (RFC 6819 §4.4.1.8)。
 */
apiConsentRouter.get("/consent/context", async (c) => {
  const db = c.var.db;
  const consentChallenge = c.req.query("consent_challenge");
  if (!consentChallenge) {
    return c.json({ error: "invalid_challenge" }, 400);
  }

  let payload;
  try {
    payload = await verifyConsentChallenge(c.env, consentChallenge);
  } catch {
    return c.json(
      {
        error: "invalid_challenge",
        error_description: "consent_challenge が無効または期限切れです",
      },
      400,
    );
  }

  const currentSession = getSessionCookie(c);
  if (!currentSession || !safeEqual(currentSession, payload.session_id)) {
    return c.json({ error: "session_mismatch", error_description: "セッションが不正です" }, 403);
  }

  const client = await db.query.clients.findFirst({
    where: eq(clients.id, payload.client_id),
  });

  const scopes = payload.scope.split(" ").filter(Boolean);

  return c.json({
    clientName: client?.name ?? payload.client_id,
    scopes,
  });
});

/**
 * `POST /api/consent` — 同意結果を受け取り、承認時は scope を merge して consent 行を作成/更新し、
 * 認可コードを発行して RP の redirect_uri (`{ redirectUrl }`) を返す。拒否時は `error=access_denied` 付きで返す。
 */
apiConsentRouter.post("/consent", async (c) => {
  const db = c.var.db;
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const consentChallenge =
    typeof body["consent_challenge"] === "string" ? body["consent_challenge"] : "";
  const approved = body["approved"] === true;

  if (!consentChallenge) {
    return c.json({ error: "invalid_challenge" }, 400);
  }

  let payload;
  try {
    payload = await verifyConsentChallenge(c.env, consentChallenge);
  } catch {
    return c.json(
      {
        error: "invalid_challenge",
        error_description: "consent_challenge が無効または期限切れです",
      },
      400,
    );
  }

  const currentSession = getSessionCookie(c);
  if (!currentSession || !safeEqual(currentSession, payload.session_id)) {
    return c.json({ error: "session_mismatch" }, 403);
  }

  const scopes = payload.scope.split(" ").filter(Boolean);

  if (!approved) {
    const url = new URL(payload.redirect_uri);
    url.searchParams.set("error", "access_denied");
    url.searchParams.set("error_description", "The user denied the request");
    if (payload.state) url.searchParams.set("state", payload.state);
    return c.json({ redirectUrl: url.toString() });
  }

  const existingConsent = await db.query.consents.findFirst({
    where: and(eq(consents.userId, payload.user_id), eq(consents.clientId, payload.client_id)),
  });

  if (existingConsent) {
    const mergedScopes = [...new Set([...existingConsent.scopes, ...scopes])];
    await db
      .update(consents)
      .set({ scopes: mergedScopes, grantedAt: new Date() })
      .where(eq(consents.id, existingConsent.id));
  } else {
    await db.insert(consents).values({
      id: generateId(),
      userId: payload.user_id,
      clientId: payload.client_id,
      scopes,
    });
  }

  const code = generateRandomString(32);
  const codeHash = await sha256Hex(code);
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

  await db.insert(authorizationCodes).values({
    codeHash,
    clientId: payload.client_id,
    userId: payload.user_id,
    redirectUri: payload.redirect_uri,
    scopes,
    codeChallenge: payload.code_challenge,
    codeChallengeMethod: payload.code_challenge_method,
    nonce: payload.nonce,
    authTime: new Date(payload.auth_time * 1000),
    sessionId: payload.session_id,
    expiresAt,
  });

  const url = new URL(payload.redirect_uri);
  url.searchParams.set("code", code);
  if (payload.state) url.searchParams.set("state", payload.state);
  return c.json({ redirectUrl: url.toString() });
});
