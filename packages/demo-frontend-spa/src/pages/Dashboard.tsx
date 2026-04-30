import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth, fetchUserInfo, type UserInfoResult } from "@auth-parts/auth-container-react";

export function Dashboard() {
  const { user, isAuthenticated, isLoading, logout, accessToken } = useAuth();
  const navigate = useNavigate();
  const [userInfo, setUserInfo] = useState<UserInfoResult | null>(null);

  useEffect(() => {
    if (!isLoading && !isAuthenticated) navigate("/");
  }, [isAuthenticated, isLoading, navigate]);

  useEffect(() => {
    if (!accessToken || !user) return;
    let cancelled = false;
    void fetchUserInfo(accessToken, user.sub).then((res) => {
      if (!cancelled) setUserInfo(res);
    });
    return () => {
      cancelled = true;
    };
  }, [accessToken, user]);

  if (isLoading || !user) {
    return <div>Loading...</div>;
  }

  return (
    <div
      style={{ fontFamily: "sans-serif", maxWidth: 500, margin: "80px auto", padding: "0 16px" }}
    >
      <h1 style={{ fontSize: "1.5rem", marginBottom: 16 }}>Dashboard — Sub (SPA Direct)</h1>
      <p style={{ color: "#555", marginBottom: 16 }}>
        ID token claims (returned by /authorize → /token exchange):
      </p>
      <pre
        style={{
          background: "#ecfdf5",
          padding: 16,
          borderRadius: 4,
          overflow: "auto",
          fontSize: "0.85rem",
          marginBottom: 24,
          border: "1px solid #a7f3d0",
        }}
      >
        {JSON.stringify(user, null, 2)}
      </pre>
      <p style={{ color: "#555", marginBottom: 16 }}>/userinfo response (Bearer access_token):</p>
      <pre
        style={{
          background: "#eff6ff",
          padding: 16,
          borderRadius: 4,
          overflow: "auto",
          fontSize: "0.85rem",
          marginBottom: 24,
          border: "1px solid #bfdbfe",
        }}
      >
        {renderUserInfo(userInfo)}
      </pre>
      <button onClick={logout} style={btnStyle}>
        Logout
      </button>
    </div>
  );
}

function renderUserInfo(result: UserInfoResult | null): string {
  if (!result) return "Loading...";
  if (result.ok) return JSON.stringify(result.claims, null, 2);
  if (result.reason === "unauthorized") return "401 Unauthorized (token revoked or expired)";
  if (result.reason === "sub_mismatch") return "sub mismatch (OIDC Core §5.3.2)";
  return `Error (HTTP ${result.status})`;
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
