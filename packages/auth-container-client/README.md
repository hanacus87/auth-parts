# @auth-parts/auth-container-client

`auth-container` 専用の confidential OIDC クライアントライブラリ。BFF パターン (Authorization Code + PKCE / JWE Cookie ステートレスセッション / Hono アダプタ) を提供する。

> 全体俯瞰・BFF と SPA 直結の比較・設計判断は [ルート README](../../README.md) を参照。

## インストール

モノレポ内ワークスペース:

```jsonc
{
  "dependencies": {
    "@auth-parts/auth-container-client": "workspace:*",
  },
}
```

## 使い方

最小の BFF 実装 (Bun + Hono を想定):

```ts
import { AuthContainerClient } from "@auth-parts/auth-container-client";
import {
  applySetCookies,
  createHonoOidcRoutes,
  honoSessionMiddleware,
  type HonoOidcVariables,
} from "@auth-parts/auth-container-client/adapters/hono";
import { Hono } from "hono";

const encryptionKeys = process.env
  .COOKIE_KEYS!.split(",")
  .map((b64) => new Uint8Array(Buffer.from(b64, "base64")));

const oidc = new AuthContainerClient({
  clientId: process.env.CLIENT_ID!,
  clientSecret: process.env.CLIENT_SECRET!,
  redirectUri: process.env.REDIRECT_URI!,
  encryptionKeys,
});

const app = new Hono();

// /auth/login, /auth/callback, /auth/status, /auth/logout の 4 ルートを mount
app.route(
  "/auth",
  createHonoOidcRoutes(oidc, {
    successRedirect: `${process.env.FRONTEND_URL}/dashboard`,
    errorRedirect: `${process.env.FRONTEND_URL}/callback`,
    postLogoutRedirectUri: process.env.POST_LOGOUT_REDIRECT_URI,
  }),
);

// 保護ルート: honoSessionMiddleware が c.var.user を注入する
const api = new Hono<{ Variables: HonoOidcVariables }>();
api.use("*", honoSessionMiddleware(oidc));

api.get("/me", async (c) => {
  const { sub, accessToken } = c.var.user;
  const result = await oidc.fetchUserInfo(accessToken, sub);
  if (result.ok) {
    return c.json({ name: result.claims.name, email: result.claims.email });
  }
  // /userinfo 401 = access_token revoked → セッション失効として扱う
  if (result.reason === "unauthorized") {
    applySetCookies(c, oidc.clearSession());
    return c.json({ error: "unauthenticated" }, 401);
  }
  if (result.reason === "sub_mismatch") {
    applySetCookies(c, oidc.clearSession());
    return c.json({ error: "sub_mismatch" }, 401);
  }
  return c.json({ error: "Failed to fetch user info" }, 502);
});

app.route("/api", api);
```

### Node.js で起動する場合

