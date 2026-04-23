import { and, eq, lt, ne } from "drizzle-orm";
import { exportPKCS8, exportSPKI, generateKeyPair } from "jose";
import type { DB } from "../db";
import { cryptoKeys } from "../db/schema";
import { generateId } from "./crypto";

const ROTATE_AFTER_MS = 30 * 24 * 60 * 60 * 1000;
const RETIRE_AFTER_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * JWT 署名鍵のローテーションとリタイアを進める自動バッチ。
 * Cloudflare Cron Triggers から呼び出される想定 (月次)。
 *
 * 処理内容:
 *   1. active 鍵の最新 createdAt が 30 日以上経過していれば、新しい RS256 鍵を
 *      `status='active'` で発行し、既存の active を `status='deprecated'` + `deprecatedAt=now` に遷移させる。
 *   2. `status='deprecated'` のうち `deprecatedAt` が 7 日以上経過しているものを
 *      `status='retired'` + `retiredAt=now` に遷移させる。retired 鍵は JWKS からも検証からも除外される。
 *
 * グレースピリオド (7 日) は id_token TTL + JWKS `Cache-Control: max-age=3600` に対して十分なマージン。
 * 失敗しても次回の発火でリカバリされる冪等設計にする。
 */
export async function rotateAndRetireKeys(db: DB): Promise<void> {
  const now = Date.now();
  await rotateIfOverdue(db, now);
  await retireExpiredDeprecated(db, now);
}

/**
 * active 鍵のうち最新のものが閾値を越えて古ければ、新しい active 鍵を発行して旧 active を deprecated へ降格する。
 * active が複数存在する場合もまとめて deprecated へ落とす。
 */
async function rotateIfOverdue(db: DB, now: number): Promise<void> {
  const activeKeys = await db.query.cryptoKeys.findMany({
    where: eq(cryptoKeys.status, "active"),
  });
  if (activeKeys.length === 0) return;
  const newest = activeKeys.reduce((a, b) => (a.createdAt > b.createdAt ? a : b));
  if (now - newest.createdAt.getTime() < ROTATE_AFTER_MS) return;

  const alg = "RS256";
  const kid = generateId();
  const pair = await generateKeyPair(alg, { modulusLength: 2048, extractable: true });
  const privateKeyPem = await exportPKCS8(pair.privateKey);
  const publicKeyPem = await exportSPKI(pair.publicKey);

  await db.insert(cryptoKeys).values({
    kid,
    alg,
    privateKeyPem,
    publicKeyPem,
    status: "active",
  });
  await db
    .update(cryptoKeys)
    .set({ status: "deprecated", deprecatedAt: new Date(now) })
    .where(and(eq(cryptoKeys.status, "active"), ne(cryptoKeys.kid, kid)));
}

/**
 * deprecated 鍵のうち `deprecatedAt` がグレースピリオドを超えたものを retired へ遷移させる。
 */
async function retireExpiredDeprecated(db: DB, now: number): Promise<void> {
  const threshold = new Date(now - RETIRE_AFTER_MS);
  await db
    .update(cryptoKeys)
    .set({ status: "retired", retiredAt: new Date(now) })
    .where(and(eq(cryptoKeys.status, "deprecated"), lt(cryptoKeys.deprecatedAt, threshold)));
}
