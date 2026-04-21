import { defineConfig } from "drizzle-kit";

// D1 (SQLite) 向け設定。
// generate は drizzle-kit、apply は wrangler d1 migrations apply を使う。
export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "sqlite",
  driver: "d1-http",
});
