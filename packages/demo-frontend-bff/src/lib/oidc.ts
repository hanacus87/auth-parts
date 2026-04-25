const DEMO_BFF = import.meta.env.VITE_DEMO_BFF_URL;

// ── Login ──────────────────────────────────────────────────────
// BFF パターン: demo-bff が OIDC フローを開始する
export function startLogin(): void {
  window.location.href = `${DEMO_BFF}/auth/login`;
}

// ── Logout ─────────────────────────────────────────────────────
// BFF のセッションを破棄し、AuthContainer のログアウトにリダイレクト
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
  } catch {
    // BFF への通信失敗時はホームに戻る
  }
  window.location.href = "/";
}
