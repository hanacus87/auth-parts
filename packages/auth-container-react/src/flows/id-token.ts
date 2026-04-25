import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";
import { ENDPOINTS, ISSUER } from "../constants";

const JWKS = createRemoteJWKSet(new URL(ENDPOINTS.jwks));

/**
 * OIDC Core §3.1.3.7: id_token の署名・iss・aud・exp を検証する。
 * nonce 検証は呼び出し側で pending と比較する責務。
 * 検証失敗時は jose が例外を投げるので呼び出し側で try/catch する。
 */
export async function verifyIdToken(idToken: string, audience: string): Promise<JWTPayload> {
  const { payload } = await jwtVerify(idToken, JWKS, {
    issuer: ISSUER,
    audience,
    clockTolerance: 5,
  });
  return payload;
}
