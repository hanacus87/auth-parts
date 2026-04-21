/**
 * admin のロール。
 * `super` は全権限 (users / admins / 全 clients)、`admin` は自分が作成した clients のみ管理可能。
 * フロントエンド側でミラーが必要な場合は同値を重複定義すること。
 */
export const ADMIN_ROLES = ["super", "admin"] as const;
export type AdminRole = (typeof ADMIN_ROLES)[number];
