import { COOKIES } from "../constants";
import { openJWE, sealJWE } from "../crypto/jwe";
import { CookieSizeError } from "../errors";
import type { ResolvedConfig, SessionData, SetCookieDirective } from "../types";
import { clearCookie } from "./serialize";

interface SessionCookiePayload {
  uid: string;
  sid: string | null;
  at: string;
  rt: string | null;
  aexp: number;
  cat: number;
}

const MAX_COOKIE_BYTES = 3800;

function isSecure(config: ResolvedConfig): boolean {
  if (process.env.NODE_ENV === "production") return true;
  return config.redirectUri.startsWith("https://");
}

/**
 * SessionData を encryptionKeys[0] で暗号化し、Set-Cookie ディレクティブを返す。
 * id_token は含めない (サイズ抑制のため。Logout Hint が必要になったら別途設計)。
 */
export async function buildSessionCookie(
  data: SessionData,
  config: ResolvedConfig,
): Promise<SetCookieDirective> {
  const payload: SessionCookiePayload = {
    uid: data.userId,
    sid: data.opSessionId,
    at: data.accessToken,
    rt: data.refreshToken,
    aexp: data.accessTokenExpiresAt,
    cat: data.createdAt,
  };
  const token = await sealJWE(
    new TextEncoder().encode(JSON.stringify(payload)),
    config.encryptionKeys,
  );
  if (token.length > MAX_COOKIE_BYTES) {
    throw new CookieSizeError(
      `session cookie size ${token.length} exceeds ${MAX_COOKIE_BYTES} bytes`,
    );
  }
  return {
    httpOnly: true,
    secure: isSecure(config),
    sameSite: "Lax",
    name: config.sessionCookieName,
    value: token,
    path: COOKIES.session.path,
    maxAge: COOKIES.session.maxAge,
  };
}

/**
 * 受信 Cookie から SessionData を復元する。復号失敗や壊れた JSON は全て null。
 */
export async function readSessionCookie(
  cookies: Record<string, string>,
  config: ResolvedConfig,
): Promise<SessionData | null> {
  const token = cookies[config.sessionCookieName];
  if (!token) return null;
  const plaintext = await openJWE(token, config.encryptionKeys);
  if (!plaintext) return null;
  try {
    const p = JSON.parse(new TextDecoder().decode(plaintext)) as SessionCookiePayload;
    return {
      userId: p.uid,
      opSessionId: p.sid,
      accessToken: p.at,
      refreshToken: p.rt,
      accessTokenExpiresAt: p.aexp,
      createdAt: p.cat,
    };
  } catch {
    return null;
  }
}

/**
 * Session Cookie を消す Set-Cookie ディレクティブを返す。
 * ログアウト・失効時に呼び、応答に付与してブラウザに残る Cookie を Max-Age=0 で掃除する。
 */
export function buildSessionClearCookie(config: ResolvedConfig): SetCookieDirective {
  return clearCookie({
    name: config.sessionCookieName,
    path: COOKIES.session.path,
    secure: isSecure(config),
    sameSite: "Lax",
  });
}