ライブラリ側に Bun 固有依存は無い (`node:crypto` / `jose` / `hono` / Web 標準のみ)。Bun の `export default { fetch, port }` の代わりに [`@hono/node-server`](https://github.com/honojs/node-server) の `serve()` で起動すれば、上記の `app` 構築コードはそのまま使える。

```ts
import { serve } from "@hono/node-server";
// app の定義は上と同じ

serve({ fetch: app.fetch, port: Number(process.env.PORT) || 3000 }, ({ port }) =>
  console.log(`listening on http://localhost:${port}`),
);
```

要件: Node.js 24+ (`globalThis.fetch` と Web Crypto グローバルを利用)。追加で `pnpm add @hono/node-server` が必要。

`createHonoOidcRoutes` が mount する 4 ルート (frontend が叩く側のため):

| メソッド | パス             | 概要                                                                  |
| -------- | ---------------- | --------------------------------------------------------------------- |
| GET      | `/auth/login`    | `/authorize` への 302。`oauth_pending` JWE Cookie 発行                |
| GET      | `/auth/callback` | code → token 交換。成功で `successRedirect`、失敗で `errorRedirect`   |
| GET      | `/auth/status`   | `{ loggedIn, user? }` JSON。リフレッシュ時のみ Set-Cookie             |
| POST     | `/auth/logout`   | Cookie 破棄 + `{ logoutUrl }` を返す (frontend で top-level redirect) |

## API リファレンス

### `new AuthContainerClient(options)`

| 値                          | 必須 | 内容                                                                                                                             |
| --------------------------- | ---- | -------------------------------------------------------------------------------------------------------------------------------- |
| `clientId` / `clientSecret` | 必須 | auth-container の管理画面で client 登録時に発行                                                                                  |
| `redirectUri`               | 必須 | 登録済み redirect_uri と完全一致 (BFF の `/auth/callback` 等)                                                                    |
| `encryptionKeys`            | 必須 | `openssl rand -base64 32` で生成した 32 byte 鍵の配列 (index 0 で暗号化、全鍵で復号試行)                                         |
| `tokenEndpointAuthMethod`   | 任意 | `"client_secret_basic"` / `"client_secret_post"` / `"none"`。省略時は `clientSecret` の有無で `basic` / `none` を推定            |
| `cookies.sessionName`       | 任意 | session Cookie の名前。省略時は `'bff_session'`。同一オリジンに複数 BFF を同居させる場合や、既存運用名を維持したい場合に指定する |

`ISSUER` / scopes / `pendingName` / `pendingPath` / その他 Cookie 属性 (HttpOnly/Secure/SameSite/Domain) はライブラリ内部で固定。

### `AuthContainerClient` インスタンスメソッド

通常は Hono アダプタ経由で間接的に呼ばれる。利用側ハンドラから直接呼ぶのは `fetchUserInfo` / `clearSession` が中心。

| メソッド                     | シグネチャ                                                                      | 用途                                                                       |
| ---------------------------- | ------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `startLogin`                 | `(input?: { extraAuthorizeParams? }) => Promise<{ authorizeUrl, setCookies }>`  | OIDC `/authorize` URL + Pending JWE Cookie を生成                          |
| `handleCallback`             | `(input: { query, cookies }) => Promise<CallbackResult>`                        | callback の code/state 検証 + token 交換 + Session 発行                    |
| `getSession`                 | `(input: { cookies }) => Promise<{ session, accessToken, setCookies } \| null>` | Session 復号 + 必要なら refresh で更新                                     |
| `fetchUserInfo`              | `(accessToken: string, expectedSub: string) => Promise<UserInfoResult>`         | OP の `/userinfo` を叩いて claims を取得。sub 突合 (OIDC Core §5.3.2) 込み |
| `clearSession`               | `() => SetCookieDirective[]`                                                    | Session Cookie を `Max-Age=0` で消すディレクティブ                         |
| `buildLogoutUrl`             | `({ postLogoutRedirectUri? }) => string`                                        | OP の RP-Initiated Logout URL を組み立てる                                 |
| `sessionCookieName` (getter) | `string`                                                                        | Cookie 存在チェック用の getter (アダプタ層から利用)                        |

### `createHonoOidcRoutes(client, options)`

OIDC 4 ルートを持つ `Hono` を返す。`app.route('/auth', ...)` で mount する想定。

| 値                      | 必須 | 内容                                                                                                                         |
| ----------------------- | ---- | ---------------------------------------------------------------------------------------------------------------------------- |
| `successRedirect`       | 必須 | login 成功時に飛ばす frontend URL                                                                                            |
| `errorRedirect`         | 必須 | login 失敗時に飛ばす frontend URL (`?error=` `?error_description=` クエリ付き)                                               |
| `postLogoutRedirectUri` | 任意 | OP logout 後にユーザを戻す URL。frontend URL を直接指定し、auth-container 管理画面の「ログアウト後の遷移先 URL」にも同値登録 |
| `loginPath`             | 任意 | デフォルト `/login`                                                                                                          |
| `callbackPath`          | 任意 | デフォルト `/callback`                                                                                                       |
| `statusPath`            | 任意 | デフォルト `/status`                                                                                                         |
| `logoutPath`            | 任意 | デフォルト `/logout`                                                                                                         |

OP 管理画面に登録すべき URL の対応:

- `redirectUri` env → admin「コールバック URL」 (必須)
- `postLogoutRedirectUri` env → admin「ログアウト後の遷移先 URL」 (logout 後の戻りが欲しい場合のみ、env と OP に同値)
- いずれもライブラリが自動生成しない値で、利用側が決めた URL を OP と env の両方に書くことで完全一致を保証

### `honoSessionMiddleware(client)`

`MiddlewareHandler<{ Variables: HonoOidcVariables }>` を返す。Session Cookie を検証して `c.var.user = { sub, accessToken }` を注入する。未認証 / 復号失敗 / リフレッシュ失敗時は `{ error: "unauthenticated" }` を 401 で返して中断。

### `applySetCookies(c, directives)`

`SetCookieDirective[]` を Hono `Context` の Set-Cookie ヘッダに **append** する (Hono の `c.header` は 2 回目以降 `{ append: true }` 必須なため、複数 Cookie を発行するときに必要)。利用側ハンドラからも `oidc.clearSession()` の戻り値を反映するために呼べる。

### `HonoOidcVariables`

```ts
interface HonoOidcVariables {
  user: { sub: string; accessToken: string };
}
```

`Hono<{ Variables: HonoOidcVariables }>()` で受け取ると `c.var.user` が型付けされる。

### 公開エラー / 公開型 / 公開定数

| 種別                  | 名前                                                                                             | 内容                                                                       |
| --------------------- | ------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------- |
| エラー                | `ConfigError`                                                                                    | 構成不正 (`encryptionKeys` 不足、production で `http://` redirectUri など) |
| エラー                | `CookieSizeError`                                                                                | Cookie サイズが 4KB を超過 (Pending Auth が肥大化した場合)                 |
| エラー                | `CallbackError`                                                                                  | callback 処理の典型エラーを `kind: CallbackErrorKind` 付きで投げる         |
| 型 (main)             | `ClientUserConfig`                                                                               | `new AuthContainerClient(options)` の引数型 (詳細は constructor 表)        |
| 型 (main)             | `SessionView` / `SetCookieDirective` / `CallbackResult` / `CallbackErrorKind` / `UserInfoResult` | 戻り値型・Cookie ディレクティブ型                                          |
| 型 (`/adapters/hono`) | `HonoOidcRoutesOptions`                                                                          | `createHonoOidcRoutes` の options 型 (詳細は同関数の表)                    |
| 型 (`/adapters/hono`) | `HonoOidcVariables`                                                                              | (上記参照)                                                                 |
| 定数                  | `ISSUER` / `ENDPOINTS` / `SCOPES` / `COOKIES`                                                    | 内部固定値の参照用 (利用側が直接使うことは少ない)                          |

## 制約

- **OP の URL がビルド時固定**: `ISSUER=https://auth-container.hanacus87.net` 埋め込み。ローカルで `localhost:4000` を使う場合は hosts ファイル等で同ドメインをローカル解決する。ステージングや別 OP 接続には対応しない (バージョン bump 必須)
- **Back-Channel Logout 非対応**: ステートレス設計のため BCL は原理的に不可
- **RP-Initiated Logout は対応**: frontend → `POST /auth/logout` で `logoutUrl` を取得し top-level redirect
- **全 API ルートでの即時失効反映は不可**: `fetchUserInfo` を呼ぶルート (例: `/api/me`) のみ即時検知可
- **Cookie 属性は固定**: `pendingName` / `pendingPath` / `secure` / `sameSite` / `domain` / `sessionPath` / `maxAge` は変更不可
