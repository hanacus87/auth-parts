import { Hono } from "hono";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import type { AppContext, AppEnv } from "../../types";
import {
  clients,
  authorizationCodes,
  accessTokens,
  refreshTokens,
  consents,
} from "../../db/schema";
import {
  SUPPORTED_SCOPES,
  GRANT_TYPES,
  TOKEN_ENDPOINT_AUTH_METHODS,
} from "../../lib/oidc-constants";
import { generateId, generateRandomString } from "../../lib/crypto";
import { CSRF_FIELD, getCsrfCookie, verifyCsrf } from "../../lib/csrf";
import { getCurrentAdmin, requireAdmin } from "../../lib/admin-middleware";
import { countDependencies, type DependencySpec } from "../../lib/dep-counts";

export const apiAdminClientsRouter = new Hono<AppEnv>();

/**
 * body 内の CSRF トークンを Cookie と照合する。
 * Hono v4 の `.use("/admin/clients*", ...)` wildcard が深いパスで発火しないため、
 * 各ルート内で本関数を直接呼び出して CSRF 検証を行う。
 *
 * @returns 検証 NG なら 403 Response、OK なら null
 */
function csrfGuard(c: AppContext, body: Record<string, unknown>): Response | null {
  const formToken = typeof body[CSRF_FIELD] === "string" ? (body[CSRF_FIELD] as string) : undefined;
  if (!verifyCsrf(getCsrfCookie(c), formToken)) {
    return c.json({ error: "invalid_csrf" }, 403);
  }
  return null;
}

/**
 * client の所有権を検証する。
 * Admin ロールは `client.createdByAdminId === admin.id` でなければ NG (存在漏洩を避けるため 404)。
 * SuperAdmin は常に通す。
 *
 * @returns 所有権 NG なら 404 Response、OK なら null
 */
function assertClientOwnership(
  c: AppContext,
  client: { createdByAdminId: string | null },
): Response | null {
  const admin = getCurrentAdmin(c);
  if (admin.role === "super") return null;
  if (client.createdByAdminId !== admin.id) {
    return c.json({ error: "not_found" }, 404);
  }
  return null;
}

const CLIENT_DEPS: DependencySpec[] = [
  { label: "認可コード", table: authorizationCodes, column: authorizationCodes.clientId },
  { label: "アクセストークン", table: accessTokens, column: accessTokens.clientId },
  { label: "リフレッシュトークン", table: refreshTokens, column: refreshTokens.clientId },
  { label: "同意履歴", table: consents, column: consents.clientId },
];

/** JS の URL コンストラクタで解釈可能な文字列かを判定する。 */
function isValidUrl(v: string): boolean {
  try {
    new URL(v);
    return true;
  } catch {
    return false;
  }
}

const optionalUrlString = z
  .string({ error: "文字列を入力してください" })
  .transform((v) => v.trim())
  .refine((v) => v === "" || isValidUrl(v), {
    message: "有効な URL を入力してください",
  });

const optionalUrlToNull = z
  .string({ error: "文字列を入力してください" })
  .optional()
  .transform((v) => (v ?? "").trim())
  .refine((v) => v === "" || isValidUrl(v), {
    message: "有効な URL を入力してください",
  })
  .transform((v) => (v === "" ? null : v));

const urlList = z
  .array(optionalUrlString, { error: "URL 配列の形式が不正です" })
  .transform((arr) => arr.filter((v) => v !== ""));

const clientFormSchema = z.object({
  [CSRF_FIELD]: z.string({ error: "CSRF トークンが不正です" }),
  name: z.string({ error: "クライアント名は必須です" }).trim().min(1, "クライアント名は必須です"),
  redirect_uris: urlList.refine((arr) => arr.length >= 1, {
    message: "redirect_uris を 1 つ以上指定してください",
  }),
  token_endpoint_auth_method: z.enum(TOKEN_ENDPOINT_AUTH_METHODS, {
    error: "token_endpoint_auth_method の値が不正です",
  }),
  backchannel_logout_uri: optionalUrlToNull,
  post_logout_redirect_uris: urlList.default([]),
});

