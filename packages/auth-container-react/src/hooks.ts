import { useContext } from "react";
import { AuthContext, type AuthContextValue } from "./provider";

/**
 * AuthProvider 配下で auth state + login / logout 関数にアクセスする hook。
 * Provider の外で呼ぶと throw する (utility hook の典型パターン)。
 */
export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used within <AuthProvider>");
  }
  return ctx;
}
