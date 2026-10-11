// Auth, account, sessions and two-factor.

import type { Membership, TokenResponse, User } from "@/lib/api/types";
import { db, me } from "../db";
import { HttpError, invalid, post, get, patch, del, required, respond, s } from "../router";
import { nowIso, randomToken } from "../util";

const KEY = "od-mock-session";

export function signedIn(): boolean {
  try {
    const v = localStorage.getItem(KEY);
    return v === null ? true : v === "1";
  } catch {
    return true;
  }
}

export function setSignedIn(on: boolean) {
  try {
    localStorage.setItem(KEY, on ? "1" : "0");
  } catch {
    /* storage unavailable */
  }
}

export function tokens(): TokenResponse {
  return { access_token: `mock_access_${randomToken(24)}`, expires_in: 900, user: me() };
}

export function memberships(): Membership[] {
  return db.workspaces
    .filter((w) => w.members.some((m) => m.user_id === db.meId))
    .map((w) => ({ workspace: w.workspace, role: w.members.find((m) => m.user_id === db.meId)!.role }));
}

function checkPassword(pw: string | undefined) {
  if (!pw || pw.length < 12) throw invalid("Password must be at least 12 characters");
  if (pw.length > 128) throw invalid("Password must be at most 128 characters");
  if (["password1234", "123456789012", "qwertyuiopas"].includes(pw.toLowerCase())) throw invalid("This password appears in a list of breached passwords. Choose another one.");
}

function login(): TokenResponse {
  setSignedIn(true);
  return tokens();
}

