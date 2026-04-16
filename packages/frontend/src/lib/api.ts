const APP_SERVER = import.meta.env.VITE_APP_SERVER_URL;

// Cookie ベース: credentials: "include" でセッション Cookie を自動送信
export async function fetchMe(): Promise<Record<string, unknown>> {
  const res = await fetch(`${APP_SERVER}/api/me`, {
    credentials: "include",
  });

  if (!res.ok) {
    throw new Error(`API error: ${res.status}`);
  }

  return res.json();
}

export async function checkAuthStatus(): Promise<{ loggedIn: boolean }> {
  const res = await fetch(`${APP_SERVER}/auth/status`, {
    credentials: "include",
  });
  return res.json();
}
