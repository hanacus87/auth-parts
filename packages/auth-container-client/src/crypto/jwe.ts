import { CompactEncrypt, compactDecrypt } from "jose";
import { base64urlEncode } from "./base64url";

const ALG = "dir";
const ENC = "A256GCM";

/**
 * 鍵 (32 bytes) から kid を導出する。SHA-256 の先頭 8 bytes を base64url エンコード。
 * kid は JWE ヘッダに埋め、復号時に鍵を特定する手掛かりにする (ミスマッチ時は全鍵試行)。
 *
 * `new Uint8Array(key)` で ArrayBuffer-backed のコピーを作って `crypto.subtle.digest` に渡している
 * のは、TS の BufferSource 互換性要件 (SharedArrayBuffer-backed を弾く) を満たすため。入力は
 * 32 byte なのでコピーコストは無視できる。
 */
async function deriveKid(key: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new Uint8Array(key));
  return base64urlEncode(new Uint8Array(digest).subarray(0, 8));
}

/**
 * 平文 payload を JWE (dir + A256GCM) で暗号化して compact 形式で返す。
 * keys[0] が現行鍵。kid ヘッダで復号側に鍵の識別子を伝える。
 */
export async function sealJWE(payload: Uint8Array, keys: Uint8Array[]): Promise<string> {
  const key = keys[0];
  if (!key) throw new Error("sealJWE requires at least one key");
  const kid = await deriveKid(key);
  return new CompactEncrypt(payload).setProtectedHeader({ alg: ALG, enc: ENC, kid }).encrypt(key);
}

/**
 * JWE compact 文字列を復号する。ヘッダ kid が keys のいずれかと一致すればそれを先に試し、
 * 一致しなかった場合は全鍵を順に試行する (鍵ローテ途中で kid 未伝搬の古い Cookie を救うため)。
 * どの鍵でも開けなかった場合は null を返す (復号失敗は常にサイレントに扱う方針)。
 */
export async function openJWE(token: string, keys: Uint8Array[]): Promise<Uint8Array | null> {
  if (keys.length === 0) return null;

  const header = peekHeader(token);
  const headerKid = header?.kid;

  const ordered: Uint8Array[] = [];
  if (headerKid) {
    for (const k of keys) {
      if ((await deriveKid(k)) === headerKid) {
        ordered.push(k);
        break;
      }
    }
  }
  for (const k of keys) {
    if (!ordered.includes(k)) ordered.push(k);
  }

  for (const k of ordered) {
    try {
      const { plaintext } = await compactDecrypt(token, k);
      return plaintext;
    } catch {
      continue;
    }
  }
  return null;
}

/**
 * compact JWE の protected header (1 つ目のドット区切り) だけを base64url デコードして
 * JSON として返す。失敗しても例外は投げず null を返す。
 */
function peekHeader(token: string): { kid?: string } | null {
  const dot = token.indexOf(".");
  if (dot <= 0) return null;
  try {
    const headerB64 = token.slice(0, dot);
    const pad = "=".repeat((4 - (headerB64.length % 4)) % 4);
    const b64 = (headerB64 + pad).replace(/-/g, "+").replace(/_/g, "/");
    const json = atob(b64);
    return JSON.parse(json) as { kid?: string };
  } catch {
    return null;
  }
}
