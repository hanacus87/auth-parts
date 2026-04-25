import { ENDPOINTS } from "../constants";
import { basicAuthHeader } from "../crypto/basic-auth";
import type { ResolvedConfig } from "../types";

export interface TokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token?: string;
  id_token: string;
  scope?: string;
}

export type TokenExchangeResult =
  | { ok: true; tokens: TokenResponse }
  | { ok: false; errorDescription?: string };

/**
 * RFC 6749 §3.2 + RFC 7636 §4.5: authorization_code を access/refresh/id token に交換する。
 * tokenEndpointAuthMethod に応じて Basic ヘッダ / form body / client_id のみの 3 パターンを使い分ける。
 */
export async function exchangeCodeForTokens(
  config: ResolvedConfig,
  params: { code?: string; codeVerifier?: string; refreshToken?: string },
): Promise<TokenExchangeResult> {
  const body = new URLSearchParams();
  if (params.refreshToken) {
    body.set("grant_type", "refresh_token");
    body.set("refresh_token", params.refreshToken);
  } else {
    body.set("grant_type", "authorization_code");
    body.set("code", params.code!);
    body.set("redirect_uri", config.redirectUri);
    body.set("code_verifier", params.codeVerifier!);
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/x-www-form-urlencoded",
  };

  if (config.tokenEndpointAuthMethod === "client_secret_basic") {
    headers.Authorization = basicAuthHeader(config.clientId, config.clientSecret!);
  } else if (config.tokenEndpointAuthMethod === "client_secret_post") {
    body.set("client_id", config.clientId);
    body.set("client_secret", config.clientSecret!);
  } else {
    body.set("client_id", config.clientId);
  }

  const res = await config.fetch(ENDPOINTS.token, { method: "POST", headers, body });
  if (!res.ok) {
    const err = (await res.json().catch(() => null)) as {
      error?: string;
      error_description?: string;
    } | null;
    return { ok: false, errorDescription: err?.error_description ?? err?.error };
  }
  const tokens = (await res.json()) as TokenResponse;
  return { ok: true, tokens };
}
