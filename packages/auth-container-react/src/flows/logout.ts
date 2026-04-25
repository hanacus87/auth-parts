import { ENDPOINTS } from "../constants";
import type { ResolvedAuthConfig } from "../types";

/**
 * OIDC RP-Initiated Logout 1.0 §2 に基づく end_session_endpoint への redirect URL を組み立てる。
 * id_token_hint を付けると OP 側でユーザ確認画面を省略できる場合がある。
 * post_logout_redirect_uri は OP 側に登録されている必要あり (auth-container 側で validation)。
 */
export function buildLogoutUrl(
  config: ResolvedAuthConfig,
  params: { idTokenHint: string | null },
): string {
  const url = new URLSearchParams({
    post_logout_redirect_uri: config.postLogoutRedirectUri,
  });
  if (params.idTokenHint) url.set("id_token_hint", params.idTokenHint);
  return `${ENDPOINTS.endSession}?${url}`;
}
