import { Hono } from "hono";

export const discoveryRouter = new Hono();

discoveryRouter.get("/.well-known/openid-configuration", (c) => {
  const issuer = process.env.ISSUER!;

  return c.json({
    issuer,
    authorization_endpoint: `${issuer}/authorize`,
    token_endpoint: `${issuer}/token`,
    userinfo_endpoint: `${issuer}/userinfo`,
    jwks_uri: `${issuer}/jwks.json`,
    end_session_endpoint: `${issuer}/logout`,
    response_types_supported: ["code"],
    response_modes_supported: ["query"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    subject_types_supported: ["public"],
    id_token_signing_alg_values_supported: ["RS256"],
    scopes_supported: ["openid", "profile", "email", "offline_access"],
    token_endpoint_auth_methods_supported: ["client_secret_basic", "none"],
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
  });
});
