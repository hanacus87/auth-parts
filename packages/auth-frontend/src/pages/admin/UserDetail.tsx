import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Trash2 } from "lucide-react";
import { useAdminSession } from "../../components/AdminLayout";
import { Button } from "../../components/Button";
import { Alert } from "../../components/Alert";
import { VerifiedBadge } from "../../components/VerifiedBadge";
import { DeleteConfirmPanel } from "../../components/DeleteConfirmPanel";
import { api, ApiError } from "../../lib/api";

interface UserDetail {
  id: string;
  email: string;
  emailVerified: boolean;
  name: string;
  givenName: string;
  familyName: string;
  createdAt: string;
  updatedAt: string;
}

interface CascadeTarget {
  deps: { label: string; count: number }[];
}

/**
 * 一般ユーザー詳細ページ (SuperAdmin 専用、読み取り専用)。
 * 編集機能は無く、削除のみ可能。削除時のカスケード対応は UsersList と同じフローを使う。
 */
export function UserDetail() {
  const { csrfToken } = useAdminSession();
  const navigate = useNavigate();
  const params = useParams();
  const id = params.id ?? "";

  const [user, setUser] = useState<UserDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [cascadeTarget, setCascadeTarget] = useState<CascadeTarget | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    api
      .get<{ user: UserDetail }>(`/api/admin/users/${encodeURIComponent(id)}`)
      .then((res) => setUser(res.user))
      .catch((err) => setError(err instanceof ApiError ? err.message : "読み込みに失敗"))
      .finally(() => setLoading(false));
  }, [id]);

  async function requestDelete(cascade: boolean) {
    setDeleting(true);
    setError(null);
    try {
      const res = await api.post<{
        ok?: boolean;
        requiresCascade?: boolean;
        dependencies?: { label: string; count: number }[];
      }>(`/api/admin/users/${encodeURIComponent(id)}/delete`, {
        cascade,
        _csrf: csrfToken,
      });
      if (res.requiresCascade) {
        setCascadeTarget({ deps: res.dependencies ?? [] });
        setDeleting(false);
      } else {
        navigate("/admin/users");
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "削除に失敗");
      setDeleting(false);
    }
  }

  if (loading) return <div className="text-sm text-zinc-500">読み込み中...</div>;
  if (!user)
    return (
      <div className="max-w-2xl">
        {error && (
          <div className="mb-4">
            <Alert kind="error">{error}</Alert>
          </div>
        )}
        <Link
          to="/admin/users"
          className="inline-flex items-center gap-1 text-sm text-indigo-400 hover:text-indigo-300"
        >
          <ArrowLeft className="h-4 w-4" strokeWidth={2} />
          ユーザー一覧に戻る
        </Link>
      </div>
    );

  return (
    <div className="max-w-2xl">
      <Link
        to="/admin/users"
        className="inline-flex items-center gap-1 text-sm text-zinc-400 hover:text-zinc-200"
      >
        <ArrowLeft className="h-4 w-4" strokeWidth={2} />
        ユーザー一覧に戻る
      </Link>

      <h1 className="mt-4 text-2xl font-semibold tracking-tight text-zinc-50">ユーザー詳細</h1>
      <p className="mt-1 text-sm text-zinc-400">読み取り専用。削除は画面下部から。</p>

      {error && (
        <div className="mt-4">
          <Alert kind="error">{error}</Alert>
        </div>
      )}

      <dl className="mt-6 space-y-4 rounded-lg border border-zinc-800/80 bg-zinc-900/30 p-5">
        <Field label="メールアドレス">
          <div className="flex items-center gap-2">
            <span className="text-sm text-zinc-100">{user.email}</span>
            <VerifiedBadge verified={user.emailVerified} />
          </div>
        </Field>
        <Field label="表示名">
          <span className="text-sm text-zinc-100">{user.name}</span>
        </Field>
        <Field label="名 (given_name)">
          <span className="text-sm text-zinc-300">{user.givenName || "—"}</span>
        </Field>
        <Field label="姓 (family_name)">
          <span className="text-sm text-zinc-300">{user.familyName || "—"}</span>
        </Field>
        <Field label="id">
          <code className="font-mono text-xs text-zinc-400">{user.id}</code>
        </Field>
        <Field label="作成日時">
          <span className="font-mono text-xs text-zinc-400">
            {new Date(user.createdAt).toISOString().slice(0, 16).replace("T", " ")}
          </span>
        </Field>
        <Field label="更新日時">
          <span className="font-mono text-xs text-zinc-400">
            {new Date(user.updatedAt).toISOString().slice(0, 16).replace("T", " ")}
          </span>
        </Field>
      </dl>

      <div className="mt-10 rounded-lg border border-red-900/50 bg-red-950/10 p-4">
        <h2 className="text-sm font-semibold text-red-200">ユーザーを削除</h2>
        <p className="mt-1 text-xs text-zinc-400">
          このユーザーアカウントを削除します。関連データ (認可コード・トークン・同意履歴等)
          がある場合は確認画面で明示されます。削除は取り消せません。
        </p>

        {cascadeTarget ? (
          <div className="mt-3">
            <DeleteConfirmPanel
              message={
                <>
                  <code className="font-mono text-red-200">{user.email}</code>{" "}
                  を削除するには関連データも削除する必要があります:
                </>
              }
              dependencies={cascadeTarget.deps}
              confirmLabel="関連データごと削除する"
              onConfirm={() => requestDelete(true)}
              onCancel={() => setCascadeTarget(null)}
              pending={deleting}
            />
          </div>
        ) : (
          <div className="mt-3">
            <Button
              variant="danger"
              onClick={() => requestDelete(false)}
              disabled={deleting}
              leftIcon={<Trash2 className="h-3.5 w-3.5" strokeWidth={2} />}
            >
              {deleting ? "削除中..." : "このユーザーを削除"}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

/** 左ラベル + 右値 の 2 カラム表示行 (dl の中で dt/dd 対で使う)。 */
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start">
      <dt className="w-36 shrink-0 text-xs font-medium uppercase tracking-wide text-zinc-500">
        {label}
      </dt>
      <dd className="flex-1">{children}</dd>
    </div>
  );
}
