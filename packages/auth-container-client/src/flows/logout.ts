import { ENDPOINTS } from "../constants";

/**
 * OIDC RP-Initiated Logout 1.0 §3 に基づき、auth-container の end_session_endpoint へ
 * リダイレクトする URL を組み立てる。
 *
 * postLogoutRedirectUri は任意。指定があれば OP 側 client の post_logout_redirect_uris に
 * 完全一致登録されている必要がある (OP 側で URI 検証して redirect する仕様)。未指定なら
 * クエリを付けず、OP は logout 完了画面に留まる (= ユーザは元アプリに自動で戻らない)。
 *
 * id_token_hint は仕様上 RECOMMENDED だが、本ライブラリは Cookie サイズ抑制のため
 * Session Cookie に id_token を保持していない。よって省略する。OP は確認画面 (auth-frontend
 * の /logout SPA) を表示してユーザに同意を求める運用になる。
 */
export function buildLogoutUrl(params: { postLogoutRedirectUri?: string }): string {
  if (!params.postLogoutRedirectUri) return ENDPOINTS.endSession;
  const url = new URLSearchParams({
    post_logout_redirect_uri: params.postLogoutRedirectUri,
  });
  return `${ENDPOINTS.endSession}?${url}`;
}
