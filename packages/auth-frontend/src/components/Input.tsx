import {
  forwardRef,
  useState,
  type InputHTMLAttributes,
  type TextareaHTMLAttributes,
  type SelectHTMLAttributes,
  type ReactNode,
  type Ref,
} from "react";
import { Eye, EyeOff } from "lucide-react";

const FIELD_CLASS =
  "w-full rounded-md border border-zinc-800 bg-zinc-900/60 px-3.5 py-2 text-sm text-zinc-100 " +
  "placeholder:text-zinc-600 " +
  "transition-colors duration-150 " +
  "hover:border-zinc-700 " +
  "focus:border-indigo-500/70 focus:outline-none focus:ring-4 focus:ring-indigo-500/15 " +
  "read-only:bg-zinc-950/60 read-only:text-zinc-400 read-only:cursor-default";

/** ラベル・ヒント・エラー表示を束ねるフォームフィールドのラッパ。 */
export function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  children: ReactNode;
}) {
  return (
    <div className="mb-4">
      <label className="mb-1.5 flex items-center gap-2 text-xs font-medium text-zinc-400">
        <span className="text-zinc-200">{label}</span>
        {hint && <span className="text-zinc-500">{hint}</span>}
      </label>
      {children}
      {error && <p className="mt-1 text-xs text-red-400">{error}</p>}
    </div>
  );
}

/**
 * 統一スタイルのテキスト入力。
 * react-hook-form の `register()` が返す ref を DOM 要素まで届けるため forwardRef 化している。
 */
export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function Input(props, ref) {
    return (
      <input ref={ref} {...props} className={[FIELD_CLASS, props.className ?? ""].join(" ")} />
    );
  },
);

/** 統一スタイルの複数行テキスト入力 (等幅フォント)。ref は react-hook-form 用に素通し。 */
export const TextArea = forwardRef<
  HTMLTextAreaElement,
  TextareaHTMLAttributes<HTMLTextAreaElement>
>(function TextArea(props, ref) {
  return (
    <textarea
      ref={ref}
      {...props}
      className={[
        FIELD_CLASS,
        "font-mono text-[0.8rem] min-h-20 leading-5",
        props.className ?? "",
      ].join(" ")}
    />
  );
});

/** 統一スタイルの select 要素。ref は react-hook-form 用に素通し。 */
export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(
  function Select(props, ref) {
    return (
      <select ref={ref} {...props} className={[FIELD_CLASS, props.className ?? ""].join(" ")} />
    );
  },
);

/**
 * パスワード入力。右端の目玉アイコンで表示/非表示を切り替え可能。
 * `type` 属性は内部で "password"/"text" を切り替えるため props 側から受け付けない。
 */
export const PasswordInput = forwardRef<
  HTMLInputElement,
  Omit<InputHTMLAttributes<HTMLInputElement>, "type">
>(function PasswordInput(props, ref: Ref<HTMLInputElement>) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="relative">
      <input
        ref={ref}
        {...props}
        type={visible ? "text" : "password"}
        className={[FIELD_CLASS, "pr-10", props.className ?? ""].join(" ")}
      />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        tabIndex={-1}
        aria-label={visible ? "パスワードを隠す" : "パスワードを表示"}
        aria-pressed={visible}
        className={[
          "absolute right-1.5 top-1/2 -translate-y-1/2",
          "inline-flex h-7 w-7 items-center justify-center rounded",
          "text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800/60",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400/60",
          "transition-colors",
        ].join(" ")}
      >
        {visible ? (
          <EyeOff className="h-4 w-4" strokeWidth={2} />
        ) : (
          <Eye className="h-4 w-4" strokeWidth={2} />
        )}
      </button>
    </div>
  );
});
