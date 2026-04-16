import { Hono } from "hono";
import { cors } from "hono/cors";
import { jsxRenderer } from "hono/jsx-renderer";
import { loadOrGenerateKeyPair } from "./lib/jwt";
import { discoveryRouter } from "./routes/discovery";
import { jwksRouter } from "./routes/jwks";
import { authorizeRouter } from "./routes/authorize";
import { loginRouter } from "./routes/login";
import { consentRouter } from "./routes/consent";
import { tokenRouter } from "./routes/token";
import { userinfoRouter } from "./routes/userinfo";
import { logoutRouter } from "./routes/logout";

const app = new Hono();

// CORS: RP Frontend からのアクセスのみ許可
app.use(
  "*",
  cors({
    origin: "http://localhost:5173",
    allowMethods: ["GET", "POST", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization"],
    credentials: true,
  }),
);

// Referrer-Policy: URL パラメータ（login_challenge, consent_challenge）の漏洩防止
app.use("*", async (c, next) => {
  await next();
  c.header("Referrer-Policy", "no-referrer");
});

// JSX レンダラー（Auth Server UI 用）
app.use("*", jsxRenderer());

// ルート登録
app.route("/", discoveryRouter);
app.route("/", jwksRouter);
app.route("/", authorizeRouter);
app.route("/", loginRouter);
app.route("/", consentRouter);
app.route("/", tokenRouter);
app.route("/", userinfoRouter);
app.route("/", logoutRouter);

// 起動
const port = Number(process.env.PORT) || 4000;

await loadOrGenerateKeyPair();

console.log(`Auth Server listening on http://localhost:${port}`);

export default {
  port,
  fetch: app.fetch,
};
