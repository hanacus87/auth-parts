import { pgTable, text, timestamp, boolean } from "drizzle-orm/pg-core";

// ── ユーザー ──────────────────────────────────────────────
export const users = pgTable("users", {
  id: text("id").primaryKey(), // ULID
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(), // bcrypt
  name: text("name").notNull(),
  givenName: text("given_name"),
  familyName: text("family_name"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// ── OIDCクライアント（RP 登録情報） ──────────────────────────
export const clients = pgTable("clients", {
  id: text("id").primaryKey(), // client_id
  secret: text("secret"), // null = public client
  name: text("name").notNull(),
  redirectUris: text("redirect_uris").array().notNull(),
  allowedScopes: text("allowed_scopes").array().notNull(),
  // RFC 7591 §2: "none" | "client_secret_basic" | "client_secret_post"
  tokenEndpointAuthMethod: text("token_endpoint_auth_method")
    .notNull()
    .default("client_secret_basic"),
  // Authorization Code Flow のみサポート
  allowedGrantTypes: text("allowed_grant_types")
    .array()
    .notNull()
    .default(["authorization_code", "refresh_token"]),
  // OIDC Back-Channel Logout 1.0: ログアウト通知先 URI
  backchannelLogoutUri: text("backchannel_logout_uri"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// ── 認可コード ─────────────────────────────────────────────
// RFC 6749 §4.1.2 / RFC 7636 §4.5
export const authorizationCodes = pgTable("authorization_codes", {
  code: text("code").primaryKey(),
  clientId: text("client_id")
    .notNull()
    .references(() => clients.id),
  userId: text("user_id")
    .notNull()
    .references(() => users.id),
  redirectUri: text("redirect_uri").notNull(),
  scopes: text("scopes").array().notNull(),
  // PKCE (RFC 7636)
  codeChallenge: text("code_challenge").notNull(),
  codeChallengeMethod: text("code_challenge_method").notNull().default("S256"),
  // OIDC Core §3.1.2.1
  nonce: text("nonce"),
  // auth_time: ユーザーが認証した時刻 (Unix timestamp)
  authTime: timestamp("auth_time"),
  // OP セッション ID (ID Token の sid クレーム用)
  sessionId: text("session_id"),
  // RFC 6749: 認可コードの有効期限は最大10分 (§4.1.2)
  expiresAt: timestamp("expires_at").notNull(),
  // RFC 6749: 認可コードは1回のみ使用可能 (§4.1.2)
  used: boolean("used").default(false).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// ── アクセストークン ───────────────────────────────────────
// RFC 6749 §1.4 / RFC 6750
export const accessTokens = pgTable("access_tokens", {
  token: text("token").primaryKey(), // JWT (RS256)
  jti: text("jti").notNull().unique(), // JWT ID (RFC 7519 §4.1.7)
  clientId: text("client_id")
    .notNull()
    .references(() => clients.id),
  userId: text("user_id")
    .notNull()
    .references(() => users.id),
  scopes: text("scopes").array().notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  revoked: boolean("revoked").default(false).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// ── リフレッシュトークン ───────────────────────────────────
// RFC 6749 §6 / OIDC Core §12
export const refreshTokens = pgTable("refresh_tokens", {
  token: text("token").primaryKey(), // opaque (crypto random)
  clientId: text("client_id")
    .notNull()
    .references(() => clients.id),
  userId: text("user_id")
    .notNull()
    .references(() => users.id),
  scopes: text("scopes").array().notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  revoked: boolean("revoked").default(false).notNull(),
  // Refresh Token Rotation: 使用済みトークンを追跡
  replacedBy: text("replaced_by"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// ── OP セッション（認可サーバー側のログインセッション）──────
// ブラウザ → 認可サーバー間のセッション（Cookie で管理）
export const opSessions = pgTable("op_sessions", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// ── スコープ同意 ───────────────────────────────────────────
export const consents = pgTable("consents", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id),
  clientId: text("client_id")
    .notNull()
    .references(() => clients.id),
  scopes: text("scopes").array().notNull(),
  grantedAt: timestamp("granted_at").defaultNow().notNull(),
});
