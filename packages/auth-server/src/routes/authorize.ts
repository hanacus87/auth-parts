import { Hono } from "hono";
import { db } from "../db/index";
import { authorizationCodes, clients, consents, opSessions } from "../db/schema";
import { eq, and } from "drizzle-orm";
import { createLoginChallenge, createConsentChallenge, getSessionCookie } from "../lib/session";
import { generateRandomString } from "../lib/crypto";

export const authorizeRouter = new Hono();

// RFC 6749 §3.1 + OIDC Core §3.1.2.1: GET・POST 両方を MUST
// パラメータ取得を共通化
async function extractParams(c: any) {
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
  // GET
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

async function handleAuthorize(c: any) {
  const params = await extractParams(c);

  // 1. response_type 検証
  if (params.response_type !== "code") {
    // client_id / redirect_uri が未検証なのでリダイレクトせずエラーを返す
    return c.json(
      {
        error: "unsupported_response_type",
        error_description: "Only response_type=code is supported",
      },
      400,
    );
  }

  // 2. client_id 検証
  const client = await db.query.clients.findFirst({
    where: eq(clients.id, params.client_id),
  });
  if (!client) {
    return c.json({ error: "unauthorized_client", error_description: "Unknown client_id" }, 400);
  }

  // 2b. allowedGrantTypes に authorization_code が含まれるか検証
  if (!client.allowedGrantTypes.includes("authorization_code")) {
    return c.json(
      {
        error: "unauthorized_client",
        error_description: "Client is not allowed to use authorization_code grant",
      },
      400,
    );
  }

  // 3. redirect_uri 完全一致検証 (RFC 6749 §3.1.2.3)
  let redirectUri = params.redirect_uri;
  if (!redirectUri) {
    // redirect_uri 未指定で登録が1件のみなら省略可
    if (client.redirectUris.length === 1) {
      redirectUri = client.redirectUris[0];
    } else {
      return c.json(
        { error: "invalid_request", error_description: "redirect_uri is required" },
        400,
      );
    }
  }
  if (!client.redirectUris.includes(redirectUri)) {
    // リダイレクト先が不正なのでリダイレクトせずエラーを返す
    return c.json(
      {
        error: "invalid_request",
        error_description: "redirect_uri does not match registered URIs",
      },
      400,
    );
  }

  // ここからはエラー時 redirect_uri にリダイレクト可能
  const errorRedirect = (error: string, description: string) => {
    const url = new URL(redirectUri);
    url.searchParams.set("error", error);
    url.searchParams.set("error_description", description);
    if (params.state) url.searchParams.set("state", params.state);
    return c.redirect(url.toString());
  };

  // 4. scope 検証: openid 必須
  const requestedScopes = params.scope.split(" ").filter(Boolean);
  if (!requestedScopes.includes("openid")) {
    return errorRedirect("invalid_scope", "scope must include openid");
  }
  // クライアントの許可スコープと照合
  const invalidScopes = requestedScopes.filter((s: string) => !client.allowedScopes.includes(s));
  if (invalidScopes.length > 0) {
    return errorRedirect("invalid_scope", `Unsupported scopes: ${invalidScopes.join(", ")}`);
  }

  // 5. PKCE 検証: S256 必須
  if (!params.code_challenge) {
    return errorRedirect("invalid_request", "code_challenge is required");
  }
  if (params.code_challenge_method !== "S256") {
    return errorRedirect("invalid_request", "Only code_challenge_method=S256 is supported");
  }

  // 6. OP セッション Cookie を確認
  const sessionId = getSessionCookie(c);
  let session = null;
  if (sessionId) {
    session = await db.query.opSessions.findFirst({
      where: eq(opSessions.id, sessionId),
    });
    // 期限切れチェック
    if (session && session.expiresAt < new Date()) {
      session = null;
    }
  }

  // prompt=none で未ログインなら即座にエラー
  if (params.prompt === "none" && !session) {
    return errorRedirect("login_required", "User is not authenticated");
  }

  // prompt=login なら再認証を強制
  if (params.prompt === "login") {
    session = null;
  }

  // 未ログイン → /login にリダイレクト
  if (!session) {
    const loginChallenge = await createLoginChallenge({
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

  // 7. max_age チェック
  if (params.max_age) {
    const maxAge = parseInt(params.max_age, 10);
    const sessionAge = Math.floor((Date.now() - session.createdAt.getTime()) / 1000);
    if (sessionAge > maxAge) {
      // 再認証が必要
      const loginChallenge = await createLoginChallenge({
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

  // 8. 同意確認: 対象スコープに未同意なら /consent にリダイレクト
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
    const consentChallenge = await createConsentChallenge({
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

  // 9. 全条件クリア: 認可コードを発行（既に同意済みの場合）
  const code = generateRandomString(32);
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10分

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
