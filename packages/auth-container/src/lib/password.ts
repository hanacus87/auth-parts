import { safeEqual } from "./safe-equal";

const PBKDF2_ITERATIONS = 100_000;
const PBKDF2_HASH = "SHA-256";
const PBKDF2_SALT_BYTES = 16;
const PBKDF2_KEY_BITS = 256;
const PREFIX = "pbkdf2";

/** Uint8Array を標準 Base64 文字列にエンコードする。 */
function b64encode(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

/** 標準 Base64 文字列を Uint8Array にデコードする。 */
function b64decode(str: string): Uint8Array {
  const bin = atob(str);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * PBKDF2-SHA256 で鍵を導出する。
 * Cloudflare Workers の Web Crypto は iterations 上限が 100,000 (OWASP 推奨 600,000 には届かないが、Workers 上での最大値)。
 *
 * @param password - 平文パスワード
 * @param salt - 16 バイトのソルト (new 時は `crypto.getRandomValues` で生成)
 * @param iterations - 反復回数。保存済みハッシュから取り出した値を渡す (検証時) か、`PBKDF2_ITERATIONS` を渡す (生成時)
 * @returns 256bit 派生鍵
 */
async function derive(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: salt as BufferSource, iterations, hash: PBKDF2_HASH },
    key,
    PBKDF2_KEY_BITS,
  );
  return new Uint8Array(bits);
}

/**
 * 平文パスワードを PBKDF2 でハッシュ化する。
 *
 * @returns `pbkdf2$<iter>$<salt_b64>$<key_b64>` 形式の文字列
 */
export async function hashPassword(plain: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(PBKDF2_SALT_BYTES));
  const derived = await derive(plain, salt, PBKDF2_ITERATIONS);
  return `${PREFIX}$${PBKDF2_ITERATIONS}$${b64encode(salt)}$${b64encode(derived)}`;
}

let dummyHashPromise: Promise<string> | null = null;

/**
 * タイミング攻撃対策用のダミーハッシュを遅延生成・キャッシュする。
 * 初回のみ PBKDF2 を実行し、以降は同じ Promise を返す。
 */
export function getDummyPasswordHash(): Promise<string> {
  if (!dummyHashPromise) {
    dummyHashPromise = hashPassword("dummy");
  }
  return dummyHashPromise;
}

/**
 * 平文パスワードを定数時間で検証する。
 * ユーザー未存在時もダミーハッシュに対して PBKDF2 を走らせ、応答時間でのユーザー列挙を防ぐ。
 * 保存ハッシュが未知形式の場合も、応答時間を揃えるため実際の derive を実行してから false を返す。
 *
 * @param plain - 検証したい平文パスワード
 * @param knownHash - DB に保存されているハッシュ (無い場合はダミーハッシュに対して PBKDF2 を走らせる)
 * @returns 一致すれば true、そうでなければ false
 */
export async function verifyPasswordConstantTime(
  plain: string,
  knownHash: string | undefined,
): Promise<boolean> {
  const target = knownHash ?? (await getDummyPasswordHash());
  const parts = target.split("$");
  if (parts.length !== 4 || parts[0] !== PREFIX) {
    await derive(plain, new Uint8Array(PBKDF2_SALT_BYTES), PBKDF2_ITERATIONS);
    return false;
  }
  const iterations = Number.parseInt(parts[1]!, 10);
  if (!Number.isFinite(iterations) || iterations <= 0) {
    await derive(plain, new Uint8Array(PBKDF2_SALT_BYTES), PBKDF2_ITERATIONS);
    return false;
  }
  const salt = b64decode(parts[2]!);
  const expectedB64 = parts[3]!;
  const derived = await derive(plain, salt, iterations);
  return safeEqual(b64encode(derived), expectedB64);
}
