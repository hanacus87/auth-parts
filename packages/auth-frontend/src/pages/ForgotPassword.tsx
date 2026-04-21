import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { AuthLayout } from "../components/Layout";
import { Field, Input } from "../components/Input";
import { Button } from "../components/Button";
import { Alert } from "../components/Alert";
import { api, ApiError } from "../lib/api";
import { forgotPasswordSchema, type ForgotPasswordInput } from "../lib/schemas";

type SentState = { email: string };

/**
 * 一般ユーザー向けパスワード再設定リンク送信ページ。
 * 未登録メール宛でも送信成功扱いでレスポンスが返る (ユーザー列挙対策) ため、UI も成功ビューに切り替えて案内する。
 */
export function ForgotPasswordPage() {
  const [serverError, setServerError] = useState<string | null>(null);
  const [sent, setSent] = useState<SentState | null>(null);
  const [resendState, setResendState] = useState<"idle" | "sending" | "sent">("idle");

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ForgotPasswordInput>({
    resolver: zodResolver(forgotPasswordSchema),
    mode: "onBlur",
    reValidateMode: "onChange",
    defaultValues: { email: "" },
  });

  const onSubmit = handleSubmit(async (data) => {
    setServerError(null);
    try {
      await api.post<{ ok: boolean }>("/api/forgot-password", data);
      setSent({ email: data.email });
    } catch (err) {
      setServerError(err instanceof ApiError ? err.message : "送信に失敗しました");
    }
  });

  async function handleResend() {
    if (!sent) return;
    setResendState("sending");
    try {
      await api.post<{ ok: boolean }>("/api/forgot-password", { email: sent.email });
      setResendState("sent");
    } catch {
      setResendState("idle");
    }
  }

  if (sent) {
    return (
      <AuthLayout title="パスワード再設定メールを送信しました" subtitle="受信箱をご確認ください">
        <div className="mb-4">
          <Alert kind="success">
            <strong>{sent.email}</strong>{" "}
            宛にパスワード再設定のリンクを送信しました。メール内のリンクをクリックして新しいパスワードを設定してください。
          </Alert>
        </div>
        <p className="mb-4 text-xs text-zinc-400">
          リンクの有効期限は 15 分です。届かない場合は迷惑メールフォルダもご確認ください。
          また、該当メールアドレスでアカウントが登録されていない場合はメールは届きません。
        </p>

        {resendState === "sent" ? (
          <Alert kind="success">再送しました。</Alert>
        ) : (
          <Button
            type="button"
            variant="secondary"
            full
            disabled={resendState === "sending"}
            onClick={handleResend}
          >
            {resendState === "sending" ? "送信中..." : "メールを再送"}
          </Button>
        )}

        <p className="mt-4 text-center text-sm text-zinc-400">
          メール内のリンクを開いて新しいパスワードを設定してください。
        </p>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      title="パスワードを忘れた方"
      subtitle="登録したメールアドレスに再設定リンクを送信します"
    >
      {serverError && (
        <div className="mb-4">
          <Alert kind="error">{serverError}</Alert>
        </div>
      )}
      <form onSubmit={onSubmit} noValidate>
        <Field label="メールアドレス" error={errors.email?.message}>
          <Input {...register("email")} type="email" autoComplete="email" />
        </Field>
        <div className="mt-6">
          <Button type="submit" full disabled={isSubmitting}>
            {isSubmitting ? "送信中..." : "再設定リンクを送信"}
          </Button>
        </div>
      </form>
    </AuthLayout>
  );
}
