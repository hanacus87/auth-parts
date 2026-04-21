#!/usr/bin/env bun
/**
 * seed.sql に埋め込む PBKDF2 ハッシュをオフラインで生成するユーティリティ。
 *
 * 使い方:
 *   `bun run scripts/gen-seed-hash.ts password123 admin123`
 * 出力された `pbkdf2$...` 文字列を drizzle/seed.sql に貼り付ける。Web Crypto のみ使うため Workers と同一のハッシュ形式になる。
 *
 * このファイルは Workers バンドルには含まれず Bun で直接実行される。Workers 用 tsconfig
 * (@cloudflare/workers-types) の対象外なので、Bun ランタイムが提供する最小限のグローバルをローカルで宣言している。
 */
declare const process: { argv: readonly string[]; exit(code?: number): never };

const ITERATIONS = 100_000;
const SALT_BYTES = 16;
const KEY_BITS = 256;

/** Uint8Array を標準 Base64 文字列にエンコードする。 */
function b64encode(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

/**
 * 平文パスワードから `pbkdf2$<iter>$<salt_b64>$<key_b64>` 形式のハッシュを生成する。
 * `lib/password.ts` の `hashPassword` と同じパラメータ (iterations / salt bytes / key bits) を使う。
 */
async function hash(plain: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(plain),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: salt as BufferSource, iterations: ITERATIONS, hash: "SHA-256" },
    key,
    KEY_BITS,
  );
  return `pbkdf2$${ITERATIONS}$${b64encode(salt)}$${b64encode(new Uint8Array(bits))}`;
}

const args = process.argv.slice(2);
if (args.length === 0) {
  console.error("usage: gen-seed-hash.ts <password1> [<password2> ...]");
  process.exit(1);
}

for (const plain of args) {
  console.log(`${plain} -> ${await hash(plain)}`);
}

export {};
