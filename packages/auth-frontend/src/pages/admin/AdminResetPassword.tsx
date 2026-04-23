import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Link, useSearchParams } from "react-router-dom";
import { AuthLayout } from "../../components/Layout";
import { Field, PasswordInput } from "../../components/Input";
import { Button } from "../../components/Button";
import { Alert } from "../../components/Alert";
import { api, ApiError } from "../../lib/api";
import { resetPasswordSchema, type ResetPasswordInput } from "../../lib/schemas";

type Status = "idle" | "success" | "invalid" | "expired";

/**
 * 管理者向けパスワード再設定ページ (招待リンクと forgot-password の両方から遷移する)。
 * URL の `?token=` を添えて `/api/admin/reset-password` に POST し、結果に応じて
 * 成功 / 無効 / 期限切れ のビューを出し分ける。成功時は既存 adminSessions が全て無効化される。
 */
export function AdminResetPasswordPage() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token") ?? "";

  const [status, setStatus] = useState<Status>(token ? "idle" : "invalid");
  const [serverError, setServerError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ResetPasswordInput>({
    resolver: zodResolver(resetPasswordSchema),
    mode: "onBlur",
    reValidateMode: "onChange",
    defaultValues: { password: "", password_confirm: "" },
  });

  const onSubmit = handleSubmit(async (data) => {
    setServerError(null);
    try {
      await api.post<{ ok: boolean }>("/api/admin/reset-password", { token, ...data });
      setStatus("success");
    } catch (err) {
      if (err instanceof ApiError && err.code === "expired") {
        setStatus("expired");
      } else if (err instanceof ApiError && err.code === "invalid") {
        setStatus("invalid");
      } else {
        setServerError(err instanceof ApiError ? err.message : "再設定に失敗しました");
      }
    }
  });

  if (status === "success") {
    return (
      <AuthLayout title="パスワードを再設定しました">
        <div className="mb-4">
          <Alert kind="success">新しいパスワードでログインしてください。</Alert>
        </div>
        <p className="text-center text-sm text-zinc-400">
          <Link to="/admin/login" className="text-indigo-400 hover:text-indigo-300">
            管理者ログイン画面へ
          </Link>
        </p>
      </AuthLayout>
    );
  }

  if (status === "invalid" || status === "expired") {
    const heading = status === "expired" ? "リンクの有効期限が切れています" : "リンクが無効です";
    const description =
      status === "expired"
        ? "再度メールを送信してください。"
        : "リンクが正しくないか、既に使用されています。";
    return (
      <AuthLayout title="管理者パスワード再設定" subtitle={heading}>
        <div className="mb-4">
          <Alert kind={status === "expired" ? "warning" : "error"}>{description}</Alert>
        </div>
        <p className="text-center text-sm text-zinc-400">
          <Link to="/admin/forgot-password" className="text-indigo-400 hover:text-indigo-300">
            もう一度メールを送信する
          </Link>
        </p>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title="管理者パスワード再設定">
      {serverError && (
        <div className="mb-4">
          <Alert kind="error">{serverError}</Alert>
        </div>
      )}
      <form onSubmit={onSubmit} noValidate>
        <Field label="新しいパスワード" hint="(8 文字以上)" error={errors.password?.message}>
          <PasswordInput {...register("password")} autoComplete="new-password" />
        </Field>
        <Field label="新しいパスワード (確認)" error={errors.password_confirm?.message}>
          <PasswordInput {...register("password_confirm")} autoComplete="new-password" />
        </Field>
        <div className="mt-6">
          <Button type="submit" full disabled={isSubmitting}>
            {isSubmitting ? "再設定中..." : "パスワードを再設定"}
          </Button>
        </div>
      </form>
      <p className="mt-4 text-center text-sm text-zinc-400">
        <Link to="/admin/login" className="text-indigo-400 hover:text-indigo-300">
          管理者ログインに戻る
        </Link>
      </p>
    </AuthLayout>
  );
}
