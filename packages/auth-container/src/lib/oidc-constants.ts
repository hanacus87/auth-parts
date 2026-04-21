/**
 * OIDC サーバが公開するスコープ (OIDC Core §3.1.2.1)。
 * discovery / admin API / schema validation / DB デフォルトの全てがこの値を参照する。
 * `packages/auth-frontend/src/lib/oidc-constants.ts` のミラーと同期させること。
 */
export const SUPPORTED_SCOPES = ["openid", "profile", "email", "offline_access"] as const;

/** サポートする grant_type (RFC 6749 §4)。Authorization Code + Refresh のみ。 */
export const GRANT_TYPES = ["authorization_code", "refresh_token"] as const;

/** サポートする token_endpoint_auth_method (RFC 7591 §2)。 */
export const TOKEN_ENDPOINT_AUTH_METHODS = [
  "none",
  "client_secret_basic",
  "client_secret_post",
] as const;

export type Scope = (typeof SUPPORTED_SCOPES)[number];
export type GrantType = (typeof GRANT_TYPES)[number];
export type TokenEndpointAuthMethod = (typeof TOKEN_ENDPOINT_AUTH_METHODS)[number];
