import { AuthContainerClient } from "@auth-parts/auth-container-client";
import {
  applySetCookies,
  createHonoOidcRoutes,
  honoSessionMiddleware,
  type HonoOidcVariables,
} from "@auth-parts/auth-container-client/adapters/hono";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { secureHeaders } from "hono/secure-headers";

const FRONTEND_URL = process.env.FRONTEND_URL!;

const encryptionKeys = process.env
  .COOKIE_KEYS!.split(",")
  .map((b64) => new Uint8Array(Buffer.from(b64, "base64")));

const oidc = new AuthContainerClient({
  clientId: process.env.CLIENT_ID!,
  clientSecret: process.env.CLIENT_SECRET!,
  redirectUri: process.env.REDIRECT_URI!,
  encryptionKeys,
  cookies: { sessionName: process.env.SESSION_COOKIE_NAME },
});

const app = new Hono();

app.use(
  "*",
  cors({
    origin: FRONTEND_URL,
    allowMethods: ["GET", "POST", "OPTIONS"],
    allowHeaders: ["Content-Type"],
    credentials: true,
  }),
);

app.use(
  "*",
  secureHeaders({
    strictTransportSecurity: "max-age=31536000; includeSubDomains",
    xFrameOptions: "DENY",
    xContentTypeOptions: "nosniff",
    referrerPolicy: "no-referrer",
    contentSecurityPolicy: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:"],
      fontSrc: ["'self'"],
      connectSrc: ["'self'"],
      formAction: ["'self'"],
      frameAncestors: ["'none'"],
      baseUri: ["'self'"],
    },
  }),
);

app.route(
  "/auth",
  createHonoOidcRoutes(oidc, {
    successRedirect: `${FRONTEND_URL}/dashboard`,
    errorRedirect: `${FRONTEND_URL}/callback`,
    postLogoutRedirectUri: process.env.POST_LOGOUT_REDIRECT_URI,
  }),
);

const api = new Hono<{ Variables: HonoOidcVariables }>();
api.use("*", honoSessionMiddleware(oidc));
/**
 * SPA 向けのユーザー情報エンドポイント。AuthContainer の `/userinfo` を BFF 経由で叩き、
 * 表示に必要な claim だけを返す。`/userinfo` が 401 を返した場合は access_token が revoke
 * されたとみなしてサーバ側セッション Cookie を破棄してから 401 を返す (再ログインを促す)。
 * sub mismatch も同様にセッションを破棄する (別ユーザーへすり替わる事故を防ぐ)。
 */
api.get("/me", async (c) => {
  const { sub, accessToken } = c.var.user;
  const result = await oidc.fetchUserInfo(accessToken, sub);

  if (result.ok) {
    return c.json({
      name: result.claims.name ?? null,
      given_name: result.claims.given_name ?? null,
      family_name: result.claims.family_name ?? null,
      email: result.claims.email ?? null,
    });
  }

  if (result.reason === "unauthorized") {
    applySetCookies(c, oidc.clearSession());
    return c.json({ error: "unauthenticated" }, 401);
  }

  if (result.reason === "sub_mismatch") {
    applySetCookies(c, oidc.clearSession());
    return c.json({ error: "sub_mismatch" }, 401);
  }

  return c.json({ error: "Failed to fetch user info" }, 502);
});
app.route("/api", api);

app.get("/health", (c) => c.json({ status: "ok" }));

const port = Number(process.env.PORT) || 3000;
console.log(`App Server listening on http://localhost:${port}`);

export default {
  port,
  fetch: app.fetch,
};
