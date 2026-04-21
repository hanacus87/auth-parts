import type { ReactNode } from "react";
import { AlertCircle, CheckCircle2, Info, AlertTriangle } from "lucide-react";

type Kind = "error" | "success" | "warning" | "info";

const CONFIG: Record<
  Kind,
  {
    className: string;
    icon: ReactNode;
  }
> = {
  error: {
    className: "bg-red-950/40 border-red-900/60 text-red-200",
    icon: <AlertCircle className="h-4 w-4 text-red-400" strokeWidth={2} />,
  },
  success: {
    className: "bg-emerald-950/40 border-emerald-900/60 text-emerald-200",
    icon: <CheckCircle2 className="h-4 w-4 text-emerald-400" strokeWidth={2} />,
  },
  warning: {
    className: "bg-amber-950/40 border-amber-900/60 text-amber-200",
    icon: <AlertTriangle className="h-4 w-4 text-amber-400" strokeWidth={2} />,
  },
  info: {
    className: "bg-indigo-950/40 border-indigo-900/60 text-indigo-200",
    icon: <Info className="h-4 w-4 text-indigo-400" strokeWidth={2} />,
  },
};

/** error / success / warning / info の 4 種類を切り替えられる通知アラート。 */
export function Alert({ kind = "info", children }: { kind?: Kind; children: ReactNode }) {
  const { className, icon } = CONFIG[kind];
  return (
    <div
      className={[
        "flex items-start gap-2.5 rounded-md border px-3.5 py-2.5 text-sm leading-5",
        className,
      ].join(" ")}
    >
      <span className="mt-0.5 shrink-0">{icon}</span>
      <div className="flex-1">{children}</div>
    </div>
  );
}
