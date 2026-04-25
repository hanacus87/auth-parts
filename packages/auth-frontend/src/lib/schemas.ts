import { z } from "zod";
import { TOKEN_ENDPOINT_AUTH_METHODS } from "./oidc-constants";

/**
 * メールアドレスの共通バリデーション。
 * 同期: auth-container/src/lib/validation.ts の emailField とルールを揃えること。
 */
export const emailField = z
  .email({ error: "有効なメールアドレスを入力してください" })
  .max(254, "メールアドレスが長すぎます");

/**
 * パスワードの共通バリデーション (8〜256 文字)。
 * 同期: auth-container/src/lib/validation.ts の passwordField。
 */
export const passwordField = z
  .string({ error: "パスワードを入力してください" })
  .min(8, "パスワードは 8 文字以上で入力してください")
  .max(256, "パスワードが長すぎます");

/**
 * 表示名 (必須, 1〜200 文字, 前後 trim)。
 * 同期: auth-container/src/lib/validation.ts の nameField。
 */
export const nameField = z
  .string({ error: "名前は必須です" })
  .trim()
  .min(1, "名前は必須です")
  .max(200, "名前が長すぎます");

const optionalShortText = z.string().trim().max(200, "値が長すぎます").optional();

/**
 * HTTP(S) スキームを持つブラウザ遷移可能な URL か判定する。
 * javascript: / data: / file: 等の悪性スキームを明示的に弾く。
 * サーバ側 (auth-container) で最終的な SSRF 対策は別途行う。
 */
function isValidUrl(v: string): boolean {
  try {
    const u = new URL(v);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

/** 前後空白を trim した結果が空文字、もしくは JS URL として解釈可能な文字列のみ許容するスキーマ。 */
const urlOrEmpty = z
  .string({ error: "文字列を入力してください" })
  .transform((v) => v.trim())
  .refine((v) => v === "" || isValidUrl(v), {
    message: "有効な URL を入力してください",
  });

/**
 * react-hook-form の useFieldArray は配列要素がオブジェクトである必要があるため、
 * URL 配列は `{ value: string }` の形で保持する。
 */
const urlItem = z.object({ value: urlOrEmpty });

/**
 * クライアント登録/編集フォームのスキーマ。
 * `redirect_uris` は「少なくとも 1 行は非空 URL」を要求し、空行自体は `urlOrEmpty` で許容する。
 * 公開クライアント (`token_endpoint_auth_method=none`) のときだけ `allowed_cors_origins` の最低 1 件を
 * superRefine で要求する (OAuth 2.0 BCP for Browser-Based Apps §6.2 に従い、SPA からの fetch には
 * Origin 登録が必須)。confidential client は server-to-server で CORS 不要のため空のままで OK。
 */
export const clientFormSchema = z
  .object({
    name: z.string({ error: "クライアント名は必須です" }).trim().min(1, "クライアント名は必須です"),

    redirect_uris: z.array(urlItem).refine((arr) => arr.some((r) => r.value !== ""), {
      message: "コールバック URL を 1 つ以上入力してください",
    }),

    token_endpoint_auth_method: z.enum(TOKEN_ENDPOINT_AUTH_METHODS, {
      error: "token_endpoint_auth_method の値が不正です",
    }),

    backchannel_logout_uri: urlOrEmpty,

    post_logout_redirect_uris: z.array(urlItem),

    allowed_cors_origins: z.array(urlItem),
  })
  .superRefine((data, ctx) => {
    if (
      data.token_endpoint_auth_method === "none" &&
      !data.allowed_cors_origins.some((o) => o.value !== "")
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["allowed_cors_origins"],
        message: "公開クライアントでは Web Origin を 1 つ以上指定してください",
      });
    }
  });

export type ClientFormInput = z.infer<typeof clientFormSchema>;

/** 新規ユーザー登録フォームのスキーマ。password と password_confirm の一致を `refine` で検証する。 */
export const registerFormSchema = z
  .object({
    email: emailField,
    password: passwordField,
    password_confirm: z.string({ error: "確認用パスワードを入力してください" }),
    name: nameField,
    given_name: optionalShortText,
    family_name: optionalShortText,
  })
  .refine((d) => d.password === d.password_confirm, {
    message: "パスワードと確認用が一致しません",
    path: ["password_confirm"],
  });

export type RegisterFormInput = z.infer<typeof registerFormSchema>;

/** ログインフォームのスキーマ (一般ユーザー / 管理者で共用)。 */
export const loginFormSchema = z.object({
  email: emailField,
  password: passwordField,
});

export type LoginFormInput = z.infer<typeof loginFormSchema>;

export const adminLoginFormSchema = loginFormSchema;
export type AdminLoginFormInput = LoginFormInput;

/** メール確認リンクの再送フォームスキーマ。 */
export const resendVerificationSchema = z.object({
  email: emailField,
});

export type ResendVerificationInput = z.infer<typeof resendVerificationSchema>;

/**
 * 管理者ロール (`super` | `admin`)。
 * 同期: auth-container/src/lib/admin-constants.ts の ADMIN_ROLES と常にミラー。
 */
export const ADMIN_ROLES = ["super", "admin"] as const;
export type AdminRole = (typeof ADMIN_ROLES)[number];

/** 管理者招待フォームのスキーマ (SuperAdmin 専用)。 */
export const inviteAdminSchema = z.object({
  email: emailField,
  name: nameField,
  role: z.enum(ADMIN_ROLES, { error: "role の値が不正です" }),
});

export type InviteAdminInput = z.infer<typeof inviteAdminSchema>;

/** 管理者情報編集フォームのスキーマ (SuperAdmin 専用、name と role のみ)。 */
export const editAdminSchema = z.object({
  name: nameField,
  role: z.enum(ADMIN_ROLES, { error: "role の値が不正です" }),
});

export type EditAdminInput = z.infer<typeof editAdminSchema>;

/** パスワードリセットリンク送信フォームのスキーマ (users / admins 共用)。 */
export const forgotPasswordSchema = z.object({
  email: emailField,
});

export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;

/**
 * パスワード再設定フォームのスキーマ。
 * token は URL param から抽出して送信時に含めるため form 側には含めない。
 */
export const resetPasswordSchema = z
  .object({
    password: passwordField,
    password_confirm: z.string({ error: "確認用パスワードを入力してください" }),
  })
  .refine((d) => d.password === d.password_confirm, {
    message: "パスワードと確認用が一致しません",
    path: ["password_confirm"],
  });

export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
