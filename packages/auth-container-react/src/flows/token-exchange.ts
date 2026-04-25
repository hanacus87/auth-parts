import { ENDPOINTS } from "../constants";
import type { ResolvedAuthConfig } from "../types";

export interface TokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  id_token: string;
  scope?: string;
}

export type TokenExchangeResult =
  | { ok: true; tokens: TokenResponse }
  | { ok: false; description?: string };

/**
 * RFC 6749 §3.2 + RFC 7636 §4.5: authorization_code を access_token / id_token に交換する。
 * SPA は public client (`token_endpoint_auth_method=none`) なので Authorization ヘッダなし、
 * `client_id` を form body に入れて送る。client_secret は持たない。
 */
export async function exchangeCodeForTokens(
  config: ResolvedAuthConfig,
  params: { code: string; codeVerifier: string },
): Promise<TokenExchangeResult> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code: params.code,
    redirect_uri: config.redirectUri,
    code_verifier: params.codeVerifier,
    client_id: config.clientId,
  });

  const res = await config.fetch(ENDPOINTS.token, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => null)) as {
      error?: string;
      error_description?: string;
    } | null;
    return { ok: false, description: err?.error_description ?? err?.error };
  }
  const tokens = (await res.json()) as TokenResponse;
  return { ok: true, tokens };
}
