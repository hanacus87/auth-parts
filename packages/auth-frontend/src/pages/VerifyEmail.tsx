import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useSearchParams } from "react-router-dom";
import { AuthLayout } from "../components/Layout";
import { Field, Input } from "../components/Input";
import { Button } from "../components/Button";
import { Alert } from "../components/Alert";
import { api, ApiError } from "../lib/api";
import { resendVerificationSchema, type ResendVerificationInput } from "../lib/schemas";

type Status = "verifying" | "ok" | "invalid" | "expired" | "already";

/**
 * メール確認リンクの着地ページ。`?token=` を `/api/verify-email` に送り、
 * 結果に応じて成功 / 既確認 / 無効 / 期限切れ のビューを出し分ける。
 * 無効/期限切れ時は同画面から再送リクエストを受け付ける (5 分 1 回)。
 */
export function VerifyEmailPage() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token") ?? "";

  const [status, setStatus] = useState<Status>("verifying");
  const [verifiedEmail, setVerifiedEmail] = useState<string | null>(null);
  const [resendState, setResendState] = useState<"idle" | "sending" | "sent" | "rate_limited">(
    "idle",
  );
  const [resendError, setResendError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<ResendVerificationInput>({
    resolver: zodResolver(resendVerificationSchema),
    mode: "onBlur",
    reValidateMode: "onChange",
    defaultValues: { email: "" },
  });

  useEffect(() => {
    if (!token) {
      setStatus("invalid");
      return;
    }
    api
      .post<{ ok?: boolean; email?: string; alreadyVerified?: boolean }>("/api/verify-email", {
        token,
      })
      .then((res) => {
        if (res.ok) {
          setVerifiedEmail(res.email ?? null);
          setStatus(res.alreadyVerified ? "already" : "ok");
        } else {
          setStatus("invalid");
        }
      })
      .catch((err) => {
        if (err instanceof ApiError && err.code === "expired") setStatus("expired");
        else setStatus("invalid");
      });
  }, [token]);

  const onResend = handleSubmit(async (data) => {
    setResendError(null);
    setResendState("sending");
    try {
      await api.post<{ ok: boolean }>("/api/resend-verification", { email: data.email });
      setResendState("sent");
    } catch (err) {
      if (err instanceof ApiError && err.status === 429) {
        setResendState("rate_limited");
      } else {
        setResendState("idle");
        setResendError(err instanceof ApiError ? err.message : "送信に失敗しました");
      }
    }
  });

  if (status === "verifying") {
    return (
      <AuthLayout title="確認中..." subtitle="しばらくお待ちください">
        <p className="text-sm text-zinc-400">メールアドレスを確認しています。</p>
      </AuthLayout>
    );
  }

  if (status === "ok" || status === "already") {
    return (
      <AuthLayout
        title="メールアドレスを確認しました"
        subtitle={status === "already" ? "確認済みです" : "ご登録ありがとうございます"}
      >
        <div className="mb-4">
          <Alert kind="success">
            {verifiedEmail ? (
              <>
                <strong>{verifiedEmail}</strong> を確認しました。
              </>
            ) : (
              "確認しました。"
            )}
          </Alert>
        </div>
        <p className="text-sm text-zinc-400">アプリに戻ってログインを開始してください。</p>
      </AuthLayout>
    );
  }

  const heading = status === "expired" ? "リンクの有効期限が切れています" : "リンクが無効です";
  const description =
    status === "expired"
      ? "下のフォームから再送できます。"
      : "リンクが正しくないか、既に使用されています。";

  return (
    <AuthLayout title="メールアドレスの確認" subtitle={heading}>
      <div className="mb-4">
        <Alert kind={status === "expired" ? "warning" : "error"}>{description}</Alert>
      </div>

      {resendState === "sent" ? (
        <Alert kind="success">再送しました。受信箱をご確認ください。</Alert>
      ) : resendState === "rate_limited" ? (
        <Alert kind="warning">しばらく経ってからお試しください。</Alert>
      ) : (
        <form onSubmit={onResend} noValidate>
          {resendError && (
            <div className="mb-4">
              <Alert kind="error">{resendError}</Alert>
            </div>
          )}
          <Field label="メールアドレス" error={errors.email?.message}>
            <Input {...register("email")} type="email" autoComplete="email" />
          </Field>
          <Button type="submit" full disabled={resendState === "sending"}>
            {resendState === "sending" ? "送信中..." : "確認メールを再送"}
          </Button>
        </form>
      )}
    </AuthLayout>
  );
}
