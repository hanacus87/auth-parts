# OIDC Scratch Implementation

OpenID Connect Authorization Code Flow + PKCE をフルスクラッチで実装し、仕様を理解するためのプロジェクト。
2 種類のクライアントパターンで SSO (Single Sign-On) の挙動を確認できる:

- **demo-frontend-bff** (port 5173) → **demo-bff** (Bun BFF) 経由 → auth-container
  - confidential client + JWE Cookie ステートレス、`@auth-parts/auth-container-client` を使用
- **demo-frontend-spa** (port 5174) → **直接** auth-container
  - public client + PKCE (BCP for Browser-Based Apps)、`@auth-parts/auth-container-react` を使用

**Auth Server (auth-container)** は Cloudflare Workers + D1 に移行済み。UI は Vite + React SPA + Tailwind (ダークテーマ)。

## 技術スタック

| 項目                   | 技術                                                                                                                 |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------- |
| AuthContainer 実行環境 | Cloudflare Workers                                                                                                   |
| AuthContainer DB       | Cloudflare D1 (SQLite)                                                                                               |
| UI (AuthContainer)     | Vite + React + Tailwind v4                                                                                           |
| BFF 実行環境           | Bun                                                                                                                  |
| Web フレームワーク     | Hono                                                                                                                 |
| フロントエンド         | Vite + React                                                                                                         |
| JWT                    | jose (v5)                                                                                                            |
| ORM                    | Drizzle ORM                                                                                                          |
| パスワードハッシュ     | bcryptjs                                                                                                             |
| BFF セッション         | JWE Cookie (dir + A256GCM)、`@auth-parts/auth-container-client` に集約                                               |
| SPA 直結 OIDC          | Authorization Code + PKCE (public client)、`@auth-parts/auth-container-react`、メモリ token + top-level silent renew |
| パッケージ管理         | pnpm workspaces                                                                                                      |

## サービス構成

```mermaid
graph LR
  Browser["Browser"]
  FE["demo-frontend-bff (BFF 経由)<br/>:5173"]
  FE2["demo-frontend-spa (SPA 直結)<br/>:5174"]
  BFF["demo-bff (BFF App Server)<br/>Bun :3000"]
  Auth["Auth Server<br/>Workers :4000"]
  AuthUI["Auth Frontend<br/>Vite SPA (Static Assets)"]
  D1[("Cloudflare D1")]

  Browser -->|bff_session JWE| BFF
  Browser -->|op_session / admin_session| Auth
  Browser --> AuthUI
  FE -->|fetch| BFF
  FE2 -->|fetch /token /userinfo (CORS)| Auth
  BFF -->|POST /token, GET /userinfo| Auth
  Auth --> D1
  AuthUI -.|assets binding|.- Auth
```

| サービス          | ポート | 実行環境           | 役割                                                                    |
| ----------------- | ------ | ------------------ | ----------------------------------------------------------------------- |
| demo-frontend-bff | 5173   | Vite dev           | React SPA (BFF 経由)。トークンをブラウザに一切持たない                  |
| demo-frontend-spa | 5174   | Vite dev           | React SPA (auth-container と直接 OIDC、public client + PKCE)            |
| demo-bff          | 3000   | Bun                | BFF。OIDC フロー・セッション管理・トークン保持 (demo-frontend-bff 専用) |
| AuthContainer     | 4000   | Cloudflare Workers | OP + JSON API + Static Assets (React SPA)                               |
| Auth Frontend     | —      | (Static Assets)    | Vite 製 React SPA。login / consent / register / logout / admin          |
| D1                | —      | Cloudflare         | AuthContainer の永続化層 (users, admins, clients, トークン等)           |

## ディレクトリ構成

