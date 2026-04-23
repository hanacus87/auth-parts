import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { LogOut, Users, KeyRound, LayoutGrid, UserCog } from "lucide-react";
import { api, ApiError, redirectTo } from "../lib/api";
import { Button } from "./Button";
import { AuthContainerMark } from "./AuthContainerMark";
import type { AdminRole } from "../lib/schemas";

interface AdminInfo {
  id: string;
  email: string;
  name: string;
  role: AdminRole;
}

interface AdminSession {
  admin: AdminInfo;
  csrfToken: string;
}

const AdminSessionCtx = createContext<AdminSession | null>(null);

/**
 * 管理画面配下のコンポーネントで現在の管理者セッション情報を取得する。
 * `AdminLayout` の内側でのみ使用可能。
 *
 * @throws `AdminLayout` の外で呼んだ場合
 */
export function useAdminSession(): AdminSession {
  const ctx = useContext(AdminSessionCtx);
  if (!ctx) throw new Error("useAdminSession outside AdminLayout");
  return ctx;
}

/** admin の role に応じて表示するサイドナビ項目を組み立てる。SuperAdmin のみ Users / Admins 管理を表示。 */
function buildNavItems(role: AdminRole) {
  const items = [{ to: "/admin", label: "ダッシュボード", icon: LayoutGrid, end: true }];
  if (role === "super") {
    items.push({ to: "/admin/users", label: "ユーザー", icon: Users, end: false });
    items.push({ to: "/admin/admins", label: "管理者", icon: UserCog, end: false });
  }
  items.push({ to: "/admin/clients", label: "クライアント", icon: KeyRound, end: false });
  return items;
}

/**
 * 管理画面全体のレイアウト。マウント時に `/api/admin/session` を呼んで管理者情報と CSRF トークンを取得し、
 * 401 なら `/admin/login` へ redirect する。取得した session を Context で子コンポーネントに提供する。
 */
export function AdminLayout() {
  const navigate = useNavigate();
  const [session, setSession] = useState<AdminSession | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<AdminSession>("/api/admin/session")
      .then(setSession)
      .catch((err) => {
        if (err instanceof ApiError && err.status === 401) {
          navigate("/admin/login", { replace: true });
        } else {
          setError(err.message ?? "セッションの取得に失敗しました");
        }
      });
  }, [navigate]);

  async function handleLogout() {
    if (!session) return;
    try {
      const res = await api.post<{ redirectUrl: string }>("/api/admin/logout", {
        _csrf: session.csrfToken,
      });
      redirectTo(res.redirectUrl);
    } catch (err) {
      setError(err instanceof Error ? err.message : "ログアウトに失敗しました");
    }
  }

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center p-8">
        <div className="rounded-lg border border-red-900/60 bg-red-950/30 px-6 py-4 text-sm text-red-200">
          {error}
        </div>
      </div>
    );
  }

  const navItems = useMemo(() => buildNavItems(session?.admin.role ?? "admin"), [session]);

  if (!session) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="flex items-center gap-2 text-sm text-zinc-500">
          <div className="h-2 w-2 animate-pulse rounded-full bg-indigo-400" />
          読み込み中...
        </div>
      </div>
    );
  }

  return (
    <AdminSessionCtx.Provider value={session}>
      <div className="min-h-screen">
        <header className="sticky top-0 z-10 border-b border-zinc-800/80 bg-zinc-950/80 backdrop-blur-xl">
          <div className="mx-auto flex h-14 max-w-6xl items-center gap-6 px-6">
            <div className="flex items-center gap-2">
              <AuthContainerMark className="h-4 w-4 text-indigo-400" strokeWidth={2.2} />
              <span className="text-sm font-semibold tracking-tight text-zinc-100">
                AuthContainer
              </span>
              {session.admin.role === "super" ? (
                <span className="ml-1 rounded-full bg-indigo-950/60 px-2 py-0.5 text-[10px] font-medium tracking-wide text-indigo-300 ring-1 ring-inset ring-indigo-900/60">
                  SuperAdmin
                </span>
              ) : (
                <span className="ml-1 rounded-full bg-zinc-800 px-2 py-0.5 text-[10px] font-medium tracking-wide text-zinc-400">
                  Admin
                </span>
              )}
            </div>

            <nav className="flex items-center gap-1">
              {navItems.map(({ to, label, icon: Icon, end }) => (
                <NavLink
                  key={to}
                  to={to}
                  end={end}
                  className={({ isActive }) =>
                    [
                      "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                      isActive
                        ? "bg-zinc-800/80 text-zinc-50"
                        : "text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100",
                    ].join(" ")
                  }
                >
                  <Icon className="h-3.5 w-3.5" strokeWidth={2} />
                  {label}
                </NavLink>
              ))}
            </nav>

            <div className="flex-1" />

            <div className="flex items-center gap-3">
              <span className="hidden text-xs text-zinc-500 sm:block">{session.admin.email}</span>
              <Button
                size="sm"
                variant="secondary"
                onClick={handleLogout}
                leftIcon={<LogOut className="h-3.5 w-3.5" strokeWidth={2} />}
              >
                ログアウト
              </Button>
            </div>
          </div>
        </header>

        <main className="mx-auto max-w-6xl px-6 py-10">
          <Outlet />
        </main>
      </div>
    </AdminSessionCtx.Provider>
  );
}
