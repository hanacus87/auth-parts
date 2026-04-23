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
  type JWTVerifyGetKey,
  type KeyLike,
} from "jose";
import { desc, eq, or } from "drizzle-orm";
import type { Bindings } from "../types";
import type { DB } from "../db";
import { cryptoKeys } from "../db/schema";
import { generateId } from "./crypto";

interface KeyPair {
  privateKey: CryptoKey | KeyLike;
  publicKey: CryptoKey | KeyLike;
  kid: string;
  alg: string;
}

type CryptoKeyRow = typeof cryptoKeys.$inferSelect;

const kidCache = new Map<string, Promise<KeyPair>>();

/**
 * DB から取得した 1 行を CryptoKey オブジェクトへ復元する内部ヘルパ。
 * 同じ kid を複数回復元しないよう kidCache で共有し、失敗時は次回再試行できるよう破棄する。
 */
function loadRow(row: CryptoKeyRow): Promise<KeyPair> {
  const existing = kidCache.get(row.kid);
  if (existing) return existing;
  const promise = (async (): Promise<KeyPair> => ({
    kid: row.kid,
    alg: row.alg,
    privateKey: await importPKCS8(row.privateKeyPem, row.alg, { extractable: true }),
    publicKey: await importSPKI(row.publicKeyPem, row.alg, { extractable: true }),
  }))();
  promise.catch(() => {
    kidCache.delete(row.kid);
  });
  kidCache.set(row.kid, promise);
  return promise;
}

/**
 * 署名に使用する active 鍵を返す。複数 active があれば最新 createdAt を採用する。
 * active がひとつも無い場合 (ブートストラップ時) は 2048bit RSA 鍵を 1 本生成して INSERT する。
 * 並行 INSERT の race は PK 衝突で吸収し、active を再 SELECT して拾い直す。
 */
export async function getActiveSigningKey(db: DB): Promise<KeyPair> {
  const row = await db.query.cryptoKeys.findFirst({
    where: eq(cryptoKeys.status, "active"),
    orderBy: [desc(cryptoKeys.createdAt)],
  });
  if (row) return loadRow(row);
  const alg = "RS256";
  const kid = generateId();
  const pair = await generateKeyPair(alg, { modulusLength: 2048, extractable: true });
  const privateKeyPem = await exportPKCS8(pair.privateKey);
  const publicKeyPem = await exportSPKI(pair.publicKey);
  try {
    await db.insert(cryptoKeys).values({
      kid,
      alg,
      privateKeyPem,
      publicKeyPem,
      status: "active",
    });
    const inserted = await db.query.cryptoKeys.findFirst({ where: eq(cryptoKeys.kid, kid) });
    if (!inserted) throw new Error("Failed to load newly inserted crypto key");
    return loadRow(inserted);
  } catch {
    const again = await db.query.cryptoKeys.findFirst({
      where: eq(cryptoKeys.status, "active"),
      orderBy: [desc(cryptoKeys.createdAt)],
    });
    if (!again) throw new Error("Failed to persist crypto key");
    return loadRow(again);
  }
}

/**
 * 指定 kid の鍵を返す。
 * status が `retired` の鍵や存在しない kid の場合は null を返す。
 * JWT 検証時に header.kid から公開鍵を引き当てるために使用する。
 */
export async function getKeyPairByKid(db: DB, kid: string): Promise<KeyPair | null> {
  const row = await db.query.cryptoKeys.findFirst({ where: eq(cryptoKeys.kid, kid) });
  if (!row) return null;
  if (row.status === "retired") return null;
  return loadRow(row);
}

/**
 * JWKS (RFC 7517 §5) に返却する公開鍵一覧を組み立てる。
 * status が `active` または `deprecated` の鍵のみを含み、`retired` は除外する。
 */
export async function listPublicJwks(db: DB): Promise<{ keys: unknown[] }> {
  const rows = await db.query.cryptoKeys.findMany({
    where: or(eq(cryptoKeys.status, "active"), eq(cryptoKeys.status, "deprecated")),
  });
  const keys = await Promise.all(
    rows.map(async (row) => {
      const publicKey = await importSPKI(row.publicKeyPem, row.alg, { extractable: true });
      const jwk = await exportJWK(publicKey);
      return { ...jwk, use: "sig", alg: row.alg, kid: row.kid };
    }),
  );
  return { keys };
}

/**
 * jwtVerify に渡す kid ベースの鍵解決関数を生成する。
 * protectedHeader.kid が無い、または未知 / retired の kid の場合は例外を投げて検証失敗させる。
 */
function kidResolver(db: DB): JWTVerifyGetKey {
  return async (header) => {
    if (!header.kid) throw new Error("missing kid in JWT header");
    const kp = await getKeyPairByKid(db, header.kid);
    if (!kp) throw new Error("unknown or retired kid");
    return kp.publicKey;
  };
}

/**
 * JWT 形式のアクセストークンに署名する (RFC 9068 §2)。
 * ヘッダは `typ=at+jwt` + active 鍵の kid、ペイロードには `client_id` を含める。
 */
export async function signAccessToken(
  db: DB,
  env: Bindings,
  payload: JWTPayload & { jti: string; sub: string; aud: string; client_id: string },
): Promise<string> {
  const kp = await getActiveSigningKey(db);
  return new SignJWT(payload)
    .setProtectedHeader({ alg: "RS256", kid: kp.kid, typ: "at+jwt" })
    .setIssuedAt()
    .setIssuer(env.ISSUER)
    .setExpirationTime(`${env.ACCESS_TOKEN_TTL}s`)
    .sign(kp.privateKey);
}

/**
 * アクセストークンの署名 / iss / aud / exp / typ を検証する (RFC 9068)。
 * 成功すれば JWTPayload を返し、検証失敗や期限切れの場合は null を返す。
 * 複数鍵に対応するため header.kid で公開鍵を引き当てる (JWKS rotation)。
 */
export async function verifyAccessToken(
  db: DB,
  env: Bindings,
  token: string,
): Promise<JWTPayload | null> {
  try {
    const { payload } = await jwtVerify(token, kidResolver(db), {
      issuer: env.ISSUER,
      algorithms: ["RS256"],
      typ: "at+jwt",
    });
    return payload;
  } catch {
    return null;
  }
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
  const kp = await getActiveSigningKey(db);
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
 * kid ベースで鍵を解決するため、ローテ後 deprecated 鍵で署名された token も検証できる。
 */
export async function verifyIdTokenHint(
  db: DB,
  env: Bindings,
  token: string,
): Promise<JWTPayload | null> {
  try {
    const { payload } = await jwtVerify(token, kidResolver(db), {
      issuer: env.ISSUER,
      algorithms: ["RS256"],
      clockTolerance: 60,
    });
    return payload;
  } catch (err: unknown) {
    const e = err as { code?: string; payload?: JWTPayload };
    if (e?.code === "ERR_JWT_EXPIRED" && e.payload) {
      return e.payload;
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
  const kp = await getActiveSigningKey(db);
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
