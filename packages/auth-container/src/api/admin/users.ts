import { Hono } from "hono";
import { desc, eq } from "drizzle-orm";
import type { AppContext, AppEnv } from "../../types";
import {
  users,
  authorizationCodes,
  accessTokens,
  refreshTokens,
  opSessions,
  consents,
  emailVerificationTokens,
  passwordResetTokens,
} from "../../db/schema";
import { CSRF_FIELD, getCsrfCookie, verifyCsrf } from "../../lib/csrf";
import { requireSuperAdmin } from "../../lib/admin-middleware";
import { countDependencies, type DependencySpec } from "../../lib/dep-counts";

export const apiAdminUsersRouter = new Hono<AppEnv>();

/**
 * body 内の CSRF トークンを Cookie と照合する (admin/users ローカルユーティリティ)。
 * Hono v4 の `.use("/admin/users*")` wildcard が深いパスで発火しない問題があるため、
 * 各ルートで本関数を直接呼び出している。
 *
 * @returns NG なら 403 Response、OK なら null
 */
function csrfGuard(c: AppContext, body: Record<string, unknown>): Response | null {
  const formToken = typeof body[CSRF_FIELD] === "string" ? (body[CSRF_FIELD] as string) : undefined;
  if (!verifyCsrf(getCsrfCookie(c), formToken)) {
    return c.json({ error: "invalid_csrf" }, 403);
  }
  return null;
}

const USER_DEPS: DependencySpec[] = [
  { label: "認可コード", table: authorizationCodes, column: authorizationCodes.userId },
  { label: "アクセストークン", table: accessTokens, column: accessTokens.userId },
  { label: "リフレッシュトークン", table: refreshTokens, column: refreshTokens.userId },
  { label: "OP セッション", table: opSessions, column: opSessions.userId },
  { label: "同意履歴", table: consents, column: consents.userId },
];

/** `GET /api/admin/users` — 一般ユーザー一覧。SuperAdmin のみ呼び出せる。 */
apiAdminUsersRouter.get("/admin/users", requireSuperAdmin, async (c) => {
  const db = c.var.db;
  const list = await db.query.users.findMany({ orderBy: [desc(users.createdAt)] });
  return c.json({
    users: list.map((u) => ({
      id: u.id,
      email: u.email,
      emailVerified: u.emailVerified,
      name: u.name,
      givenName: u.givenName,
      familyName: u.familyName,
      createdAt: u.createdAt.toISOString(),
    })),
  });
});

/** `GET /api/admin/users/:id` — 一般ユーザー詳細。SuperAdmin のみ。 */
apiAdminUsersRouter.get("/admin/users/:id", requireSuperAdmin, async (c) => {
  const db = c.var.db;
  const id = c.req.param("id");
  const user = await db.query.users.findFirst({ where: eq(users.id, id) });
  if (!user) return c.json({ error: "not_found" }, 404);
  return c.json({
    user: {
      id: user.id,
      email: user.email,
      emailVerified: user.emailVerified,
      name: user.name,
      givenName: user.givenName ?? "",
      familyName: user.familyName ?? "",
      createdAt: user.createdAt.toISOString(),
      updatedAt: user.updatedAt.toISOString(),
    },
  });
});

/**
 * `POST /api/admin/users/:id/delete` — 一般ユーザー削除 (SuperAdmin 専用)。
 * 依存行がある場合は `requiresCascade` と件数を返し、`cascade=true` 再送で一括削除する。
 * D1 は `db.transaction()` が使えないため `db.batch()` で atomicity を担保する。
 * emailVerificationTokens / passwordResetTokens は USER_DEPS には含めず silent 削除する (FK エラー防止)。
 */
apiAdminUsersRouter.post("/admin/users/:id/delete", requireSuperAdmin, async (c) => {
  const db = c.var.db;
  const id = c.req.param("id");
  const user = await db.query.users.findFirst({ where: eq(users.id, id) });
  if (!user) return c.json({ error: "not_found" }, 404);

  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const guard = csrfGuard(c, body);
  if (guard) return guard;

  const cascade = body["cascade"] === true;
  const deps = await countDependencies(db, USER_DEPS, id);

  if (deps.total > 0 && !cascade) {
    return c.json({
      requiresCascade: true,
      dependencies: deps.items,
      total: deps.total,
    });
  }

  await db.batch([
    db.delete(authorizationCodes).where(eq(authorizationCodes.userId, id)),
    db.delete(accessTokens).where(eq(accessTokens.userId, id)),
    db.delete(refreshTokens).where(eq(refreshTokens.userId, id)),
    db.delete(opSessions).where(eq(opSessions.userId, id)),
    db.delete(consents).where(eq(consents.userId, id)),
    db.delete(emailVerificationTokens).where(eq(emailVerificationTokens.userId, id)),
    db.delete(passwordResetTokens).where(eq(passwordResetTokens.userId, id)),
    db.delete(users).where(eq(users.id, id)),
  ]);

  return c.json({ ok: true });
});
