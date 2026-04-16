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
} from "jose";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";

interface KeyPair {
  privateKey: CryptoKey | import("jose").KeyLike;
  publicKey: CryptoKey | import("jose").KeyLike;
  kid: string;
}

let keyPair: KeyPair;

/** 起動時にキーペアを読み込むか新規生成する */
export async function loadOrGenerateKeyPair(): Promise<void> {
  const privPath = process.env.PRIVATE_KEY_PATH!;
  const pubPath = process.env.PUBLIC_KEY_PATH!;

  if (existsSync(privPath) && existsSync(pubPath)) {
    const [privPem, pubPem] = await Promise.all([
      readFile(privPath, "utf-8"),
      readFile(pubPath, "utf-8"),
    ]);
    keyPair = {
      privateKey: await importPKCS8(privPem, "RS256", { extractable: true }),
      publicKey: await importSPKI(pubPem, "RS256", { extractable: true }),
      kid: "key-1",
    };
    console.log("Loaded existing key pair");
  } else {
    const pair = await generateKeyPair("RS256", { modulusLength: 2048, extractable: true });
    await mkdir("./keys", { recursive: true });
    await Promise.all([
      writeFile(privPath, await exportPKCS8(pair.privateKey)),
      writeFile(pubPath, await exportSPKI(pair.publicKey)),
    ]);
    keyPair = { ...pair, kid: "key-1" };
    console.log("Generated new key pair");
  }
}

/** アクセストークン (JWT/RS256) を生成する */
export async function signAccessToken(payload: JWTPayload & { jti: string }): Promise<string> {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: "RS256", kid: keyPair.kid, typ: "JWT" })
    .setIssuedAt()
    .setIssuer(process.env.ISSUER!)
    .setExpirationTime(`${process.env.ACCESS_TOKEN_TTL}s`)
    .sign(keyPair.privateKey);
}

/** ID Token (JWT/RS256) を生成する。OIDC Core §2 準拠 */
export async function signIdToken(payload: {
  sub: string;
  aud: string;
  nonce?: string;
  auth_time?: number;
  sid?: string;
}): Promise<string> {
  return new SignJWT({
    ...payload,
    amr: ["pwd"],
  })
    .setProtectedHeader({ alg: "RS256", kid: keyPair.kid, typ: "JWT" })
    .setIssuedAt()
    .setIssuer(process.env.ISSUER!)
    .setAudience(payload.aud)
    .setExpirationTime(`${process.env.ID_TOKEN_TTL}s`)
    .sign(keyPair.privateKey);
}

/** id_token_hint の署名を検証する (RP-Initiated Logout 用)
 *  期限切れトークンも受け付ける (OIDC RP-Initiated Logout §2) */
export async function verifyIdTokenHint(token: string): Promise<JWTPayload | null> {
  try {
    const { payload } = await jwtVerify(token, keyPair.publicKey, {
      issuer: process.env.ISSUER!,
      // id_token_hint は期限切れでも受け付ける
      clockTolerance: 365 * 24 * 60 * 60,
    });
    return payload;
  } catch {
    return null;
  }
}

/** Back-Channel Logout 用の logout_token (JWT/RS256) を生成する
 *  OIDC Back-Channel Logout 1.0 §2.4 準拠 */
export async function signLogoutToken(payload: {
  sub: string;
  aud: string;
  jti: string;
  sid?: string;
}): Promise<string> {
  return new SignJWT({
    sub: payload.sub,
    sid: payload.sid,
    events: {
      "http://schemas.openid.net/event/backchannel-logout": {},
    },
  })
    .setProtectedHeader({ alg: "RS256", kid: keyPair.kid, typ: "JWT" })
    .setIssuedAt()
    .setIssuer(process.env.ISSUER!)
    .setAudience(payload.aud)
    .setJti(payload.jti)
    .setExpirationTime("2m")
    .sign(keyPair.privateKey);
}

/** JWKS (公開鍵セット) を返す。RFC 7517 §5 準拠 */
export async function getJWKS() {
  const jwk = await exportJWK(keyPair.publicKey);
  return {
    keys: [{ ...jwk, use: "sig", alg: "RS256", kid: keyPair.kid }],
  };
}
