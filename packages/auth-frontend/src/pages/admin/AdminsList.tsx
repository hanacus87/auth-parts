import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Eye, Plus, Trash2 } from "lucide-react";
import { useAdminSession } from "../../components/AdminLayout";
import { Button } from "../../components/Button";
import { Alert } from "../../components/Alert";
import { Tooltip } from "../../components/Tooltip";
import { VerifiedBadge } from "../../components/VerifiedBadge";
import { DeleteConfirmPanel } from "../../components/DeleteConfirmPanel";
import { api, ApiError } from "../../lib/api";
import type { AdminRole } from "../../lib/schemas";

interface AdminRow {
  id: string;
  email: string;
  name: string;
  role: AdminRole;
  emailVerified: boolean;
  createdAt: string;
  updatedAt: string;
}

/**
 * 管理者一覧ページ (SuperAdmin 専用)。
 * 自分のアカウントを先頭に固定表示し、自分自身の削除は UI 上で disabled にする。
 */
export function AdminsList() {
  const { admin: me, csrfToken } = useAdminSession();
  const [admins, setAdmins] = useState<AdminRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [confirmTarget, setConfirmTarget] = useState<AdminRow | null>(null);

  async function reload() {
    try {
      const res = await api.get<{ admins: AdminRow[] }>("/api/admin/admins");
      const sorted = [
        ...res.admins.filter((a) => a.id === me.id),
        ...res.admins.filter((a) => a.id !== me.id),
      ];
      setAdmins(sorted);
    } catch (err) {
      setError(err instanceof Error ? err.message : "読み込みに失敗");
    }
  }

  useEffect(() => {
    reload();
  }, []);

  async function confirmDelete() {
    if (!confirmTarget) return;
    const target = confirmTarget;
    setPendingId(target.id);
    try {
      await api.post<{ ok: boolean }>(`/api/admin/admins/${encodeURIComponent(target.id)}/delete`, {
        _csrf: csrfToken,
      });
      setConfirmTarget(null);
      await reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "削除に失敗");
    } finally {
      setPendingId(null);
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-50">Admins</h1>
          <p className="mt-1 text-sm text-zinc-400">
            管理者の閲覧・招待・role 変更・削除 (SuperAdmin のみ)
          </p>
        </div>
        <Link to="/admin/admins/new">
          <Button leftIcon={<Plus className="h-3.5 w-3.5" strokeWidth={2.5} />}>
            Invite admin
          </Button>
        </Link>
      </div>

      {error && (
        <div className="mt-6">
          <Alert kind="error">{error}</Alert>
        </div>
      )}

      {confirmTarget && (
        <div className="mt-6">
          <DeleteConfirmPanel
            message={
              <>
                <code className="font-mono text-red-200">{confirmTarget.email}</code>{" "}
                を削除します。関連する adminSessions /
                招待トークンも同時に削除され、この管理者が所有していたクライアントは SuperAdmin
                専有扱いになります。
              </>
            }
            confirmLabel="削除する"
            onConfirm={confirmDelete}
            onCancel={() => setConfirmTarget(null)}
            pending={pendingId === confirmTarget.id}
          />
        </div>
      )}

      <div className="mt-6 overflow-hidden rounded-xl border border-zinc-800/80 bg-zinc-900/30">
        <table className="min-w-full divide-y divide-zinc-800/80 text-sm">
          <thead className="bg-zinc-900/60">
            <tr className="text-left">
              <Th>Email</Th>
              <Th>確認</Th>
              <Th>Role</Th>
              <Th>表示名</Th>
              <Th>ID</Th>
              <Th>作成日時</Th>
              <Th className="text-right">Actions</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-800/60">
            {admins === null ? (
              <tr>
                <td className="px-4 py-10 text-center text-sm text-zinc-500" colSpan={7}>
                  <span className="inline-flex items-center gap-2">
                    <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-indigo-400" />
                    Loading...
                  </span>
                </td>
              </tr>
            ) : admins.length === 0 ? (
              <tr>
                <td className="px-4 py-10 text-center text-sm text-zinc-500" colSpan={7}>
                  管理者がいません
                </td>
              </tr>
            ) : (
              admins.map((a) => {
                const isSelf = a.id === me.id;
                return (
                  <tr key={a.id} className="transition-colors hover:bg-zinc-900/40">
                    <Td className="text-zinc-100">
                      {a.email}
                      {isSelf && (
                        <span className="ml-2 text-[10px] font-mono text-indigo-400">(自分)</span>
                      )}
                    </Td>
                    <Td>
                      <VerifiedBadge verified={a.emailVerified} />
                    </Td>
                    <Td>
                      <RoleBadge role={a.role} />
                    </Td>
                    <Td className="text-zinc-300">{a.name}</Td>
                    <Td className="font-mono text-xs text-zinc-500">{a.id}</Td>
                    <Td className="font-mono text-xs text-zinc-500">
                      {new Date(a.createdAt).toISOString().slice(0, 16).replace("T", " ")}
                    </Td>
                    <Td className="text-right whitespace-nowrap">
                      <Link
                        to={`/admin/admins/${encodeURIComponent(a.id)}`}
                        className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-zinc-400 hover:bg-zinc-800/60 hover:text-zinc-100 transition-colors"
                      >
                        <Eye className="h-3 w-3" strokeWidth={2} />
                        詳細
                      </Link>
                      {isSelf ? (
                        <Tooltip label="自分自身は削除できません">
                          <span className="ml-1 inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-zinc-600 cursor-not-allowed">
                            <Trash2 className="h-3 w-3" strokeWidth={2} />
                            削除
                          </span>
                        </Tooltip>
                      ) : (
                        <button
                          disabled={pendingId === a.id}
                          onClick={() => setConfirmTarget(a)}
                          className="ml-1 inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-red-400 hover:bg-red-950/40 hover:text-red-300 transition-colors disabled:opacity-50"
                        >
                          <Trash2 className="h-3 w-3" strokeWidth={2} />
                          削除
                        </button>
                      )}
                    </Td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** admin の role に応じた着色バッジを返す (super は indigo、admin は zinc)。 */
function RoleBadge({ role }: { role: AdminRole }) {
  if (role === "super") {
    return (
      <span className="inline-flex items-center rounded-md bg-indigo-950/60 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-indigo-300 ring-1 ring-inset ring-indigo-900/60">
        super
      </span>
    );
  }
  return (
    <span className="inline-flex items-center rounded-md bg-zinc-800/60 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-zinc-400 ring-1 ring-inset ring-zinc-700/60">
      admin
    </span>
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
