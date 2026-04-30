import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

/**
 * BFF パターン: 通常のコールバック処理は demo-bff が行うため、このページはエラー時のみ
 * demo-bff からリダイレクトされる。`error` クエリがあればメッセージとして表示し、
 * URL からエラーパラメータを除去する。エラーパラメータ無しで直接アクセスされた場合はホームへ戻す。
 */
export function Callback() {
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const err = params.get("error");
    if (err) {
      const desc = params.get("error_description") ?? err;
      setError(desc);
      window.history.replaceState({}, "", window.location.pathname);
    } else {
      navigate("/");
    }
  }, [navigate]);

  if (error) {
    return (
      <div
        style={{ fontFamily: "sans-serif", maxWidth: 400, margin: "80px auto", padding: "0 16px" }}
      >
        <h1 style={{ fontSize: "1.5rem", color: "#dc2626" }}>Error</h1>
        <p>{error}</p>
        <a href="/">Back to Home</a>
      </div>
    );
  }

  return <div>Processing login...</div>;
}
