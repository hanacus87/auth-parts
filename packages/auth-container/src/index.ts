import { Hono } from "hono";
import { cors } from "hono/cors";
import { secureHeaders } from "hono/secure-headers";
import type { AppEnv } from "./types";
import { createDb } from "./db";
import { discoveryRouter } from "./routes/discovery";
import { jwksRouter } from "./routes/jwks";
import { authorizeRouter } from "./routes/authorize";
import { tokenRouter } from "./routes/token";
import { userinfoRouter } from "./routes/userinfo";
import { apiRouter } from "./api";
import { rotateAndRetireKeys } from "./lib/key-rotation";

const app = new Hono<AppEnv>();

app.use("*", async (c, next) => {
  c.set("db", createDb(c.env.DB));
  await next();
});

app.use("*", async (c, next) => {
  if (c.env.ENVIRONMENT === "development") {
    return cors({
      origin: "http://localhost:5173",
      allowMethods: ["GET", "POST", "OPTIONS"],
      allowHeaders: ["Content-Type", "Authorization"],
      credentials: true,
    })(c, next);
  }
  await next();
});

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
      frameAncestors: ["'none'"],
      baseUri: ["'self'"],
    },
  }),
);

app.route("/", discoveryRouter);
app.route("/", jwksRouter);
app.route("/", authorizeRouter);
app.route("/", tokenRouter);
app.route("/", userinfoRouter);

app.route("/api", apiRouter);

app.get("*", async (c) => {
  const res = await c.env.ASSETS.fetch(new Request(new URL("/index.html", c.req.url)));
  return new Response(res.body, res);
});

/**
 * Cloudflare Workers のエントリポイント。
 * `fetch` は通常の HTTP リクエスト、`scheduled` は wrangler.toml の `[triggers] crons` 発火時に呼ばれる。
 * scheduled では JWT 署名鍵の月次ローテ / グレース満了鍵のリタイアを `ctx.waitUntil` で非同期実行する。
 */
export default {
  fetch: app.fetch,
  scheduled: async (_event, env, ctx) => {
    ctx.waitUntil(rotateAndRetireKeys(createDb(env.DB)));
  },
} satisfies ExportedHandler<AppEnv["Bindings"]>;
