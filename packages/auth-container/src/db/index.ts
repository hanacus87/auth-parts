import { drizzle } from "drizzle-orm/d1";
import * as schema from "./schema";

export type DB = ReturnType<typeof createDb>;

/** D1Database バインディングを drizzle ハンドルに変換する。 */
export function createDb(d1: D1Database) {
  return drizzle(d1, { schema });
}
