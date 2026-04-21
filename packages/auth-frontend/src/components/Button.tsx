import type { ButtonHTMLAttributes, ReactNode } from "react";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md";

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  children: ReactNode;
  variant?: Variant;
  size?: Size;
  full?: boolean;
  leftIcon?: ReactNode;
  rightIcon?: ReactNode;
}

const VARIANT: Record<Variant, string> = {
  primary:
    "bg-indigo-500 hover:bg-indigo-400 active:bg-indigo-600 text-white " +
    "shadow-[0_1px_0_0_rgba(255,255,255,0.08)_inset,0_0_0_1px_rgba(255,255,255,0.04)]",
  secondary:
    "bg-zinc-900 hover:bg-zinc-800 active:bg-zinc-900 text-zinc-100 " +
    "border border-zinc-800 hover:border-zinc-700",
  ghost: "bg-transparent hover:bg-zinc-900 text-zinc-300 hover:text-zinc-100",
  danger:
    "bg-red-500 hover:bg-red-400 active:bg-red-600 text-white " +
    "shadow-[0_1px_0_0_rgba(255,255,255,0.08)_inset]",
};

const SIZE: Record<Size, string> = {
  sm: "h-8 px-3 text-xs",
  md: "h-9 px-4 text-sm",
};

/** 4 variant × 2 size の統一ボタン。左右アイコンと full 幅オプションに対応。 */
export function Button({
  children,
  variant = "primary",
  size = "md",
  full,
  leftIcon,
  rightIcon,
  className = "",
  ...rest
}: Props) {
  return (
    <button
      {...rest}
      className={[
        "inline-flex items-center justify-center gap-2 rounded-md font-medium",
        "transition-all duration-150 ease-out",
        "focus:outline-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400/60 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950",
        "disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-zinc-800",
        "active:scale-[0.98]",
        VARIANT[variant],
        SIZE[size],
        full ? "w-full" : "",
        className,
      ].join(" ")}
    >
      {leftIcon && <span className="flex h-4 w-4 items-center">{leftIcon}</span>}
      {children}
      {rightIcon && <span className="flex h-4 w-4 items-center">{rightIcon}</span>}
    </button>
  );
}