```
oidc-scratch/
├── package.json
├── pnpm-workspace.yaml
├── .github/workflows/deploy.yml     # AuthContainer CI/CD
└── packages/
    ├── auth-container-client/       # auth-container 専用 OIDC クライアント (BFF が import / confidential)
    ├── auth-container-react/        # auth-container 専用 SPA 直結 OIDC React クライアント (PKCE / public)
    ├── auth-container/              # Cloudflare Workers OP (AuthContainer)
    │   ├── wrangler.toml            # Workers 設定 (D1 / Assets binding)
    │   ├── drizzle/                 # D1 migration + seed.sql
    │   ├── scripts/gen-seed-hash.ts # bcryptjs ハッシュ生成ヘルパ
    │   └── src/
    │       ├── index.ts             # Workers entry (Hono + SPA fallback)
    │       ├── types.ts             # Bindings / Variables
    │       ├── db/
    │       │   ├── schema.ts        # SQLite dialect + JSON mode
    │       │   └── index.ts         # createDb(d1)
    │       ├── lib/                 # jwt / password(bcryptjs) / pkce / session / csrf / ...
    │       ├── routes/              # OIDC プロトコル (discovery / jwks / authorize / token / userinfo)
    │       └── api/                 # SPA 向け JSON API (login / consent / logout / admin/*)
    │
    ├── auth-frontend/               # Vite + React SPA (ダークテーマ)
    │   ├── vite.config.ts           # outDir → auth-container/dist-assets
    │   └── src/
    │       ├── main.tsx
    │       ├── routes.tsx
    │       ├── styles.css           # Tailwind v4 エントリ
    │       ├── lib/                 # api.ts / scope-labels.ts
    │       ├── components/          # Button / Input / Alert / Layout / AdminLayout
    │       └── pages/
    │           ├── Login / Register / Consent / Logout / NotFound
    │           └── admin/           # AdminLogin / AdminDashboard / UsersList / UserForm / ClientsList / ClientForm
    │
    ├── demo-bff/                    # BFF (Bun)。auth-container-client を組み込むだけの薄い実装
    │   └── src/index.ts             # /auth/* (login/callback/status), /api/me
    ├── demo-frontend-bff/           # React SPA (Vite dev、BFF パターン)
    └── demo-frontend-spa/           # React SPA (auth-container-react で SPA 直結 OIDC)
```

## Auth Server エンドポイント

### OIDC プロトコル (契約不変)

| メソッド  | パス                                | 概要                                             |
| --------- | ----------------------------------- | ------------------------------------------------ |
| GET       | `/.well-known/openid-configuration` | プロバイダメタデータ                             |
| GET       | `/jwks.json`                        | RS256 公開鍵 (JWK Set)                           |
| GET\|POST | `/authorize`                        | 認可エンドポイント                               |
| POST      | `/token`                            | トークン発行 (authorization_code, refresh_token) |
| GET\|POST | `/userinfo`                         | ユーザー情報 (Bearer Token 必須)                 |

### SPA 配信 (Static Assets)

| パス        | 概要                         |
| ----------- | ---------------------------- |
| `/login`    | ログイン画面 (React SPA)     |
| `/register` | 新規登録画面                 |
| `/consent`  | 同意画面                     |
| `/logout`   | ログアウト確認画面           |
| `/admin/*`  | 管理画面 (要 admin ログイン) |

### SPA 向け JSON API

| メソッド | パス                    | 概要                                                           |
| -------- | ----------------------- | -------------------------------------------------------------- |
| GET      | `/api/login/context`    | login_challenge 検証                                           |
| POST     | `/api/login`            | ログイン (→ redirectUrl を JSON で返却)                        |
| GET      | `/api/register/context` | 登録画面用 context                                             |
| POST     | `/api/register`         | 新規登録                                                       |
| GET      | `/api/consent/context`  | consent_challenge + session_id バインディング検証              |
| POST     | `/api/consent`          | 同意 / 拒否                                                    |
| GET      | `/api/logout/context`   | ログアウト画面 context + CSRF token                            |
| POST     | `/api/logout`           | ログアウト実行 (CSRF 必須) + BCL 送信                          |
| POST     | `/api/admin/login`      | 管理者ログイン                                                 |
| POST     | `/api/admin/logout`     | 管理者ログアウト (CSRF 必須)                                   |
| GET      | `/api/admin/session`    | 管理者情報 + CSRF token                                        |
| GET/POST | `/api/admin/users`      | ユーザー CRUD (`:id` / `:id/delete`)                           |
| GET/POST | `/api/admin/clients`    | クライアント CRUD (`:id` / `:id/delete` / `:id/rotate-secret`) |

### demo-bff (:3000) — Bun

`@auth-parts/auth-container-client` の Hono アダプタが提供する 3 ルートと、
BFF 個別実装の `/api/me` (UserInfo プロキシ) のみ。

