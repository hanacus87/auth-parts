/**
 * "name=value; name2=value2" 形式の Cookie ヘッダを Record<string, string> に分解する。
 * 同名が複数あれば最初の値を採用 (Hono の getCookie と同じ挙動)。値の decodeURIComponent は
 * 本ライブラリで扱う Cookie が全て ASCII safe な JWE compact 形式のためスキップしている。
 */
export function parseCookieHeader(header: string | null | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    const name = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (name && !(name in out)) out[name] = value;
  }
  return out;
}
