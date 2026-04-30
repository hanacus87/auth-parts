import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Check, Copy } from "lucide-react";
import { useAdminSession } from "../../components/AdminLayout";
import { Field, Input, Select } from "../../components/Input";
import { Button } from "../../components/Button";
import { Alert } from "../../components/Alert";
import { RepeatableInput } from "../../components/RepeatableInput";
import { api, ApiError } from "../../lib/api";
import {
  GRANT_TYPES,
  SUPPORTED_SCOPES,
  TOKEN_ENDPOINT_AUTH_METHODS,
  type TokenEndpointAuthMethod,
} from "../../lib/oidc-constants";
import { clientFormSchema, type ClientFormInput } from "../../lib/schemas";

/**
 * 認証方式の表示ラベル。コードベース値だけだと「none って何？」となるので機密 / 公開の区別と用途を併記する。
 * サーバ側 (computeAllowedScopesAndGrants in api/admin/clients.ts) と意味的に整合させる。
 */
const AUTH_METHOD_LABELS: Record<TokenEndpointAuthMethod, string> = {
  none: "none (公開クライアント / SPA・モバイル)",
  client_secret_basic: "client_secret_basic (機密クライアント / Authorization ヘッダ)",
  client_secret_post: "client_secret_post (機密クライアント / リクエストボディ)",
};

interface Props {
  mode: "new" | "edit";
}

interface ClientDetail {
  id: string;
  name: string;
  tokenEndpointAuthMethod: string;
  redirectUris: string[];
  allowedScopes: string[];
  allowedGrantTypes: string[];
  backchannelLogoutUri: string;
  postLogoutRedirectUris: string[];
  allowedCorsOrigins: string[];
}

/**
 * OIDC クライアントの新規作成 / 編集フォーム (mode で切替)。
 * 作成時に発行される client_secret、および auth_method 変更 / rotate-secret による新 secret は
 * `SecretDisplay` で 1 度だけ表示する。空欄の redirect_uris 行はサーバに送らずクライアントで除去する。
 *
 * `redirect_uris` のような配列ルートに付くエラー (`.refine` で生まれる「1 つ以上」など) は
 * RHF の onChange (リーフのみ再検証) では消えないため、`useWatch` で配列の変化を見て
 * ルートエラーが出ている間だけ `trigger("redirect_uris")` を明示的に呼んで掃除する。
 * `CorsOriginsField` でも同じパターンを採用している。
 */
