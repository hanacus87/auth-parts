# @auth-parts/auth-container-react

`auth-container` 専用の SPA 直結 OIDC React クライアント。Authorization Code + PKCE (public client) / メモリトークンのみ / top-level silent renew で OIDC を SPA だけで完結させる。

> 全体俯瞰・BFF と SPA 直結の比較・設計判断は [ルート README](../../README.md) を参照。

## インストール

モノレポ内ワークスペース:

```jsonc
{
  "dependencies": {
    "@auth-parts/auth-container-react": "workspace:*",
  },
}
```

`react` (^18) と `jose` (^5) は peer dependency。

## 使い方

### 1. Provider で SPA を包む

```tsx
import { AuthProvider } from "@auth-parts/auth-container-react";
import { createRoot } from "react-dom/client";
import { App } from "./App";

createRoot(document.getElementById("root")!).render(
  <AuthProvider
    config={{
      clientId: import.meta.env.VITE_CLIENT_ID,
      redirectUri: window.location.origin + "/callback",
      postLogoutRedirectUri: window.location.origin,
    }}
  >
    <App />
  </AuthProvider>,
);
```

### 2. Callback ルートを設定

```tsx
import { Callback } from "@auth-parts/auth-container-react";
import { BrowserRouter, Routes, Route } from "react-router-dom";

<BrowserRouter>
  <Routes>
    <Route path="/" element={<Home />} />
    <Route path="/callback" element={<Callback />} />
    <Route path="/dashboard" element={<Dashboard />} />
  </Routes>
</BrowserRouter>;
```

### 3. useAuth で UI 制御

```tsx
import { useAuth } from "@auth-parts/auth-container-react";

function Home() {
  const { isAuthenticated, isLoading, login } = useAuth();
  if (isLoading) return <div>Loading...</div>;
  if (isAuthenticated) return <Navigate to="/dashboard" />;
  return <button onClick={login}>Login</button>;
}

function Dashboard() {
  const { user, accessToken, logout } = useAuth();
  return (
    <>
      <p>Welcome, {user?.name}</p>
      <button onClick={logout}>Logout</button>
    </>
  );
}
```

## API リファレンス

### `<AuthProvider config={...}>`

| 値                      | 必須 | 内容                                                                                         |
| ----------------------- | ---- | -------------------------------------------------------------------------------------------- |
| `clientId`              | 必須 | auth-container の admin で登録した SPA 用 public client_id (token_endpoint_auth_method=none) |
| `redirectUri`           | 必須 | 登録済み redirect_uri と完全一致 (例: `window.location.origin + "/callback"`)                |
| `postLogoutRedirectUri` | 任意 | 省略時 `window.location.origin`。OP に登録済み URI と一致必須                                |
| `silentRenewOnMount`    | 任意 | 省略時 `true`。`false` にすると起動時の自動 silent renew を無効化                            |

### `useAuth()` の戻り値 (`AuthContextValue`)

`AuthProvider` 配下で呼べる hook。Provider の外で呼ぶと throw。

| フィールド             | 型                  | 内容                                                        |
| ---------------------- | ------------------- | ----------------------------------------------------------- |
| `isAuthenticated`      | `boolean`           | 認証済みか                                                  |
| `isLoading`            | `boolean`           | mount 起動 / silent renew / callback 処理の最中             |
| `user`                 | `AuthUser \| null`  | id_token claims (`sub` 必須、`name` / `email` 等は OP 次第) |
| `accessToken`          | `string \| null`    | UserInfo / 自前 API の Bearer に使う (memory 保管)          |
| `idToken`              | `string \| null`    | logout 時の `id_token_hint` 用などに保持                    |
| `accessTokenExpiresAt` | `number \| null`    | Unix 秒。memory 期限切れ判定に                              |
| `error`                | `AuthError \| null` | 直近のエラー (`kind` で分岐、詳細は下表)                    |
| `login()`              | `() => void`        | `/authorize` に top-level redirect                          |
| `logout()`             | `() => void`        | OP の `/logout` に top-level redirect (memory もクリア)     |

### `AuthError.kind`

利用側が `error?.kind` で switch する想定:

