const SCOPE_LABELS: Record<string, string> = {
  openid: "識別情報",
  profile: "プロフィール",
  email: "メールアドレス",
  offline_access: "オフラインアクセス",
};

/** OIDC スコープ文字列をユーザー向け表示ラベルに変換する (未定義スコープはそのまま返す)。 */
export function labelForScope(scope: string): string {
  return SCOPE_LABELS[scope] ?? scope;
}
