import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { AuthLayout } from "../components/Layout";
import { Button } from "../components/Button";
import { Alert } from "../components/Alert";
import { api, ApiError, redirectTo } from "../lib/api";
import { labelForScope } from "../lib/scope-labels";

interface Ctx {
  clientName: string;
  scopes: string[];
}

/**
 * OIDC 同意画面。`/api/consent/context` から client 名と要求スコープを取得し、
 * 許可/拒否いずれかの結果で `/api/consent` を POST して RP の redirect_uri に遷移する。
 */
export function ConsentPage() {
  const [searchParams] = useSearchParams();
  const consentChallenge = searchParams.get("consent_challenge") ?? "";
  const [ctx, setCtx] = useState<Ctx | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!consentChallenge) {
      setError("consent_challenge が指定されていません");
      return;
    }
    api
      .get<Ctx>(`/api/consent/context?consent_challenge=${encodeURIComponent(consentChallenge)}`)
      .then(setCtx)
      .catch((err) =>
        setError(err instanceof ApiError ? err.message : "consent_challenge の検証に失敗しました"),
      );
  }, [consentChallenge]);

  async function decide(approved: boolean) {
    setSubmitting(true);
    try {
      const res = await api.post<{ redirectUrl: string }>("/api/consent", {
        consent_challenge: consentChallenge,
        approved,
      });
      redirectTo(res.redirectUrl);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "処理に失敗しました");
      setSubmitting(false);
    }
  }

  return (
    <AuthLayout title="アクセス許可">
      {error && (
        <div className="mb-4">
          <Alert kind="error">{error}</Alert>
        </div>
      )}
      {!ctx ? (
        <div className="text-sm text-zinc-500">読み込み中...</div>
      ) : (
        <>
          <p className="text-sm text-zinc-300">
            <span className="font-semibold text-zinc-100">{ctx.clientName}</span>{" "}
            が以下の情報へのアクセスを求めています:
          </p>
          <ul className="mt-3 space-y-1 rounded border border-zinc-800 bg-zinc-950 p-3 text-sm">
            {ctx.scopes.map((s) => (
              <li key={s} className="text-zinc-300">
                • {labelForScope(s)} <span className="text-xs text-zinc-500">({s})</span>
              </li>
            ))}
          </ul>
          <div className="mt-6 flex gap-3">
            <Button variant="secondary" full onClick={() => decide(false)} disabled={submitting}>
              拒否
            </Button>
            <Button full onClick={() => decide(true)} disabled={submitting}>
              {submitting ? "処理中..." : "許可する"}
            </Button>
          </div>
        </>
      )}
    </AuthLayout>
  );
}
