import { eq, sql, type AnyColumn } from "drizzle-orm";
import type { SQLiteTable } from "drizzle-orm/sqlite-core";
import type { DB } from "../db";

export interface DependencySpec {
  label: string;
  table: SQLiteTable;
  column: AnyColumn;
}

export interface DependencyCounts {
  items: { label: string; count: number }[];
  total: number;
}

/**
 * 指定した FK 列に対して並列に `count(*)` を実行し、依存件数をまとめて返す。
 * 削除前のカスケード確認 (ユーザー / クライアント削除 UI) で使用する。
 *
 * @param db - drizzle ハンドル
 * @param specs - 調べる (table, column, label) の集合
 * @param value - FK 列と比較する値
 * @returns 各ラベル毎の件数と合計件数
 */
export async function countDependencies(
  db: DB,
  specs: DependencySpec[],
  value: string,
): Promise<DependencyCounts> {
  const results = await Promise.all(
    specs.map(async (spec) => {
      const [row] = await db
        .select({ n: sql<number>`count(*)` })
        .from(spec.table)
        .where(eq(spec.column, value));
      return { label: spec.label, count: Number(row?.n ?? 0) };
    }),
  );
  const total = results.reduce((a, r) => a + r.count, 0);
  return { items: results, total };
}
