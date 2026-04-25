export const ISSUER = "https://auth-container.hanacus87.net" as const;

export const ENDPOINTS = {
  issuer: ISSUER,
  authorization: `${ISSUER}/authorize`,
  token: `${ISSUER}/token`,
  userinfo: `${ISSUER}/userinfo`,
  jwks: `${ISSUER}/jwks.json`,
  endSession: `${ISSUER}/logout`,
} as const;

export const SCOPES = ["openid", "profile", "email"] as const;

export const SILENT_ATTEMPTED_KEY = "auth-container-react:silent-attempted";
export const PENDING_KEY = "auth-container-react:pending";
