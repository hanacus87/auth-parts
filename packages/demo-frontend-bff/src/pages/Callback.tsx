import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

// BFF パターン: コールバックは demo-bff が処理する。
// このページはエラー時のみ demo-bff からリダイレクトされる。
export function Callback() {
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const err = params.get("error");
    if (err) {
      const desc = params.get("error_description") ?? err;
      setError(desc);
      // URL からエラーパラメータを除去
      window.history.replaceState({}, "", window.location.pathname);
    } else {
      // エラーパラメータなしで直接アクセスされた場合はホームへ
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

  return (
    <div
      style={{ fontFamily: "sans-serif", maxWidth: 400, margin: "80px auto", padding: "0 16px" }}
    >
      <p>Processing login...</p>
    </div>
  );
}
