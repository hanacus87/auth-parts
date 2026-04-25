export const ISSUER = "https://auth-container.hanacus87.net" as const;

export const ENDPOINTS = {
  issuer: ISSUER,
  authorization: `${ISSUER}/authorize`,
  token: `${ISSUER}/token`,
  userinfo: `${ISSUER}/userinfo`,
  jwks: `${ISSUER}/jwks.json`,
  endSession: `${ISSUER}/logout`,
} as const;

export const SCOPES = ["openid", "profile", "email", "offline_access"] as const;

export const COOKIES = {
  session: { name: "bff_session", path: "/", maxAge: 86400 },
  pending: { name: "oauth_pending", path: "/auth", maxAge: 600 },
} as const;
