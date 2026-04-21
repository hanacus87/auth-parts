import { AuthLayout } from "../components/Layout";

/** 404 ページ。マッチしないルートは全てここにフォールバックする。 */
export function NotFound() {
  return (
    <AuthLayout title="404">
      <p className="text-sm text-zinc-400">ページが見つかりませんでした。</p>
    </AuthLayout>
  );
}
