import { ENDPOINTS } from "../constants";
import type { ResolvedConfig, UserInfoResult } from "../types";

/**
 * RFC 6750 §2 + OIDC Core §5.3: access_token を Bearer で渡して /userinfo を取得する。
 * auth-container はクエリ文字列での token 受け渡しを許可していないため必ず Authorization ヘッダで送る。
 *
 * 401 (= access_token revoked / invalid) と 5xx 等の一時障害を区別するため、throw せず
 * 型付き Result (`UserInfoResult`) を返す。利用側は reason='unauthorized' を
 * セッション失効シグナルとして扱える。
 */
export async function fetchUserInfo(
  config: ResolvedConfig,
  accessToken: string,
): Promise<UserInfoResult> {
  const res = await config.fetch(ENDPOINTS.userinfo, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (res.status === 401) return { ok: false, reason: "unauthorized" };
  if (!res.ok) return { ok: false, reason: "error", status: res.status };
  return { ok: true, claims: (await res.json()) as Record<string, unknown> };
}
