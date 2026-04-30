import { ENDPOINTS } from "../constants";

export type UserInfoResult =
  | { ok: true; claims: Record<string, unknown> }
  | { ok: false; reason: "unauthorized" }
  | { ok: false; reason: "sub_mismatch" }
  | { ok: false; reason: "error"; status: number };

/**
 * RFC 6750 §2 + OIDC Core §5.3: access_token を Bearer で渡して /userinfo を取得する。
 * 401 (= revoked / expired) と 5xx を区別した Result 型で返し、利用側はセッション失効処理ができる。
 * id_token の claims で十分な場合は呼ぶ必要なし (任意ユーティリティ)。
 *
 * OIDC Core §5.3.2: response の sub と id_token の sub の一致を MUST で検証する (token mix-up 対策)。
 * `expectedSub` は `useAuth().user.sub` 等、id_token 由来の sub を渡す。
 * 不一致は reason='sub_mismatch' で返るので、unauthorized と同様にセッション失効として扱う想定。
 */
export async function fetchUserInfo(
  accessToken: string,
  expectedSub: string,
): Promise<UserInfoResult> {
  const res = await fetch(ENDPOINTS.userinfo, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (res.status === 401) return { ok: false, reason: "unauthorized" };
  if (!res.ok) return { ok: false, reason: "error", status: res.status };
  const claims = (await res.json()) as Record<string, unknown>;
  if (typeof claims.sub !== "string" || claims.sub !== expectedSub) {
    return { ok: false, reason: "sub_mismatch" };
  }
  return { ok: true, claims };
}
