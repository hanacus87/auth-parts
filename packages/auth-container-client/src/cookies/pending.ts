import { COOKIES } from "../constants";
import { openJWE, sealJWE } from "../crypto/jwe";
import { CookieSizeError } from "../errors";
import type { ResolvedConfig, SetCookieDirective } from "../types";
import { clearCookie } from "./serialize";

export interface PendingAuthPayload {
  s: string;
  v: string;
  n: string;
  r?: string;
  iat: number;
}

const MAX_COOKIE_BYTES = 3800;

/**
 * JWE Cookie 共通属性を決定する。Secure は本番のみ、SameSite=Lax, HttpOnly, Domain 未指定。
 * (constants.COOKIES に書ききれない「動的属性」だけここで決める)
 */
function baseAttrs(
  config: ResolvedConfig,
): Pick<SetCookieDirective, "httpOnly" | "secure" | "sameSite"> {
  return {
    httpOnly: true,
    secure: isSecure(config),
    sameSite: "Lax",
  };
}

/**
 * Cookie の Secure 属性を決める。NODE_ENV=production なら常に true、それ以外は redirectUri の
 * scheme で判定する (ローカル dev の `http://localhost` を許容するため)。prod + http:// の組合せは
 * resolveConfig 側で起動時に弾いている前提。
 */
function isSecure(config: ResolvedConfig): boolean {
  if (process.env.NODE_ENV === "production") return true;
  return config.redirectUri.startsWith("https://");
}

/**
 * Pending Auth ({ state, codeVerifier, nonce, returnTo, iat } の短縮キー JSON) を encryptionKeys[0] で
 * JWE 暗号化して Set-Cookie ディレクティブを返す。RFC 6265 実装互換の 3800 byte を超えたら
 * CookieSizeError を投げて早期に誤設定を検出する (returnTo の異常な長さ等)。
 */
export async function buildPendingCookie(
  payload: PendingAuthPayload,
  config: ResolvedConfig,
): Promise<SetCookieDirective> {
  const json = JSON.stringify(payload);
  const token = await sealJWE(new TextEncoder().encode(json), config.encryptionKeys);
  if (token.length > MAX_COOKIE_BYTES) {
    throw new CookieSizeError(
      `pending cookie size ${token.length} exceeds ${MAX_COOKIE_BYTES} bytes`,
    );
  }
  return {
    ...baseAttrs(config),
    name: COOKIES.pending.name,
    value: token,
    path: COOKIES.pending.path,
    maxAge: COOKIES.pending.maxAge,
  };
}

/**
 * 受信 Cookie から Pending Auth を復元する。復号失敗・JSON パース失敗は全て null 扱い。
 * 復号失敗の理由は区別せず、呼び出し側は state_mismatch として統一処理する (情報漏洩回避)。
 */
export async function readPendingCookie(
  cookies: Record<string, string>,
  config: ResolvedConfig,
): Promise<PendingAuthPayload | null> {
  const token = cookies[COOKIES.pending.name];
  if (!token) return null;
  const plaintext = await openJWE(token, config.encryptionKeys);
  if (!plaintext) return null;
  try {
    return JSON.parse(new TextDecoder().decode(plaintext)) as PendingAuthPayload;
  } catch {
    return null;
  }
}

/**
 * Pending Cookie を消すディレクティブ。callback の成功・失敗どちらでも必ず応答に含める。
 */
export function buildPendingClearCookie(config: ResolvedConfig): SetCookieDirective {
  return clearCookie({
    name: COOKIES.pending.name,
    path: COOKIES.pending.path,
    secure: isSecure(config),
    sameSite: "Lax",
  });
}
