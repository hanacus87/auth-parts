import type { ResolvedConfig, SessionData } from "../types";
import { exchangeCodeForTokens } from "./token-exchange";

export const REFRESH_BUFFER_SECONDS = 30;

/**
 * 与えられた SessionData の access_token がそろそろ切れる場合に refresh_token で更新する。
 * - refresh_token が無ければ何もせず null を返す (更新不能 / 失効扱い)
 * - 期限まで残り <= REFRESH_BUFFER_SECONDS (30 秒) になったタイミングで更新を試みる
 * - 期限まで余裕があれば更新せず null を返す
 * - 更新成功時は新しい SessionData を返す。OP 側のトークンローテーションで返却される
 *   refresh_token は新値があればそちらを使い、無ければ既存値を維持する。
 * - OP からエラー応答 (refresh_token が revoke 済み等) の場合も null を返す。
 */
export async function refreshIfNearExpiry(
  config: ResolvedConfig,
  data: SessionData,
): Promise<SessionData | null> {
  if (!data.refreshToken) return null;
  const now = config.clock();
  if (data.accessTokenExpiresAt > now + REFRESH_BUFFER_SECONDS) return null;

  const result = await exchangeCodeForTokens(config, { refreshToken: data.refreshToken });
  if (!result.ok) return null;

  return {
    userId: data.userId,
    opSessionId: data.opSessionId,
    accessToken: result.tokens.access_token,
    refreshToken: result.tokens.refresh_token ?? data.refreshToken,
    accessTokenExpiresAt: now + result.tokens.expires_in,
    createdAt: data.createdAt,
  };
}
