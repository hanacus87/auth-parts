import { ENDPOINTS, SCOPES } from "../constants";
import type { ResolvedAuthConfig } from "../types";

/**
 * OIDC Core §3.1.2.1 に基づく Authorization Request URL を組み立てる。
 * silent (prompt=none) かどうかで `prompt` パラメータの有無のみ切り替える。
 * top-level redirect 用 URL の文字列だけを返し、navigation は呼び出し側で行う。
 */
export function buildAuthorizeUrl(
  config: ResolvedAuthConfig,
  params: { state: string; nonce: string; codeChallenge: string; silent: boolean },
): string {
  const url = new URLSearchParams({
    response_type: "code",
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    scope: SCOPES.join(" "),
    state: params.state,
    nonce: params.nonce,
    code_challenge: params.codeChallenge,
    code_challenge_method: "S256",
  });
  if (params.silent) url.set("prompt", "none");
  return `${ENDPOINTS.authorization}?${url}`;
}
