import { useAuth } from "./hooks";

/**
 * /callback ルート用の最小コンポーネント。code の検証・交換は Provider が処理するので、
 * ここでは Provider が次のフレームで URL を returnTo に書き換えるまでの繋ぎ表示のみを担当する。
 *
 * カスタム表示が欲しい場合は useAuth() の isLoading / error を直接見て独自実装してよい。
 */
export function Callback(): JSX.Element {
  const { isLoading, error } = useAuth();
  if (error) {
    return (
      <div role="alert">
        <p>error: {error.kind}</p>
      </div>
    );
  }
  if (isLoading) {
    return <div>Loading...</div>;
  }
  return <div />;
}
