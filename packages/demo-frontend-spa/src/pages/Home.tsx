import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@auth-parts/auth-container-react";

export function Home() {
  const { isAuthenticated, isLoading, login } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!isLoading && isAuthenticated) navigate("/dashboard");
  }, [isAuthenticated, isLoading, navigate]);

  if (isLoading) {
    return (
      <div
        style={{ fontFamily: "sans-serif", maxWidth: 400, margin: "80px auto", padding: "0 16px" }}
      >
        <p>Loading...</p>
      </div>
    );
  }

  return (
    <div
      style={{ fontFamily: "sans-serif", maxWidth: 400, margin: "80px auto", padding: "0 16px" }}
    >
      <h1 style={{ fontSize: "1.5rem", marginBottom: 8 }}>OIDC Demo App Sub (SPA Direct)</h1>
      <p style={{ color: "#555", marginBottom: 8 }}>
        Direct OIDC SPA via @auth-parts/auth-container-react. No BFF.
      </p>
      <p style={{ color: "#059669", fontSize: "0.85rem", marginBottom: 24 }}>
        Authorization Code + PKCE (public client, memory-only tokens)
      </p>
      <button
        onClick={login}
        style={{
          width: "100%",
          padding: 10,
          background: "#059669",
          color: "white",
          border: "none",
          borderRadius: 4,
          cursor: "pointer",
          fontSize: "1rem",
        }}
      >
        Login
      </button>
    </div>
  );
}
