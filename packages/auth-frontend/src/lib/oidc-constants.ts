/**
 * OIDC サーバが公開するスコープ (OIDC Core §3.1.2.1)。
 * 同期: packages/auth-container/src/lib/oidc-constants.ts と常にミラーさせること。
 */
export const SUPPORTED_SCOPES = ["openid", "profile", "email", "offline_access"] as const;

/**
 * サポートする grant_type (RFC 6749 §4)。
 * 同期: auth-container 側の GRANT_TYPES と一致させる。
 */
export const GRANT_TYPES = ["authorization_code", "refresh_token"] as const;

/**
 * サポートする token_endpoint_auth_method (RFC 7591 §2)。
 * 同期: auth-container 側の TOKEN_ENDPOINT_AUTH_METHODS と一致させる。
 */
export const TOKEN_ENDPOINT_AUTH_METHODS = [
  "none",
  "client_secret_basic",
  "client_secret_post",
] as const;

export type Scope = (typeof SUPPORTED_SCOPES)[number];
export type GrantType = (typeof GRANT_TYPES)[number];
export type TokenEndpointAuthMethod = (typeof TOKEN_ENDPOINT_AUTH_METHODS)[number];
