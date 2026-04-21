import { Hono } from "hono";
import type { AppEnv } from "../types";
import { apiLoginRouter } from "./login";
import { apiRegisterRouter } from "./register";
import { apiConsentRouter } from "./consent";
import { apiLogoutRouter } from "./logout";
import { apiAdminSessionRouter } from "./admin/session";
import { apiAdminUsersRouter } from "./admin/users";
import { apiAdminClientsRouter } from "./admin/clients";
import { apiAdminAdminsRouter } from "./admin/admins";
import { apiVerifyEmailRouter } from "./verify-email";
import { apiResetPasswordRouter } from "./reset-password";
import { apiAdminResetPasswordRouter } from "./admin/reset-password";

export const apiRouter = new Hono<AppEnv>();

apiRouter.route("/", apiLoginRouter);
apiRouter.route("/", apiRegisterRouter);
apiRouter.route("/", apiConsentRouter);
apiRouter.route("/", apiLogoutRouter);
apiRouter.route("/", apiVerifyEmailRouter);
apiRouter.route("/", apiResetPasswordRouter);
apiRouter.route("/", apiAdminSessionRouter);
apiRouter.route("/", apiAdminUsersRouter);
apiRouter.route("/", apiAdminClientsRouter);
apiRouter.route("/", apiAdminAdminsRouter);
apiRouter.route("/", apiAdminResetPasswordRouter);
