import { Routes, Route, Navigate, Outlet } from "react-router-dom";
import { LoginPage } from "./pages/Login";
import { RegisterPage } from "./pages/Register";
import { ConsentPage } from "./pages/Consent";
import { LogoutPage } from "./pages/Logout";
import { VerifyEmailPage } from "./pages/VerifyEmail";
import { ForgotPasswordPage } from "./pages/ForgotPassword";
import { ResetPasswordPage } from "./pages/ResetPassword";
import { NotFound } from "./pages/NotFound";
import { AdminLoginPage } from "./pages/admin/AdminLogin";
import { AdminForgotPasswordPage } from "./pages/admin/AdminForgotPassword";
import { AdminResetPasswordPage } from "./pages/admin/AdminResetPassword";
import { AdminLayout } from "./components/AdminLayout";
import { RequireSuperAdmin } from "./components/RequireSuperAdmin";
import { AdminDashboard } from "./pages/admin/AdminDashboard";
import { UsersList } from "./pages/admin/UsersList";
import { UserDetail } from "./pages/admin/UserDetail";
import { AdminsList } from "./pages/admin/AdminsList";
import { AdminInvite } from "./pages/admin/AdminInvite";
import { AdminDetail } from "./pages/admin/AdminDetail";
import { ClientsList } from "./pages/admin/ClientsList";
import { ClientForm } from "./pages/admin/ClientForm";

/**
 * SPA の全ルート定義。
 * `/admin/*` は `AdminLayout` 配下で session を解決し、Users / Admins 管理系は `RequireSuperAdmin` で
 * role !== "super" の管理者を `/admin` に redirect する (clients 管理は全 admin が利用可能)。
 */
export function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/admin" replace />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route path="/consent" element={<ConsentPage />} />
      <Route path="/logout" element={<LogoutPage />} />
      <Route path="/verify-email" element={<VerifyEmailPage />} />
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />
      <Route path="/admin/login" element={<AdminLoginPage />} />
      <Route path="/admin/forgot-password" element={<AdminForgotPasswordPage />} />
      <Route path="/admin/reset-password" element={<AdminResetPasswordPage />} />
      <Route element={<AdminLayout />}>
        <Route path="/admin" element={<AdminDashboard />} />
        <Route
          element={
            <RequireSuperAdmin>
              <Outlet />
            </RequireSuperAdmin>
          }
        >
          <Route path="/admin/users" element={<UsersList />} />
          <Route path="/admin/users/:id" element={<UserDetail />} />
          <Route path="/admin/admins" element={<AdminsList />} />
          <Route path="/admin/admins/new" element={<AdminInvite />} />
          <Route path="/admin/admins/:id" element={<AdminDetail />} />
        </Route>
        <Route path="/admin/clients" element={<ClientsList />} />
        <Route path="/admin/clients/new" element={<ClientForm mode="new" />} />
        <Route path="/admin/clients/:id/edit" element={<ClientForm mode="edit" />} />
      </Route>
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}
