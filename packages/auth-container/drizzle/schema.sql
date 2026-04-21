-- auth-container 全テーブル定義（単一スキーマファイル）
-- 冪等: DROP IF EXISTS → CREATE で何度流しても同じ状態になる。
-- 新規テーブル／カラム追加時はこのファイルに直接追記すること。
-- 適用: `pnpm run db:reset:local` / `db:reset:remote`（本番 remote は全データ消去）

-- 子テーブルから先に DROP（外部キー制約を避けるため）
DROP TABLE IF EXISTS `admin_password_reset_tokens`;
DROP TABLE IF EXISTS `password_reset_tokens`;
DROP TABLE IF EXISTS `email_verification_tokens`;
DROP TABLE IF EXISTS `admin_sessions`;
DROP TABLE IF EXISTS `consents`;
DROP TABLE IF EXISTS `op_sessions`;
DROP TABLE IF EXISTS `refresh_tokens`;
DROP TABLE IF EXISTS `access_tokens`;
DROP TABLE IF EXISTS `authorization_codes`;
DROP TABLE IF EXISTS `crypto_keys`;
DROP TABLE IF EXISTS `clients`;
DROP TABLE IF EXISTS `admins`;
DROP TABLE IF EXISTS `users`;

-- users
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`password_hash` text NOT NULL,
	`name` text NOT NULL,
	`given_name` text,
	`family_name` text,
	`email_verified` integer DEFAULT false NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);

-- admins
CREATE TABLE `admins` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`password_hash` text NOT NULL,
	`name` text NOT NULL,
	`role` text DEFAULT 'admin' NOT NULL,
	`email_verified` integer DEFAULT false NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
CREATE UNIQUE INDEX `admins_email_unique` ON `admins` (`email`);

-- clients
CREATE TABLE `clients` (
	`id` text PRIMARY KEY NOT NULL,
	`secret` text,
	`name` text NOT NULL,
	`redirect_uris` text NOT NULL,
	`allowed_scopes` text NOT NULL,
	`token_endpoint_auth_method` text DEFAULT 'client_secret_basic' NOT NULL,
	`allowed_grant_types` text DEFAULT '["authorization_code","refresh_token"]' NOT NULL,
	`backchannel_logout_uri` text,
	`post_logout_redirect_uris` text DEFAULT '[]' NOT NULL,
	`created_by_admin_id` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);

-- crypto_keys
CREATE TABLE `crypto_keys` (
	`kid` text PRIMARY KEY NOT NULL,
	`alg` text DEFAULT 'RS256' NOT NULL,
	`public_key_pem` text NOT NULL,
	`private_key_pem` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);

-- authorization_codes
CREATE TABLE `authorization_codes` (
	`code` text PRIMARY KEY NOT NULL,
	`client_id` text NOT NULL,
	`user_id` text NOT NULL,
	`redirect_uri` text NOT NULL,
	`scopes` text NOT NULL,
	`code_challenge` text NOT NULL,
	`code_challenge_method` text DEFAULT 'S256' NOT NULL,
	`nonce` text,
	`auth_time` integer,
	`session_id` text,
	`expires_at` integer NOT NULL,
	`used` integer DEFAULT false NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);

-- access_tokens
CREATE TABLE `access_tokens` (
	`token` text PRIMARY KEY NOT NULL,
	`jti` text NOT NULL,
	`client_id` text NOT NULL,
	`user_id` text NOT NULL,
	`auth_code_id` text,
	`scopes` text NOT NULL,
	`expires_at` integer NOT NULL,
	`revoked` integer DEFAULT false NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
CREATE UNIQUE INDEX `access_tokens_jti_unique` ON `access_tokens` (`jti`);

-- refresh_tokens
CREATE TABLE `refresh_tokens` (
	`token` text PRIMARY KEY NOT NULL,
	`client_id` text NOT NULL,
	`user_id` text NOT NULL,
	`scopes` text NOT NULL,
	`auth_time` integer,
	`session_id` text,
	`auth_code_id` text,
	`expires_at` integer NOT NULL,
	`revoked` integer DEFAULT false NOT NULL,
	`replaced_by` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);

-- op_sessions
CREATE TABLE `op_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);

-- consents
CREATE TABLE `consents` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`client_id` text NOT NULL,
	`scopes` text NOT NULL,
	`granted_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON UPDATE no action ON DELETE no action
);

-- admin_sessions
CREATE TABLE `admin_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`admin_id` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`admin_id`) REFERENCES `admins`(`id`) ON UPDATE no action ON DELETE no action
);

-- email_verification_tokens
CREATE TABLE `email_verification_tokens` (
	`token` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);

-- password_reset_tokens
CREATE TABLE `password_reset_tokens` (
	`token` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);

-- admin_password_reset_tokens
CREATE TABLE `admin_password_reset_tokens` (
	`token` text PRIMARY KEY NOT NULL,
	`admin_id` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`admin_id`) REFERENCES `admins`(`id`) ON UPDATE no action ON DELETE no action
);
