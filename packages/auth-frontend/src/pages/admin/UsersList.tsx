import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Eye, Trash2 } from "lucide-react";
import { useAdminSession } from "../../components/AdminLayout";
import { Alert } from "../../components/Alert";
import { VerifiedBadge } from "../../components/VerifiedBadge";
import { DeleteConfirmPanel } from "../../components/DeleteConfirmPanel";
import { api, ApiError } from "../../lib/api";

interface User {
  id: string;
  email: string;
  emailVerified: boolean;
  name: string;
  createdAt: string;
}

/**
 * 一般ユーザー一覧ページ (SuperAdmin 専用)。
 * 削除時に子行 (認可コード / トークン / セッション / consent 等) があれば `requiresCascade` で確認パネルを表示し、
 * 承認後に `cascade=true` で再リクエストして一括削除する。
 */
export function UsersList() {
  const { csrfToken } = useAdminSession();
  const [users, setUsers] = useState<User[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [cascadeTarget, setCascadeTarget] = useState<{
    id: string;
    email: string;
    deps: { label: string; count: number }[];
  } | null>(null);

  async function reload() {
    try {
      const res = await api.get<{ users: User[] }>("/api/admin/users");
      setUsers(res.users);
    } catch (err) {
      setError(err instanceof Error ? err.message : "読み込みに失敗");
    }
  }

  useEffect(() => {
    reload();
  }, []);

  async function requestDelete(id: string, email: string, cascade: boolean) {
    setPendingId(id);
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
        setCascadeTarget({ id, email, deps: res.dependencies ?? [] });
      } else {
        setCascadeTarget(null);
        await reload();
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "削除に失敗");
    } finally {
      setPendingId(null);
    }
  }

  return (
    <div>
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-50">Users</h1>
        <p className="mt-1 text-sm text-zinc-400">一般ユーザーの閲覧と削除</p>
      </div>

      {error && (
        <div className="mt-6">
          <Alert kind="error">{error}</Alert>
        </div>
      )}

      {cascadeTarget && (
        <div className="mt-6">
          <DeleteConfirmPanel
            message={
              <>
                <code className="font-mono text-red-200">{cascadeTarget.email}</code>{" "}
                を削除するには関連データも削除する必要があります:
              </>
            }
            dependencies={cascadeTarget.deps}
            confirmLabel="関連データごと削除する"
            onConfirm={() => requestDelete(cascadeTarget.id, cascadeTarget.email, true)}
            onCancel={() => setCascadeTarget(null)}
            pending={pendingId === cascadeTarget.id}
          />
        </div>
      )}

      <div className="mt-6 overflow-hidden rounded-xl border border-zinc-800/80 bg-zinc-900/30">
        <table className="min-w-full divide-y divide-zinc-800/80 text-sm">
          <thead className="bg-zinc-900/60">
            <tr className="text-left">
              <Th>Email</Th>
              <Th>確認</Th>
              <Th>表示名</Th>
              <Th>ID</Th>
              <Th>作成日時</Th>
              <Th className="text-right">Actions</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-800/60">
            {users === null ? (
              <tr>
                <td className="px-4 py-10 text-center text-sm text-zinc-500" colSpan={6}>
                  <span className="inline-flex items-center gap-2">
                    <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-indigo-400" />
                    Loading...
                  </span>
                </td>
              </tr>
            ) : users.length === 0 ? (
              <tr>
                <td className="px-4 py-10 text-center text-sm text-zinc-500" colSpan={6}>
                  ユーザーがいません
                </td>
              </tr>
            ) : (
              users.map((u) => (
                <tr key={u.id} className="transition-colors hover:bg-zinc-900/40">
                  <Td className="text-zinc-100">{u.email}</Td>
                  <Td>
                    <VerifiedBadge verified={u.emailVerified} />
                  </Td>
                  <Td className="text-zinc-300">{u.name}</Td>
                  <Td className="font-mono text-xs text-zinc-500">{u.id}</Td>
                  <Td className="font-mono text-xs text-zinc-500">
                    {new Date(u.createdAt).toISOString().slice(0, 16).replace("T", " ")}
                  </Td>
                  <Td className="text-right whitespace-nowrap">
                    <Link
                      to={`/admin/users/${encodeURIComponent(u.id)}`}
                      className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-zinc-400 hover:bg-zinc-800/60 hover:text-zinc-100 transition-colors"
                    >
                      <Eye className="h-3 w-3" strokeWidth={2} />
                      詳細
                    </Link>
                    <button
                      disabled={pendingId === u.id}
                      onClick={() => requestDelete(u.id, u.email, false)}
                      className="ml-1 inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-red-400 hover:bg-red-950/40 hover:text-red-300 transition-colors disabled:opacity-50"
                    >
                      <Trash2 className="h-3 w-3" strokeWidth={2} />
                      削除
                    </button>
                  </Td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** テーブルヘッダセル (統一スタイル)。 */
function Th({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <th
      className={[
        "px-4 py-2.5 text-xs font-medium uppercase tracking-wide text-zinc-500",
        className,
      ].join(" ")}
    >
      {children}
    </th>
  );
}

/** テーブルデータセル (統一スタイル)。 */
function Td({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <td className={["px-4 py-3 align-middle", className].join(" ")}>{children}</td>;
}
