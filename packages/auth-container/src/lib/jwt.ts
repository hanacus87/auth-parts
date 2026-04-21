import {
  exportPKCS8,
  exportSPKI,
  generateKeyPair,
  importPKCS8,
  importSPKI,
  SignJWT,
  jwtVerify,
  exportJWK,
  type JWTPayload,
  type KeyLike,
} from "jose";
import { desc, eq } from "drizzle-orm";
import type { Bindings } from "../types";
import type { DB } from "../db";
import { cryptoKeys } from "../db/schema";

interface KeyPair {
  privateKey: CryptoKey | KeyLike;
  publicKey: CryptoKey | KeyLike;
  kid: string;
  alg: string;
}

let cached: Promise<KeyPair> | null = null;

/**
 * D1 の `crypto_keys` から鍵をロードする。未存在なら 2048bit RSA 鍵を生成して INSERT する。
 * Worker 単一インスタンス内で memoize し、初回のみ数百 ms 掛かる。失敗時は cache をクリアして次リクエストで再試行する。
 * 並行生成の race は PK 衝突で吸収し、SELECT で拾い直す。
 */
export async function getKeyPair(db: DB): Promise<KeyPair> {
  if (cached) return cached;
  cached = (async (): Promise<KeyPair> => {
    const row = await db.query.cryptoKeys.findFirst({
      orderBy: [desc(cryptoKeys.createdAt)],
    });
    if (row) {
      return {
        kid: row.kid,
        alg: row.alg,
        privateKey: await importPKCS8(row.privateKeyPem, row.alg, { extractable: true }),
        publicKey: await importSPKI(row.publicKeyPem, row.alg, { extractable: true }),
      };
    }
    const alg = "RS256";
    const kid = "key-1";
    const pair = await generateKeyPair(alg, { modulusLength: 2048, extractable: true });
    const privateKeyPem = await exportPKCS8(pair.privateKey);
    const publicKeyPem = await exportSPKI(pair.publicKey);
    try {
      await db.insert(cryptoKeys).values({ kid, alg, privateKeyPem, publicKeyPem });
      return { kid, alg, privateKey: pair.privateKey, publicKey: pair.publicKey };
    } catch {
      const again = await db.query.cryptoKeys.findFirst({ where: eq(cryptoKeys.kid, kid) });
      if (!again) throw new Error("Failed to persist crypto key");
      return {
        kid: again.kid,
        alg: again.alg,
        privateKey: await importPKCS8(again.privateKeyPem, again.alg, { extractable: true }),
        publicKey: await importSPKI(again.publicKeyPem, again.alg, { extractable: true }),
      };
    }
  })();
  cached.catch(() => {
    cached = null;
  });
  return cached;
}

/**
 * JWT 形式のアクセストークンに署名する (RFC 9068 §2)。
 * ヘッダは `typ=at+jwt`、ペイロードには `client_id` を含める。
 */
export async function signAccessToken(
  db: DB,
  env: Bindings,
  payload: JWTPayload & { jti: string; sub: string; aud: string; client_id: string },
): Promise<string> {
  const kp = await getKeyPair(db);
  return new SignJWT(payload)
    .setProtectedHeader({ alg: "RS256", kid: kp.kid, typ: "at+jwt" })
    .setIssuedAt()
    .setIssuer(env.ISSUER)
    .setExpirationTime(`${env.ACCESS_TOKEN_TTL}s`)
    .sign(kp.privateKey);
}

/**
 * ID Token に署名する (OIDC Core §2)。
 * `amr=["pwd"]` を自動付与する。
 */
export async function signIdToken(
  db: DB,
  env: Bindings,
  payload: {
    sub: string;
    aud: string;
    nonce?: string;
    auth_time?: number;
    sid?: string;
  },
): Promise<string> {
  const kp = await getKeyPair(db);
  return new SignJWT({
    ...payload,
    amr: ["pwd"],
  })
    .setProtectedHeader({ alg: "RS256", kid: kp.kid, typ: "JWT" })
    .setIssuedAt()
    .setIssuer(env.ISSUER)
    .setAudience(payload.aud)
    .setExpirationTime(`${env.ID_TOKEN_TTL}s`)
    .sign(kp.privateKey);
}

/**
 * `id_token_hint` の署名を検証する (OIDC RP-Initiated Logout §2 用途)。
 * 期限切れでも署名が有効な場合は payload を返す。検証失敗時は null。
 */
export async function verifyIdTokenHint(
  db: DB,
  env: Bindings,
  token: string,
): Promise<JWTPayload | null> {
  const kp = await getKeyPair(db);
  try {
    const { payload } = await jwtVerify(token, kp.publicKey, {
      issuer: env.ISSUER,
      clockTolerance: 60,
    });
    return payload;
  } catch (err: any) {
    if (err?.code === "ERR_JWT_EXPIRED" && err.payload) {
      return err.payload as JWTPayload;
    }
    return null;
  }
}

/** Back-Channel Logout Token に署名する (OIDC Back-Channel Logout 1.0 §2.4)。 */
export async function signLogoutToken(
  db: DB,
  env: Bindings,
  payload: {
    sub: string;
    aud: string;
    jti: string;
    sid?: string;
  },
): Promise<string> {
  const kp = await getKeyPair(db);
  return new SignJWT({
    sub: payload.sub,
    sid: payload.sid,
    events: {
      "http://schemas.openid.net/event/backchannel-logout": {},
    },
  })
    .setProtectedHeader({ alg: "RS256", kid: kp.kid, typ: "JWT" })
    .setIssuedAt()
    .setIssuer(env.ISSUER)
    .setAudience(payload.aud)
    .setJti(payload.jti)
    .setExpirationTime("2m")
    .sign(kp.privateKey);
}

/** JWKS (RFC 7517 §5) を組み立てて返す。 */
export async function getJWKS(db: DB) {
  const kp = await getKeyPair(db);
  const jwk = await exportJWK(kp.publicKey);
  return {
    keys: [{ ...jwk, use: "sig", alg: kp.alg, kid: kp.kid }],
  };
}
