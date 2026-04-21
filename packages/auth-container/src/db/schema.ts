import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

export {
  SUPPORTED_SCOPES,
  GRANT_TYPES,
  TOKEN_ENDPOINT_AUTH_METHODS,
  type Scope,
  type GrantType,
  type TokenEndpointAuthMethod,
} from "../lib/oidc-constants";

import { ADMIN_ROLES } from "../lib/admin-constants";
export { ADMIN_ROLES, type AdminRole } from "../lib/admin-constants";

/** 一般ユーザー。`emailVerified` は OIDC Core §5.1 の email_verified クレームに対応。 */
export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  name: text("name").notNull(),
  givenName: text("given_name"),
  familyName: text("family_name"),
  emailVerified: integer("email_verified", { mode: "boolean" }).notNull().default(false),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
});

/** メール確認トークン。1 ユーザーに複数併存可、期限切れは自然消滅。 */
export const emailVerificationTokens = sqliteTable("email_verification_tokens", {
  token: text("token").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id),
  expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
});

/**
 * OIDC / OAuth2 クライアント登録。
 * `tokenEndpointAuthMethod` は RFC 7591 §2 に従う ("none" | "client_secret_basic" | "client_secret_post")。
 * `backchannelLogoutUri` は OIDC Back-Channel Logout 1.0、`postLogoutRedirectUris` は
 * OIDC RP-Initiated Logout 1.0 §2 で事前登録必須。
 * `createdByAdminId` が NULL のものは system-owned で SuperAdmin 専有、Admin は自分の id で作成したものだけ操作可。
 */
export const clients = sqliteTable("clients", {
  id: text("id").primaryKey(),
  secret: text("secret"),
  name: text("name").notNull(),
  redirectUris: text("redirect_uris", { mode: "json" }).$type<string[]>().notNull(),
  allowedScopes: text("allowed_scopes", { mode: "json" }).$type<string[]>().notNull(),
  tokenEndpointAuthMethod: text("token_endpoint_auth_method")
    .notNull()
    .default("client_secret_basic"),
  allowedGrantTypes: text("allowed_grant_types", { mode: "json" })
    .$type<string[]>()
    .notNull()
    .default(sql`'["authorization_code","refresh_token"]'`),
  backchannelLogoutUri: text("backchannel_logout_uri"),
  postLogoutRedirectUris: text("post_logout_redirect_uris", { mode: "json" })
    .$type<string[]>()
    .notNull()
    .default(sql`'[]'`),
  createdByAdminId: text("created_by_admin_id"),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
});

/**
 * 認可コード (RFC 6749 §4.1.2, RFC 7636 §4.5)。1 回のみ使用可能で `used` で消費管理。
 * `codeChallenge`/`codeChallengeMethod` は PKCE (RFC 7636)、`nonce`/`authTime`/`sessionId` は
 * ID Token (OIDC Core §3.1.2.1) 発行に利用する。
 */
export const authorizationCodes = sqliteTable("authorization_codes", {
  code: text("code").primaryKey(),
  clientId: text("client_id")
    .notNull()
    .references(() => clients.id),
  userId: text("user_id")
    .notNull()
    .references(() => users.id),
  redirectUri: text("redirect_uri").notNull(),
  scopes: text("scopes", { mode: "json" }).$type<string[]>().notNull(),
  codeChallenge: text("code_challenge").notNull(),
  codeChallengeMethod: text("code_challenge_method").notNull().default("S256"),
  nonce: text("nonce"),
  authTime: integer("auth_time", { mode: "timestamp_ms" }),
  sessionId: text("session_id"),
  expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
  used: integer("used", { mode: "boolean" }).notNull().default(false),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
});

/**
 * アクセストークン (RFC 6749 §1.4, RFC 6750, RFC 9068)。
 * `authCodeId` は RFC 9700 §4.14 の再利用検知時に family 単位で revoke するための紐付け。
 */
export const accessTokens = sqliteTable("access_tokens", {
  token: text("token").primaryKey(),
  jti: text("jti").notNull().unique(),
  clientId: text("client_id")
    .notNull()
    .references(() => clients.id),
  userId: text("user_id")
    .notNull()
    .references(() => users.id),
  authCodeId: text("auth_code_id"),
  scopes: text("scopes", { mode: "json" }).$type<string[]>().notNull(),
  expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
  revoked: integer("revoked", { mode: "boolean" }).notNull().default(false),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
});

/**
 * リフレッシュトークン (RFC 6749 §6, OIDC Core §12, RFC 9700 §4.14)。
 * `authTime`/`sessionId` は OIDC Core §12.2 / Back-Channel Logout §2.1 に基づき
 * refresh で再発行する ID Token に引き継ぐ。`replacedBy` で rotation チェーンを追跡する。
 */
export const refreshTokens = sqliteTable("refresh_tokens", {
  token: text("token").primaryKey(),
  clientId: text("client_id")
    .notNull()
    .references(() => clients.id),
  userId: text("user_id")
    .notNull()
    .references(() => users.id),
  scopes: text("scopes", { mode: "json" }).$type<string[]>().notNull(),
  authTime: integer("auth_time", { mode: "timestamp_ms" }),
  sessionId: text("session_id"),
  authCodeId: text("auth_code_id"),
  expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
  revoked: integer("revoked", { mode: "boolean" }).notNull().default(false),
  replacedBy: text("replaced_by"),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
});

/** OP 側ログインセッション。認可コードフロー中のユーザー識別に使用する。 */
export const opSessions = sqliteTable("op_sessions", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id),
  expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
});

/** ユーザーがクライアントに付与したスコープ同意記録。 */
export const consents = sqliteTable("consents", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id),
  clientId: text("client_id")
    .notNull()
    .references(() => clients.id),
  scopes: text("scopes", { mode: "json" }).$type<string[]>().notNull(),
  grantedAt: integer("granted_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
});

/**
 * 管理画面専用アカウント (一般ユーザーの `users` とは独立)。
 * `role="super"` は全権限、`"admin"` は自分が作った clients のみ操作可。
 * `emailVerified` は招待リンク経由の初期パスワード設定 / forgot-password 経由のリセット成功で true 化する。
 */
export const admins = sqliteTable("admins", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  name: text("name").notNull(),
  role: text("role", { enum: ADMIN_ROLES }).notNull().default("admin"),
  emailVerified: integer("email_verified", { mode: "boolean" }).notNull().default(false),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
});

/** 管理者ログインセッション。 */
export const adminSessions = sqliteTable("admin_sessions", {
  id: text("id").primaryKey(),
  adminId: text("admin_id")
    .notNull()
    .references(() => admins.id),
  expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
});

/** ユーザー向けパスワードリセットトークン (TTL 15 分)。 */
export const passwordResetTokens = sqliteTable("password_reset_tokens", {
  token: text("token").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id),
  expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
});

/** 管理者向けパスワードリセットトークン (TTL 15 分)。 */
export const adminPasswordResetTokens = sqliteTable("admin_password_reset_tokens", {
  token: text("token").primaryKey(),
  adminId: text("admin_id")
    .notNull()
    .references(() => admins.id),
  expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
});

/** JWT 署名用 RSA 鍵 (kid 別)。起動時に D1 からロードし、未存在なら生成して INSERT する。 */
export const cryptoKeys = sqliteTable("crypto_keys", {
  kid: text("kid").primaryKey(),
  alg: text("alg").notNull().default("RS256"),
  publicKeyPem: text("public_key_pem").notNull(),
  privateKeyPem: text("private_key_pem").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
});
