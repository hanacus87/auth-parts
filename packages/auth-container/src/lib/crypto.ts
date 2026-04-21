const ULID_ENCODING = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** Date.now() (ms) を 10 文字の Crockford base32 にエンコードする。 */
function encodeUlidTime(ts: number): string {
  const out = new Array<string>(10);
  for (let i = 9; i >= 0; i--) {
    out[i] = ULID_ENCODING[ts & 0x1f]!;
    ts = Math.floor(ts / 32);
  }
  return out.join("");
}

/** 80bit の乱数を 5bit × 16 に bit-pack して 16 文字の Crockford base32 にする。 */
function encodeUlidRandom(): string {
  const b = crypto.getRandomValues(new Uint8Array(10));
  return (
    ULID_ENCODING[(b[0]! >> 3) & 0x1f]! +
    ULID_ENCODING[((b[0]! << 2) | (b[1]! >> 6)) & 0x1f]! +
    ULID_ENCODING[(b[1]! >> 1) & 0x1f]! +
    ULID_ENCODING[((b[1]! << 4) | (b[2]! >> 4)) & 0x1f]! +
    ULID_ENCODING[((b[2]! << 1) | (b[3]! >> 7)) & 0x1f]! +
    ULID_ENCODING[(b[3]! >> 2) & 0x1f]! +
    ULID_ENCODING[((b[3]! << 3) | (b[4]! >> 5)) & 0x1f]! +
    ULID_ENCODING[b[4]! & 0x1f]! +
    ULID_ENCODING[(b[5]! >> 3) & 0x1f]! +
    ULID_ENCODING[((b[5]! << 2) | (b[6]! >> 6)) & 0x1f]! +
    ULID_ENCODING[(b[6]! >> 1) & 0x1f]! +
    ULID_ENCODING[((b[6]! << 4) | (b[7]! >> 4)) & 0x1f]! +
    ULID_ENCODING[((b[7]! << 1) | (b[8]! >> 7)) & 0x1f]! +
    ULID_ENCODING[(b[8]! >> 2) & 0x1f]! +
    ULID_ENCODING[((b[8]! << 3) | (b[9]! >> 5)) & 0x1f]! +
    ULID_ENCODING[b[9]! & 0x1f]!
  );
}

/** ULID を生成する (26 文字、先頭 10 文字が timestamp、末尾 16 文字が 80bit 乱数、時間順にソート可能)。 */
export function generateId(): string {
  return encodeUlidTime(Date.now()) + encodeUlidRandom();
}

/** 指定バイト数の暗号学的乱数を Base64URL エンコードした文字列を返す。 */
export function generateRandomString(bytes: number): string {
  const array = new Uint8Array(bytes);
  crypto.getRandomValues(array);
  return base64urlEncode(array);
}

/** Uint8Array を Base64URL (padding なし) にエンコードする。 */
export function base64urlEncode(buffer: Uint8Array): string {
  return btoa(Array.from(buffer, (b) => String.fromCharCode(b)).join(""))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
}
