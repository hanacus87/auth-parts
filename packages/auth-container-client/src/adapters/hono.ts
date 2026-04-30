import { Hono, type Context, type MiddlewareHandler } from "hono";
import type { AuthContainerClient } from "../client";
import { parseCookieHeader } from "../cookies/parse";
import { serializeSetCookie } from "../cookies/serialize";
import type { SetCookieDirective } from "../types";

export interface HonoOidcRoutesOptions {
  loginPath?: string;
  callbackPath?: string;
  statusPath?: string;
  logoutPath?: string;
  successRedirect: string;
  errorRedirect: string;
  postLogoutRedirectUri?: string;
}

/**
 * honoSessionMiddleware で注入される c.var.user の型。
 * ルートハンドラ側は `Hono<{ Variables: HonoOidcVariables }>()` で受け取る。
 */
export interface HonoOidcVariables {
  user: { sub: string; accessToken: string };
}

/**
 * /login, /callback, /status, /logout の 4 ルートを提供する Hono を返す。
 * 本 Hono を `app.route('/auth', createHonoOidcRoutes(client, {...}))` の形で mount する想定。
 */
export function createHonoOidcRoutes(
  client: AuthContainerClient,
  opts: HonoOidcRoutesOptions,
): Hono {
  const loginPath = opts.loginPath ?? "/login";
  const callbackPath = opts.callbackPath ?? "/callback";
  const statusPath = opts.statusPath ?? "/status";
  const logoutPath = opts.logoutPath ?? "/logout";

  const app = new Hono();

  /**
   * RFC 6749 §4.1.1 Authorization Request への 302 リダイレクト。
   * Set-Cookie: oauth_pending=<JWE> を付けて返す。
   */
  app.get(loginPath, async (c) => {
    const { authorizeUrl, setCookies } = await client.startLogin();
    applySetCookies(c, setCookies);
    return c.redirect(authorizeUrl);
  });

  /**
   * OIDC Authorization Response 処理。成功時は successRedirect、失敗時は errorRedirect に 302。
   * 失敗時はクエリで error/error_description を伝搬 (RFC 6749 §4.1.2.1 に準拠した表現に揃える)。
   */
  app.get(callbackPath, async (c) => {
    const cookies = parseCookieHeader(c.req.header("cookie"));
    const result = await client.handleCallback({
      query: {
        code: c.req.query("code"),
        state: c.req.query("state"),
        error: c.req.query("error"),
        error_description: c.req.query("error_description"),
      },
      cookies,
    });
    applySetCookies(c, result.setCookies);
    if (result.ok) {
      return c.redirect(opts.successRedirect);
    }
    const url = new URL(opts.errorRedirect);
    url.searchParams.set("error", result.kind);
    if (result.opError?.errorDescription) {
      url.searchParams.set("error_description", result.opError.errorDescription);
    } else if (result.opError?.error) {
      url.searchParams.set("error_description", result.opError.error);
    }
    return c.redirect(url.toString());
  });

  /**
   * 現在のログイン状態を JSON で返す。401 ではなく常に 200 + loggedIn フラグ。
   * リフレッシュが走った場合のみ Set-Cookie で Session Cookie を更新する。
   * 期限切れ / 復号失敗で session 取得に失敗した場合は、リクエスト Cookie が存在するときに限り
   * Max-Age=0 で無効 Cookie を掃除する (送られてこない初回アクセスでは不要 Set-Cookie を出さない)。
   */
  app.get(statusPath, async (c) => {
    const cookies = parseCookieHeader(c.req.header("cookie"));
    const result = await client.getSession({ cookies });
    if (!result) {
      if (cookies[client.sessionCookieName]) {
        applySetCookies(c, client.clearSession());
      }
      return c.json({ loggedIn: false });
    }
    applySetCookies(c, result.setCookies);
    return c.json({
      loggedIn: true,
      user: { sub: result.session.userId },
    });
  });

  /**
   * RP-Initiated Logout 1.0 §3 のフロー開始。BFF 側 Session Cookie を Set-Cookie:Max-Age=0 で消し、
   * OP の end_session_endpoint URL を JSON で返す。frontend は受け取った logoutUrl に
   * window.location.href で遷移し、OP 側の logout 確認を経て postLogoutRedirectUri に redirect される。
   *
   * opts.postLogoutRedirectUri は任意。指定があれば OP の logout クエリに `post_logout_redirect_uri`
   * として付与し、OP 側 client 設定の post_logout_redirect_uris と完全一致する必要がある (典型的には
   * frontend URL を直接登録する 1-hop 構成)。未指定時はクエリを付けず OP の logout 完了画面に留まる。
   *
   * 以前は実リクエスト URL から `${origin}${postLogoutPath}` を derive して BFF の中継 endpoint に
   * 戻していたが、`app.route("/auth", ...)` の mount プレフィックスを取りこぼすバグがあった。中継
   * endpoint 自体を廃止し、利用側で env から URL を明示設定する方針に統一した (= redirect_uri と同じ性質)。
   */
  app.post(logoutPath, async (c) => {
    applySetCookies(c, client.clearSession());
    const logoutUrl = client.buildLogoutUrl({
      postLogoutRedirectUri: opts.postLogoutRedirectUri,
    });
    return c.json({ logoutUrl });
  });

  return app;
}

/**
 * 保護ルート用ミドルウェア。Session Cookie を検証して c.var.user に { sub, accessToken } を注入する。
 * 未ログイン / 復号失敗 / リフレッシュ失敗は 401 JSON を返す。
 */
export function honoSessionMiddleware(
  client: AuthContainerClient,
): MiddlewareHandler<{ Variables: HonoOidcVariables }> {
  return async (c, next) => {
    const cookies = parseCookieHeader(c.req.header("cookie"));
    const result = await client.getSession({ cookies });
    if (!result) {
      if (cookies[client.sessionCookieName]) {
        applySetCookies(c, client.clearSession());
      }
      return c.json({ error: "unauthenticated" }, 401);
    }
    applySetCookies(c, result.setCookies);
    c.set("user", { sub: result.session.userId, accessToken: result.accessToken });
    await next();
  };
}

/**
 * SetCookieDirective 配列を Set-Cookie ヘッダに追記する (複数 Cookie 同時発行に対応)。
 * Hono の c.header() は 2 回目以降 append: true を指定しないと上書きされる。
 * 利用側ハンドラ (例: /api/me で /userinfo 401 検知時の clearSession 反映) からも呼べるよう公開する。
 */
export function applySetCookies(c: Context, directives: SetCookieDirective[]): void {
  for (const d of directives) {
    c.header("Set-Cookie", serializeSetCookie(d), { append: true });
  }
}
