import { Hono } from "hono";
import { cors } from "hono/cors";
import { authRouter } from "./routes/auth";
import { apiRouter } from "./routes/api";

const app = new Hono();

// CORS: RP Frontend からのアクセスを許可
app.use(
  "*",
  cors({
    origin: process.env.FRONTEND_URL || "http://localhost:5174",
    allowMethods: ["GET", "POST", "OPTIONS"],
    allowHeaders: ["Content-Type"],
    credentials: true,
  }),
);

// BFF 認証ルート
app.route("/auth", authRouter);

// API ルート
app.route("/api", apiRouter);

// ヘルスチェック
app.get("/health", (c) => c.json({ status: "ok" }));

const port = Number(process.env.PORT) || 3001;
console.log(`App Server Sub listening on http://localhost:${port}`);

export default {
  port,
  fetch: app.fetch,
};
