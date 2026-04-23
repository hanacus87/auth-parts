import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { AuthLayout } from "../components/Layout";
import { Button } from "../components/Button";
import { Alert } from "../components/Alert";
import { api, ApiError, redirectTo } from "../lib/api";

interface Ctx {
  alreadyLoggedOut: boolean;
  clientName?: string;
  csrfToken?: string;
  postLogoutRedirectUri?: string;
}

/**
 * RP-Initiated Logout 画面 (OIDC RP-Initiated Logout §2)。
 * `/api/logout/context` でセッション有無とヒント先 client 名・CSRF トークンを取得し、
 * 確認後に POST して redirectUrl があれば RP に遷移、無ければ完了画面を表示する。
 */
export function LogoutPage() {
  const [searchParams] = useSearchParams();
  const idTokenHint = searchParams.get("id_token_hint") ?? "";
  const postLogoutRedirectUri = searchParams.get("post_logout_redirect_uri") ?? "";
  const state = searchParams.get("state") ?? "";

  const [ctx, setCtx] = useState<Ctx | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [completed, setCompleted] = useState(false);

  useEffect(() => {
    const qs = new URLSearchParams();
    if (idTokenHint) qs.set("id_token_hint", idTokenHint);
    if (postLogoutRedirectUri) qs.set("post_logout_redirect_uri", postLogoutRedirectUri);
    if (state) qs.set("state", state);
    api
      .get<Ctx>(`/api/logout/context${qs.toString() ? `?${qs}` : ""}`)
      .then(setCtx)
      .catch((err) => setError(err instanceof ApiError ? err.message : "読み込みに失敗しました"));
  }, [idTokenHint, postLogoutRedirectUri, state]);

  async function doLogout() {
    if (!ctx?.csrfToken) return;
    setSubmitting(true);
    try {
      const res = await api.post<{ redirectUrl?: string; completed?: boolean }>("/api/logout", {
        id_token_hint: idTokenHint,
        post_logout_redirect_uri: postLogoutRedirectUri,
        state,
        _csrf: ctx.csrfToken,
      });
      if (res.redirectUrl) {
        redirectTo(res.redirectUrl);
      } else {
        setCompleted(true);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "ログアウトに失敗しました");
      setSubmitting(false);
    }
  }

  if (error) {
    return (
      <AuthLayout title="ログアウト">
        <Alert kind="error">{error}</Alert>
      </AuthLayout>
    );
  }

  if (!ctx) {
    return (
      <AuthLayout title="ログアウト">
        <div className="text-sm text-zinc-500">読み込み中...</div>
      </AuthLayout>
    );
  }

  if (completed) {
    return (
      <AuthLayout title="ログアウトしました">
        <p className="text-sm text-zinc-300">またのご利用をお待ちしています。</p>
      </AuthLayout>
    );
  }

  if (ctx.alreadyLoggedOut) {
    return (
      <AuthLayout title="ログアウト済み">
        <p className="text-sm text-zinc-300">既にログアウトしています。</p>
        {postLogoutRedirectUri && (
          <div className="mt-4">
            <a
              className="text-sm text-indigo-400 hover:text-indigo-300"
              href={postLogoutRedirectUri}
            >
              元のページに戻る
            </a>
          </div>
        )}
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title="ログアウトしますか?">
      {ctx.clientName && (
        <p className="text-sm text-zinc-300">
          <span className="font-semibold text-zinc-100">{ctx.clientName}</span>{" "}
          からログアウトします。
        </p>
      )}
      <p className="mt-2 text-sm text-zinc-400">接続中の他のアプリからもログアウトされます。</p>
      <div className="mt-6 flex gap-3">
        <Button variant="secondary" full onClick={() => history.back()} disabled={submitting}>
          キャンセル
        </Button>
        <Button variant="danger" full onClick={doLogout} disabled={submitting}>
          {submitting ? "処理中..." : "ログアウト"}
        </Button>
      </div>
    </AuthLayout>
  );
}
