import type { Bindings } from "../types";

/**
 * Resend REST API で確認メールを送信する。
 *
 * @param env - Cloudflare Workers の Bindings (RESEND_API_KEY / FROM_EMAIL を使用)
 * @param params - 宛先・ユーザー名・確認 URL・有効期限 (分)
 * @throws Resend API が 2xx 以外を返した場合にメッセージ付きエラーを投げる (呼び出し元で握りつぶすか再スローするか判断する)
 */
export async function sendVerificationEmail(
  env: Bindings,
  params: { to: string; userName: string; verificationUrl: string; expiresInMinutes: number },
): Promise<void> {
  const { to, userName, verificationUrl, expiresInMinutes } = params;
  const html = renderVerificationHtml({ userName, verificationUrl, expiresInMinutes });
  const text = renderVerificationText({ userName, verificationUrl, expiresInMinutes });

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: env.FROM_EMAIL,
      to,
      subject: "【AuthContainer】メールアドレスの確認",
      html,
      text,
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Resend API error ${res.status}: ${body}`);
  }
}

/** 確認メールのプレーンテキスト本文を組み立てる。 */
function renderVerificationText(opts: {
  userName: string;
  verificationUrl: string;
  expiresInMinutes: number;
}): string {
  return [
    `${opts.userName} 様`,
    "",
    "AuthContainer へのご登録ありがとうございます。",
    "以下のリンクをクリックしてメールアドレスの確認を完了してください:",
    "",
    opts.verificationUrl,
    "",
    `※ このリンクの有効期限は ${opts.expiresInMinutes} 分間です。`,
    "※ 心当たりがない場合はこのメールを破棄してください。",
  ].join("\n");
}

/**
 * 確認メールの HTML 本文を組み立てる。
 * メールクライアントの CSS 互換性を考慮し inline style + table-less な基本要素のみを使用する。
 */
function renderVerificationHtml(opts: {
  userName: string;
  verificationUrl: string;
  expiresInMinutes: number;
}): string {
  const name = escapeHtml(opts.userName);
  const url = escapeHtml(opts.verificationUrl);
  const esc = (s: string) => escapeHtml(s);

  return `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>メールアドレスの確認</title>
</head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#18181b;">
  <div style="max-width:480px;margin:40px auto;padding:32px;background:#ffffff;border-radius:12px;box-shadow:0 1px 3px rgba(0,0,0,0.06);">
    <div style="margin-bottom:24px;font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#6366f1;font-weight:600;">AuthContainer</div>
    <h1 style="font-size:20px;margin:0 0 12px;color:#18181b;">メールアドレスの確認</h1>
    <p style="font-size:14px;line-height:1.6;color:#3f3f46;margin:0 0 8px;">${name} 様</p>
    <p style="font-size:14px;line-height:1.6;color:#3f3f46;margin:0 0 24px;">
      AuthContainer へのご登録ありがとうございます。以下のボタンをクリックしてメールアドレスの確認を完了してください。
    </p>
    <div style="text-align:center;margin:24px 0;">
      <a href="${url}" style="display:inline-block;padding:12px 24px;background:#6366f1;color:#ffffff;text-decoration:none;border-radius:6px;font-size:14px;font-weight:600;">
        メールアドレスを確認する
      </a>
    </div>
    <p style="font-size:12px;line-height:1.5;color:#71717a;margin:24px 0 8px;">
      ボタンが機能しない場合は以下の URL をブラウザに貼り付けてください:
    </p>
    <p style="font-size:12px;line-height:1.5;color:#3f3f46;word-break:break-all;margin:0 0 24px;">
      <a href="${url}" style="color:#4f46e5;text-decoration:underline;">${url}</a>
    </p>
    <hr style="border:none;border-top:1px solid #e4e4e7;margin:24px 0;" />
    <p style="font-size:11px;line-height:1.5;color:#71717a;margin:0;">
      このリンクの有効期限は <strong>${esc(String(opts.expiresInMinutes))} 分</strong> です。<br />
      心当たりがない場合はこのメールを破棄してください。
    </p>
  </div>
</body>
</html>`;
}

/** HTML 特殊文字をエスケープする (& < > " ')。 */
function escapeHtml(str: string): string {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

interface PasswordResetMailParams {
  to: string;
  userName: string;
  resetUrl: string;
  expiresInMinutes: number;
  audience: "user" | "admin";
}

/**
 * パスワードリセットメールの送信本体 (ユーザー / 管理者共通)。
 * `audience` で件名とブランド表示を切り替える。
 *
 * @throws Resend API が 2xx 以外を返した場合にエラーを投げる
 */
async function sendResetEmail(env: Bindings, params: PasswordResetMailParams): Promise<void> {
  const { to, audience } = params;
  const subject =
    audience === "admin"
      ? "【AuthContainer 管理画面】パスワード再設定のご案内"
      : "【AuthContainer】パスワード再設定のご案内";
  const html = renderPasswordResetHtml(params);
  const text = renderPasswordResetText(params);

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: env.FROM_EMAIL,
      to,
      subject,
      html,
      text,
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Resend API error ${res.status}: ${body}`);
  }
}

