# @auth-parts/auth-container-client

`https://auth-container.hanacus87.net` 専用の OIDC クライアントライブラリ。

- Authorization Code + PKCE(S256) フロー
- Pending Auth / Session を JWE Cookie に収めるステートレス構成 (Redis 等不要)
- Hono 用のアダプタ同梱

## 利用側に渡す値

| 値                          | 必須 | 由来                                                                                                                             |
| --------------------------- | ---- | -------------------------------------------------------------------------------------------------------------------------------- |
| `clientId` / `clientSecret` | 必須 | auth-container の管理画面で client 登録時に発行                                                                                  |
| `redirectUri`               | 必須 | 登録済み redirect_uri と完全一致 (BFF の `/auth/callback` 等)                                                                    |
| `encryptionKeys`            | 必須 | `openssl rand -base64 32` で生成した 32 byte 鍵の配列 (index 0 で暗号化、全鍵で復号試行)                                         |
| `cookies.sessionName`       | 任意 | session Cookie の名前。省略時は `'bff_session'`。同一オリジンに複数 BFF を同居させる場合や、既存運用名を維持したい場合に指定する |

### Hono アダプタ (`createHonoOidcRoutes`) のオプション

| 値                      | 必須 | 由来                                                                                                                         |
| ----------------------- | ---- | ---------------------------------------------------------------------------------------------------------------------------- |
| `successRedirect`       | 必須 | login 成功時に飛ばす frontend URL                                                                                            |
| `errorRedirect`         | 必須 | login 失敗時に飛ばす frontend URL (`?error=` `?error_description=` クエリ付き)                                               |
| `postLogoutRedirectUri` | 任意 | OP logout 後にユーザを戻す URL。frontend URL を直接指定し、auth-container 管理画面の「ログアウト後の遷移先 URL」にも同値登録 |

OP admin 画面に登録すべき URL の対応:

- `redirectUri` env → admin「コールバック URL」 (必須)
- `postLogoutRedirectUri` env → admin「ログアウト後の遷移先 URL」 (logout 後の戻りが欲しい場合のみ、env と OP に同値)
- いずれもライブラリが自動生成しない値で、利用側が決めた URL を OP と env の両方に書くことで完全一致を保証

`ISSUER` / scopes / `pendingName` / `pendingPath` / その他 Cookie 属性 (HttpOnly/Secure/SameSite/Domain) はライブラリ内部で固定。

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

```ts
import { AuthContainerClient } from "@auth-parts/auth-container-client";
import {
  createHonoOidcRoutes,
  honoSessionMiddleware,
} from "@auth-parts/auth-container-client/adapters/hono";

const keys = process.env.COOKIE_KEYS!.split(",").map((b) => Buffer.from(b, "base64"));

const client = new AuthContainerClient({
  clientId: process.env.CLIENT_ID!,
  clientSecret: process.env.CLIENT_SECRET!,
  redirectUri: process.env.REDIRECT_URI!,
  encryptionKeys: keys,
  // 任意。env 未設定時は default 'bff_session' にフォールバック
  cookies: { sessionName: process.env.SESSION_COOKIE_NAME },
});
```

`/api/me` 等の保護ルートで `fetchUserInfo` を呼ぶ場合、戻り値は `UserInfoResult` 型 (Result 型)。
`reason: "unauthorized"` (= /userinfo 401 = access_token revoked) を検知してセッションをクリアする例:

```ts
import {
  applySetCookies,
  honoSessionMiddleware,
} from "@auth-parts/auth-container-client/adapters/hono";

api.get("/me", async (c) => {
  const { accessToken } = c.var.user;
  const result = await client.fetchUserInfo(accessToken);

  if (result.ok) {
    return c.json({ name: result.claims.name, email: result.claims.email });
  }
  if (result.reason === "unauthorized") {
    applySetCookies(c, client.clearSession());
    return c.json({ error: "unauthenticated" }, 401);
  }
  return c.json({ error: "Failed to fetch user info" }, 502);
});
```

## 制約 (v0.1)

- Back-Channel Logout 非対応 (ステートレス設計のため BCL は原理的に不可)
- RP-Initiated Logout は対応 (frontend → `POST /auth/logout` で `logoutUrl` を取得し top-level redirect)
- 全 API ルートでの即時失効反映は不可。`fetchUserInfo` を呼ぶルート (例: `/api/me`) のみ即時検知可
- ステージング環境や別 OP への接続には対応しない (バージョン bump 必須)
- `pendingName` / `pendingPath` / `secure` / `sameSite` / `domain` / `sessionPath` / `maxAge` は引き続き固定
