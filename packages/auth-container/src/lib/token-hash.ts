/**
 * 入力文字列の SHA-256 を 16 進文字列で返す。
 * 高エントロピーな認可コードや refresh_token を DB に索引化する際に、
 * 平文ではなくこのハッシュ値のみを保存するために使う。
 */
export async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
