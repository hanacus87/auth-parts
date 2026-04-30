import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { logout } from "../lib/oidc";
import { fetchMe } from "../lib/api";

export function Dashboard() {
  const navigate = useNavigate();
  const [userInfo, setUserInfo] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchMe()
      .then(setUserInfo)
      .catch(() => {
        setError("Session expired. Please login again.");
      })
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return <div>Loading...</div>;
  }

  if (error) {
    return (
      <div
        style={{ fontFamily: "sans-serif", maxWidth: 500, margin: "80px auto", padding: "0 16px" }}
      >
        <h1 style={{ fontSize: "1.5rem", color: "#dc2626" }}>Error</h1>
        <p>{error}</p>
        <button onClick={() => navigate("/")} style={btnStyle}>
          Back to Home
        </button>
      </div>
    );
  }

  return (
    <div
      style={{ fontFamily: "sans-serif", maxWidth: 500, margin: "80px auto", padding: "0 16px" }}
    >
      <h1 style={{ fontSize: "1.5rem", marginBottom: 16 }}>Dashboard</h1>
      <p style={{ color: "#555", marginBottom: 16 }}>
        OIDC login successful. User info fetched from App Server:
      </p>
      <pre
        style={{
          background: "#f3f4f6",
          padding: 16,
          borderRadius: 4,
          overflow: "auto",
          fontSize: "0.85rem",
          marginBottom: 24,
        }}
      >
        {JSON.stringify(userInfo, null, 2)}
      </pre>
      <button onClick={() => logout()} style={btnStyle}>
        Logout
      </button>
    </div>
  );
}

const btnStyle: React.CSSProperties = {
  width: "100%",
  padding: 10,
  background: "#dc2626",
  color: "white",
  border: "none",
  borderRadius: 4,
  cursor: "pointer",
  fontSize: "1rem",
};
