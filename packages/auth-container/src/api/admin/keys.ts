import { Hono } from "hono";
import { desc } from "drizzle-orm";
import type { AppEnv } from "../../types";
import { cryptoKeys } from "../../db/schema";
import { requireSuperAdmin } from "../../lib/admin-middleware";
import { CSRF_FIELD, getCsrfCookie, verifyCsrf } from "../../lib/csrf";
import { rotateAndRetireKeys } from "../../lib/key-rotation";

export const apiAdminKeysRouter = new Hono<AppEnv>();

/**
 * `GET /api/admin/keys` — JWT 署名鍵の一覧を SuperAdmin に返す。
 * privateKeyPem は返さず、kid / alg / status / 各種タイムスタンプのみを含める。
 */
apiAdminKeysRouter.get("/admin/keys", requireSuperAdmin, async (c) => {
  const rows = await c.var.db.query.cryptoKeys.findMany({
    orderBy: [desc(cryptoKeys.createdAt)],
  });
  return c.json({
    keys: rows.map((row) => ({
      kid: row.kid,
      alg: row.alg,
      status: row.status,
      createdAt: row.createdAt,
      deprecatedAt: row.deprecatedAt,
      retiredAt: row.retiredAt,
    })),
  });
});

/**
 * `POST /api/admin/keys/rotate` — 鍵ローテを手動発火させる緊急用エンドポイント。
 * 内部ロジックは月次 cron と同一の `rotateAndRetireKeys` を呼ぶ。
 * CSRF トークンと SuperAdmin 権限が必須。
 */
apiAdminKeysRouter.post("/admin/keys/rotate", requireSuperAdmin, async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const formToken = typeof body[CSRF_FIELD] === "string" ? (body[CSRF_FIELD] as string) : undefined;
  if (!verifyCsrf(getCsrfCookie(c), formToken)) {
    return c.json({ error: "invalid_csrf" }, 403);
  }
  await rotateAndRetireKeys(c.var.db);
  return c.json({ ok: true });
});
