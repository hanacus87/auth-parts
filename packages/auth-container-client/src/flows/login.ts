import { buildPendingCookie } from "../cookies/pending";
import { ENDPOINTS, SCOPES } from "../constants";
import { generateCodeChallenge, generateCodeVerifier } from "../crypto/pkce";
import { generateNonce, generateState } from "../crypto/random";
import type { ResolvedConfig, SetCookieDirective } from "../types";

/**
 * RFC 6749 §4.1 + RFC 7636 (PKCE) + OIDC Core §3.1.2.1 に基づく Authorization Code
 * リクエスト URL を組み立て、state/nonce/code_verifier を Pending Auth Cookie に封印して返す。
 *
 * 呼び出し側はこの authorizeUrl に 302 リダイレクトし、setCookies を Set-Cookie ヘッダに付与する。
 */
export async function startLogin(
  config: ResolvedConfig,
  input: {
    extraAuthorizeParams?: Record<string, string>;
  },
): Promise<{ authorizeUrl: string; setCookies: SetCookieDirective[] }> {
  const state = generateState();
  const nonce = generateNonce();
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = await generateCodeChallenge(codeVerifier);

  const params = new URLSearchParams({
    response_type: "code",
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    scope: SCOPES.join(" "),
    state,
    nonce,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
  });
  if (input.extraAuthorizeParams) {
    for (const [k, v] of Object.entries(input.extraAuthorizeParams)) {
      params.set(k, v);
    }
  }

  const pendingCookie = await buildPendingCookie(
    {
      s: state,
      v: codeVerifier,
      n: nonce,
      iat: config.clock(),
    },
    config,
  );

  return {
    authorizeUrl: `${ENDPOINTS.authorization}?${params}`,
    setCookies: [pendingCookie],
  };
}
