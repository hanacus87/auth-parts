import { Link } from "react-router-dom";

export function NotFound() {
  return (
    <div
      style={{ fontFamily: "sans-serif", maxWidth: 400, margin: "80px auto", padding: "0 16px" }}
    >
      <h1 style={{ fontSize: "1.5rem", marginBottom: 8 }}>404 Not Found</h1>
      <p style={{ color: "#555", marginBottom: 24 }}>お探しのページは見つかりませんでした。</p>
      <Link to="/" style={{ color: "#059669" }}>
        ホームに戻る
      </Link>
    </div>
  );
}