/** Zod バリデーションエラーを 400 JSON レスポンスに変換する (admin/clients 用フォーマット)。 */
function badRequest(c: AppContext, error: z.ZodError) {
  return c.json(
    {
      error: "invalid_request",
      error_description: "入力値が不正です",
      issues: error.issues.map((i) => ({
        path: i.path.map(String).join("."),
        message: i.message,
      })),
    },
    400,
  );
}

/**
 * `GET /api/admin/clients` — クライアント一覧。
 * SuperAdmin は全件、Admin は自分が作成したもののみを返す。
 */
apiAdminClientsRouter.get("/admin/clients", requireAdmin, async (c) => {
  const db = c.var.db;
  const admin = getCurrentAdmin(c);
  const list = await db.query.clients.findMany({
    orderBy: [desc(clients.createdAt)],
    where: admin.role === "super" ? undefined : eq(clients.createdByAdminId, admin.id),
  });
  return c.json({
    clients: list.map((cl) => ({
      id: cl.id,
      name: cl.name,
      tokenEndpointAuthMethod: cl.tokenEndpointAuthMethod,
      redirectUris: cl.redirectUris,
      allowedScopes: cl.allowedScopes,
      allowedGrantTypes: cl.allowedGrantTypes,
      backchannelLogoutUri: cl.backchannelLogoutUri ?? "",
      postLogoutRedirectUris: cl.postLogoutRedirectUris,
      createdByAdminId: cl.createdByAdminId,
      createdAt: cl.createdAt.toISOString(),
    })),
  });
});

/** `GET /api/admin/clients/:id` — 単一クライアントの詳細取得。所有権チェック付き。 */
apiAdminClientsRouter.get("/admin/clients/:id", requireAdmin, async (c) => {
  const db = c.var.db;
  const id = c.req.param("id");
  const client = await db.query.clients.findFirst({ where: eq(clients.id, id) });
  if (!client) return c.json({ error: "not_found" }, 404);
  const own = assertClientOwnership(c, client);
  if (own) return own;
  return c.json({
    client: {
      id: client.id,
      name: client.name,
      tokenEndpointAuthMethod: client.tokenEndpointAuthMethod,
      redirectUris: client.redirectUris,
      allowedScopes: client.allowedScopes,
      allowedGrantTypes: client.allowedGrantTypes,
      backchannelLogoutUri: client.backchannelLogoutUri ?? "",
      postLogoutRedirectUris: client.postLogoutRedirectUris,
      createdByAdminId: client.createdByAdminId,
    },
  });
});

/**
 * `POST /api/admin/clients` — 新規クライアント作成。
 * `tokenEndpointAuthMethod=none` 以外では `clientSecret` を発行して返す (秘匿値は応答 1 度きり)。
 * allowedScopes と allowedGrantTypes はサーバ全体のサポート値に固定する。
 */
apiAdminClientsRouter.post("/admin/clients", requireAdmin, async (c) => {
  const db = c.var.db;
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const guard = csrfGuard(c, body);
  if (guard) return guard;

  const parsed = clientFormSchema.safeParse(body);
  if (!parsed.success) return badRequest(c, parsed.error);
  const input = parsed.data;

  const admin = getCurrentAdmin(c);
  const newId = generateId();
  const isPublic = input.token_endpoint_auth_method === "none";
  const newSecret = isPublic ? null : generateRandomString(32);

  await db.insert(clients).values({
    id: newId,
    secret: newSecret,
    name: input.name,
    redirectUris: input.redirect_uris,
    allowedScopes: [...SUPPORTED_SCOPES],
    tokenEndpointAuthMethod: input.token_endpoint_auth_method,
    allowedGrantTypes: [...GRANT_TYPES],
    backchannelLogoutUri: input.backchannel_logout_uri,
    postLogoutRedirectUris: input.post_logout_redirect_uris,
    createdByAdminId: admin.id,
  });

  return c.json({ clientId: newId, clientSecret: newSecret });
});

/**
 * `POST /api/admin/clients/:id` — クライアント情報更新。
 * `tokenEndpointAuthMethod` の public↔confidential 切替に伴う `secret` の整合も行う
 * (public 化で null、confidential 化で新規 secret 発行)。
 */
