/** BFF からの JSON エラー応答をそのまま保持する例外クラス。 */
export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public body: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

/**
 * 同一オリジン API に対して JSON fetch を行う共通ヘルパー。
 * Cookie を含めるため `credentials: "include"` を付与し、エラー時は `ApiError` を throw する。
 */
export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(path, {
    ...init,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      ...init.headers,
    },
  });
  const contentType = res.headers.get("content-type") ?? "";
  const body = contentType.includes("application/json") ? await res.json().catch(() => ({})) : {};
  if (!res.ok) {
    throw new ApiError(
      res.status,
      (body as any).error ?? "http_error",
      (body as any).error_description ?? (body as any).error ?? res.statusText,
      body as Record<string, unknown>,
    );
  }
  return body as T;
}

export const api = {
  get: <T>(path: string) => apiFetch<T>(path, { method: "GET" }),
  post: <T>(path: string, body: unknown = {}) =>
    apiFetch<T>(path, { method: "POST", body: JSON.stringify(body) }),
};

/** 受け取った redirectUrl で画面遷移する (history 的には 302 相当の replace)。 */
export function redirectTo(url: string): void {
  window.location.replace(url);
}
