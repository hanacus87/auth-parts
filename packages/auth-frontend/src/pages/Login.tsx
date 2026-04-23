import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useSearchParams, Link } from "react-router-dom";
import { AuthLayout } from "../components/Layout";
import { Field, Input, PasswordInput } from "../components/Input";
import { Button } from "../components/Button";
import { Alert } from "../components/Alert";
import { api, ApiError, redirectTo } from "../lib/api";
import { loginFormSchema, type LoginFormInput } from "../lib/schemas";

type UnverifiedState = { email: string };

/**
 * OIDC ログイン画面。
 * クエリ `login_challenge` の検証結果に応じてフォーム or 「アプリから再開してください」案内ビューを出し分ける。
 * メール未確認ユーザーには確認メール再送ボタン (5 分 1 回、429 検知) を表示する。
 */
export function LoginPage() {
  const [searchParams] = useSearchParams();
  const loginChallenge = searchParams.get("login_challenge") ?? "";

  const [serverError, setServerError] = useState<string | null>(null);
  const [challengeValid, setChallengeValid] = useState<boolean | null>(null);
  const [unverified, setUnverified] = useState<UnverifiedState | null>(null);
  const [resendState, setResendState] = useState<"idle" | "sending" | "sent" | "rate_limited">(
    "idle",
  );

  const {
    register,
    handleSubmit,
    getValues,
    formState: { errors, isSubmitting },
  } = useForm<LoginFormInput>({
    resolver: zodResolver(loginFormSchema),
    mode: "onBlur",
    reValidateMode: "onChange",
    defaultValues: { email: "", password: "" },
  });

  useEffect(() => {
    if (!loginChallenge) {
      setChallengeValid(false);
      return;
    }
    api
      .get<{ valid: boolean; error?: string }>(
        `/api/login/context?login_challenge=${encodeURIComponent(loginChallenge)}`,
      )
      .then((res) => {
        setChallengeValid(res.valid);
      })
      .catch(() => {
        setChallengeValid(false);
      });
  }, [loginChallenge]);

  const onSubmit = handleSubmit(async (data) => {
    setServerError(null);
    setUnverified(null);
    setResendState("idle");
    try {
      const res = await api.post<{ redirectUrl?: string }>("/api/login", {
        ...data,
        login_challenge: loginChallenge,
      });
      if (res.redirectUrl) redirectTo(res.redirectUrl);
    } catch (err) {
      if (err instanceof ApiError && err.code === "email_not_verified") {
        const unverifiedEmail =
          typeof err.body.email === "string" ? err.body.email : getValues("email");
        setUnverified({ email: unverifiedEmail });
      } else {
        setServerError(err instanceof ApiError ? err.message : "ログインに失敗しました");
      }
    }
  });

  async function handleResend() {
    if (!unverified) return;
    setResendState("sending");
    try {
      await api.post<{ ok: boolean }>("/api/resend-verification", { email: unverified.email });
      setResendState("sent");
    } catch (err) {
      if (err instanceof ApiError && err.status === 429) {
        setResendState("rate_limited");
      } else {
        setResendState("idle");
      }
    }
  }

  const registerHref = loginChallenge
    ? `/register?login_challenge=${encodeURIComponent(loginChallenge)}`
    : "/register";

  if (challengeValid === false) {
    return (
      <AuthLayout title="ログインを開始できません" subtitle="アプリからやり直してください">
        <div className="mb-4">
          <Alert kind="info">アプリに戻って、もう一度ログインを開始してください。</Alert>
        </div>
        <p className="mt-4 text-center text-sm">
          <Link to="/forgot-password" className="text-zinc-500 hover:text-zinc-300">
            パスワードを再設定する
          </Link>
        </p>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title="ログイン">
      {serverError && (
        <div className="mb-4">
          <Alert kind="error">{serverError}</Alert>
        </div>
      )}
      {unverified && (
        <div className="mb-4 space-y-3">
          <Alert kind="warning">
            <strong>{unverified.email}</strong>{" "}
            はまだ確認されていません。メールのリンクをクリックしてください。
          </Alert>
          {resendState === "sent" ? (
            <Alert kind="success">確認メールを再送しました。</Alert>
          ) : resendState === "rate_limited" ? (
            <Alert kind="warning">しばらく経ってからお試しください。</Alert>
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
        </div>
      )}
      <form onSubmit={onSubmit} noValidate>
        <Field label="メールアドレス" error={errors.email?.message}>
          <Input {...register("email")} type="email" autoComplete="email" />
        </Field>
        <Field label="パスワード" error={errors.password?.message}>
          <PasswordInput {...register("password")} autoComplete="current-password" />
        </Field>
        <div className="mt-6">
          <Button type="submit" full disabled={isSubmitting || !challengeValid}>
            {isSubmitting ? "確認中..." : "ログイン"}
          </Button>
        </div>
      </form>
      <p className="mt-4 text-center text-sm">
        <Link to={registerHref} className="text-indigo-400 hover:text-indigo-300">
          新規登録
        </Link>
      </p>
      <p className="mt-2 text-center text-sm">
        <Link to="/forgot-password" className="text-zinc-500 hover:text-zinc-300">
          パスワードを忘れた方
        </Link>
      </p>
    </AuthLayout>
  );
}