/** 一般ユーザー向けパスワードリセットメールを送信する。 */
export async function sendPasswordResetEmail(
  env: Bindings,
  params: { to: string; userName: string; resetUrl: string; expiresInMinutes: number },
): Promise<void> {
  return sendResetEmail(env, { ...params, audience: "user" });
}

/** 管理者向けパスワードリセットメールを送信する。 */
export async function sendAdminPasswordResetEmail(
  env: Bindings,
  params: { to: string; adminName: string; resetUrl: string; expiresInMinutes: number },
): Promise<void> {
  return sendResetEmail(env, {
    to: params.to,
    userName: params.adminName,
    resetUrl: params.resetUrl,
    expiresInMinutes: params.expiresInMinutes,
    audience: "admin",
  });
}

/** パスワードリセットメールのプレーンテキスト本文を組み立てる。 */
function renderPasswordResetText(opts: PasswordResetMailParams): string {
  const role = opts.audience === "admin" ? "管理画面" : "アカウント";
  return [
    `${opts.userName} 様`,
    "",
    `AuthContainer の ${role} パスワード再設定のリクエストを受け付けました。`,
    "以下のリンクから新しいパスワードを設定してください:",
    "",
    opts.resetUrl,
    "",
    `※ このリンクの有効期限は ${opts.expiresInMinutes} 分間です。`,
    "※ 心当たりがない場合はこのメールを破棄してください (何もしなければパスワードは変更されません)。",
  ].join("\n");
}

interface AdminInvitationParams {
  to: string;
  adminName: string;
  invitationUrl: string;
  expiresInMinutes: number;
  inviterName: string;
}

/**
 * 管理者招待メールを Resend 経由で送信する。
 *
 * @throws Resend API が 2xx 以外を返した場合にエラーを投げる
 */
