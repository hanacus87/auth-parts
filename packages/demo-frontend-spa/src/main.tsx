import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { AuthProvider } from "@auth-parts/auth-container-react";
import { App } from "./App";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AuthProvider
      config={{
        clientId: import.meta.env.VITE_CLIENT_ID,
        redirectUri: window.location.origin + "/callback",
        postLogoutRedirectUri: window.location.origin,
      }}
    >
      <App />
    </AuthProvider>
  </StrictMode>,
);
