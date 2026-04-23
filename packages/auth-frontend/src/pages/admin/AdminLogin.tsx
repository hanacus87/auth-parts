import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Link } from "react-router-dom";
import { AuthLayout } from "../../components/Layout";
import { Field, Input, PasswordInput } from "../../components/Input";
import { Button } from "../../components/Button";
import { Alert } from "../../components/Alert";
import { api, ApiError, redirectTo } from "../../lib/api";
import { adminLoginFormSchema, type AdminLoginFormInput } from "../../lib/schemas";

/** 管理画面ログインページ。成功時は `/admin` にリダイレクトする。 */
export function AdminLoginPage() {
  const [serverError, setServerError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<AdminLoginFormInput>({
    resolver: zodResolver(adminLoginFormSchema),
    mode: "onBlur",
    reValidateMode: "onChange",
    defaultValues: { email: "", password: "" },
  });

  const onSubmit = handleSubmit(async (data) => {
    setServerError(null);
    try {
      const res = await api.post<{ redirectUrl: string }>("/api/admin/login", data);
      redirectTo(res.redirectUrl);
    } catch (err) {
      setServerError(err instanceof ApiError ? err.message : "ログインに失敗しました");
    }
  });

  return (
    <AuthLayout title="管理者ログイン">
      {serverError && (
        <div className="mb-4">
          <Alert kind="error">{serverError}</Alert>
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
          <Button type="submit" full disabled={isSubmitting}>
            {isSubmitting ? "確認中..." : "ログイン"}
          </Button>
        </div>
      </form>
      <p className="mt-4 text-center text-sm">
        <Link to="/admin/forgot-password" className="text-zinc-500 hover:text-zinc-300">
          パスワードを忘れた方
        </Link>
      </p>
    </AuthLayout>
  );
}
