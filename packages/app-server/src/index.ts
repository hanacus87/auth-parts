import { Hono } from "hono";
import { cors } from "hono/cors";
import { authRouter } from "./routes/auth";
import { apiRouter } from "./routes/api";

const app = new Hono();

// CORS: RP Frontend からのアクセスを許可
app.use(
  "*",
  cors({
    origin: "http://localhost:5173",
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

const port = Number(process.env.PORT) || 3000;
console.log(`App Server listening on http://localhost:${port}`);

export default {
  port,
  fetch: app.fetch,
};
