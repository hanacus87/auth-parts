import type { SessionData } from "./session";
import { basicAuthHeader } from "./crypto";

const AUTH_SERVER = process.env.AUTH_SERVER_URL!;

/** access_token の期限切れ時に refresh_token でサーバー間リフレッシュを行う */
export async function refreshTokens(session: SessionData): Promise<SessionData | null> {
  if (!session.refreshToken) return null;

  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: session.refreshToken,
  });

  const res = await fetch(`${AUTH_SERVER}/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: basicAuthHeader(),
    },
    body,
  });

  if (!res.ok) return null;

  const tokens = (await res.json()) as {
    access_token: string;
    expires_in: number;
    refresh_token?: string;
    id_token: string;
  };

  return {
    ...session,
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token ?? session.refreshToken,
    idToken: tokens.id_token,
    accessTokenExpiresAt: Math.floor(Date.now() / 1000) + tokens.expires_in,
  };
}
