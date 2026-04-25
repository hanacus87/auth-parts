import { ENDPOINTS } from "../constants";

export type UserInfoResult =
  | { ok: true; claims: Record<string, unknown> }
  | { ok: false; reason: "unauthorized" }
  | { ok: false; reason: "error"; status: number };

/**
 * RFC 6750 §2 + OIDC Core §5.3: access_token を Bearer で渡して /userinfo を取得する。
 * 401 (= revoked / expired) と 5xx を区別した Result 型で返し、利用側はセッション失効処理ができる。
 * id_token の claims で十分な場合は呼ぶ必要なし (任意ユーティリティ)。
 */
export async function fetchUserInfo(
  accessToken: string,
  options: { fetch?: typeof globalThis.fetch } = {},
): Promise<UserInfoResult> {
  const fetchFn = options.fetch ?? globalThis.fetch.bind(globalThis);
  const res = await fetchFn(ENDPOINTS.userinfo, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (res.status === 401) return { ok: false, reason: "unauthorized" };
  if (!res.ok) return { ok: false, reason: "error", status: res.status };
  return { ok: true, claims: (await res.json()) as Record<string, unknown> };
}
