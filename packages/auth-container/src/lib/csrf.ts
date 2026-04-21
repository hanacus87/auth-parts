import type { CookieOptions } from "hono/utils/cookie";
import { getCookie, setCookie } from "hono/cookie";
import type { AppContext } from "../types";
import { generateRandomString } from "./crypto";
import { safeEqual } from "./safe-equal";

export const ADMIN_CSRF_COOKIE = "admin_csrf";
export const LOGOUT_CSRF_COOKIE = "logout_csrf";
export const CSRF_FIELD = "_csrf";

/** 後方互換: admin ルーターが import している旧名のエイリアス。 */
export const CSRF_COOKIE = ADMIN_CSRF_COOKIE;

const CSRF_TTL_SEC = 60 * 60 * 8;
const CSRF_MIN_LENGTH = 32;

/**
 * 指定 Cookie 名と Cookie 属性に紐付く CSRF ヘルパー対 (`ensure` / `getFromCookie`) を生成する。
 *
 * @param cookieName - 保存先 Cookie 名
 * @param cookieOptions - maxAge 以外の Cookie 属性 (maxAge は内部で CSRF_TTL_SEC を設定)
 * @returns Cookie 再利用 or 新規発行を行う ensure と、現在値を取得する getFromCookie のペア
 */
function createCsrfHelpers(cookieName: string, cookieOptions: Omit<CookieOptions, "maxAge">) {
  /** 既存の CSRF Cookie を再利用し、未発行 or 長さ不足なら新規トークンを発行する。 */
  function ensure(c: AppContext): string {
    const existing = getCookie(c, cookieName);
    if (existing && existing.length >= CSRF_MIN_LENGTH) return existing;

    const token = generateRandomString(32);
    setCookie(c, cookieName, token, {
      ...cookieOptions,
      secure: c.env.ENVIRONMENT !== "development",
      maxAge: CSRF_TTL_SEC,
    });
    return token;
  }

  /** 現在設定されている CSRF Cookie を取得する。 */
  function getFromCookie(c: AppContext): string | undefined {
    return getCookie(c, cookieName);
  }

  return { ensure, getFromCookie };
}

const admin = createCsrfHelpers(ADMIN_CSRF_COOKIE, {
  httpOnly: true,
  sameSite: "Strict",
  path: "/",
});

const logout = createCsrfHelpers(LOGOUT_CSRF_COOKIE, {
  httpOnly: true,
  sameSite: "Lax",
  path: "/",
});

export const ensureCsrfToken = admin.ensure;
export const getCsrfCookie = admin.getFromCookie;

export const ensureLogoutCsrfToken = logout.ensure;
export const getLogoutCsrfCookie = logout.getFromCookie;

/**
 * 定数時間比較で CSRF トークンの一致を検証する。
 * 長さが `CSRF_MIN_LENGTH` 未満、もしくはどちらかが undefined なら即座に false。
 */
export function verifyCsrf(
  cookieToken: string | undefined,
  formToken: string | undefined,
): boolean {
  if (!cookieToken || !formToken) return false;
  if (cookieToken.length < CSRF_MIN_LENGTH || formToken.length < CSRF_MIN_LENGTH) return false;
  return safeEqual(cookieToken, formToken);
}

/** フォーム POST 用の `<input type="hidden">` マークアップを生成する。 */
export function csrfHiddenInput(token: string): string {
  return `<input type="hidden" name="${CSRF_FIELD}" value="${token}" />`;
}
