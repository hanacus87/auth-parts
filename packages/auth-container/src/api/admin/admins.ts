import { Hono } from "hono";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import type { AppContext, AppEnv } from "../../types";
import { adminPasswordResetTokens, adminSessions, admins, clients } from "../../db/schema";
import { generateId, generateRandomString } from "../../lib/crypto";
import { hashPassword } from "../../lib/password";
import { CSRF_FIELD, getCsrfCookie, verifyCsrf } from "../../lib/csrf";
import { getCurrentAdmin, requireSuperAdmin } from "../../lib/admin-middleware";
import { sendAdminInvitationEmail } from "../../lib/email";
import { adminRoleField, emailField, nameField, zodBadRequest } from "../../lib/validation";

export const apiAdminAdminsRouter = new Hono<AppEnv>();

const INVITATION_TTL_MINUTES = 15;
const INVITATION_TTL_MS = INVITATION_TTL_MINUTES * 60 * 1000;

/**
 * body 内の CSRF トークンを Cookie と照合する (admin/admins ローカルユーティリティ)。
 * Hono v4 SmartRouter の `.use("/admin/admins*")` wildcard が深いパスで発火しないため、
 * 各ルートから本関数を直接呼び出している。
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

const inviteSchema = z.object({
  [CSRF_FIELD]: z.string({ error: "CSRF トークンが不正です" }),
  email: emailField,
  name: nameField,
  role: adminRoleField,
});

const editSchema = z.object({
  [CSRF_FIELD]: z.string({ error: "CSRF トークンが不正です" }),
  name: nameField,
  role: adminRoleField,
});

/** `GET /api/admin/admins` — 管理者一覧 (SuperAdmin 専用)。 */
apiAdminAdminsRouter.get("/admin/admins", requireSuperAdmin, async (c) => {
  const db = c.var.db;
  const list = await db.query.admins.findMany({ orderBy: [desc(admins.createdAt)] });
  return c.json({
    admins: list.map((a) => ({
      id: a.id,
      email: a.email,
      name: a.name,
      role: a.role,
      emailVerified: a.emailVerified,
      createdAt: a.createdAt.toISOString(),
      updatedAt: a.updatedAt.toISOString(),
    })),
  });
});

/** `GET /api/admin/admins/:id` — 単一管理者の詳細 (SuperAdmin 専用)。 */
apiAdminAdminsRouter.get("/admin/admins/:id", requireSuperAdmin, async (c) => {
  const db = c.var.db;
  const id = c.req.param("id");
  const admin = await db.query.admins.findFirst({ where: eq(admins.id, id) });
  if (!admin) return c.json({ error: "not_found" }, 404);
  return c.json({
    admin: {
      id: admin.id,
      email: admin.email,
      name: admin.name,
      role: admin.role,
      emailVerified: admin.emailVerified,
      createdAt: admin.createdAt.toISOString(),
      updatedAt: admin.updatedAt.toISOString(),
    },
  });
});

/**
 * `POST /api/admin/admins` — 新規管理者を招待する (SuperAdmin 専用)。
 * `passwordHash` には使われないランダム値を初期挿入し、adminPasswordResetTokens を発行して
 * 招待メール経由で初回パスワード設定に誘導する。
 */
apiAdminAdminsRouter.post("/admin/admins", requireSuperAdmin, async (c) => {
  const db = c.var.db;
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const guard = csrfGuard(c, body);
  if (guard) return guard;

  const parsed = inviteSchema.safeParse(body);
  if (!parsed.success) return zodBadRequest(c, parsed.error);
  const input = parsed.data;

  const existing = await db.query.admins.findFirst({ where: eq(admins.email, input.email) });
  if (existing) {
    return c.json(
      { error: "conflict", error_description: "このメールアドレスは既に登録されています" },
      409,
    );
  }

  const newId = generateId();
  const placeholderHash = await hashPassword(generateRandomString(32));
  const token = generateRandomString(32);
  const expiresAt = new Date(Date.now() + INVITATION_TTL_MS);

  await db.batch([
    db.insert(admins).values({
      id: newId,
      email: input.email,
      name: input.name,
      role: input.role,
      passwordHash: placeholderHash,
    }),
    db.insert(adminPasswordResetTokens).values({
      token,
      adminId: newId,
      expiresAt,
    }),
  ]);

  const inviter = getCurrentAdmin(c);
  try {
    await sendAdminInvitationEmail(c.env, {
      to: input.email,
      adminName: input.name,
      invitationUrl: `${c.env.ISSUER}/admin/reset-password?token=${encodeURIComponent(token)}`,
      expiresInMinutes: INVITATION_TTL_MINUTES,
      inviterName: inviter.name,
    });
  } catch (err) {
    console.error("sendAdminInvitationEmail failed:", err);
  }

  return c.json({ ok: true, adminId: newId });
});

/**
 * `POST /api/admin/admins/:id` — 管理者情報の編集 (SuperAdmin 専用)。
 * `name` と `role` のみ編集可能。email / password は本エンドポイントでは変更しない。
 * 自分自身の role 変更は禁止。
 */
apiAdminAdminsRouter.post("/admin/admins/:id", requireSuperAdmin, async (c) => {
  const db = c.var.db;
  const id = c.req.param("id");
  const target = await db.query.admins.findFirst({ where: eq(admins.id, id) });
  if (!target) return c.json({ error: "not_found" }, 404);

  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const guard = csrfGuard(c, body);
  if (guard) return guard;

  const parsed = editSchema.safeParse(body);
  if (!parsed.success) return zodBadRequest(c, parsed.error);
  const input = parsed.data;

  const me = getCurrentAdmin(c);
  if (me.id === target.id && input.role !== target.role) {
    return c.json(
      {
        error: "self_role_change_forbidden",
        error_description: "自分自身の role は変更できません",
      },
      400,
    );
  }

  await db
    .update(admins)
    .set({
      name: input.name,
      role: input.role,
      updatedAt: new Date(),
    })
    .where(eq(admins.id, id));

  return c.json({ ok: true });
});

/**
 * `POST /api/admin/admins/:id/delete` — 管理者削除 (SuperAdmin 専用)。
 * 自分自身は削除不可。削除時は adminSessions / adminPasswordResetTokens を破棄し、
 * `clients.createdByAdminId` を NULL にして SuperAdmin 専有扱い (system-owned) に降格させる。
 */
apiAdminAdminsRouter.post("/admin/admins/:id/delete", requireSuperAdmin, async (c) => {
  const db = c.var.db;
  const id = c.req.param("id");
  const target = await db.query.admins.findFirst({ where: eq(admins.id, id) });
  if (!target) return c.json({ error: "not_found" }, 404);

  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const guard = csrfGuard(c, body);
  if (guard) return guard;

  const me = getCurrentAdmin(c);
  if (me.id === target.id) {
    return c.json(
      { error: "self_delete_forbidden", error_description: "自分自身は削除できません" },
      400,
    );
  }

  await db.batch([
    db.delete(adminSessions).where(eq(adminSessions.adminId, id)),
    db.delete(adminPasswordResetTokens).where(eq(adminPasswordResetTokens.adminId, id)),
    db.update(clients).set({ createdByAdminId: null }).where(eq(clients.createdByAdminId, id)),
    db.delete(admins).where(eq(admins.id, id)),
  ]);

  return c.json({ ok: true });
});
