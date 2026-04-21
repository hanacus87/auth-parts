import { Hono } from "hono";
import type { AppContext, AppEnv } from "../types";
import { authorizationCodes, clients, consents, opSessions } from "../db/schema";
import { eq, and } from "drizzle-orm";
import { createLoginChallenge, createConsentChallenge, getSessionCookie } from "../lib/session";
import { generateRandomString } from "../lib/crypto";

export const authorizeRouter = new Hono<AppEnv>();

/**
 * `/authorize` エンドポイントのパラメータを GET / POST 両方から抽出する。
 * RFC 6749 §3.1 と OIDC Core §3.1.2.1 が両メソッド MUST を要求するためメソッドを跨いで正規化する。
 */
async function extractParams(c: AppContext) {
  if (c.req.method === "POST") {
    const body = await c.req.parseBody();
    return {
      response_type: String(body["response_type"] ?? ""),
      client_id: String(body["client_id"] ?? ""),
      redirect_uri: String(body["redirect_uri"] ?? ""),
      scope: String(body["scope"] ?? ""),
      state: body["state"] ? String(body["state"]) : undefined,
      nonce: body["nonce"] ? String(body["nonce"]) : undefined,
      code_challenge: String(body["code_challenge"] ?? ""),
      code_challenge_method: String(body["code_challenge_method"] ?? ""),
      prompt: body["prompt"] ? String(body["prompt"]) : undefined,
      max_age: body["max_age"] ? String(body["max_age"]) : undefined,
    };
  }
  const q = c.req.query.bind(c.req);
  return {
    response_type: q("response_type") ?? "",
    client_id: q("client_id") ?? "",
    redirect_uri: q("redirect_uri") ?? "",
    scope: q("scope") ?? "",
    state: q("state") ?? undefined,
    nonce: q("nonce") ?? undefined,
    code_challenge: q("code_challenge") ?? "",
    code_challenge_method: q("code_challenge_method") ?? "",
    prompt: q("prompt") ?? undefined,
    max_age: q("max_age") ?? undefined,
  };
}

/**
 * Authorization Code Flow の `/authorize` ハンドラ。
 * client_id / redirect_uri / scope / PKCE の検証を行い、未ログインなら `/login`、未同意なら `/consent` へ、
 * 全て揃えば認可コードを発行して redirect_uri に 302 する。
 *
 * 準拠: RFC 6749 §3.1 / §3.1.2.3 / §4.1、OIDC Core §3.1、RFC 7636 (PKCE, S256 必須)。
 * `prompt=none` のときはログイン/同意要求をせずエラーリダイレクト (OIDC Core §3.1.2.1)。
 */
