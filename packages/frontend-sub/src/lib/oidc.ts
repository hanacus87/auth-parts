const APP_SERVER = import.meta.env.VITE_APP_SERVER_URL;

// ── Login ──────────────────────────────────────────────────────
// BFF パターン: app-server が OIDC フローを開始する
export function startLogin(): void {
  window.location.href = `${APP_SERVER}/auth/login`;
}

// ── Logout ─────────────────────────────────────────────────────
// BFF のセッションを破棄し、auth-server のログアウトにリダイレクト
export async function logout(): Promise<void> {
  try {
    const res = await fetch(`${APP_SERVER}/auth/logout`, {
      method: "POST",
      credentials: "include",
    });
    if (res.ok) {
      const { logoutUrl } = await res.json();
      window.location.href = logoutUrl;
      return;
    }
  } catch {
    // BFF への通信失敗時はホームに戻る
  }
  window.location.href = "/";
}
