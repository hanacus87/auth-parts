import { COOKIES } from "./constants";
import { buildSessionClearCookie } from "./cookies/session";
import { handleCallback } from "./flows/callback";
import { getSession } from "./flows/get-session";
import { startLogin } from "./flows/login";
import { buildLogoutUrl } from "./flows/logout";
import { fetchUserInfo } from "./flows/userinfo";
import { ConfigError } from "./errors";
import type {
  CallbackResult,
  ClientUserConfig,
  ResolvedConfig,
  SessionView,
  SetCookieDirective,
  UserInfoResult,
} from "./types";

/**
 * auth-container (https://auth-container.hanacus87.net) への OIDC Authorization Code + PKCE
 * ログインフローをラップするクライアント。ISSUER / SCOPES / Cookie 属性は内部定数で固定し、
 * 利用側には BFF 固有の値 (clientId / clientSecret / redirectUri / encryptionKeys) だけを要求する。
 *
 * Pending Auth・Session は JWE Cookie に収め、サーバ側の状態ストア (Redis 等) は持たない。
 */
export class AuthContainerClient {
  readonly #config: ResolvedConfig;

  constructor(opts: ClientUserConfig) {
    this.#config = resolveConfig(opts);
  }

  /**
   * OIDC Authorization Code + PKCE リクエスト URL と Pending Auth Cookie を生成する。
   * 呼び出し側は authorizeUrl に 302 リダイレクト、setCookies を Set-Cookie に付与する。
   */
  async startLogin(
    input: {
      returnTo?: string;
      extraAuthorizeParams?: Record<string, string>;
    } = {},
  ): Promise<{ authorizeUrl: string; setCookies: SetCookieDirective[] }> {
    return startLogin(this.#config, input);
  }

  /**
   * Authorization Response を処理して Session Cookie を発行する。
   * RFC 9700 §4.5.3.1 に従い state を最初に検証し、失敗時は ?error= を無視してサイレントに弾く。
   * 成功・失敗いずれの場合も Pending Cookie のクリア指示が setCookies に含まれる。
   */
  async handleCallback(input: {
    query: Record<string, string | undefined>;
    cookies: Record<string, string>;
  }): Promise<CallbackResult> {
    return handleCallback(this.#config, input);
  }

  /**
   * Session Cookie を復号し、必要に応じて refresh_token で更新した SessionView + access_token を返す。
   * Cookie 無し / 復号失敗 / 期限切れ + リフレッシュ失敗の場合は null。
   * リフレッシュが走った場合のみ setCookies に新 Cookie が入る。
   */
  async getSession(input: { cookies: Record<string, string> }): Promise<{
    session: SessionView;
    accessToken: string;
    setCookies: SetCookieDirective[];
  } | null> {
    return getSession(this.#config, input);
  }

  /**
   * RFC 6750 §2 / OIDC Core §5.3: access_token を Bearer で渡して /userinfo を取得する。
   * 401 (= revoked / invalid token) と 5xx 等を区別した Result 型で返す。
   * 利用側は ok=false かつ reason=unauthorized を「セッション失効」として扱える。
   */
  async fetchUserInfo(accessToken: string): Promise<UserInfoResult> {
    return fetchUserInfo(this.#config, accessToken);
  }

  /**
   * Session Cookie を Max-Age=0 で消すディレクティブを返す。ログアウト応答で Set-Cookie に付与する。
   */
  clearSession(): SetCookieDirective[] {
    return [buildSessionClearCookie(this.#config)];
  }

  /**
   * OIDC RP-Initiated Logout 1.0 §3 に基づき OP の end_session_endpoint へ送る URL を返す。
   * 呼び出し側はこの URL に top-level redirect させる (or JSON で frontend に返却)。
   *
   * postLogoutRedirectUri は任意。指定すれば OP のクライアント設定に登録済み URL と完全一致が必要。
   * 未指定なら OP の logout 完了画面に留まる (= 元アプリに自動で戻らない)。
   * id_token_hint は本ライブラリは Cookie に保持していないため省略 (OP は確認画面を出す)。
   */
  buildLogoutUrl(params: { postLogoutRedirectUri?: string }): string {
    return buildLogoutUrl(params);
  }

  /**
   * Hono アダプタ等の framework 連携層が Cookie 存在チェックに使うための getter。
   * ライブラリ default または利用側 override (cookies.sessionName) のいずれかが入る。
   */
  get sessionCookieName(): string {
    return this.#config.sessionCookieName;
  }
}

/**
 * ClientUserConfig を内部用 ResolvedConfig に解決する。
 * - encryptionKeys は必須 + 各要素 32 bytes を要求する (A256GCM 鍵長)
 * - tokenEndpointAuthMethod 省略時は clientSecret の有無で basic / none を推定する
 * - NODE_ENV=production 時に redirectUri が http:// だと誤設定なので throw する
 * - cookies.sessionName 省略時は constants.COOKIES.session.name (`bff_session`) を使う。
 *   同一オリジンに複数 BFF を同居させる場合や既存運用名を維持したい場合に上書きする
 * - fetch / clock 省略時は globalThis.fetch と (Date.now() / 1000) を注入する
 */
function resolveConfig(opts: ClientUserConfig): ResolvedConfig {
  if (!opts.encryptionKeys || opts.encryptionKeys.length === 0) {
    throw new ConfigError("encryptionKeys is required (at least 1 key of 32 bytes)");
  }
  for (const [i, k] of opts.encryptionKeys.entries()) {
    if (k.byteLength !== 32) {
      throw new ConfigError(`encryptionKeys[${i}] must be 32 bytes (got ${k.byteLength})`);
    }
  }

  const tokenEndpointAuthMethod =
    opts.tokenEndpointAuthMethod ?? (opts.clientSecret ? "client_secret_basic" : "none");

  if (tokenEndpointAuthMethod !== "none" && !opts.clientSecret) {
    throw new ConfigError(
      `tokenEndpointAuthMethod='${tokenEndpointAuthMethod}' requires clientSecret`,
    );
  }

  if (isProduction() && opts.redirectUri.startsWith("http://")) {
    throw new ConfigError(
      "redirectUri must be https:// in production (NODE_ENV=production detected)",
    );
  }

  return {
    clientId: opts.clientId,
    clientSecret: opts.clientSecret,
    tokenEndpointAuthMethod,
    redirectUri: opts.redirectUri,
    encryptionKeys: opts.encryptionKeys,
    sessionCookieName: opts.cookies?.sessionName ?? COOKIES.session.name,
    fetch: opts.fetch ?? globalThis.fetch,
    clock: opts.clock ?? (() => Math.floor(Date.now() / 1000)),
  };
}

/**
 * NODE_ENV==='production' 判定。Cookie の Secure 属性決定・redirectUri 検証で利用。
 */
export function isProduction(): boolean {
  return process.env.NODE_ENV === "production";
}