export function ClientForm({ mode }: Props) {
  const { csrfToken } = useAdminSession();
  const navigate = useNavigate();
  const params = useParams();
  const id = params.id ?? "";

  const [loading, setLoading] = useState(mode === "edit");
  const [serverError, setServerError] = useState<string | null>(null);
  const [createdSecret, setCreatedSecret] = useState<{ id: string; secret: string | null } | null>(
    null,
  );
  const [rotatedSecret, setRotatedSecret] = useState<string | null>(null);
  const [rotating, setRotating] = useState(false);
  const [confirmingRotate, setConfirmingRotate] = useState(false);

  const {
    register,
    control,
    trigger,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<ClientFormInput>({
    resolver: zodResolver(clientFormSchema),
    mode: "onBlur",
    reValidateMode: "onChange",
    defaultValues: {
      name: "",
      redirect_uris: [{ value: "" }],
      token_endpoint_auth_method: "client_secret_basic",
      backchannel_logout_uri: "",
      post_logout_redirect_uris: [],
      allowed_cors_origins: [],
    },
  });

  const redirectUris = useWatch({ control, name: "redirect_uris" });
  const redirectUrisError = errors.redirect_uris?.root?.message ?? errors.redirect_uris?.message;
  useEffect(() => {
    if (redirectUrisError) void trigger("redirect_uris");
  }, [redirectUris, redirectUrisError, trigger]);

  useEffect(() => {
    if (mode !== "edit") return;
    api
      .get<{ client: ClientDetail }>(`/api/admin/clients/${encodeURIComponent(id)}`)
      .then((res) => {
        reset({
          name: res.client.name,
          redirect_uris: res.client.redirectUris.map((v) => ({ value: v })),
          token_endpoint_auth_method: res.client
            .tokenEndpointAuthMethod as ClientFormInput["token_endpoint_auth_method"],
          backchannel_logout_uri: res.client.backchannelLogoutUri,
          post_logout_redirect_uris: res.client.postLogoutRedirectUris.map((v) => ({ value: v })),
          allowed_cors_origins: res.client.allowedCorsOrigins.map((v) => ({ value: v })),
        });
      })
      .catch((err) => setServerError(err instanceof Error ? err.message : "読み込みに失敗しました"))
      .finally(() => setLoading(false));
  }, [id, mode, reset]);

  const onSubmit = handleSubmit(async (data) => {
    setServerError(null);
    const payload = {
      _csrf: csrfToken,
      name: data.name,
      redirect_uris: data.redirect_uris.map((r) => r.value).filter((v) => v !== ""),
      token_endpoint_auth_method: data.token_endpoint_auth_method,
      backchannel_logout_uri: data.backchannel_logout_uri,
      post_logout_redirect_uris: data.post_logout_redirect_uris
        .map((r) => r.value)
        .filter((v) => v !== ""),
      allowed_cors_origins: data.allowed_cors_origins.map((r) => r.value).filter((v) => v !== ""),
    };
    try {
      if (mode === "new") {
        const res = await api.post<{ clientId: string; clientSecret: string | null }>(
          "/api/admin/clients",
          payload,
        );
        setCreatedSecret({ id: res.clientId, secret: res.clientSecret });
      } else {
        const res = await api.post<{ ok: boolean; generatedSecret?: string | null }>(
          `/api/admin/clients/${encodeURIComponent(id)}`,
          payload,
        );
        if (res.generatedSecret) {
          setRotatedSecret(res.generatedSecret);
        } else {
          navigate("/admin/clients");
        }
      }
    } catch (err) {
      setServerError(err instanceof ApiError ? err.message : "保存に失敗しました");
    }
  });

  async function rotateSecret() {
    setRotating(true);
    setServerError(null);
    try {
      const res = await api.post<{ clientSecret: string }>(
        `/api/admin/clients/${encodeURIComponent(id)}/rotate-secret`,
        { _csrf: csrfToken },
      );
      setRotatedSecret(res.clientSecret);
    } catch (err) {
      setServerError(err instanceof ApiError ? err.message : "ローテーションに失敗しました");
    } finally {
      setRotating(false);
      setConfirmingRotate(false);
    }
  }

  if (loading) return <div className="text-sm text-zinc-500">読み込み中...</div>;

  if (createdSecret) {
    return (
      <SecretDisplay
        title="クライアントを作成しました"
        clientId={createdSecret.id}
        clientSecret={createdSecret.secret}
        onContinue={() => navigate("/admin/clients")}
      />
    );
  }
  if (rotatedSecret) {
    return (
      <SecretDisplay
        title="新しいシークレットを発行しました"
        clientId={id}
        clientSecret={rotatedSecret}
        onContinue={() => navigate("/admin/clients")}
        rotationReason="古いシークレットは使用できなくなりました。"
      />
    );
  }

  return (
    <div className="max-w-2xl">
      <h1 className="text-2xl font-semibold text-zinc-100">
        {mode === "new" ? "新規クライアント" : "クライアント編集"}
      </h1>
      {serverError && (
        <div className="mt-4">
          <Alert kind="error">{serverError}</Alert>
        </div>
      )}

      {mode === "edit" ? (
        <p className="mt-4 text-sm text-zinc-400">
          クライアント ID: <code className="font-mono text-zinc-200">{id}</code>{" "}
          <span className="text-zinc-500">(変更不可)</span>
        </p>
      ) : (
        <p className="mt-4 text-sm text-zinc-400">
          クライアント ID とシークレットは作成時に自動発行されます。
        </p>
      )}

      <form onSubmit={onSubmit} className="mt-6" noValidate>
        <Field label="クライアント名" error={errors.name?.message}>
          <Input {...register("name")} autoComplete="off" />
        </Field>

        <Field label="コールバック URL" hint="(1 つ以上)">
          <RepeatableInput
            control={control}
            name="redirect_uris"
            placeholder="https://example.com/auth/callback"
            minRows={1}
            arrayError={errors.redirect_uris?.root?.message ?? errors.redirect_uris?.message}
          />
        </Field>

        <Field label="認証方式" error={errors.token_endpoint_auth_method?.message}>
          <Select {...register("token_endpoint_auth_method")}>
            {TOKEN_ENDPOINT_AUTH_METHODS.map((m) => (
              <option key={m} value={m}>
                {AUTH_METHOD_LABELS[m]}
              </option>
            ))}
          </Select>
        </Field>

        <CorsOriginsField
          control={control}
          trigger={trigger}
          arrayError={
            errors.allowed_cors_origins?.root?.message ?? errors.allowed_cors_origins?.message
          }
        />

        <DerivedScopesAndGrants control={control} />

        <Field
          label="バックチャネルログアウト URL"
          hint="(任意)"
          error={errors.backchannel_logout_uri?.message}
        >
          <Input
            {...register("backchannel_logout_uri")}
            type="url"
            autoComplete="off"
            placeholder="https://example.com/auth/backchannel-logout"
          />
        </Field>

        <Field label="ログアウト後の遷移先 URL" hint="(任意)">
          <RepeatableInput
            control={control}
            name="post_logout_redirect_uris"
            placeholder="https://example.com/auth/post-logout"
          />
        </Field>

        <div className="mt-6 flex gap-2">
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? "保存中..." : mode === "new" ? "登録" : "更新"}
          </Button>
          <Button type="button" variant="secondary" onClick={() => navigate("/admin/clients")}>
            キャンセル
          </Button>
        </div>
      </form>

      {mode === "edit" && (
        <RotateSecretSection
          control={control}
          confirmingRotate={confirmingRotate}
          setConfirmingRotate={setConfirmingRotate}
          rotating={rotating}
          rotateSecret={rotateSecret}
        />
      )}
    </div>
  );
}

