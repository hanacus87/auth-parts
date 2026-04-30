import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { startLogin } from "../lib/oidc";
import { checkAuthStatus } from "../lib/api";

export function Home() {
  const navigate = useNavigate();
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    checkAuthStatus()
      .then(({ loggedIn }) => {
        if (loggedIn) navigate("/dashboard");
      })
      .finally(() => setChecking(false));
  }, [navigate]);

  if (checking) {
    return <div>Loading...</div>;
  }

  return (
    <div
      style={{ fontFamily: "sans-serif", maxWidth: 400, margin: "80px auto", padding: "0 16px" }}
    >
      <h1 style={{ fontSize: "1.5rem", marginBottom: 8 }}>OIDC Demo App</h1>
      <p style={{ color: "#555", marginBottom: 24 }}>
        OpenID Connect Authorization Code Flow + PKCE demo application.
      </p>
      <button
        onClick={() => startLogin()}
        style={{
          width: "100%",
          padding: 10,
          background: "#4f46e5",
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
