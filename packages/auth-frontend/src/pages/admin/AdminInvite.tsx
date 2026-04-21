import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Link, useNavigate } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { useAdminSession } from "../../components/AdminLayout";
import { Field, Input, Select } from "../../components/Input";
import { Button } from "../../components/Button";
import { Alert } from "../../components/Alert";
import { api, ApiError } from "../../lib/api";
import { ADMIN_ROLES, inviteAdminSchema, type InviteAdminInput } from "../../lib/schemas";

/**
 * 管理者招待ページ (SuperAdmin 専用)。
 * email / name / role を入力して `/api/admin/admins` に POST すると、受信者宛に初期パスワード
 * 設定リンク (TTL 15 分) が送信される。送信後は「招待メール送信済み」ビューに切り替わる。
 */
export function AdminInvite() {
  const { csrfToken } = useAdminSession();
  const navigate = useNavigate();

  const [serverError, setServerError] = useState<string | null>(null);
  const [sent, setSent] = useState<{ email: string } | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<InviteAdminInput>({
    resolver: zodResolver(inviteAdminSchema),
    mode: "onBlur",
    reValidateMode: "onChange",
    defaultValues: { email: "", name: "", role: "admin" },
  });

  const onSubmit = handleSubmit(async (data) => {
    setServerError(null);
    try {
      await api.post<{ ok: boolean; adminId: string }>("/api/admin/admins", {
        ...data,
        _csrf: csrfToken,
      });
      setSent({ email: data.email });
    } catch (err) {
      setServerError(err instanceof ApiError ? err.message : "招待に失敗しました");
    }
  });

  if (sent) {
    return (
      <div className="max-w-2xl">
        <Link
          to="/admin/admins"
          className="inline-flex items-center gap-1 text-sm text-zinc-400 hover:text-zinc-200"
        >
          <ArrowLeft className="h-4 w-4" strokeWidth={2} />
          管理者一覧に戻る
        </Link>
        <h1 className="mt-4 text-2xl font-semibold text-zinc-100">招待メールを送信しました</h1>
        <div className="mt-4">
          <Alert kind="success">
            <strong>{sent.email}</strong>{" "}
            宛に招待メールを送信しました。受信者がリンクから初期パスワードを設定するとログイン可能になります。
          </Alert>
        </div>
        <p className="mt-4 text-xs text-zinc-400">
          リンクの有効期限は 15 分です。期限切れの場合は `/admin/forgot-password` から再送できます。
        </p>
        <div className="mt-6 flex gap-2">
          <Button onClick={() => navigate("/admin/admins")}>一覧に戻る</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-xl">
      <Link
        to="/admin/admins"
        className="inline-flex items-center gap-1 text-sm text-zinc-400 hover:text-zinc-200"
      >
        <ArrowLeft className="h-4 w-4" strokeWidth={2} />
        管理者一覧に戻る
      </Link>

      <h1 className="mt-4 text-2xl font-semibold text-zinc-100">管理者を招待</h1>
      <p className="mt-1 text-sm text-zinc-400">
        メールアドレス宛に初期パスワード設定リンクが送信されます。
      </p>

      {serverError && (
        <div className="mt-4">
          <Alert kind="error">{serverError}</Alert>
        </div>
      )}

      <form onSubmit={onSubmit} className="mt-6" noValidate>
        <Field label="メールアドレス" error={errors.email?.message}>
          <Input {...register("email")} type="email" autoComplete="off" />
        </Field>
        <Field label="表示名" error={errors.name?.message}>
          <Input {...register("name")} type="text" autoComplete="off" />
        </Field>
        <Field
          label="Role"
          error={errors.role?.message}
          hint="(super = 全権限 / admin = 自分が作成した clients のみ)"
        >
          <Select {...register("role")}>
            {ADMIN_ROLES.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </Select>
        </Field>
        <div className="mt-6 flex gap-2">
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? "送信中..." : "招待メールを送信"}
          </Button>
          <Button type="button" variant="secondary" onClick={() => navigate("/admin/admins")}>
            キャンセル
          </Button>
        </div>
      </form>
    </div>
  );
}
