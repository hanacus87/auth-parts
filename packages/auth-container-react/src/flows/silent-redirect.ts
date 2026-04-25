import { SILENT_ATTEMPTED_KEY } from "../constants";
import { savePending } from "../storage/pending";
import type { ResolvedAuthConfig } from "../types";
import { buildAuthorizeUrl } from "./authorize";
import { generateCodeChallenge, generateCodeVerifier } from "./pkce";
import { generateNonce, generateState } from "./random";

/**
 * 起動時に sessionStorage の SILENT_ATTEMPTED フラグを立てて、prompt=none で /authorize に
 * top-level redirect する。OAuth 2.0 BCP for Browser-Based Apps §6.2.4 に従う方式。
 *
 * - 戻り値は無い (ブラウザが navigate するため関数は返らない想定)
 * - フラグはこの関数内でセット。クリアは callback 成功時 / login() / logout() のいずれかで行う
 * - 連続リロードで無限に OP に攻め続けないよう、フラグありの場合は呼び出し側でこの関数をスキップする
 */
export async function performSilentRedirect(config: ResolvedAuthConfig): Promise<void> {
  sessionStorage.setItem(SILENT_ATTEMPTED_KEY, "1");

  const state = generateState();
  const nonce = generateNonce();
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = await generateCodeChallenge(codeVerifier);
  const returnTo = window.location.pathname + window.location.search;

  savePending({ state, nonce, codeVerifier, returnTo, createdAt: Date.now() });

  const url = buildAuthorizeUrl(config, { state, nonce, codeChallenge, silent: true });
  window.location.replace(url);
}

/**
 * ユーザが明示的に login() を呼んだとき。silent_attempted フラグをクリアして prompt 無しで /authorize 。
 * 同じく browser navigation 起点なので関数は返らない。
 */
export async function performLoginRedirect(config: ResolvedAuthConfig): Promise<void> {
  sessionStorage.removeItem(SILENT_ATTEMPTED_KEY);

  const state = generateState();
  const nonce = generateNonce();
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = await generateCodeChallenge(codeVerifier);
  const returnTo = window.location.pathname + window.location.search;

  savePending({ state, nonce, codeVerifier, returnTo, createdAt: Date.now() });

  const url = buildAuthorizeUrl(config, { state, nonce, codeChallenge, silent: false });
  window.location.assign(url);
}