| kind                   | 発生条件                                                       |
| ---------------------- | -------------------------------------------------------------- |
| `login_required`       | OP が `prompt=none` 中に未ログインを返した (silent renew 失敗) |
| `consent_required`     | 同意未取得                                                     |
| `interaction_required` | 何らかのユーザ操作要求                                         |
| `state_mismatch`       | callback の state バインディング不一致                         |
| `nonce_mismatch`       | id_token の nonce が pending と不一致                          |
| `id_token`             | id_token の sig / iss / aud / exp / sub 検証失敗               |
| `token_exchange`       | `/token` 交換が失敗 (`description` でエラー詳細)               |
| `op_error`             | OP が他の `error=...` を返した (`error` / `description` あり)  |
| `missing_code`         | callback に code も error も無い (異常系)                      |

### `<Callback />`

引数なし。`/callback` ルートに mount する最小コンポーネント。`isLoading` 中は `<div>Loading...</div>`、`error` 時は `<div role="alert">` で `kind` を表示する。カスタム表示が欲しければ `useAuth()` の `isLoading` / `error` を直接見て独自実装してよい。

### `fetchUserInfo(accessToken, expectedSub)`

`Promise<UserInfoResult>`。OP の `/userinfo` を叩いて claims を取得。OIDC Core §5.3.2 準拠で、response の `sub` と `expectedSub` (= `useAuth().user.sub`) の突合をライブラリが実施する。

```ts
type UserInfoResult =
  | { ok: true; claims: Record<string, unknown> }
  | { ok: false; reason: "unauthorized" }
  | { ok: false; reason: "sub_mismatch" }
  | { ok: false; reason: "error"; status: number };
```

- `reason: "unauthorized"` (= 401 = access_token revoked) → 利用側はログイン画面に飛ばす
- `reason: "sub_mismatch"` (= id_token と /userinfo の sub 不一致 = token mix-up 兆候) → 同様にセッション失効として扱う

### 公開型 / 公開定数

| 種別 | 名前                                                             | 内容                                                            |
| ---- | ---------------------------------------------------------------- | --------------------------------------------------------------- |
| 型   | `AuthConfig`                                                     | `<AuthProvider config={...}>` の引数型 (詳細は AuthProvider 表) |
| 型   | `AuthError`                                                      | `useAuth().error` の型 (詳細は kind 表)                         |
| 型   | `AuthState` / `AuthUser` / `AuthContextValue` / `UserInfoResult` | useAuth 戻り値の構成型                                          |
| 定数 | `ISSUER` / `ENDPOINTS` / `SCOPES`                                | 内部固定値の参照用                                              |

## silent renew の挙動

ページロード時、SPA は `${ISSUER}/authorize?prompt=none` に top-level redirect する。OP セッションが有効なら無感に code を取得 → token 化、無ければ `error=login_required` で戻り、未ログイン状態を表示する。

無限ループ防止のため、`silent_attempted` sessionStorage フラグで「起動時 1 回しか試さない」制御を入れている。フラグは:

- silent renew **成功時** にクリア
- ユーザが `login()` を呼んだとき **クリア**
- ユーザが `logout()` を呼んだとき **クリア**
- ブラウザタブを閉じれば自動的に消える (sessionStorage は tab scope)

## 制約

- **OP の URL がビルド時固定**: `ISSUER=https://auth-container.hanacus87.net` 埋め込み。ローカルで `localhost:4000` を使う場合は hosts ファイル等で同ドメインをローカル解決する。ステージングや別 OP 接続には対応しない (バージョン bump 必須)
- **メモリのみ保管 → ページリロードで token 消失**: ロード時に top-level redirect で silent renew を試行してリカバリ
- **silent renew は起動時 1 回のみ**: access_token 期限切れ後の自動延長はしない (利用側で `login()` を呼んで対応)
- **refresh_token を使わない**: auth-container 側で public client は `offline_access` を許可しない仕様
- **画面が一瞬白くなる**: top-level redirect のため。`isLoading` 中の loader 表示でカバー
- **同一オリジン同居非サポート**: 1 SPA = 1 オリジン前提
- **Back-Channel Logout 非対応**: SPA は BCL endpoint を持てない (構造的に不可)
- **多タブ logout sync なし**: 1 タブで logout しても他タブは memory token を持ち続ける (リロードで silent renew が走り、OP セッションが切れていれば未ログインに同期)