| メソッド | パス             | 概要                                                                                         |
| -------- | ---------------- | -------------------------------------------------------------------------------------------- |
| GET      | `/auth/login`    | 302 → `/authorize`。`oauth_pending` JWE Cookie 発行                                          |
| GET      | `/auth/callback` | code → token 交換 → id_token 検証 → 302 → 成功/失敗用 redirect URL。`bff_session` JWE Cookie |
| GET      | `/auth/status`   | 200 JSON `{ loggedIn, user? }` (リフレッシュ時のみ Set-Cookie)                               |
| GET      | `/api/me`        | UserInfo 経由でユーザー情報取得 (401 検知時はセッションクリア)                               |

> v0.1 では RP-Initiated Logout / Back-Channel Logout は提供していない (ステートレス設計上 BCL は原理的に成立不可)。

### demo-frontend-spa (:5174) — SPA 直結

`@auth-parts/auth-container-react` を使い、ブラウザから直接 auth-container と OIDC を実行する。BFF を経由しない。

- `clientId`: `frontend-sub-spa` (public client、`token_endpoint_auth_method=none`)
- Token はメモリのみ保管、ページリロード時は top-level redirect で `prompt=none` の silent renew を試行
- `offline_access` / `refresh_token` は使わない (auth-container 側で public client への発行を禁止)

## セットアップ

### 前提条件

