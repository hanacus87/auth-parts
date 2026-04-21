import type { ReactNode } from "react";
import { AlertTriangle } from "lucide-react";
import { Button } from "./Button";

export interface Dependency {
  label: string;
  count: number;
}

interface Props {
  title?: string;
  message: ReactNode;
  dependencies?: Dependency[];
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
  pending?: boolean;
}

/**
 * 削除操作の確認用インラインパネル。
 * - UsersList / ClientsList / UserDetail / AdminsList / AdminDetail で共通化。
 * - カスケード対象がある場合は dependencies に件数を渡せば一覧表示する。
 * - UI パターン: 赤系背景 + AlertTriangle アイコン + danger / secondary の 2 ボタン。
 */
export function DeleteConfirmPanel({
  title = "削除の確認",
  message,
  dependencies,
  confirmLabel,
  onConfirm,
  onCancel,
  pending,
}: Props) {
  return (
    <div className="rounded-lg border border-red-900/60 bg-red-950/20 p-4">
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-400" strokeWidth={2} />
        <div className="flex-1">
          <h2 className="text-sm font-semibold text-red-200">{title}</h2>
          <div className="mt-1 text-sm text-red-100/90">{message}</div>
          {dependencies && dependencies.length > 0 && (
            <ul className="mt-3 space-y-1 text-sm text-red-200/90">
              {dependencies.map((d) => (
                <li key={d.label} className="flex items-center gap-2">
                  <span className="h-1 w-1 rounded-full bg-red-400/60" />
                  <span>
                    {d.label}: <span className="font-mono">{d.count}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
      <div className="mt-4 flex gap-2">
        <Button variant="danger" size="sm" onClick={onConfirm} disabled={pending}>
          {pending ? "削除中..." : confirmLabel}
        </Button>
        <Button variant="secondary" size="sm" onClick={onCancel} disabled={pending}>
          キャンセル
        </Button>
      </div>
    </div>
  );
}
