import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useSearchParams, Link } from "react-router-dom";
import { AuthLayout } from "../components/Layout";
import { Field, Input, PasswordInput } from "../components/Input";
import { Button } from "../components/Button";
import { Alert } from "../components/Alert";
import { api, ApiError } from "../lib/api";
import { registerFormSchema, type RegisterFormInput } from "../lib/schemas";

type SentState = { email: string };

/**
 * ユーザー新規登録画面。登録成功後は「確認メール送信済み」ビューへ切り替わり、
 * 再送ボタン (5 分 1 回) を提供する。
 */
export function RegisterPage() {
  const [searchParams] = useSearchParams();
  const loginChallenge = searchParams.get("login_challenge") ?? "";

  const [serverError, setServerError] = useState<string | null>(null);
  const [sent, setSent] = useState<SentState | null>(null);
  const [resendState, setResendState] = useState<"idle" | "sending" | "sent" | "rate_limited">(
    "idle",
  );

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<RegisterFormInput>({
    resolver: zodResolver(registerFormSchema),
    mode: "onBlur",
    reValidateMode: "onChange",
    defaultValues: {
      email: "",
      password: "",
      password_confirm: "",
      name: "",
      given_name: "",
      family_name: "",
    },
  });

  const onSubmit = handleSubmit(async (data) => {
    setServerError(null);
    try {
      const res = await api.post<{ emailSent: boolean; email: string }>("/api/register", data);
      if (res.emailSent) setSent({ email: res.email });
    } catch (err) {
      setServerError(err instanceof ApiError ? err.message : "登録に失敗しました");
    }
  });

  async function handleResend() {
    if (!sent) return;
    setResendState("sending");
    try {
      await api.post<{ ok: boolean }>("/api/resend-verification", { email: sent.email });
      setResendState("sent");
    } catch (err) {
      if (err instanceof ApiError && err.status === 429) {
        setResendState("rate_limited");
      } else {
        setResendState("idle");
      }
    }
  }

  const loginHref = loginChallenge
    ? `/login?login_challenge=${encodeURIComponent(loginChallenge)}`
    : "/login";

  if (sent) {
    return (
      <AuthLayout title="確認メールを送信しました" subtitle="受信箱をご確認ください">
        <div className="mb-4">
          <Alert kind="success">
            <strong>{sent.email}</strong>{" "}
            宛に確認用のリンクを送信しました。メール内のリンクをクリックしてアカウントを有効化してください。
          </Alert>
        </div>
        <p className="mb-4 text-sm text-zinc-400">
          リンクの有効期限は 60 分です。届かない場合は迷惑メールフォルダもご確認ください。
        </p>

        {resendState === "sent" ? (
          <Alert kind="success">確認メールを再送しました。</Alert>
        ) : resendState === "rate_limited" ? (
          <Alert kind="warning">再送は 5 分に 1 回までです。しばらくお待ちください。</Alert>
        ) : (
          <Button
            type="button"
            variant="secondary"
            full
            disabled={resendState === "sending"}
            onClick={handleResend}
          >
            {resendState === "sending" ? "送信中..." : "確認メールを再送"}
          </Button>
        )}

        <p className="mt-4 text-center text-sm text-zinc-400">
          <Link to={loginHref} className="text-indigo-400 hover:text-indigo-300">
            ログインに戻る
          </Link>
        </p>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title="新規登録" subtitle="アカウントを作成">
      {serverError && (
        <div className="mb-4">
          <Alert kind="error">{serverError}</Alert>
        </div>
      )}
      <form onSubmit={onSubmit} noValidate>
        <Field label="メールアドレス" hint="(必須)" error={errors.email?.message}>
          <Input {...register("email")} type="email" autoComplete="email" />
        </Field>
        <Field label="パスワード" hint="(8 文字以上)" error={errors.password?.message}>
          <PasswordInput {...register("password")} autoComplete="new-password" />
        </Field>
        <Field label="パスワード (確認)" error={errors.password_confirm?.message}>
          <PasswordInput {...register("password_confirm")} autoComplete="new-password" />
        </Field>
        <Field label="表示名" hint="(必須)" error={errors.name?.message}>
          <Input {...register("name")} type="text" autoComplete="name" />
        </Field>
        <Field label="名 (任意)" error={errors.given_name?.message}>
          <Input {...register("given_name")} type="text" autoComplete="given-name" />
        </Field>
        <Field label="姓 (任意)" error={errors.family_name?.message}>
          <Input {...register("family_name")} type="text" autoComplete="family-name" />
        </Field>
        <div className="mt-6">
          <Button type="submit" full disabled={isSubmitting}>
            {isSubmitting ? "登録中..." : "登録する"}
          </Button>
        </div>
      </form>
      <p className="mt-4 text-center text-sm text-zinc-400">
        <Link to={loginHref} className="text-indigo-400 hover:text-indigo-300">
          ログインに戻る
        </Link>
      </p>
    </AuthLayout>
  );
}
