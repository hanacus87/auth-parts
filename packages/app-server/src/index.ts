import { Hono } from "hono";
import { cors } from "hono/cors";
import { secureHeaders } from "hono/secure-headers";
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

app.use(
  "*",
  secureHeaders({
    strictTransportSecurity: "max-age=31536000; includeSubDomains",
    xFrameOptions: "DENY",
    xContentTypeOptions: "nosniff",
    referrerPolicy: "no-referrer",
    contentSecurityPolicy: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:"],
      fontSrc: ["'self'"],
      connectSrc: ["'self'"],
      formAction: ["'self'"],
      frameAncestors: ["'none'"],
      baseUri: ["'self'"],
    },
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
