/**
 * 公開網上の HTTPS エンドポイントであることを検証する。
 * localhost / loopback / private IP / IP リテラル / 予約 TLD を拒否して SSRF を防ぐ。
 * `allowHttp=true` の時のみ `http://` を許容する (開発環境以外では使用しない想定)。
 * `allowLoopback=true` の時のみ loopback 宛 (localhost / 127.0.0.0/8 / ::1 / *.localhost) を許容する。
 */
export function isPublicHttpsUrl(
  raw: string,
  opts?: { allowHttp?: boolean; allowLoopback?: boolean },
): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  const allowHttp = opts?.allowHttp === true;
  if (url.protocol !== "https:" && !(allowHttp && url.protocol === "http:")) {
    return false;
  }
  const host = url.hostname.toLowerCase();
  if (opts?.allowLoopback === true && isLoopback(host)) return true;
  if (isIpLiteral(host)) return false;
  if (isLoopbackOrPrivate(host)) return false;
  if (isReservedTld(host)) return false;
  return true;
}

/**
 * loopback にしか解決しない宛先 (localhost / 127.0.0.0/8 / ::1 / *.localhost) を判定する。
 * RFC 6761 より `*.localhost` は必ずループバックに解決される。
 */
function isLoopback(host: string): boolean {
  if (host === "localhost") return true;
  if (host.endsWith(".localhost")) return true;
  if (/^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host)) return true;
  if (host === "::1" || host === "[::1]") return true;
  return false;
}

/**
 * ホスト名が IPv4 / IPv6 のリテラル記法か判定する。
 * DNS rebinding 対策として、ドメイン名形式以外 (数値アドレス直指定) は拒否する。
 */
function isIpLiteral(host: string): boolean {
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return true;
  if (host.startsWith("[") && host.endsWith("]")) return true;
  if (host.includes(":")) return true;
  return false;
}

/**
 * loopback / private IP 範囲 / link-local / ユニークローカル IPv6 を検出する。
 * RFC 1918 / RFC 4193 / RFC 3927 の各予約レンジをカバーする。
 */
function isLoopbackOrPrivate(host: string): boolean {
  if (host === "localhost") return true;
  if (host.startsWith("127.")) return true;
  if (host.startsWith("10.")) return true;
  if (host.startsWith("192.168.")) return true;
  if (host.startsWith("169.254.")) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(host)) return true;
  if (host === "::1") return true;
  if (host.startsWith("fc") || host.startsWith("fd")) return true;
  return false;
}

/**
 * RFC 2606 / RFC 6761 等で予約された TLD を検出する。
 * 内部サービス向けに使われがちな `.local` `.internal` も拒否対象に含める。
 */
function isReservedTld(host: string): boolean {
  return /\.(local|internal|localhost|test|invalid|example)$/i.test(host);
}
