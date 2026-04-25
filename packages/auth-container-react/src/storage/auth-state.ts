import type { AuthError, AuthState, AuthUser } from "../types";

/**
 * Provider の useReducer に渡す reducer。AuthState を遷移させる。
 * memory のみ保管 (BCP 推奨) なのでページリロードで消える前提。
 */
export type AuthAction =
  | { type: "init" }
  | { type: "loading" }
  | {
      type: "callback_success";
      user: AuthUser;
      accessToken: string;
      idToken: string;
      accessTokenExpiresAt: number;
    }
  | { type: "logout" }
  | { type: "error"; error: AuthError };

export const initialAuthState: AuthState = {
  isAuthenticated: false,
  isLoading: false,
  user: null,
  accessToken: null,
  idToken: null,
  accessTokenExpiresAt: null,
  error: null,
};

export function authReducer(state: AuthState, action: AuthAction): AuthState {
  switch (action.type) {
    case "init":
      return { ...initialAuthState };
    case "loading":
      return { ...state, isLoading: true, error: null };
    case "callback_success":
      return {
        isAuthenticated: true,
        isLoading: false,
        user: action.user,
        accessToken: action.accessToken,
        idToken: action.idToken,
        accessTokenExpiresAt: action.accessTokenExpiresAt,
        error: null,
      };
    case "logout":
      return { ...initialAuthState };
    case "error":
      return { ...state, isLoading: false, error: action.error };
    default:
      return state;
  }
}