/**
 * 編集画面の「シークレット再発行」ブロック。
 * 認証方式が `none` (公開クライアント) の間は client_secret 自体が存在しないため、
 * 再発行の余地が無くサーバ側 API も 400 を返す。混乱を避けるためセクション全体を非表示にする。
 * 認証方式 dropdown を変更した瞬間に表示が切り替わるよう useWatch で現在値を監視する。
 */
function RotateSecretSection({
  control,
  confirmingRotate,
  setConfirmingRotate,
  rotating,
  rotateSecret,
}: {
  control: ReturnType<typeof useForm<ClientFormInput>>["control"];
  confirmingRotate: boolean;
  setConfirmingRotate: (v: boolean) => void;
  rotating: boolean;
  rotateSecret: () => void;
}) {
  const authMethod = useWatch({ control, name: "token_endpoint_auth_method" });
  if (authMethod === "none") return null;

  return (
    <div className="mt-10 rounded-lg border border-zinc-800 bg-zinc-900/30 p-4">
      <h2 className="text-sm font-semibold text-zinc-200">シークレットの再発行</h2>
      <p className="mt-1 text-xs text-zinc-400">
        新しいシークレットを発行します。新しい値は一度だけ表示されます。
      </p>

      {confirmingRotate ? (
        <div className="mt-3 rounded-md border border-red-900/60 bg-red-950/20 p-3">
          <p className="text-sm text-red-100/90">
            現在のシークレットを <strong>破棄</strong>{" "}
            して新しい値を発行します。古いシークレットを使用している接続アプリは接続できなくなります。
          </p>
          <div className="mt-3 flex gap-2">
            <Button variant="danger" size="sm" onClick={rotateSecret} disabled={rotating}>
              {rotating ? "発行中..." : "再生成する"}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setConfirmingRotate(false)}
              disabled={rotating}
            >
              キャンセル
            </Button>
          </div>
        </div>
      ) : (
        <div className="mt-3">
          <Button variant="danger" onClick={() => setConfirmingRotate(true)} disabled={rotating}>
            シークレットを再発行
          </Button>
        </div>
      )}
    </div>
  );
}

/**
 * 公開クライアント (token_endpoint_auth_method=none) の場合のみ表示される CORS 許可 origin 入力欄。
 * 認証方式を useWatch で監視し、none 以外では何も描画しない。none 時は最低 1 件入力を要求する
 * (バリデーションは clientFormSchema 側 superRefine + サーバ側 buildClientFormSchema で二重に効く)。
 *
 * redirect_uri とは独立にSPA から fetch する origin を明示する。
 * confidential client (BFF) では server-to-server 通信のため
 * CORS は無関係なので欄ごと出さない。
 *
 * superRefine で配列ルートに付くクロスフィールドエラーは RHF の onChange (リーフのみ再検証) では
 * 自動で消えないため、ルートエラーが出ている間だけ items / auth method の変化を契機に
 * `trigger("allowed_cors_origins")` を呼んで掃除する。
 */
function CorsOriginsField({
  control,
  trigger,
  arrayError,
}: {
  control: ReturnType<typeof useForm<ClientFormInput>>["control"];
  trigger: ReturnType<typeof useForm<ClientFormInput>>["trigger"];
  arrayError: string | undefined;
}) {
  const authMethod = useWatch({ control, name: "token_endpoint_auth_method" });
  const items = useWatch({ control, name: "allowed_cors_origins" });

  useEffect(() => {
    if (arrayError) void trigger("allowed_cors_origins");
  }, [items, authMethod, arrayError, trigger]);

  if (authMethod !== "none") return null;
  return (
    <Field
      label="許可する Web Origin (CORS)"
      hint="(必須: SPA から fetch する origin)"
      error={arrayError}
    >
      <RepeatableInput
        control={control}
        name="allowed_cors_origins"
        placeholder="https://app.example.com"
        minRows={1}
      />
    </Field>
  );
}

