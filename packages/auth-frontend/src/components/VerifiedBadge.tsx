import { CheckCircle2, XCircle } from "lucide-react";
import { Tooltip } from "./Tooltip";

/** メールアドレス確認状態を示すバッジ。確認済みなら emerald チェック、未確認なら amber × を Tooltip 付きで表示。 */
export function VerifiedBadge({ verified }: { verified: boolean }) {
  const label = verified ? "メールアドレス確認済み" : "メールアドレス未確認";
  return (
    <Tooltip label={label}>
      <span className="inline-flex" aria-label={label}>
        {verified ? (
          <CheckCircle2 className="h-4 w-4 text-emerald-400" strokeWidth={2} />
        ) : (
          <XCircle className="h-4 w-4 text-amber-400" strokeWidth={2} />
        )}
      </span>
    </Tooltip>
  );
}
