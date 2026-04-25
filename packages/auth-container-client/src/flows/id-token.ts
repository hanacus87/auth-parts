import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";
import { ENDPOINTS, ISSUER } from "../constants";

const JWKS = createRemoteJWKSet(new URL(ENDPOINTS.jwks));

/**
 * OIDC Core §3.1.3.7: id_token の署名・iss・aud・exp を検証する。
 * nonce 検証は呼び出し側で Pending Auth の nonce と比較する (ここでは payload のみ返す)。
 * 検証失敗時は例外 throw されるので呼び出し側で try/catch する。
 *
 * JWKS (`createRemoteJWKSet`) はモジュールロード時に 1 度だけ初期化し、以降は jose 内部で
 * HTTP キャッシュされる (OIDC Core §10.1 / RFC 7517 の鍵ローテに対応)。
 */
export async function verifyIdToken(idToken: string, audience: string): Promise<JWTPayload> {
  const { payload } = await jwtVerify(idToken, JWKS, {
    issuer: ISSUER,
    audience,
    clockTolerance: 5,
  });
  return payload;
}