/** 読み取り専用のチップ列 (allowed_scopes / allowed_grant_types 表示用)。 */
function ReadOnlyChipList({ values }: { values: readonly string[] }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {values.map((v) => (
        <span
          key={v}
          className="inline-flex items-center rounded-md bg-zinc-800/60 px-2 py-1 text-xs font-mono text-zinc-300 ring-1 ring-inset ring-zinc-700/60"
        >
          {v}
        </span>
      ))}
    </div>
  );
}

/**
 * 認証方式 dropdown の現在値を react-hook-form の useWatch で監視し、許可スコープ / 認可フローを
 * 表示用に動的にフィルタする。サーバ側 (computeAllowedScopesAndGrants) と同じロジックを UI に反映し、
 * none 選択時は offline_access / refresh_token を「そもそも許可されない」として表示から除外する。
 */
function DerivedScopesAndGrants({
  control,
}: {
  control: ReturnType<typeof useForm<ClientFormInput>>["control"];
}) {
  const authMethod = useWatch({ control, name: "token_endpoint_auth_method" });
  const isPublic = authMethod === "none";
  const displayedScopes = isPublic
    ? SUPPORTED_SCOPES.filter((s) => s !== "offline_access")
    : SUPPORTED_SCOPES;
  const displayedGrantTypes = isPublic
    ? GRANT_TYPES.filter((g) => g !== "refresh_token")
    : GRANT_TYPES;

  return (
    <>
      <Field label="許可するスコープ" hint="(認証方式により自動決定)">
        <ReadOnlyChipList values={displayedScopes} />
      </Field>
      <Field label="許可する認可フロー" hint="(認証方式により自動決定)">
        <ReadOnlyChipList values={displayedGrantTypes} />
      </Field>
    </>
  );
}

/**
 * クリップボードにコピーできる値表示。
 * コピー成功後 1.5 秒間だけチェックアイコンに切り替わる。clipboard API 非対応環境では silent fail。
 */
function CopyableValue({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {}
  }
  return (
    <div>
      <div className="text-xs text-zinc-400">{label}</div>
      <div className="mt-1 flex items-stretch gap-2">
        <div className="flex-1 rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 font-mono text-xs text-zinc-100 break-all">
          {value}
        </div>
        <button
          type="button"
          onClick={copy}
          aria-label={`${label} をコピー`}
          className={[
            "inline-flex h-auto w-9 items-center justify-center rounded-md",
            "border border-zinc-800 bg-zinc-900/60 text-zinc-400",
            "hover:border-zinc-700 hover:text-zinc-200 hover:bg-zinc-800/60",
            "transition-colors",
          ].join(" ")}
        >
          {copied ? (
            <Check className="h-4 w-4 text-emerald-400" strokeWidth={2} />
          ) : (
            <Copy className="h-4 w-4" strokeWidth={2} />
          )}
        </button>
      </div>
    </div>
  );
}

/**
 * 新規作成 or rotate 直後にだけ表示する client_id / client_secret 表示ビュー。
 * secret は 1 度きりの表示であり、ページ離脱後は二度と取得できない旨を明示する。
 */
function SecretDisplay(props: {
  title: string;
  clientId: string;
  clientSecret: string | null;
  onContinue: () => void;
  rotationReason?: string;
}) {
  return (
    <div className="max-w-2xl">
      <h1 className="text-2xl font-semibold text-zinc-100">{props.title}</h1>
      {props.rotationReason && <p className="mt-2 text-sm text-zinc-400">{props.rotationReason}</p>}
      <div className="mt-6 space-y-4">
        <CopyableValue label="クライアント ID" value={props.clientId} />
        {props.clientSecret ? (
          <>
            <CopyableValue label="クライアントシークレット" value={props.clientSecret} />
            <Alert kind="warning">
              このシークレットは二度と表示されません。パスワード管理ツール等に保存してください。
            </Alert>
          </>
        ) : (
          <p className="text-sm text-zinc-500">このクライアントはシークレット不要です。</p>
        )}
      </div>
      <div className="mt-6 flex gap-2">
        <Button onClick={props.onContinue}>クライアント一覧に戻る</Button>
      </div>
    </div>
  );
}
