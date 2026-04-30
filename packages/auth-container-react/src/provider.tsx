import { createContext, useEffect, useMemo, useReducer, useRef, type ReactNode } from "react";
import { SILENT_ATTEMPTED_KEY } from "./constants";
import { safeEqual } from "./crypto/safe-equal";
import { buildLogoutUrl } from "./flows/logout";
import { verifyIdToken } from "./flows/id-token";
import { performLoginRedirect, performSilentRedirect } from "./flows/silent-redirect";
import { exchangeCodeForTokens } from "./flows/token-exchange";
import { clearPending, loadPending } from "./storage/pending";
import { authReducer, initialAuthState } from "./storage/auth-state";
import type { AuthConfig, AuthError, AuthState, AuthUser, ResolvedAuthConfig } from "./types";

export interface AuthContextValue extends AuthState {
  login: () => void;
  logout: () => void;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

/**
 * SPA を包む OIDC Provider。マウント時に以下を判定:
 * - 現在 URL が callback (?code か ?error 含む redirect_uri) なら code 交換 + id_token 検証 + state 設定
 * - そうでなく memory に token なし + silent 未試行 + silentRenewOnMount=true なら top-level redirect で
 *   prompt=none を試行 (OP セッションあれば無感に code 取得、無ければ login_required で戻る)
 *
 * Token は memory のみ保管。ページリロードで消失するが silent renew で復元可能 (3rd-party cookie 制限なし)。
 *
 * 失効監視: `accessTokenExpiresAt` を超過した瞬間に自動で `session_expired` を dispatch して
 * memory state を initialAuthState に倒す (失効 token を握り続けない)。proactive な silent renew は
 * top-level redirect の UX 破壊を避けるため敢えてしない (利用側が再ログイン or リロードで復旧)。
 *
 * 起動 useEffect は意図的に依存配列を空 ([]) で固定する: resolved は useMemo で安定参照だが、
 * runStartup は top-level redirect (window.location.assign) を伴う副作用なので 1 度だけ走る必要がある。
 * react-hooks/exhaustive-deps を disable しているのはそのため。
 */
export function AuthProvider({ children, config }: { children: ReactNode; config: AuthConfig }) {
  const resolved = useMemo(() => resolveConfig(config), [config]);
  const [state, dispatch] = useReducer(authReducer, undefined, () => ({
    ...initialAuthState,
    isLoading: resolved.silentRenewOnMount,
  }));
  const initialized = useRef(false);

  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;
    void runStartup(resolved, dispatch);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (state.accessTokenExpiresAt === null) return;
    const ms = state.accessTokenExpiresAt * 1000 - Date.now();
    if (ms <= 0) {
      dispatch({ type: "session_expired" });
      return;
    }
    const timer = setTimeout(() => dispatch({ type: "session_expired" }), ms);
    return () => clearTimeout(timer);
  }, [state.accessTokenExpiresAt]);

  const value = useMemo<AuthContextValue>(
    () => ({
      ...state,
      login: () => {
        void performLoginRedirect(resolved);
      },
      logout: () => {
        const url = buildLogoutUrl(resolved, { idTokenHint: state.idToken });
        sessionStorage.removeItem(SILENT_ATTEMPTED_KEY);
        clearPending();
        dispatch({ type: "logout" });
        window.location.assign(url);
      },
    }),
    [state, resolved],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

/**
 * AuthConfig を内部用 ResolvedAuthConfig に解決する。
 * 省略可能なフィールドにデフォルトを充填し、postLogoutRedirectUri を確定値にする。
 * 確定後の redirectUri / postLogoutRedirectUri は HTTPS 必須で検証する (`assertSecureRedirectUri`)。
 */
function resolveConfig(config: AuthConfig): ResolvedAuthConfig {
  const postLogoutRedirectUri = config.postLogoutRedirectUri ?? window.location.origin;
  assertSecureRedirectUri(config.redirectUri, "redirectUri");
  assertSecureRedirectUri(postLogoutRedirectUri, "postLogoutRedirectUri");
  return {
    clientId: config.clientId,
    redirectUri: config.redirectUri,
    postLogoutRedirectUri,
    silentRenewOnMount: config.silentRenewOnMount ?? true,
    fetch: globalThis.fetch.bind(globalThis),
  };
}

/**
 * mount 時に 1 度だけ呼ばれる起動ロジック。callback URL なら code を消費、そうでなければ silent renew を試行。
 * すでに silent_attempted フラグありなら何もしない (= ユーザに login を促す状態)。
 *
 * silent renew 経路では performSilentRedirect が window.location.assign で OP に遷移するため、
 * await はしているが関数は実質返ってこない (ブラウザ navigate により本実行コンテキストが破棄される)。
 */
async function runStartup(
  config: ResolvedAuthConfig,
  dispatch: (action: import("./storage/auth-state").AuthAction) => void,
): Promise<void> {
  const url = new URL(window.location.href);
  const callbackPath = new URL(config.redirectUri).pathname;
  const isCallbackUrl =
    url.pathname === callbackPath &&
    (url.searchParams.has("code") || url.searchParams.has("error"));

  if (isCallbackUrl) {
    await processCallback(config, url, dispatch);
    return;
  }

  if (!config.silentRenewOnMount) {
    dispatch({ type: "init" });
    return;
  }

  if (sessionStorage.getItem(SILENT_ATTEMPTED_KEY) === "1") {
    dispatch({ type: "init" });
    return;
  }

  await performSilentRedirect(config);
}

/**
 * /callback URL を処理する。OIDC Core §3.1.2.5 に従う順序:
 *  1. state バインディング検証 (RFC 9700 §4.5.3.1: error より先に判定して DoS 緩和)
 *  2. error パラメータ判定 (login_required / consent_required / interaction_required を区別)
 *  3. code 取得確認
 *  4. /token 交換 (PKCE)
 *  5. id_token 検証 (sig / iss / aud / exp / nonce)
 *  6. dispatch + URL を returnTo に書き換え
 */
async function processCallback(
  config: ResolvedAuthConfig,
  url: URL,
  dispatch: (action: import("./storage/auth-state").AuthAction) => void,
): Promise<void> {
  const code = url.searchParams.get("code");
  const stateParam = url.searchParams.get("state");
  const error = url.searchParams.get("error");
  const errorDescription = url.searchParams.get("error_description");

  const pending = loadPending();
  clearPending();

  if (!stateParam || !pending || !safeEqual(pending.state, stateParam)) {
    dispatch({ type: "error", error: { kind: "state_mismatch" } });
    cleanupCallbackUrl(pending);
    return;
  }

  if (error) {
    const errorObj = mapOpError(error, errorDescription);
    dispatch({ type: "error", error: errorObj });
    cleanupCallbackUrl(pending);
    return;
  }

  if (!code) {
    dispatch({ type: "error", error: { kind: "missing_code" } });
    cleanupCallbackUrl(pending);
    return;
  }

  const exchange = await exchangeCodeForTokens(config, {
    code,
    codeVerifier: pending.codeVerifier,
  });
  if (!exchange.ok) {
    dispatch({
      type: "error",
      error: { kind: "token_exchange", description: exchange.description },
    });
    cleanupCallbackUrl(pending);
    return;
  }

  let payload;
  try {
    payload = await verifyIdToken(exchange.tokens.id_token, config.clientId);
  } catch {
    dispatch({ type: "error", error: { kind: "id_token" } });
    cleanupCallbackUrl(pending);
    return;
  }

  const nonceClaim = typeof payload["nonce"] === "string" ? payload["nonce"] : "";
  if (!safeEqual(nonceClaim, pending.nonce)) {
    dispatch({ type: "error", error: { kind: "nonce_mismatch" } });
    cleanupCallbackUrl(pending);
    return;
  }

  if (!payload.sub) {
    dispatch({ type: "error", error: { kind: "id_token" } });
    cleanupCallbackUrl(pending);
    return;
  }

  sessionStorage.removeItem(SILENT_ATTEMPTED_KEY);
  const now = Math.floor(Date.now() / 1000);
  dispatch({
    type: "callback_success",
    user: payload as AuthUser,
    accessToken: exchange.tokens.access_token,
    idToken: exchange.tokens.id_token,
    accessTokenExpiresAt: now + exchange.tokens.expires_in,
  });
  cleanupCallbackUrl(pending);
}

/**
 * OP が /authorize redirect で返した error 文字列を AuthError に正規化する。
 * silent renew (prompt=none) で頻出する 3 種は専用 kind に分けて利用側がハンドルしやすくする。
 */
function mapOpError(error: string, description: string | null): AuthError {
  if (error === "login_required") return { kind: "login_required" };
  if (error === "consent_required") return { kind: "consent_required" };
  if (error === "interaction_required") return { kind: "interaction_required" };
  return { kind: "op_error", error, description: description ?? undefined };
}

/**
 * callback URL から query を取り除いて pending.returnTo に書き戻す。
 * popstate イベントで React Router が URL 変化を検知して re-render する。
 */
function cleanupCallbackUrl(pending: { returnTo: string } | null): void {
  const returnTo = pending?.returnTo ?? "/";
  window.history.replaceState({}, "", returnTo);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

/**
 * redirect 系 URI が HTTPS であることを起動時に強制する (OAuth 2.0 BCP §7.5.1, RFC 8252 §7.3)。
 * 例外として `http://localhost` / `http://127.0.0.1` のみ dev 用途で許容する。
 * bundler に依存せず実行時の URL 文字列だけで判定するため、Vite/Webpack 等の env 注入を要求しない。
 * 検証失敗時は設定者がすぐ気付けるよう違反値を含めて throw する。
 */
function assertSecureRedirectUri(uri: string, fieldName: string): void {
  let url: URL;
  try {
    url = new URL(uri);
  } catch {
    throw new Error(`${fieldName} is not a valid URL: ${uri}`);
  }
  if (url.protocol === "https:") return;
  if (url.protocol === "http:" && (url.hostname === "localhost" || url.hostname === "127.0.0.1")) {
    return;
  }
  throw new Error(`${fieldName} must be https:// (or http://localhost for dev): ${uri}`);
}