export function registerAuth() {
  get("/v1/auth/config", () => ({
    providers: [
      { id: "google", name: "Google" },
      { id: "microsoft", name: "Microsoft" },
      { id: "github", name: "GitHub" },
      { id: "oidc", name: "SSO" },
    ],
    password_login: true,
    signup_enabled: true,
    turnstile_site_key: null,
  }));

  post("/v1/auth/login", (ctx) => {
    const email = required(ctx, "email");
    const password = s(ctx, "password") ?? "";
    if (password === "wrong" || !password) throw new HttpError(401, "invalid_credentials", "Email or password is incorrect");
    if (email.toLowerCase().includes("mfa")) return { mfa_required: true, mfa_token: "mfa_mock" };
    return login();
  });

  post("/v1/auth/register", (ctx) => {
    const email = required(ctx, "email");
    const name = required(ctx, "name");
    checkPassword(s(ctx, "password"));
    if (email === "taken@fieldnote.app") throw new HttpError(409, "email_taken", "An account with this email already exists");
    const u = me();
    u.name = name;
    u.email = email;
    u.email_verified = false;
    return login();
  });

  post("/v1/auth/mfa", (ctx) => {
    const code = (s(ctx, "code") ?? "").replace(/\s/g, "");
    if (code !== "123456" && !/^[a-z0-9]{4}(-[a-z0-9]{4}){3}$/i.test(code)) throw new HttpError(401, "invalid_code", "That code is not valid. Try again.");
    return login();
  });

  post("/v1/auth/refresh", () => {
    if (!signedIn()) throw new HttpError(401, "unauthorized", "No session");
    return respond(200, tokens());
  });

  post("/v1/auth/logout", () => {
    setSignedIn(false);
    return respond(204);
  });

  post("/v1/auth/password/forgot", () => respond(204));
  post("/v1/auth/password/reset", (ctx) => {
    const token = required(ctx, "token");
    if (token === "expired") throw new HttpError(400, "invalid_token", "This reset link has expired. Request a new one.");
    checkPassword(s(ctx, "password"));
    return respond(204);
  });
  post("/v1/auth/email/verify", (ctx) => {
    const token = required(ctx, "token");
    if (token === "expired") throw new HttpError(400, "invalid_token", "This verification link has expired.");
    me().email_verified = true;
    return respond(204);
  });
  post("/v1/auth/email/resend", () => respond(204));

  get("/v1/auth/oauth/:provider/start", (ctx) => respond(302, undefined, { location: `/auth/callback?code=mock-${ctx.params.provider}` }));

  post("/v1/auth/oauth/exchange", (ctx) => {
    const code = required(ctx, "code");
    if (code === "mock-link") return { link_required: true, link_token: "lt_mock", email: me().email };
    if (code === "mock-mfa") return { mfa_required: true, mfa_token: "mfa_mock" };
    if (code === "mock-bad") throw new HttpError(400, "invalid_code", "This sign-in link has expired. Try again.");
    return login();
  });

  post("/v1/auth/oauth/link", (ctx) => {
    required(ctx, "link_token");
    const password = s(ctx, "password");
    if (!password || password === "wrong") throw new HttpError(401, "invalid_credentials", "Password is incorrect");
    return login();
  });

  post("/v1/auth/totp/setup", () => {
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
    let secret = "";
    for (let i = 0; i < 32; i++) secret += alphabet[Math.floor(Math.random() * 32)];
    db.totpPending = secret;
    return respond(200, { secret, otpauth_url: `otpauth://totp/opendesk:${encodeURIComponent(me().email)}?secret=${secret}&issuer=opendesk&algorithm=SHA1&digits=6&period=30` });
  });
  post("/v1/auth/totp/enable", (ctx) => {
    const code = s(ctx, "code") ?? "";
    if (!/^\d{6}$/.test(code)) throw new HttpError(400, "invalid_code", "Enter the 6-digit code from your app");
    if (!db.totpPending) throw new HttpError(409, "conflict", "Start setup first");
    me().totp_enabled = true;
    db.totpPending = null;
    const codes = Array.from({ length: 10 }, () => {
      const r = randomToken(16).toLowerCase().replace(/[-_]/g, "x");
      return `${r.slice(0, 4)}-${r.slice(4, 8)}-${r.slice(8, 12)}-${r.slice(12, 16)}`;
    });
    return respond(200, { recovery_codes: codes });
  });
  post("/v1/auth/totp/disable", (ctx) => {
    if (!/^\d{6}$/.test(s(ctx, "code") ?? "")) throw new HttpError(400, "invalid_code", "Enter the 6-digit code from your app");
    me().totp_enabled = false;
    return respond(204);
  });

  get("/v1/me", () => ({ user: me(), memberships: memberships() }));
  patch("/v1/me", (ctx): User => {
    const u = me();
    const name = s(ctx, "name");
    if (name !== undefined) {
      if (!name.trim()) throw invalid("Name can't be empty");
      u.name = name.trim().slice(0, 80);
    }
    const avatar = s(ctx, "avatar_url");
    if (avatar !== undefined) u.avatar_url = avatar;
    return u;
  });
  post("/v1/me/password", (ctx) => {
    if ((s(ctx, "current_password") ?? "") === "wrong") throw new HttpError(401, "invalid_credentials", "Current password is incorrect");
    checkPassword(s(ctx, "new_password"));
    return respond(204);
  });
  get("/v1/me/sessions", () => ({ data: db.sessions, next_cursor: null }));
  del("/v1/me/sessions/:id", (ctx) => {
    const sess = db.sessions.find((x) => x.id === ctx.params.id);
    if (!sess) throw new HttpError(404, "not_found", "Session not found");
    if (sess.current) setSignedIn(false);
    db.sessions = db.sessions.filter((x) => x.id !== ctx.params.id);
    return respond(204);
  });
  del("/v1/me", (ctx) => {
    if (s(ctx, "password") === "wrong") throw new HttpError(401, "invalid_credentials", "Password is incorrect");
    const sole = db.workspaces.find((w) => {
      const mine = w.members.find((m) => m.user_id === db.meId);
      return mine?.role === "owner" && w.members.filter((m) => m.role === "owner").length === 1 && w.members.length > 1;
    });
    if (sole) throw new HttpError(409, "sole_owner", `You're the only owner of ${sole.workspace.name}. Transfer ownership or delete the workspace first.`);
    setSignedIn(false);
    return respond(204);
  });

  // Keep the current session's "last used" fresh.
  for (const x of db.sessions) if (x.current) x.last_used_at = nowIso();
}
