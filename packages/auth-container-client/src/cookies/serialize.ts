import type { SetCookieDirective } from "../types";

/**
 * SetCookieDirective を RFC 6265 §4.1.1 の Set-Cookie ヘッダ値にシリアライズする。
 * Hono 等の framework に依存しないため、ここでは "name=value; Path=...; HttpOnly; ..." 形式の
 * 単一文字列を返す。framework 側は複数 Set-Cookie を header に追加すればよい。
 *
 * RFC 6265 §5.4: HttpOnly / Secure は属性名のみ、Path / Max-Age / Expires / Domain / SameSite は値付き。
 */
export function serializeSetCookie(d: SetCookieDirective): string {
  const parts: string[] = [`${d.name}=${d.value}`];
  if (d.path) parts.push(`Path=${d.path}`);
  if (d.domain) parts.push(`Domain=${d.domain}`);
  if (typeof d.maxAge === "number") parts.push(`Max-Age=${d.maxAge}`);
  if (d.expires) parts.push(`Expires=${d.expires.toUTCString()}`);
  if (d.sameSite) parts.push(`SameSite=${d.sameSite}`);
  if (d.secure) parts.push("Secure");
  if (d.httpOnly) parts.push("HttpOnly");
  return parts.join("; ");
}

/**
 * 与えた名前の Cookie を Max-Age=0 で消すディレクティブを作る。
 * path / domain / secure / sameSite は発行時と揃える必要がある (RFC 6265 §5.3)。
 */
export function clearCookie(params: {
  name: string;
  path: string;
  secure: boolean;
  sameSite: SetCookieDirective["sameSite"];
  domain?: string;
}): SetCookieDirective {
  return {
    name: params.name,
    value: "",
    httpOnly: true,
    secure: params.secure,
    sameSite: params.sameSite,
    path: params.path,
    domain: params.domain,
    maxAge: 0,
  };
}
