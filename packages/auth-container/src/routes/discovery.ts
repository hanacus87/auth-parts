import { Hono } from "hono";
import type { AppEnv } from "../types";
import { SUPPORTED_SCOPES, GRANT_TYPES, TOKEN_ENDPOINT_AUTH_METHODS } from "../lib/oidc-constants";

export const discoveryRouter = new Hono<AppEnv>();

/**
 * OpenID Provider Discovery (OIDC Discovery 1.0 §3)。
 * サーバのエンドポイントと対応機能を広告する。
 */
discoveryRouter.get("/.well-known/openid-configuration", (c) => {
  const issuer = c.env.ISSUER;

  return c.json({
    issuer,
    authorization_endpoint: `${issuer}/authorize`,
    token_endpoint: `${issuer}/token`,
    userinfo_endpoint: `${issuer}/userinfo`,
    jwks_uri: `${issuer}/jwks.json`,
    end_session_endpoint: `${issuer}/logout`,
    response_types_supported: ["code"],
    response_modes_supported: ["query"],
    grant_types_supported: GRANT_TYPES,
    subject_types_supported: ["public"],
    id_token_signing_alg_values_supported: ["RS256"],
    scopes_supported: SUPPORTED_SCOPES,
    token_endpoint_auth_methods_supported: TOKEN_ENDPOINT_AUTH_METHODS,
    claims_supported: [
      "sub",
      "iss",
      "aud",
      "exp",
      "iat",
      "auth_time",
      "nonce",
      "name",
      "given_name",
      "family_name",
      "email",
      "email_verified",
    ],
    code_challenge_methods_supported: ["S256"],
    backchannel_logout_supported: true,
    backchannel_logout_session_supported: true,
    frontchannel_logout_supported: false,
  });
});
