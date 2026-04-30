import { PENDING_KEY } from "../constants";
import type { PendingAuth } from "../types";

/**
 * /authorize redirect 直前に state/nonce/codeVerifier/returnTo を sessionStorage に保管する。
 * sessionStorage はタブごとに分離されており、redirect 後 (top-level navigation) に同じタブで callback を
 * 受けるまで保持される。tab を閉じれば自動的に消える。
 */
export function savePending(pending: PendingAuth): void {
  sessionStorage.setItem(PENDING_KEY, JSON.stringify(pending));
}

/**
 * callback ページでの取り出し用。state 検証後に必ず clearPending を呼んで単回使用を強制する。
 * `createdAt` から `maxAgeMs` を超過した pending は強制破棄する (タブを長期放置した古い
 * state/nonce/codeVerifier を使い回さない目的)。既定 10 分は OP 側 authorization code TTL
 * および BFF 版 `oauth_pending` Cookie の `maxAge: 600` と一致。
 */
export function loadPending(maxAgeMs: number = 600_000): PendingAuth | null {
  const raw = sessionStorage.getItem(PENDING_KEY);
  if (!raw) return null;
  try {
    const p = JSON.parse(raw) as PendingAuth;
    if (typeof p.createdAt !== "number") return null;
    if (Date.now() - p.createdAt > maxAgeMs) {
      sessionStorage.removeItem(PENDING_KEY);
      return null;
    }
    return p;
  } catch {
    return null;
  }
}

/**
 * pending を消す。callback 処理後 (成功・失敗いずれも) に必ず呼んでリプレイ余地を残さない。
 */
export function clearPending(): void {
  sessionStorage.removeItem(PENDING_KEY);
}
