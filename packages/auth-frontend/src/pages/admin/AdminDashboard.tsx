import { Link } from "react-router-dom";
import { ArrowRight, KeyRound, UserCog, Users } from "lucide-react";
import { useAdminSession } from "../../components/AdminLayout";
import type { AdminRole } from "../../lib/schemas";

interface Card {
  to: string;
  title: string;
  description: string;
  icon: typeof Users;
  roles: readonly AdminRole[];
}

const CARDS: readonly Card[] = [
  {
    to: "/admin/users",
    title: "ユーザー管理",
    description: "一般ユーザーの閲覧と削除",
    icon: Users,
    roles: ["super"],
  },
  {
    to: "/admin/admins",
    title: "管理者管理",
    description: "管理者の招待・role 変更・削除",
    icon: UserCog,
    roles: ["super"],
  },
  {
    to: "/admin/clients",
    title: "クライアント管理",
    description: "OIDC クライアントの CRUD。client_id / secret は自動生成",
    icon: KeyRound,
    roles: ["super", "admin"],
  },
];

/**
 * 管理画面のトップページ。
 * 現在の admin role に応じて表示するカード (ユーザー管理 / 管理者管理 / クライアント管理) を絞り込む。
 */
export function AdminDashboard() {
  const { admin } = useAdminSession();
  const visible = CARDS.filter((c) => c.roles.includes(admin.role));

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-50">Dashboard</h1>
          <p className="mt-1 text-sm text-zinc-400">
            ようこそ、<span className="text-zinc-200">{admin.name}</span> さん{" "}
            <span className="ml-2 inline-flex items-center rounded-md bg-zinc-800/60 px-1.5 py-0.5 text-[10px] font-mono text-zinc-300 ring-1 ring-inset ring-zinc-700/60">
              {admin.role}
            </span>
          </p>
        </div>
      </div>

      <div className="mt-10 grid gap-4 sm:grid-cols-2">
        {visible.map(({ to, title, description, icon: Icon }) => (
          <Link
            key={to}
            to={to}
            className={[
              "group relative overflow-hidden rounded-xl border border-zinc-800/80 bg-zinc-900/40 p-6 transition-all",
              "hover:border-indigo-900/60 hover:bg-zinc-900/70",
            ].join(" ")}
          >
            <div className="flex items-start justify-between">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-zinc-800 bg-zinc-900 text-indigo-400 group-hover:border-indigo-900/60 group-hover:text-indigo-300 transition-colors">
                <Icon className="h-5 w-5" strokeWidth={2} />
              </div>
              <ArrowRight
                className="h-4 w-4 text-zinc-600 transition-transform group-hover:translate-x-1 group-hover:text-indigo-400"
                strokeWidth={2}
              />
            </div>
            <h2 className="mt-5 text-base font-semibold tracking-tight text-zinc-100">{title}</h2>
            <p className="mt-1 text-sm text-zinc-400">{description}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
