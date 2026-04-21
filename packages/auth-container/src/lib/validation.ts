import { z } from "zod";
import type { AppContext } from "../types";
import { ADMIN_ROLES } from "./admin-constants";

/**
 * メールアドレスの共通バリデーション。
 * RFC 5321 のローカル+ドメイン最大長 254 を上限とする。
 * `auth-frontend/src/lib/schemas.ts` 側のヘルパーとメッセージを揃えること。
 */
export const emailField = z
  .email({ error: "有効なメールアドレスを入力してください" })
  .max(254, "メールアドレスが長すぎます");

/** パスワードの共通バリデーション。8 文字以上 256 文字以下。 */
export const passwordField = z
  .string({ error: "パスワードを入力してください" })
  .min(8, "パスワードは 8 文字以上で入力してください")
  .max(256, "パスワードが長すぎます");

/** 表示名 (必須) の共通バリデーション。1〜200 文字、前後空白は trim。 */
export const nameField = z
  .string({ error: "名前は必須です" })
  .trim()
  .min(1, "名前は必須です")
  .max(200, "名前が長すぎます");

/** given_name / family_name など任意名フィールド。空文字 / undefined は null に正規化する。 */
export const optionalNameField = z
  .string()
  .trim()
  .max(200, "値が長すぎます")
  .optional()
  .transform((v) => (v === "" || v === undefined ? null : v));

/** admin role フィールド (`super` | `admin`)。 */
export const adminRoleField = z.enum(ADMIN_ROLES, {
  error: "role の値が不正です",
});

/**
 * Zod バリデーション失敗時の共通 400 レスポンスを生成する。
 * `issues[].path` はドット連結文字列で返す。
 */
export function zodBadRequest(c: AppContext, error: z.ZodError): Response {
  return c.json(
    {
      error: "invalid_request",
      error_description: "入力値が不正です",
      issues: error.issues.map((i) => ({
        path: i.path.map(String).join("."),
        message: i.message,
      })),
    },
    400,
  );
}