async function handleAuthorize(c: AppContext) {
  const db = c.var.db;
  const params = await extractParams(c);

  if (params.response_type !== "code") {
    return c.json(
      {
        error: "unsupported_response_type",
        error_description: "Only response_type=code is supported",
      },
      400,
    );
  }

  const client = await db.query.clients.findFirst({
    where: eq(clients.id, params.client_id),
  });
  if (!client) {
    return c.json({ error: "unauthorized_client", error_description: "Unknown client_id" }, 400);
  }

  if (!client.allowedGrantTypes.includes("authorization_code")) {
    return c.json(
      {
        error: "unauthorized_client",
        error_description: "Client is not allowed to use authorization_code grant",
      },
      400,
    );
  }

  let redirectUri = params.redirect_uri;
  if (!redirectUri) {
    if (client.redirectUris.length === 1) {
      redirectUri = client.redirectUris[0]!;
    } else {
      return c.json(
        { error: "invalid_request", error_description: "redirect_uri is required" },
        400,
      );
    }
  }
  if (!client.redirectUris.includes(redirectUri)) {
    return c.json(
      {
        error: "invalid_request",
        error_description: "redirect_uri does not match registered URIs",
      },
      400,
    );
  }

  /** redirect_uri にエラーパラメータを付けて 302 リダイレクトする (RFC 6749 §4.1.2.1)。 */
  const errorRedirect = (error: string, description: string) => {
    const url = new URL(redirectUri);
    url.searchParams.set("error", error);
    url.searchParams.set("error_description", description);
    if (params.state) url.searchParams.set("state", params.state);
    return c.redirect(url.toString());
  };

  const requestedScopes = params.scope.split(" ").filter(Boolean);
  if (!requestedScopes.includes("openid")) {
    return errorRedirect("invalid_scope", "scope must include openid");
  }
  const invalidScopes = requestedScopes.filter((s: string) => !client.allowedScopes.includes(s));
  if (invalidScopes.length > 0) {
    return errorRedirect("invalid_scope", `Unsupported scopes: ${invalidScopes.join(", ")}`);
  }

  if (!params.code_challenge) {
    return errorRedirect("invalid_request", "code_challenge is required");
  }
  if (params.code_challenge_method !== "S256") {
    return errorRedirect("invalid_request", "Only code_challenge_method=S256 is supported");
  }

  const sessionId = getSessionCookie(c);
  let session = null;
  if (sessionId) {
    session = await db.query.opSessions.findFirst({
      where: eq(opSessions.id, sessionId),
    });
    if (session && session.expiresAt < new Date()) {
      session = null;
    }
  }

  if (params.prompt === "none" && !session) {
    return errorRedirect("login_required", "User is not authenticated");
  }

  if (params.prompt === "login") {
    session = null;
  }

  if (!session) {
    const loginChallenge = await createLoginChallenge(c.env, {
      client_id: params.client_id,
      redirect_uri: redirectUri,
      scope: params.scope,
      state: params.state,
      nonce: params.nonce,
      code_challenge: params.code_challenge,
      code_challenge_method: params.code_challenge_method,
      prompt: params.prompt,
      max_age: params.max_age,
    });
    return c.redirect(`/login?login_challenge=${encodeURIComponent(loginChallenge)}`);
  }

  if (params.max_age) {
    const maxAge = parseInt(params.max_age, 10);
    const sessionAge = Math.floor((Date.now() - session.createdAt.getTime()) / 1000);
    if (sessionAge > maxAge) {
      const loginChallenge = await createLoginChallenge(c.env, {
        client_id: params.client_id,
        redirect_uri: redirectUri,
        scope: params.scope,
        state: params.state,
        nonce: params.nonce,
        code_challenge: params.code_challenge,
        code_challenge_method: params.code_challenge_method,
        prompt: params.prompt,
        max_age: params.max_age,
      });
      return c.redirect(`/login?login_challenge=${encodeURIComponent(loginChallenge)}`);
    }
  }

  const existingConsent = await db.query.consents.findFirst({
    where: and(eq(consents.userId, session.userId), eq(consents.clientId, params.client_id)),
  });

  const needsConsent =
    params.prompt === "consent" ||
    !existingConsent ||
    !requestedScopes.every((s: string) => existingConsent.scopes.includes(s));

  if (params.prompt === "none" && needsConsent) {
    return errorRedirect("consent_required", "User has not granted consent");
  }

  if (needsConsent) {
    const consentChallenge = await createConsentChallenge(c.env, {
      user_id: session.userId,
      session_id: session.id,
      auth_time: Math.floor(session.createdAt.getTime() / 1000),
      client_id: params.client_id,
      redirect_uri: redirectUri,
      scope: params.scope,
      state: params.state,
      nonce: params.nonce,
      code_challenge: params.code_challenge,
      code_challenge_method: params.code_challenge_method,
    });
    return c.redirect(`/consent?consent_challenge=${encodeURIComponent(consentChallenge)}`);
  }

  const code = generateRandomString(32);
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

  await db.insert(authorizationCodes).values({
    code,
    clientId: params.client_id,
    userId: session.userId,
    redirectUri: redirectUri,
    scopes: requestedScopes,
    codeChallenge: params.code_challenge,
    codeChallengeMethod: params.code_challenge_method,
    nonce: params.nonce,
    authTime: session.createdAt,
    sessionId: session.id,
    expiresAt,
  });

  const url = new URL(redirectUri);
  url.searchParams.set("code", code);
  if (params.state) url.searchParams.set("state", params.state);
  return c.redirect(url.toString());
}

authorizeRouter.get("/authorize", handleAuthorize);
authorizeRouter.post("/authorize", handleAuthorize);
