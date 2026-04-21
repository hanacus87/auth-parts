import type { ReactNode } from "react";
import { ShieldCheck } from "lucide-react";

interface Props {
  title: string;
  subtitle?: string;
  children: ReactNode;
}

/** OIDC フロー画面 (login / consent / register / logout) 用のカードレイアウト。 */
export function AuthLayout({ title, subtitle, children }: Props) {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-4 py-12">
      <div className="mb-8 flex items-center gap-2 text-zinc-500">
        <ShieldCheck className="h-4 w-4 text-indigo-400" strokeWidth={2.2} />
        <span className="text-xs font-medium tracking-wide uppercase">AuthContainer</span>
      </div>

      <div
        className={[
          "w-full max-w-md rounded-xl",
          "border border-zinc-800/80",
          "bg-zinc-900/50 backdrop-blur-xl",
          "p-8",
          "shadow-2xl shadow-black/40",
        ].join(" ")}
      >
        <h1 className="text-lg font-semibold tracking-tight text-zinc-50">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-zinc-400">{subtitle}</p>}
        <div className="mt-6">{children}</div>
      </div>
    </div>
  );
}
