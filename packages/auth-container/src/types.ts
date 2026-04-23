import type { Context, Hono } from "hono";
import type { DB } from "./db";
import type { AdminContext } from "./lib/admin-session";

/** Cloudflare Workers の環境変数 / 外部バインディング。 */
export type Bindings = {
  DB: D1Database;
  ASSETS: Fetcher;
  RATE_LIMIT_KV: KVNamespace;
  ISSUER: string;
  SESSION_SECRET: string;
  ACCESS_TOKEN_TTL: string;
  ID_TOKEN_TTL: string;
  REFRESH_TOKEN_TTL: string;
  ENVIRONMENT: "development" | "production";
  RESEND_API_KEY: string;
  FROM_EMAIL: string;
};

/** Hono の `c.var` にぶら下がるリクエストローカル変数。 */
export type Variables = {
  db: DB;
  admin?: AdminContext;
};

export type AppEnv = { Bindings: Bindings; Variables: Variables };
export type AppContext = Context<AppEnv>;
export type AppHono = Hono<AppEnv>;
