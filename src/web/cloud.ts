// =============================================================================
//  Account and synced school progress (ADR-047): Supabase Auth (email + password)
//  and one row in public.school_progress, through their REST APIs - no SDK.
//  The publishable key is public by design; access is limited by row-level
//  security (supabase/school.sql): a signed-in user reads and writes only their row.
// =============================================================================

import type { ProgressData } from "../school/merge.js";

export const SUPABASE_URL = "https://mtpmxxzhyqwwbomadsjv.supabase.co";
const KEY = "sb_publishable_6ZSwsdqWSFbe9UvOZdPQCA_vYaJ5w67";
const STORE = "dotaapp.cloud.v1";

export interface Session {
  access: string;
  refresh: string;
  /** epoch seconds */
  expiresAt: number;
  userId: string;
  email: string;
}

let session: Session | undefined = (() => {
  try {
    return (JSON.parse(localStorage.getItem(STORE) ?? "null") as Session | null) ?? undefined;
  } catch {
    return undefined;
  }
})();
function keep(s: Session | undefined): void {
  session = s;
  try {
    if (s) localStorage.setItem(STORE, JSON.stringify(s));
    else localStorage.removeItem(STORE);
  } catch {
    /* private mode: signed in for this page only */
  }
}
export const currentUser = (): { email: string } | undefined => (session ? { email: session.email } : undefined);

interface AuthReply {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  user?: { id: string; email?: string; confirmed_at?: string | null; email_confirmed_at?: string | null };
  error_description?: string;
  msg?: string;
  message?: string;
  error?: string;
}
const authErr = (j: AuthReply, status: number) => j.error_description || j.msg || j.message || j.error || `HTTP ${status}`;

async function auth(path: string, body: unknown, bearer?: string): Promise<AuthReply> {
  const r = await fetch(`${SUPABASE_URL}/auth/v1/${path}`, {
    method: "POST",
    headers: { apikey: KEY, "content-type": "application/json", ...(bearer ? { authorization: `Bearer ${bearer}` } : {}) },
    body: JSON.stringify(body),
  });
  const j = (await r.json().catch(() => ({}))) as AuthReply;
  if (!r.ok) throw new Error(authErr(j, r.status));
  return j;
}
function fromReply(j: AuthReply, email: string): Session {
  return {
    access: j.access_token!,
    refresh: j.refresh_token!,
    expiresAt: Math.floor(Date.now() / 1000) + (j.expires_in ?? 3600),
    userId: j.user!.id,
    email: j.user?.email ?? email,
  };
}

/** create the account; returns "confirm" when Supabase sent a confirmation email. */
export async function signUp(email: string, password: string): Promise<"signed-in" | "confirm"> {
  const j = await auth("signup", { email, password });
  if (j.access_token) {
    keep(fromReply(j, email));
    return "signed-in";
  }
  return "confirm";
}
export async function signIn(email: string, password: string): Promise<void> {
  keep(fromReply(await auth("token?grant_type=password", { email, password }), email));
}
export async function signOut(): Promise<void> {
  const s = session;
  keep(undefined);
  if (s) await auth("logout", {}, s.access).catch(() => undefined);
}
export async function resetPassword(email: string): Promise<void> {
  await auth("recover", { email });
}

/** a valid access token, refreshed when it is about to expire; undefined = signed out. */
async function token(): Promise<string | undefined> {
  if (!session) return undefined;
  if (session.expiresAt - 60 > Date.now() / 1000) return session.access;
  try {
    keep(fromReply(await auth("token?grant_type=refresh_token", { refresh_token: session.refresh }), session.email));
    return session!.access;
  } catch {
    keep(undefined); // refresh token revoked or expired: sign in again
    return undefined;
  }
}

/** the account's saved progress (undefined = none yet). */
export async function pullProgress(): Promise<ProgressData | undefined> {
  const t = await token();
  if (!t) throw new Error("signed out");
  const r = await fetch(`${SUPABASE_URL}/rest/v1/school_progress?select=data&user_id=eq.${session!.userId}`, {
    headers: { apikey: KEY, authorization: `Bearer ${t}` },
  });
  if (!r.ok) throw new Error(`sync: HTTP ${r.status}`);
  const rows = (await r.json()) as Array<{ data: ProgressData }>;
  return rows[0]?.data;
}
export async function pushProgress(data: ProgressData): Promise<void> {
  const t = await token();
  if (!t) throw new Error("signed out");
  const r = await fetch(`${SUPABASE_URL}/rest/v1/school_progress?on_conflict=user_id`, {
    method: "POST",
    headers: { apikey: KEY, authorization: `Bearer ${t}`, "content-type": "application/json", prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify({ user_id: session!.userId, data, updated_at: new Date().toISOString() }),
  });
  if (!r.ok) throw new Error(`sync: HTTP ${r.status} ${(await r.text()).slice(0, 120)}`);
}
