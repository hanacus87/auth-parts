import type { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { useAdminSession } from "./AdminLayout";

/**
 * SuperAdmin 限定ルートの pre-emptive ガード。
 * role !== "super" なら /admin (dashboard) に replace ナビゲート。
 * useAdminSession は AdminLayout 内でのみ有効なので、このコンポーネントも
 * routes.tsx で AdminLayout の子として使うこと。
 */
export function RequireSuperAdmin({ children }: { children: ReactNode }) {
  const { admin } = useAdminSession();
  if (admin.role !== "super") {
    return <Navigate to="/admin" replace />;
  }
  return <>{children}</>;
}