apiAdminClientsRouter.post("/admin/clients/:id", requireAdmin, async (c) => {
  const db = c.var.db;
  const id = c.req.param("id");
  const client = await db.query.clients.findFirst({ where: eq(clients.id, id) });
  if (!client) return c.json({ error: "not_found" }, 404);
  const own = assertClientOwnership(c, client);
  if (own) return own;

  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const guard = csrfGuard(c, body);
  if (guard) return guard;

  const parsed = clientFormSchema.safeParse(body);
  if (!parsed.success) return badRequest(c, parsed.error);
  const input = parsed.data;

  const wasPublic = client.tokenEndpointAuthMethod === "none";
  const willBePublic = input.token_endpoint_auth_method === "none";
  let generatedSecret: string | null = null;
  let secretUpdate: string | null | undefined;
  if (!wasPublic && willBePublic) {
    secretUpdate = null;
  } else if (wasPublic && !willBePublic) {
    generatedSecret = generateRandomString(32);
    secretUpdate = generatedSecret;
  }

  await db
    .update(clients)
    .set({
      ...(secretUpdate !== undefined ? { secret: secretUpdate } : {}),
      name: input.name,
      redirectUris: input.redirect_uris,
      allowedScopes: [...SUPPORTED_SCOPES],
      tokenEndpointAuthMethod: input.token_endpoint_auth_method,
      allowedGrantTypes: [...GRANT_TYPES],
      backchannelLogoutUri: input.backchannel_logout_uri,
      postLogoutRedirectUris: input.post_logout_redirect_uris,
    })
    .where(eq(clients.id, id));

  return c.json({ ok: true, generatedSecret });
});

/** `POST /api/admin/clients/:id/rotate-secret` — 新しい client_secret を発行する。public client では 400。 */
apiAdminClientsRouter.post("/admin/clients/:id/rotate-secret", requireAdmin, async (c) => {
  const db = c.var.db;
  const id = c.req.param("id");
  const client = await db.query.clients.findFirst({ where: eq(clients.id, id) });
  if (!client) return c.json({ error: "not_found" }, 404);
  const own = assertClientOwnership(c, client);
  if (own) return own;

  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const guard = csrfGuard(c, body);
  if (guard) return guard;

  if (client.tokenEndpointAuthMethod === "none") {
    return c.json(
      {
        error: "invalid_operation",
        error_description: "public client (auth_method=none) は secret を持てません",
      },
      400,
    );
  }

  const newSecret = generateRandomString(32);
  await db.update(clients).set({ secret: newSecret }).where(eq(clients.id, id));
  return c.json({ clientSecret: newSecret });
});

/**
 * `POST /api/admin/clients/:id/delete` — クライアント削除。
 * 依存行 (認可コード / access / refresh / 同意履歴) がある場合は `requiresCascade` を返し、
 * 再リクエスト時に `cascade=true` が付いたら子行を一括削除してから本体を削除する。
 */
apiAdminClientsRouter.post("/admin/clients/:id/delete", requireAdmin, async (c) => {
  const db = c.var.db;
  const id = c.req.param("id");
  const client = await db.query.clients.findFirst({ where: eq(clients.id, id) });
  if (!client) return c.json({ error: "not_found" }, 404);
  const own = assertClientOwnership(c, client);
  if (own) return own;

  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const guard = csrfGuard(c, body);
  if (guard) return guard;

  const cascade = body["cascade"] === true;
  const deps = await countDependencies(db, CLIENT_DEPS, id);

  if (deps.total > 0 && !cascade) {
    return c.json({
      requiresCascade: true,
      dependencies: deps.items,
      total: deps.total,
    });
  }

  if (deps.total > 0) {
    await db.batch([
      db.delete(authorizationCodes).where(eq(authorizationCodes.clientId, id)),
      db.delete(accessTokens).where(eq(accessTokens.clientId, id)),
      db.delete(refreshTokens).where(eq(refreshTokens.clientId, id)),
      db.delete(consents).where(eq(consents.clientId, id)),
      db.delete(clients).where(eq(clients.id, id)),
    ]);
  } else {
    await db.delete(clients).where(eq(clients.id, id));
  }
  return c.json({ ok: true });
});
