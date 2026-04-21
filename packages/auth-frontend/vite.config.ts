import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

/**
 * Vite の設定。
 * build 成果物は `../auth-container/dist-assets/` に出力し、auth-container の
 * Cloudflare Workers Static Assets として配信する。
 * dev server は OIDC / API リクエストを `localhost:4000` (auth-container) にプロキシする。
 */
export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    outDir: "../auth-container/dist-assets",
    emptyOutDir: true,
    assetsDir: "assets",
    sourcemap: true,
  },
  server: {
    port: 5175,
    proxy: {
      "/api": "http://localhost:4000",
      "/authorize": "http://localhost:4000",
      "/token": "http://localhost:4000",
      "/userinfo": "http://localhost:4000",
      "/jwks.json": "http://localhost:4000",
      "/.well-known": "http://localhost:4000",
    },
  },
});