- [Bun](https://bun.sh/) (v1.1+)
- [pnpm](https://pnpm.io/) (v10+)
- [Wrangler](https://developers.cloudflare.com/workers/wrangler/) (AuthContainer 用、`pnpm install` で同梱)
- Node.js 24+ (auth-container-client パッケージのエンジン要件)

### 手順

```bash
# 1. 依存パッケージ
pnpm install

# 2. BFF / Frontend の .env をコピー
cp packages/demo-bff/.env.example packages/demo-bff/.env
cp packages/demo-frontend-bff/.env.example packages/demo-frontend-bff/.env
cp packages/demo-frontend-spa/.env.example packages/demo-frontend-spa/.env

# 3. BFF の COOKIE_KEYS (JWE Cookie 鍵) を生成して .env に設定
#    demo-bff/.env の COOKIE_KEYS= に貼る
openssl rand -base64 32

# 4. AuthContainer のローカル secret を設定
cp packages/auth-container/.dev.vars.example packages/auth-container/.dev.vars
#   SESSION_SECRET と ENVIRONMENT=development が入る

# 5. AuthContainer のローカル D1 を初期化
pnpm db:migrate:local    # drizzle/0000_init.sql を適用
pnpm db:seed:local       # クライアント・テストユーザー・管理者を INSERT

# 5b. 既存 D1 にカラム追加マイグレーション (新規セットアップ時は db:reset:local で済むので不要)
pnpm --filter auth-container exec wrangler d1 execute DB --local \
  --file=./drizzle/0001_add_allowed_cors_origins.sql

# 6. サーバー起動 (ターミナル 5 枚)
pnpm dev:auth-frontend   # Vite watch ビルド → auth-container/dist-assets
pnpm dev:auth            # Wrangler dev (Workers エミュレータ) :4000
pnpm dev:bff             # BFF (Bun) :3000
pnpm dev:frontend-bff    # React :5173 (BFF パターン)
pnpm dev:frontend-spa    # React :5174 (SPA 直結)
```

> auth-container-client は `ISSUER` を `https://auth-container.hanacus87.net` に固定して埋め込んでいる。
> 本番 OP に向けて起動する想定。ローカル `localhost:4000` の auth-container を相手にしたい場合は
> hosts ファイルや DNS で `auth-container.hanacus87.net` をローカルに向ける運用とする
> (ライブラリ側は dev エンドポイントを提供しない方針)。

### 本番デプロイ (Cloudflare)

```bash
# 初回のみ
wrangler d1 create auth-container-prod           # 出力された database_id を wrangler.toml に貼る
wrangler secret put SESSION_SECRET --config packages/auth-container/wrangler.toml
wrangler d1 execute DB --remote --file=packages/auth-container/drizzle/seed.sql

# スキーマ変更時 (本番 D1 に列追加)
wrangler d1 execute DB --remote --file=packages/auth-container/drizzle/0001_add_allowed_cors_origins.sql

# 日常 (main push で GitHub Actions が自動実行)
pnpm deploy:auth-container  # auth-frontend build → wrangler deploy
```

### CORS 許可 origin (per-client)

CORS 許可 origin はコード上の配列ではなく、**admin 画面で per-client に設定** する仕組み。

- 公開クライアント (`token_endpoint_auth_method=none` / SPA): 「許可する Web Origin (CORS)」欄が表示され、最低 1 件入力必須
- 機密クライアント (BFF / `client_secret_basic` 等): 欄非表示、サーバ側で `[]` 強制 (server-to-server 通信で CORS 不要)

新しい SPA を追加するときは admin 画面でクライアントを登録するだけで CORS も自動で許可される (auth-container 再デプロイ不要)。

### コード整形・型チェック

```bash
pnpm format
pnpm --filter auth-container exec tsc --noEmit
pnpm --filter auth-frontend exec tsc -b --noEmit
```

## 動作確認

1. `http://localhost:5173` (BFF パターン) → Login → ログイン画面 → 同意 → Dashboard
2. `http://localhost:5174` (SPA 直結) → 起動時に top-level redirect で `/authorize?prompt=none` を試行
   - 1 で既にログイン済み → 一瞬 redirect して即 Dashboard (SSO 成立)
   - 未ログイン → `error=login_required` で戻り、Login ボタン表示
3. SPA 直結で Login → 通常の `/authorize` → ログイン画面 → 同意 → Dashboard
4. SPA 直結で Logout → `/logout` (RP-Initiated Logout) → 確認画面 → ホームに戻る
5. `http://localhost:4000/admin/login` で管理画面ログイン (admin@example.com / admin123) → ユーザー/クライアント CRUD
6. クライアント新規作成時、認証方式 dropdown を `none` に切り替えた瞬間に `offline_access` / `refresh_token` チップが表示から消えることを確認 (UI レベルの整合)
7. DevTools で `bff_session` (BFF パターン), `op_session`, `admin_session` が HttpOnly であること確認。SPA 直結側は `localStorage` / `sessionStorage` に access_token / id_token が **入っていない** ことを確認 (memory のみ)
8. SPA 直結でリロード → top-level silent renew でログイン状態が即座に復元されることを確認

## CI/CD

`.github/workflows/deploy.yml`:

- PR: type-check + Vite build + wrangler deploy --dry-run
- main push: D1 migration apply + Vite build + wrangler deploy

必要な Secrets:

- `CLOUDFLARE_API_TOKEN` — Workers + D1 の書き込み権限
- `CLOUDFLARE_ACCOUNT_ID`

## 参照仕様

| 仕様                                                                                                          | 内容                                         |
| ------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| [RFC 6749](https://datatracker.ietf.org/doc/html/rfc6749)                                                     | OAuth 2.0 Authorization Framework            |
| [RFC 7636](https://datatracker.ietf.org/doc/html/rfc7636)                                                     | PKCE                                         |
| [RFC 7519](https://datatracker.ietf.org/doc/html/rfc7519)                                                     | JWT                                          |
| [RFC 7517](https://datatracker.ietf.org/doc/html/rfc7517)                                                     | JWK                                          |
| [RFC 6750](https://datatracker.ietf.org/doc/html/rfc6750)                                                     | Bearer Token Usage                           |
| [RFC 9068](https://datatracker.ietf.org/doc/html/rfc9068)                                                     | JWT Profile for OAuth 2.0 Access Tokens      |
| [RFC 9700](https://datatracker.ietf.org/doc/html/rfc9700)                                                     | Best Current Practice for OAuth 2.0 Security |
| [RFC 7591](https://datatracker.ietf.org/doc/html/rfc7591)                                                     | Dynamic Client Registration                  |
| [OIDC Core 1.0](https://openid.net/specs/openid-connect-core-1_0.html)                                        | OpenID Connect Core                          |
| [OIDC Discovery 1.0](https://openid.net/specs/openid-connect-discovery-1_0.html)                              | OpenID Connect Discovery                     |
| [OIDC RP-Initiated Logout](https://openid.net/specs/openid-connect-rpinitiated-1_0.html)                      | RP-Initiated Logout                          |
| [OIDC Back-Channel Logout 1.0](https://openid.net/specs/openid-connect-backchannel-1_0.html)                  | Back-Channel Logout                          |
| [OAuth 2.0 for Browser-Based Apps](https://datatracker.ietf.org/doc/html/draft-ietf-oauth-browser-based-apps) | BFF パターン推奨 (BCP 212)                   |
