export interface AuthConfig {
  clientId: string;
  redirectUri: string;
  postLogoutRedirectUri?: string;
  silentRenewOnMount?: boolean;
  fetch?: typeof globalThis.fetch;
}

export interface ResolvedAuthConfig {
  clientId: string;
  redirectUri: string;
  postLogoutRedirectUri: string;
  silentRenewOnMount: boolean;
  fetch: typeof globalThis.fetch;
}

export interface AuthUser {
  sub: string;
  name?: string;
  email?: string;
  email_verified?: boolean;
  [claim: string]: unknown;
}

export type AuthError =
  | { kind: "state_mismatch" }
  | { kind: "missing_code" }
  | { kind: "token_exchange"; description?: string }
  | { kind: "id_token" }
  | { kind: "nonce_mismatch" }
  | { kind: "op_error"; error: string; description?: string }
  | { kind: "login_required" }
  | { kind: "consent_required" }
  | { kind: "interaction_required" };

export interface AuthState {
  isAuthenticated: boolean;
  isLoading: boolean;
  user: AuthUser | null;
  accessToken: string | null;
  idToken: string | null;
  accessTokenExpiresAt: number | null;
  error: AuthError | null;
}

export interface PendingAuth {
  state: string;
  nonce: string;
  codeVerifier: string;
  returnTo: string;
  createdAt: number;
}
