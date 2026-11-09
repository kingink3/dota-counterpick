// =============================================================================
//  Matches fetched by the "Review a match" workflow (ADR-031): encrypted files on
//  the public `review-data` branch, opened in the browser with the site key the
//  unlock screen derived (window.__DOTA_KEY). No STRATZ call from the page.
// =============================================================================

import type { ReplayTimeline } from "../replay.js";
import type { StratzHealth, StratzMe, StratzPositions, StratzSummary, StratzVision } from "../review.js";

export interface StoreEntry {
  file: string;
  id: number;
  at: number;
  start?: number;
  duration?: number;
  radiantWin?: boolean;
  heroes: number[];
  owner?: number | null;
  mode?: string;
}

export interface StoredMatch {
  id: number;
  owner?: number | null;
  fetchedAt: number;
  summary: StratzSummary;
  positions?: StratzPositions;
  health?: StratzHealth;
  vision?: StratzVision;
  /** Steam account id -> that player's events. */
  players: Record<string, StratzMe>;
  /** per-second timeline from the .dem (ADR-045), when the replay was parsed. */
  replay?: ReplayTimeline;
  /** where the players' events came from (ADR-053); older matches: STRATZ. */
  source?: "replay" | "stratz";
}

/** owner/repo of this site: kingink3.github.io/dota-counterpick -> kingink3/dota-counterpick. */
export function repoOf(loc: { hostname: string; pathname: string } = location): string {
  const m = /^([^.]+)\.github\.io$/.exec(loc.hostname);
  const repo = loc.pathname.split("/").filter(Boolean)[0];
  return m && repo ? `${m[1]}/${repo}` : "kingink3/dota-counterpick";
}

export function workflowUrl(): string {
  return `https://github.com/${repoOf()}/actions/workflows/review-match.yml`;
}

function key(): CryptoKey | undefined {
  return (window as unknown as { __DOTA_KEY?: CryptoKey }).__DOTA_KEY;
}

/** the store needs the published site (its password key); a local build has none. */
export function storeAvailable(): boolean {
  return !!key();
}

async function open<T>(file: string): Promise<T> {
  const k = key();
  if (!k) throw new Error("Only in the published site: it needs the site password");
  const r = await fetch(`https://raw.githubusercontent.com/${repoOf()}/review-data/${file}?t=${Date.now()}`, { cache: "no-store" });
  if (r.status === 404) throw new Error(file === "index.bin" ? "Nothing fetched yet: run \"Review a match\" on GitHub" : "This match is no longer in the store");
  if (!r.ok) throw new Error(`GitHub: HTTP ${r.status}`);
  const buf = new Uint8Array(await r.arrayBuffer());
  let plain: ArrayBuffer;
  try {
    plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: buf.slice(0, 12) }, k, buf.slice(12));
  } catch {
    throw new Error("Could not decrypt: the store was written with another site password");
  }
  const text = await new Response(new Blob([plain]).stream().pipeThrough(new DecompressionStream("gzip"))).text();
  return JSON.parse(text) as T;
}

/** the token owner's last matches (ADR-042), refreshed by every workflow run. */
export interface RecentList {
  owner: number;
  fetchedAt: number;
  matches: Array<{
    id: number;
    startDateTime?: number;
    durationSeconds?: number;
    gameMode?: string;
    lobbyType?: string;
    didRadiantWin?: boolean;
    parsedDateTime?: number | null;
    players?: Array<{ heroId: number; isVictory: boolean; position?: string; kills: number; deaths: number; assists: number }>;
  }>;
}

/** undefined when no run has written the list yet. */
export const loadRecent = (): Promise<RecentList | undefined> =>
  open<RecentList>("recent.bin").catch((e: Error) => {
    if (/no longer in the store/.test(e.message)) return undefined;
    throw e;
  });
// ---- starting the workflow from the page (ADR-044) ---------------------------------

function dispatchToken(): string | undefined {
  return (window as unknown as { __DOTA_BUNDLE?: { dispatch?: string } }).__DOTA_BUNDLE?.dispatch;
}

/** the site can start "Review a match" itself (the build had DISPATCH_TOKEN). */
export function canDispatch(): boolean {
  return !!dispatchToken();
}

const API = "https://api.github.com";
async function gh(path: string, init: RequestInit = {}): Promise<Response> {
  const t = dispatchToken();
  if (!t) throw new Error("This build cannot start the workflow (no DISPATCH_TOKEN secret)");
  const r = await fetch(`${API}/repos/${repoOf()}${path}`, {
    ...init,
    headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${t}`, "X-GitHub-Api-Version": "2022-11-28", ...(init.headers ?? {}) },
  });
  if (r.status === 401) throw new Error("GitHub refused the token: it expired or was revoked - create a new one (README, ADR-044)");
  if (r.status === 403 || r.status === 404) throw new Error(`GitHub: the token cannot run workflows here (HTTP ${r.status}) - it needs Actions: read and write on this repository`);
  return r;
}

/** start "Review a match": a match id, the latest (no id), or only the list. */
export async function dispatchReview(opts: { matchId?: number; listOnly?: boolean } = {}): Promise<void> {
  const inputs: Record<string, string> = {};
  if (opts.matchId) inputs.match_id = String(opts.matchId);
  if (opts.listOnly) inputs.list_only = "true";
  const r = await gh("/actions/workflows/review-match.yml/dispatches", { method: "POST", body: JSON.stringify({ ref: "main", inputs }) });
  if (r.status !== 204) throw new Error(`GitHub: HTTP ${r.status} ${(await r.text()).slice(0, 120)}`);
}

export interface RunState {
  status: "queued" | "in_progress" | "completed" | string;
  conclusion?: string | null;
  created: number;
}

/** the newest runs of "Review a match" (status only). */
export async function reviewRuns(n = 3): Promise<RunState[]> {
  const r = await gh(`/actions/workflows/review-match.yml/runs?per_page=${n}`);
  if (!r.ok) return [];
  const j = (await r.json()) as { workflow_runs: Array<{ status: string; conclusion: string | null; created_at: string }> };
  return j.workflow_runs.map((w) => ({ status: w.status, conclusion: w.conclusion, created: Date.parse(w.created_at) / 1000 }));
}

export const loadIndex = (): Promise<StoreEntry[]> => open<StoreEntry[]>("index.bin");
export const loadMatch = (e: StoreEntry): Promise<StoredMatch> => open<StoredMatch>(e.file);
