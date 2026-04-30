const DEMO_BFF = import.meta.env.VITE_DEMO_BFF_URL;

/**
 * BFF パターン: demo-bff 側に OIDC ログインフローの開始を委譲する。
 * SPA は単に `/auth/login` へ遷移するだけで、authorization request の組み立ては BFF が担う。
 */
export function startLogin(): void {
  window.location.href = `${DEMO_BFF}/auth/login`;
}

/**
 * BFF のセッションを破棄してから AuthContainer のログアウトエンドポイントへリダイレクトする。
 * BFF への通信に失敗した場合はホームへフォールバックする (UX 上、ユーザーを宙吊りにしない)。
 */
export async function logout(): Promise<void> {
  try {
    const res = await fetch(`${DEMO_BFF}/auth/logout`, {
      method: "POST",
      credentials: "include",
    });
    if (res.ok) {
      const { logoutUrl } = await res.json();
      window.location.href = logoutUrl;
      return;
    }
  } catch {}
  window.location.href = "/";
}
