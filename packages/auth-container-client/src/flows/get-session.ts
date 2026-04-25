import { buildSessionCookie, readSessionCookie } from "../cookies/session";
import type { ResolvedConfig, SessionView, SetCookieDirective } from "../types";
import { refreshIfNearExpiry } from "./refresh";

/**
 * 受信 Cookie から Session を復号し、必要なら refresh_token で更新して返す。
 * - Cookie 無し / 復号失敗 / 期限切れ + リフレッシュ失敗 → null
 * - リフレッシュ成功時は新 Cookie を setCookies に詰める
 * - リフレッシュ不要 (access_token に余裕あり) なら setCookies は空配列
 * - リフレッシュ不要だが access_token が既に切れている (refresh_token 無し or refresh 失敗の残骸) は
 *   expired 扱いで null。境界判定に config.clock() を使う
 *
 * 戻り値の SessionView は token を含めず公開しても安全。accessToken はサーバ側内部利用のみを想定。
 */
export async function getSession(
  config: ResolvedConfig,
  input: { cookies: Record<string, string> },
): Promise<{
  session: SessionView;
  accessToken: string;
  setCookies: SetCookieDirective[];
} | null> {
  const data = await readSessionCookie(input.cookies, config);
  if (!data) return null;

  const refreshed = await refreshIfNearExpiry(config, data);
  if (refreshed) {
    const newCookie = await buildSessionCookie(refreshed, config);
    return {
      session: {
        userId: refreshed.userId,
        opSessionId: refreshed.opSessionId,
        accessTokenExpiresAt: refreshed.accessTokenExpiresAt,
        createdAt: refreshed.createdAt,
      },
      accessToken: refreshed.accessToken,
      setCookies: [newCookie],
    };
  }

  if (data.accessTokenExpiresAt <= config.clock()) return null;

  return {
    session: {
      userId: data.userId,
      opSessionId: data.opSessionId,
      accessTokenExpiresAt: data.accessTokenExpiresAt,
      createdAt: data.createdAt,
    },
    accessToken: data.accessToken,
    setCookies: [],
  };
}
