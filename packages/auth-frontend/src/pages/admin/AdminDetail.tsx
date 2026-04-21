import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Trash2 } from "lucide-react";
import { useAdminSession } from "../../components/AdminLayout";
import { Field, Input, Select } from "../../components/Input";
import { Button } from "../../components/Button";
import { Alert } from "../../components/Alert";
import { Tooltip } from "../../components/Tooltip";
import { VerifiedBadge } from "../../components/VerifiedBadge";
import { DeleteConfirmPanel } from "../../components/DeleteConfirmPanel";
import { api, ApiError } from "../../lib/api";
import {
  ADMIN_ROLES,
  editAdminSchema,
  type AdminRole,
  type EditAdminInput,
} from "../../lib/schemas";

interface AdminRow {
  id: string;
  email: string;
  name: string;
  role: AdminRole;
  emailVerified: boolean;
  createdAt: string;
  updatedAt: string;
}

/**
 * 管理者詳細・編集ページ (SuperAdmin 専用)。
 * name / role の編集と削除が可能。自分自身の role 変更と削除は UI 上で disabled にする。
 * email / password は本画面では変更できない (パスワードは /admin/forgot-password 経由)。
 */
export function AdminDetail() {
  const { admin: me, csrfToken } = useAdminSession();
  const navigate = useNavigate();
  const params = useParams();
  const id = params.id ?? "";

  const [target, setTarget] = useState<AdminRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [serverError, setServerError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const {
    register,
    handleSubmit,
    reset,
    watch,
    formState: { errors, isSubmitting, isDirty },
  } = useForm<EditAdminInput>({
    resolver: zodResolver(editAdminSchema),
    mode: "onBlur",
    reValidateMode: "onChange",
    defaultValues: { name: "", role: "admin" },
  });

  const isSelf = target?.id === me.id;

  useEffect(() => {
    api
      .get<{ admin: AdminRow }>(`/api/admin/admins/${encodeURIComponent(id)}`)
      .then((res) => {
        setTarget(res.admin);
        reset({ name: res.admin.name, role: res.admin.role });
      })
      .catch((err) => setServerError(err instanceof ApiError ? err.message : "読み込みに失敗"))
      .finally(() => setLoading(false));
  }, [id, reset]);

  const onSubmit = handleSubmit(async (data) => {
    setServerError(null);
    setSuccess(null);
    try {
      await api.post<{ ok: boolean }>(`/api/admin/admins/${encodeURIComponent(id)}`, {
        ...data,
        _csrf: csrfToken,
      });
      setSuccess("更新しました");
      setTarget((prev) => (prev ? { ...prev, name: data.name, role: data.role } : prev));
      reset({ name: data.name, role: data.role });
    } catch (err) {
      setServerError(err instanceof ApiError ? err.message : "更新に失敗しました");
    }
  });

  async function confirmDelete() {
    if (!target || isSelf) return;
    setDeleting(true);
    setServerError(null);
    try {
      await api.post<{ ok: boolean }>(`/api/admin/admins/${encodeURIComponent(id)}/delete`, {
        _csrf: csrfToken,
      });
      navigate("/admin/admins");
    } catch (err) {
      setServerError(err instanceof ApiError ? err.message : "削除に失敗");
      setDeleting(false);
      setShowDeleteConfirm(false);
    }
  }

  if (loading) return <div className="text-sm text-zinc-500">読み込み中...</div>;
  if (!target) {
    return (
      <div className="max-w-2xl">
        {serverError && (
          <div className="mb-4">
            <Alert kind="error">{serverError}</Alert>
          </div>
        )}
        <Link
          to="/admin/admins"
          className="inline-flex items-center gap-1 text-sm text-indigo-400 hover:text-indigo-300"
        >
          <ArrowLeft className="h-4 w-4" strokeWidth={2} />
          管理者一覧に戻る
        </Link>
      </div>
    );
  }

  const watchedRole = watch("role");
  const roleChangedForSelf = isSelf && watchedRole !== target.role;

  return (
    <div className="max-w-2xl">
      <Link
        to="/admin/admins"
        className="inline-flex items-center gap-1 text-sm text-zinc-400 hover:text-zinc-200"
      >
        <ArrowLeft className="h-4 w-4" strokeWidth={2} />
        管理者一覧に戻る
      </Link>

      <h1 className="mt-4 text-2xl font-semibold tracking-tight text-zinc-50">管理者詳細</h1>
      <p className="mt-1 text-sm text-zinc-400">
        name / role の編集のみ可能。email / password は変更不可。
        {isSelf && <span className="ml-1 text-indigo-400">(自分自身を編集中)</span>}
      </p>

      {serverError && (
        <div className="mt-4">
          <Alert kind="error">{serverError}</Alert>
        </div>
      )}
      {success && (
        <div className="mt-4">
          <Alert kind="success">{success}</Alert>
        </div>
      )}

      <dl className="mt-6 space-y-4 rounded-lg border border-zinc-800/80 bg-zinc-900/30 p-5">
        <InfoRow label="メールアドレス">
          <div className="flex items-center gap-2">
            <span className="text-sm text-zinc-100">{target.email}</span>
            <VerifiedBadge verified={target.emailVerified} />
          </div>
        </InfoRow>
        <InfoRow label="id">
          <code className="font-mono text-xs text-zinc-400">{target.id}</code>
        </InfoRow>
        <InfoRow label="作成日時">
          <span className="font-mono text-xs text-zinc-400">
            {new Date(target.createdAt).toISOString().slice(0, 16).replace("T", " ")}
          </span>
        </InfoRow>
        <InfoRow label="更新日時">
          <span className="font-mono text-xs text-zinc-400">
            {new Date(target.updatedAt).toISOString().slice(0, 16).replace("T", " ")}
          </span>
        </InfoRow>
      </dl>

      <form onSubmit={onSubmit} className="mt-8 space-y-4" noValidate>
        <Field label="表示名" error={errors.name?.message}>
          <Input {...register("name")} type="text" autoComplete="off" />
        </Field>
        <Field
          label="Role"
          hint={isSelf ? "(自分自身の role は変更できません)" : undefined}
          error={
            errors.role?.message ||
            (roleChangedForSelf ? "自分自身の role は変更できません" : undefined)
          }
        >
          <Select {...register("role")} disabled={isSelf}>
            {ADMIN_ROLES.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </Select>
        </Field>
        <div className="flex gap-2">
          <Button type="submit" disabled={isSubmitting || !isDirty || roleChangedForSelf}>
            {isSubmitting ? "保存中..." : "保存"}
          </Button>
        </div>
      </form>

      <div className="mt-10 rounded-lg border border-red-900/50 bg-red-950/10 p-4">
        <h2 className="text-sm font-semibold text-red-200">管理者を削除</h2>
        <p className="mt-1 text-xs text-zinc-400">
          管理者アカウントを削除します。該当 admin の adminSessions / adminPasswordResetTokens
          も同時に削除され、進行中のセッションは即時無効化されます。
          この管理者が所有するクライアント (created_by_admin_id) の扱いは DB 上 NULL に変わり、
          SuperAdmin のみが管理できる状態になります。
        </p>

        <div className="mt-3">
          {isSelf ? (
            <Tooltip label="自分自身は削除できません">
              <span>
                <Button
                  variant="danger"
                  disabled
                  leftIcon={<Trash2 className="h-3.5 w-3.5" strokeWidth={2} />}
                >
                  この管理者を削除
                </Button>
              </span>
            </Tooltip>
          ) : (
            <Button
              variant="danger"
              onClick={() => setShowDeleteConfirm(true)}
              disabled={deleting || showDeleteConfirm}
              leftIcon={<Trash2 className="h-3.5 w-3.5" strokeWidth={2} />}
            >
              この管理者を削除
            </Button>
          )}
        </div>

        {showDeleteConfirm && !isSelf && (
          <div className="mt-4">
            <DeleteConfirmPanel
              message={
                <>
                  <code className="font-mono text-red-200">{target.email}</code>{" "}
                  を削除します。関連する adminSessions /
                  招待トークンも同時に削除され、この管理者が所有していたクライアントは SuperAdmin
                  専有扱いになります。
                </>
              }
              confirmLabel="削除する"
              onConfirm={confirmDelete}
              onCancel={() => setShowDeleteConfirm(false)}
              pending={deleting}
            />
          </div>
        )}
      </div>
    </div>
  );
}

/** 左ラベル + 右値 の 2 カラム表示行 (dl の中で dt/dd 対で使う)。 */
function InfoRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start">
      <dt className="w-36 shrink-0 text-xs font-medium uppercase tracking-wide text-zinc-500">
        {label}
      </dt>
      <dd className="flex-1">{children}</dd>
    </div>
  );
}
