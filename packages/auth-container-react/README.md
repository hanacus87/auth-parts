# @auth-parts/auth-container-react

`https://auth-container.hanacus87.net` 専用の SPA 直結 OIDC React クライアント。Authorization Code + PKCE (public client) で OIDC を SPA だけで完結させる。BFF を使わないシンプルな構成向け。

## 設計の前提

- **Token はメモリのみ保管** (BCP for Browser-Based Apps 推奨)
- **silent re-auth は top-level redirect** (`prompt=none`) で実装。iframe は使わない (3rd-party cookie 制限の影響を受けない)
- **refresh_token は使わない**。長期セッション継続は OP セッション cookie + silent renew で代替
- **ISSUER / endpoints / scopes は固定** (auth-container 専用)
- BFF パターンが必要なら `@auth-parts/auth-container-client` を使う

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

## 利用側に渡す値

| 値                      | 必須 | 内容                                                                                         |
| ----------------------- | ---- | -------------------------------------------------------------------------------------------- |
| `clientId`              | 必須 | auth-container の admin で登録した SPA 用 public client_id (token_endpoint_auth_method=none) |
| `redirectUri`           | 必須 | 登録済み redirect_uri と完全一致 (例: `window.location.origin + "/callback"`)                |
| `postLogoutRedirectUri` | 任意 | 省略時 `window.location.origin`。OP に登録済み URI と一致必須                                |
| `silentRenewOnMount`    | 任意 | 省略時 `true`。`false` にすると起動時の自動 silent renew を無効化                            |
| `fetch`                 | 任意 | テスト用注入口                                                                               |

## silent renew の挙動

ページロード時、SPA は `${ISSUER}/authorize?prompt=none` に top-level redirect する。OP セッションが有効なら無感に code を取得 → token 化、無ければ `error=login_required` で戻り、未ログイン状態を表示する。

無限ループ防止のため、`silent_attempted` sessionStorage フラグで「起動時 1 回しか試さない」制御を入れている。フラグは:

- silent renew **成功時** にクリア
- ユーザが `login()` を呼んだとき **クリア**
- ユーザが `logout()` を呼んだとき **クリア**
- ブラウザタブを閉じれば自動的に消える (sessionStorage は tab scope)

## 制約

- **メモリのみ保管 → ページリロードで token 消失**。ロード時に top-level redirect で silent renew を試行してリカバリ
- **silent renew は起動時 1 回のみ**。access_token 期限切れ後の自動延長はしない (利用側で `login()` を呼んで対応)
- **refresh_token を使わない**。auth-container 側で public client は `offline_access` を許可しない仕様
- **画面が一瞬白くなる** (top-level redirect のため)。`isLoading` 中の loader 表示でカバー
- **同一オリジン同居非サポート**。1 SPA = 1 オリジン前提
- **BCL 非対応**。SPA は BCL endpoint を持てない (構造的に不可)
- **多タブ logout sync なし**。1 タブで logout しても他タブは memory token を持ち続ける (リロードで silent renew が走り、OP セッションが切れていれば未ログインに同期)

## BFF 版 (`@auth-parts/auth-container-client`) との比較

| 観点          | BFF 版 (auth-container-client)                             | SPA 版 (auth-container-react)                   |
| ------------- | ---------------------------------------------------------- | ----------------------------------------------- |
| Token 保管    | サーバ側 JWE Cookie (HttpOnly)                             | ブラウザ memory のみ                            |
| OP との通信   | サーバ間 (Hono BFF が代理)                                 | ブラウザ → OP 直接 (CORS)                       |
| client_secret | 必要 (confidential client)                                 | 不要 (public client + PKCE)                     |
| BCL           | サポート可能 (将来 v0.2)                                   | 非対応 (構造的に不可)                           |
| ステート管理  | サーバ stateless (JWE Cookie)                              | ブラウザ memory + sessionStorage (pending のみ) |
| 適切な用途    | ログアウト即時伝播・トークン非露出が重要なエンタープライズ | シンプルな SPA、サーバ持ちたくない構成          |
