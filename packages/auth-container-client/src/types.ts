export interface ClientUserConfig {
  clientId: string;
  clientSecret?: string;
  tokenEndpointAuthMethod?: "client_secret_basic" | "client_secret_post" | "none";
  redirectUri: string;
  encryptionKeys: Uint8Array[];
  cookies?: {
    sessionName?: string;
  };
  fetch?: typeof globalThis.fetch;
  clock?: () => number;
}

export interface ResolvedConfig {
  clientId: string;
  clientSecret?: string;
  tokenEndpointAuthMethod: "client_secret_basic" | "client_secret_post" | "none";
  redirectUri: string;
  encryptionKeys: Uint8Array[];
  sessionCookieName: string;
  fetch: typeof globalThis.fetch;
  clock: () => number;
}

export interface SessionView {
  userId: string;
  opSessionId: string | null;
  accessTokenExpiresAt: number;
  createdAt: number;
}

export interface SetCookieDirective {
  name: string;
  value: string;
  httpOnly: boolean;
  secure: boolean;
  sameSite: "Lax" | "Strict" | "None";
  path: string;
  domain?: string;
  maxAge?: number;
  expires?: Date;
}

export type CallbackErrorKind =
  | "state_mismatch"
  | "missing_code"
  | "token_exchange"
  | "id_token"
  | "nonce_mismatch"
  | "op_error";

export type CallbackResult =
  | {
      ok: true;
      session: SessionView;
      returnTo?: string;
      setCookies: SetCookieDirective[];
    }
  | {
      ok: false;
      kind: CallbackErrorKind;
      opError?: { error: string; errorDescription?: string };
      setCookies: SetCookieDirective[];
    };

export interface SessionData {
  userId: string;
  opSessionId: string | null;
  accessToken: string;
  refreshToken: string | null;
  accessTokenExpiresAt: number;
  createdAt: number;
}

export type UserInfoResult =
  | { ok: true; claims: Record<string, unknown> }
  | { ok: false; reason: "unauthorized" }
  | { ok: false; reason: "error"; status: number };
