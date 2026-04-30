const DEMO_BFF = import.meta.env.VITE_DEMO_BFF_URL;

/**
 * BFF の `/api/me` を呼び出し、ログイン中ユーザーの情報を取得する。
 * Cookie ベース認証なので `credentials: "include"` でセッション Cookie を自動送信する。
 */
export async function fetchMe(): Promise<Record<string, unknown>> {
  const res = await fetch(`${DEMO_BFF}/api/me`, {
    credentials: "include",
  });

  if (!res.ok) {
    throw new Error(`API error: ${res.status}`);
  }

  return res.json();
}

/**
 * BFF の `/auth/status` を叩き、現在ブラウザに有効なセッションがあるかを返す。
 */
export async function checkAuthStatus(): Promise<{ loggedIn: boolean }> {
  const res = await fetch(`${DEMO_BFF}/auth/status`, {
    credentials: "include",
  });
  return res.json();
}
