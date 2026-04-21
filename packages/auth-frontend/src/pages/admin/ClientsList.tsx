import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { useAdminSession } from "../../components/AdminLayout";
import { Button } from "../../components/Button";
import { Alert } from "../../components/Alert";
import { DeleteConfirmPanel } from "../../components/DeleteConfirmPanel";
import { api, ApiError } from "../../lib/api";

interface Client {
  id: string;
  name: string;
  tokenEndpointAuthMethod: string;
  redirectUris: string[];
}

/**
 * OIDC クライアント一覧ページ (全 admin 利用可、Admin は自分が作成したもののみサーバ側でフィルタされる)。
 * 削除時の依存行確認フローは UsersList と共通。
 */
export function ClientsList() {
  const { csrfToken } = useAdminSession();
  const [clients, setClients] = useState<Client[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [cascadeTarget, setCascadeTarget] = useState<{
    id: string;
    name: string;
    deps: { label: string; count: number }[];
  } | null>(null);

  async function reload() {
    try {
      const res = await api.get<{ clients: Client[] }>("/api/admin/clients");
      setClients(res.clients);
    } catch (err) {
      setError(err instanceof Error ? err.message : "読み込みに失敗");
    }
  }

  useEffect(() => {
    reload();
  }, []);

  async function requestDelete(id: string, name: string, cascade: boolean) {
    setPendingId(id);
    try {
      const res = await api.post<{
        ok?: boolean;
        requiresCascade?: boolean;
        dependencies?: { label: string; count: number }[];
      }>(`/api/admin/clients/${encodeURIComponent(id)}/delete`, { cascade, _csrf: csrfToken });
      if (res.requiresCascade) {
        setCascadeTarget({ id, name, deps: res.dependencies ?? [] });
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
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-50">Clients</h1>
          <p className="mt-1 text-sm text-zinc-400">OIDC クライアントの管理</p>
        </div>
        <Link to="/admin/clients/new">
          <Button leftIcon={<Plus className="h-3.5 w-3.5" strokeWidth={2.5} />}>New client</Button>
        </Link>
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
                <code className="font-mono text-red-200">{cascadeTarget.name}</code>{" "}
                を削除するには関連データも削除する必要があります:
              </>
            }
            dependencies={cascadeTarget.deps}
            confirmLabel="関連データごと削除する"
            onConfirm={() => requestDelete(cascadeTarget.id, cascadeTarget.name, true)}
            onCancel={() => setCascadeTarget(null)}
            pending={pendingId === cascadeTarget.id}
          />
        </div>
      )}

      <div className="mt-6 overflow-hidden rounded-xl border border-zinc-800/80 bg-zinc-900/30">
        <table className="min-w-full divide-y divide-zinc-800/80 text-sm">
          <thead className="bg-zinc-900/60">
            <tr className="text-left">
              <Th>client_id</Th>
              <Th>名前</Th>
              <Th>auth_method</Th>
              <Th>redirect_uris</Th>
              <Th className="text-right">Actions</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-800/60">
            {clients === null ? (
              <tr>
                <td className="px-4 py-10 text-center text-sm text-zinc-500" colSpan={5}>
                  <span className="inline-flex items-center gap-2">
                    <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-indigo-400" />
                    Loading...
                  </span>
                </td>
              </tr>
            ) : clients.length === 0 ? (
              <tr>
                <td className="px-4 py-10 text-center text-sm text-zinc-500" colSpan={5}>
                  クライアントがいません
                </td>
              </tr>
            ) : (
              clients.map((cl) => (
                <tr key={cl.id} className="transition-colors hover:bg-zinc-900/40">
                  <Td>
                    <code className="font-mono text-xs text-zinc-200">{cl.id}</code>
                  </Td>
                  <Td className="text-zinc-100">{cl.name}</Td>
                  <Td>
                    <span className="inline-flex items-center rounded-md border border-zinc-800 bg-zinc-900 px-2 py-0.5 font-mono text-[10px] text-zinc-400">
                      {cl.tokenEndpointAuthMethod}
                    </span>
                  </Td>
                  <Td className="font-mono text-xs text-zinc-500 max-w-xs truncate">
                    {cl.redirectUris.join(", ")}
                  </Td>
                  <Td className="text-right whitespace-nowrap">
                    <Link
                      to={`/admin/clients/${encodeURIComponent(cl.id)}/edit`}
                      className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-zinc-400 hover:bg-zinc-800/60 hover:text-zinc-100 transition-colors"
                    >
                      <Pencil className="h-3 w-3" strokeWidth={2} />
                      編集
                    </Link>
                    <button
                      disabled={pendingId === cl.id}
                      onClick={() => requestDelete(cl.id, cl.name, false)}
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
