import { buildPendingClearCookie, readPendingCookie } from "../cookies/pending";
import { buildSessionCookie } from "../cookies/session";
import { safeEqual } from "../crypto/safe-equal";
import type { CallbackResult, ResolvedConfig, SessionData } from "../types";
import { verifyIdToken } from "./id-token";
import { exchangeCodeForTokens } from "./token-exchange";

/**
 * OIDC Core §3.1.2.5 + RFC 9700 §4.5.3.1 に基づく Authorization Response 処理。
 *
 * 実行順序は意図的に次の通り:
 *   1. state バインディング検証 (失敗時はサイレント。Cookie だけ消す)
 *   2. ?error= の判定 (先に state を見るのは RFC 9700 §4.5.3.1 の DoS 緩和)
 *   3. code 有無の判定
 *   4. /token 交換
 *   5. id_token の署名・iss・aud・exp 検証
 *   6. nonce 一致検証
 *   7. SessionData 組み立て → Session Cookie 発行
 *
 * 成功・失敗を問わず Pending Cookie を Max-Age=0 でクリアする指示を含めて返す。
 */
export async function handleCallback(
  config: ResolvedConfig,
  input: {
    query: Record<string, string | undefined>;
    cookies: Record<string, string>;
  },
): Promise<CallbackResult> {
  const clearPending = buildPendingClearCookie(config);

  const state = input.query.state;
  const pending = await readPendingCookie(input.cookies, config);

  if (!state || !pending || !safeEqual(pending.s, state)) {
    return { ok: false, kind: "state_mismatch", setCookies: [clearPending] };
  }

  if (input.query.error) {
    return {
      ok: false,
      kind: "op_error",
      opError: {
        error: input.query.error,
        errorDescription: input.query.error_description,
      },
      setCookies: [clearPending],
    };
  }

  const code = input.query.code;
  if (!code) {
    return { ok: false, kind: "missing_code", setCookies: [clearPending] };
  }

  const exchange = await exchangeCodeForTokens(config, {
    code,
    codeVerifier: pending.v,
  });
  if (!exchange.ok) {
    return {
      ok: false,
      kind: "token_exchange",
      opError: exchange.errorDescription
        ? { error: "token_exchange_failed", errorDescription: exchange.errorDescription }
        : undefined,
      setCookies: [clearPending],
    };
  }

  let sub: string;
  let sid: string | null;
  try {
    const payload = await verifyIdToken(exchange.tokens.id_token, config.clientId);
    if (!payload.sub) {
      return { ok: false, kind: "id_token", setCookies: [clearPending] };
    }
    if (payload["nonce"] !== pending.n) {
      return { ok: false, kind: "nonce_mismatch", setCookies: [clearPending] };
    }
    sub = payload.sub;
    sid = (payload["sid"] as string | undefined) ?? null;
  } catch {
    return { ok: false, kind: "id_token", setCookies: [clearPending] };
  }

  const now = config.clock();
  const sessionData: SessionData = {
    userId: sub,
    opSessionId: sid,
    accessToken: exchange.tokens.access_token,
    refreshToken: exchange.tokens.refresh_token ?? null,
    accessTokenExpiresAt: now + exchange.tokens.expires_in,
    createdAt: now,
  };

  const sessionCookie = await buildSessionCookie(sessionData, config);

  return {
    ok: true,
    session: {
      userId: sessionData.userId,
      opSessionId: sessionData.opSessionId,
      accessTokenExpiresAt: sessionData.accessTokenExpiresAt,
      createdAt: sessionData.createdAt,
    },
    returnTo: pending.r,
    setCookies: [sessionCookie, clearPending],
  };
}
