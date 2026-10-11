// The signed-in user, their workspaces and the selected one. Resolved once at
// boot (refresh cookie, then /v1/me) so nothing under the app gates its first
// render on it again.

import { create } from "zustand";
import { api } from "./api/endpoints";
import { onSession, refreshSession, setAccessToken, setWorkspaceId } from "./api/client";
import type { Membership, Role, TokenResponse, User, Workspace } from "./api/types";

export type SessionStatus = "loading" | "anon" | "authed";

type SessionState = {
  status: SessionStatus;
  user: User | null;
  memberships: Membership[];
  workspaceId: string | null;
};

export const useSession = create<SessionState>(() => ({
  status: "loading",
  user: null,
  memberships: [],
  workspaceId: null,
}));

const wsKey = (uid: string) => `od-ws:${uid}`;

function rememberedWorkspace(uid: string): string | null {
  try {
    return localStorage.getItem(wsKey(uid));
  } catch {
    return null;
  }
}

function remember(uid: string, wid: string) {
  try {
    localStorage.setItem(wsKey(uid), wid);
  } catch {
    /* storage unavailable */
  }
}

function pickWorkspace(uid: string, memberships: Membership[], prefer?: string | null): string | null {
  const ids = memberships.map((m) => m.workspace.id);
  for (const c of [prefer, rememberedWorkspace(uid)]) if (c && ids.includes(c)) return c;
  return ids[0] ?? null;
}

async function loadMe(prefer?: string | null): Promise<SessionState> {
  const me = await api.me.get();
  const wid = pickWorkspace(me.user.id, me.memberships, prefer ?? useSession.getState().workspaceId);
  setWorkspaceId(wid);
  if (wid) remember(me.user.id, wid);
  const next: SessionState = { status: "authed", user: me.user, memberships: me.memberships, workspaceId: wid };
  useSession.setState(next);
  return next;
}

let booting: Promise<SessionState> | null = null;

/** Resolve the session once: refresh cookie, then /v1/me. */
export function bootSession(): Promise<SessionState> {
  if (booting) return booting;
  booting = (async () => {
    const r = await refreshSession();
    if (!r) {
      const anon: SessionState = { status: "anon", user: null, memberships: [], workspaceId: null };
      useSession.setState(anon);
      return anon;
    }
    try {
      return await loadMe();
    } catch {
      const anon: SessionState = { status: "anon", user: null, memberships: [], workspaceId: null };
      useSession.setState(anon);
      return anon;
    }
  })();
  return booting;
}

/** After login, register, MFA or OAuth exchange. */
export async function signIn(tok: TokenResponse, preferWorkspace?: string | null) {
  setAccessToken(tok.access_token, tok.expires_in);
  const s = await loadMe(preferWorkspace);
  booting = Promise.resolve(s);
  return s;
}

/** Re-read memberships (after creating or joining a workspace). */
export function reloadSession(preferWorkspace?: string | null) {
  const p = loadMe(preferWorkspace);
  booting = p;
  return p;
}

export function selectWorkspace(id: string) {
  const { user, memberships } = useSession.getState();
  if (!user || !memberships.some((m) => m.workspace.id === id)) return;
  setWorkspaceId(id);
  remember(user.id, id);
  useSession.setState({ workspaceId: id });
}

export function updateUser(u: User) {
  useSession.setState({ user: u });
}

export function updateWorkspace(w: Workspace) {
  useSession.setState((s) => ({
    memberships: s.memberships.map((m) => (m.workspace.id === w.id ? { ...m, workspace: w } : m)),
  }));
}

export function clearSession() {
  setAccessToken(null);
  setWorkspaceId(null);
  const anon: SessionState = { status: "anon", user: null, memberships: [], workspaceId: null };
  booting = Promise.resolve(anon);
  useSession.setState(anon);
}

export async function signOut() {
  try {
    await api.auth.logout();
  } catch {
    /* the session ends locally either way */
  }
  clearSession();
}

// A refresh that fails mid-session ends it everywhere.
onSession((r) => {
  if (!r && useSession.getState().status === "authed") clearSession();
  if (r) useSession.setState({ user: r.user });
});

export function currentMembership(s: SessionState = useSession.getState()): Membership | null {
  return s.memberships.find((m) => m.workspace.id === s.workspaceId) ?? null;
}

export function useWorkspace(): Workspace | null {
  return useSession((s) => s.memberships.find((m) => m.workspace.id === s.workspaceId)?.workspace ?? null);
}

export function useRole(): Role {
  return useSession((s) => s.memberships.find((m) => m.workspace.id === s.workspaceId)?.role ?? "viewer");
}

export function useUser(): User {
  const u = useSession((s) => s.user);
  if (!u) throw new Error("useUser outside an authenticated route");
  return u;
}

const rank: Record<Role, number> = { viewer: 0, agent: 1, admin: 2, owner: 3 };
export function atLeast(role: Role, min: Role) {
  return rank[role] >= rank[min];
}
