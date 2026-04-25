-- Seed data (idempotent)
-- password_hash は Web Crypto PBKDF2 (SHA-256, 100000 iter) で事前計算した値
-- Cloudflare Workers の Web Crypto 上限 100000 に合わせる
-- 形式: pbkdf2$<iter>$<salt_b64>$<key_b64>
-- 運用者がパスワードを変更したい場合は `bun run scripts/gen-seed-hash.ts <新パス>` で再生成し貼り直す。

-- BFF App Server
INSERT OR IGNORE INTO clients (
  id, secret, name,
  redirect_uris, allowed_scopes, token_endpoint_auth_method, allowed_grant_types,
  backchannel_logout_uri, post_logout_redirect_uris, allowed_cors_origins,
  created_by_admin_id, created_at
) VALUES (
  'bff-app', 'bff-app-secret', 'BFF App Server',
  '["http://localhost:3000/auth/callback"]',
  '["openid","profile","email","offline_access"]',
  'client_secret_basic',
  '["authorization_code","refresh_token"]',
  NULL,
  '["http://localhost:5173"]',
  '[]',
  '01HSEEDADMINXXXXXXXXXXXXXXX',
  unixepoch() * 1000
);

-- Frontend SPA (public client)
-- auth-container-react で SPA から直接 OIDC を実行する。
-- BCP for Browser-Based Apps §6.2 に従い offline_access / refresh_token は許可しない。
INSERT OR IGNORE INTO clients (
  id, secret, name,
  redirect_uris, allowed_scopes, token_endpoint_auth_method, allowed_grant_types,
  backchannel_logout_uri, post_logout_redirect_uris, allowed_cors_origins,
  created_by_admin_id, created_at
) VALUES (
  'frontend-spa', NULL, 'Frontend SPA',
  '["http://localhost:5174/callback"]',
  '["openid","profile","email"]',
  'none',
  '["authorization_code"]',
  NULL,
  '["http://localhost:5174"]',
  '["http://localhost:5174"]',
  '01HSEEDADMINXXXXXXXXXXXXXXX',
  unixepoch() * 1000
);

-- テストユーザー (password123, email 確認済み)
INSERT OR IGNORE INTO users (
  id, email, password_hash, name, given_name, family_name, email_verified, created_at, updated_at
) VALUES (
  '01HSEEDUSERTESTXXXXXXXXXXXX',
  'test@example.com',
  'pbkdf2$100000$sZG3D2wGyrSMcJt5Xu9HrQ==$49xIM7OieB1vwKcpkgQAqzgJy7qZn/2eHbm2AtdBs24=',
  'Test User',
  'Test',
  'User',
  1,
  unixepoch() * 1000,
  unixepoch() * 1000
);

-- 管理者 (初期 SuperAdmin。admin123, email 確認済み)
INSERT OR IGNORE INTO admins (
  id, email, password_hash, name, role, email_verified, created_at, updated_at
) VALUES (
  '01HSEEDADMINXXXXXXXXXXXXXXX',
  'admin@example.com',
  'pbkdf2$100000$/6lgSQ/MB/ri3Pb4ej62Cg==$IKi8o7jMatheeRS8zYYc+A19uaqKyQ9eZWxN/ED2qJQ=',
  'Admin',
  'super',
  1,
  unixepoch() * 1000,
  unixepoch() * 1000
);
