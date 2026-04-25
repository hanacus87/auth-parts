import { Hono } from "hono";
import { cors } from "hono/cors";
import { secureHeaders } from "hono/secure-headers";
import type { AppEnv } from "./types";
import { createDb, type DB } from "./db";
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

/**
 * 全クライアントの allowed_cors_origins を D1 から集約して Set として返す。
 *
 * 確認時 (毎リクエスト) に findMany が走るが Cloudflare D1 の応答時間は数 ms 程度のため許容する。
 * 必要になればメモリ / KV キャッシュを後付けする。
 */
async function loadAllowedCorsOrigins(db: DB): Promise<Set<string>> {
  const rows = await db.query.clients.findMany({ columns: { allowedCorsOrigins: true } });
  const set = new Set<string>();
  for (const row of rows) {
    for (const origin of row.allowedCorsOrigins) set.add(origin);
  }
  return set;
}

app.use("*", async (c, next) => {
  return cors({
    origin: async (origin) => {
      if (!origin) return null;
      const allowed = await loadAllowedCorsOrigins(c.var.db);
      return allowed.has(origin) ? origin : null;
    },
    allowMethods: ["GET", "POST", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization"],
    credentials: true,
  })(c, next);
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
