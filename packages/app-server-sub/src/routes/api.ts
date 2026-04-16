import { Hono } from "hono";
import { sessionAuthMiddleware } from "../middleware/auth";

const AUTH_SERVER = process.env.AUTH_SERVER_URL!;

type Env = {
  Variables: {
    user: { sub: string; accessToken: string };
  };
};

export const apiRouter = new Hono<Env>();

// 全 API ルートにセッション認証ミドルウェアを適用
apiRouter.use("*", sessionAuthMiddleware);

// GET /api/me — UserInfo から取得したユーザー情報を返す
apiRouter.get("/me", async (c) => {
  const { accessToken } = c.get("user");

  const res = await fetch(`${AUTH_SERVER}/userinfo`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!res.ok) {
    return c.json({ error: "Failed to fetch user info" }, 502);
  }

  const userinfo = (await res.json()) as Record<string, unknown>;

  return c.json({
    name: userinfo.name ?? null,
    email: userinfo.email ?? null,
  });
});
