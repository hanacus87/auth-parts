import { useState, type ReactNode } from "react";

interface Props {
  label: string;
  side?: "top" | "bottom";
  children: ReactNode;
}

/**
 * React state ベースの最小限 tooltip。追加依存なし。
 * 制御方法: mouseenter/leave + focus/blur で visible を切替。
 * 位置: 絶対配置で相対コンテナ (Wrapper) を基準に上/下に表示。
 */
export function Tooltip({ label, side = "top", children }: Props) {
  const [visible, setVisible] = useState(false);
  return (
    <span
      className="relative inline-flex"
      onMouseEnter={() => setVisible(true)}
      onMouseLeave={() => setVisible(false)}
      onFocus={() => setVisible(true)}
      onBlur={() => setVisible(false)}
    >
      {children}
      {visible && (
        <span
          role="tooltip"
          className={[
            "pointer-events-none absolute left-1/2 z-50 -translate-x-1/2 whitespace-nowrap",
            "rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs text-zinc-100 shadow-lg",
            side === "top" ? "bottom-full mb-1.5" : "top-full mt-1.5",
          ].join(" ")}
        >
          {label}
        </span>
      )}
    </span>
  );
}