export async function sendAdminInvitationEmail(
  env: Bindings,
  params: AdminInvitationParams,
): Promise<void> {
  const html = renderAdminInvitationHtml(params);
  const text = renderAdminInvitationText(params);

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: env.FROM_EMAIL,
      to: params.to,
      subject: "【AuthContainer 管理画面】アカウント招待のご案内",
      html,
      text,
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Resend API error ${res.status}: ${body}`);
  }
}

/** 管理者招待メールのプレーンテキスト本文を組み立てる。 */
function renderAdminInvitationText(opts: AdminInvitationParams): string {
  return [
    `${opts.adminName} 様`,
    "",
    `${opts.inviterName} 様より AuthContainer 管理画面への招待が届きました。`,
    "以下のリンクを開いて初期パスワードを設定し、管理画面にログインしてください:",
    "",
    opts.invitationUrl,
    "",
    `※ このリンクの有効期限は ${opts.expiresInMinutes} 分間です。`,
    "※ 心当たりがない場合はこのメールを破棄してください。",
  ].join("\n");
}

/** 管理者招待メールの HTML 本文を組み立てる。 */
function renderAdminInvitationHtml(opts: AdminInvitationParams): string {
  const name = escapeHtml(opts.adminName);
  const inviter = escapeHtml(opts.inviterName);
  const url = escapeHtml(opts.invitationUrl);
  const esc = (s: string) => escapeHtml(s);

  return `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>アカウント招待</title>
</head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#18181b;">
  <div style="max-width:480px;margin:40px auto;padding:32px;background:#ffffff;border-radius:12px;box-shadow:0 1px 3px rgba(0,0,0,0.06);">
    <div style="margin-bottom:24px;font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#6366f1;font-weight:600;">AuthContainer Admin</div>
    <h1 style="font-size:20px;margin:0 0 12px;color:#18181b;">管理画面への招待</h1>
    <p style="font-size:14px;line-height:1.6;color:#3f3f46;margin:0 0 8px;">${name} 様</p>
    <p style="font-size:14px;line-height:1.6;color:#3f3f46;margin:0 0 24px;">
      ${inviter} 様より AuthContainer 管理画面への招待が届きました。以下のボタンから初期パスワードを設定してログインしてください。
    </p>
    <div style="text-align:center;margin:24px 0;">
      <a href="${url}" style="display:inline-block;padding:12px 24px;background:#6366f1;color:#ffffff;text-decoration:none;border-radius:6px;font-size:14px;font-weight:600;">
        パスワードを設定してログイン
      </a>
    </div>
    <p style="font-size:12px;line-height:1.5;color:#71717a;margin:24px 0 8px;">
      ボタンが機能しない場合は以下の URL をブラウザに貼り付けてください:
    </p>
    <p style="font-size:12px;line-height:1.5;color:#3f3f46;word-break:break-all;margin:0 0 24px;">
      <a href="${url}" style="color:#4f46e5;text-decoration:underline;">${url}</a>
    </p>
    <hr style="border:none;border-top:1px solid #e4e4e7;margin:24px 0;" />
    <p style="font-size:11px;line-height:1.5;color:#71717a;margin:0;">
      このリンクの有効期限は <strong>${esc(String(opts.expiresInMinutes))} 分</strong> です。<br />
      心当たりがない場合はこのメールを破棄してください。
    </p>
  </div>
</body>
</html>`;
}

/** パスワードリセットメールの HTML 本文を組み立てる (`audience` でブランドを切替)。 */
function renderPasswordResetHtml(opts: PasswordResetMailParams): string {
  const name = escapeHtml(opts.userName);
  const url = escapeHtml(opts.resetUrl);
  const esc = (s: string) => escapeHtml(s);
  const role = opts.audience === "admin" ? "管理画面" : "アカウント";
  const brand = opts.audience === "admin" ? "AuthContainer Admin" : "AuthContainer";

  return `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>パスワード再設定</title>
</head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#18181b;">
  <div style="max-width:480px;margin:40px auto;padding:32px;background:#ffffff;border-radius:12px;box-shadow:0 1px 3px rgba(0,0,0,0.06);">
    <div style="margin-bottom:24px;font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#6366f1;font-weight:600;">${esc(brand)}</div>
    <h1 style="font-size:20px;margin:0 0 12px;color:#18181b;">パスワード再設定</h1>
    <p style="font-size:14px;line-height:1.6;color:#3f3f46;margin:0 0 8px;">${name} 様</p>
    <p style="font-size:14px;line-height:1.6;color:#3f3f46;margin:0 0 24px;">
      AuthContainer の ${esc(role)} パスワード再設定のリクエストを受け付けました。以下のボタンから新しいパスワードを設定してください。
    </p>
    <div style="text-align:center;margin:24px 0;">
      <a href="${url}" style="display:inline-block;padding:12px 24px;background:#6366f1;color:#ffffff;text-decoration:none;border-radius:6px;font-size:14px;font-weight:600;">
        パスワードを再設定する
      </a>
    </div>
    <p style="font-size:12px;line-height:1.5;color:#71717a;margin:24px 0 8px;">
      ボタンが機能しない場合は以下の URL をブラウザに貼り付けてください:
    </p>
    <p style="font-size:12px;line-height:1.5;color:#3f3f46;word-break:break-all;margin:0 0 24px;">
      <a href="${url}" style="color:#4f46e5;text-decoration:underline;">${url}</a>
    </p>
    <hr style="border:none;border-top:1px solid #e4e4e7;margin:24px 0;" />
    <p style="font-size:11px;line-height:1.5;color:#71717a;margin:0;">
      このリンクの有効期限は <strong>${esc(String(opts.expiresInMinutes))} 分</strong> です。<br />
      心当たりがない場合はこのメールを破棄してください (何もしなければパスワードは変更されません)。
    </p>
  </div>
</body>
</html>`;
}
