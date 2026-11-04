// =============================================================================
//  STRATZ access from the page for the match review (ADR-029). The token and the
//  review history stay in this browser (localStorage) - nothing personal goes to the
//  repository. Two transports:
//    direct     the page calls STRATZ (only if STRATZ accepts a request without a CORS
//               preflight - see DIRECT below)
//    companion  `npm run companion` on this PC forwards the query (always works)
// =============================================================================

import {
  matchMeQuery,
  matchPositionsQuery,
  matchSummaryQuery,
  recentMatchesQuery,
} from "../stratz-queries.js";
import type { MatchData, MatchReview, StratzMe, StratzPositions, StratzSummary } from "../review.js";

const KEY = "dotaapp.stratz.v1";
const HISTORY = "dotaapp.reviews.v1";
const HISTORY_MAX = 40;
export const COMPANION = "http://127.0.0.1:5174";

export interface StratzSettings {
  token?: string;
  account?: number;
  transport?: "direct" | "companion";
}

export function loadSettings(): StratzSettings {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "{}") as StratzSettings;
  } catch {
    return {};
  }
}
export function saveSettings(s: StratzSettings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* private mode: settings live for this page only */
  }
}

/** the Steam account id STRATZ put in the token (its "SteamId" claim). */
export function accountFromToken(token: string): number | undefined {
  try {
    const part = token.split(".")[1];
    if (!part) return undefined;
    const json = JSON.parse(atob(part.replace(/-/g, "+").replace(/_/g, "/"))) as { SteamId?: string };
    const n = Number(json.SteamId);
    return Number.isFinite(n) && n > 0 ? n : undefined;
  } catch {
    return undefined;
  }
}

export class StratzError extends Error {
  constructor(
    message: string,
    readonly kind: "network" | "auth" | "limit" | "query",
  ) {
    super(message);
  }
}

/** Direct call without a preflight: a GET with the query and the token in the URL
 *  (no custom headers -> a "simple" CORS request). */
async function direct(query: string, token: string): Promise<unknown> {
  const url = `https://api.stratz.com/graphql?query=${encodeURIComponent(query)}&jwt=${encodeURIComponent(token)}`;
  let r: Response;
  try {
    r = await fetch(url, { method: "GET", credentials: "omit" });
  } catch {
    throw new StratzError("STRATZ did not answer the page (browser / CORS)", "network");
  }
  return parse(r);
}

async function viaCompanion(query: string, token: string | undefined): Promise<unknown> {
  let r: Response;
  try {
    r = await fetch(`${COMPANION}/stratz`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(token ? { "x-stratz-token": token } : {}) },
      body: JSON.stringify({ query }),
    });
  } catch {
    throw new StratzError("the local companion is not running (npm run companion)", "network");
  }
  return parse(r);
}

async function parse(r: Response): Promise<unknown> {
  const text = await r.text();
  if (r.status === 401 || r.status === 403) throw new StratzError(text.slice(0, 200) || "STRATZ refused the token", "auth");
  if (r.status === 429) throw new StratzError("STRATZ rate limit - try again in a minute", "limit");
  let body: { data?: unknown; errors?: Array<{ message: string }> };
  try {
    body = JSON.parse(text);
  } catch {
    throw new StratzError(`STRATZ: ${text.slice(0, 160)}`, "query");
  }
  if (!r.ok || (body.errors?.length && !body.data)) throw new StratzError(body.errors?.map((e) => e.message).join("; ") ?? `HTTP ${r.status}`, "query");
  return body.data;
}

export class StratzClient {
  constructor(private readonly s: StratzSettings) {}

  async q<T>(query: string): Promise<T> {
    const token = this.s.token;
    if (this.s.transport === "companion") return (await viaCompanion(query, token)) as T;
    if (!token) throw new StratzError("paste your STRATZ token first", "auth");
    try {
      return (await direct(query, token)) as T;
    } catch (e) {
      // the page could not reach STRATZ itself: fall back to the companion
      if (e instanceof StratzError && e.kind === "network") return (await viaCompanion(query, token)) as T;
      throw e;
    }
  }

  recent(take = 20): Promise<RecentMatch[]> {
    const acc = this.s.account!;
    return this.q<{ player: { matches: RecentMatch[] } }>(recentMatchesQuery(acc, take)).then((d) => d.player?.matches ?? []);
  }

  /** a match in parts (STRATZ's complexity limit); positions are optional. */
  async match(id: number): Promise<MatchData> {
    const acc = this.s.account!;
    const sum = await this.q<{ match: StratzSummary }>(matchSummaryQuery(id));
    const me = await this.q<{ match: { players: StratzMe[] } }>(matchMeQuery(id, acc));
    const mine = me.match?.players?.[0];
    if (!sum.match || !mine) throw new StratzError("match not found or not parsed by STRATZ yet", "query");
    let positions: StratzPositions | undefined;
    try {
      positions = (await this.q<{ match: StratzPositions }>(matchPositionsQuery(id))).match;
    } catch {
      positions = undefined; // the "alone" check is skipped
    }
    return { summary: sum.match, me: mine, ...(positions ? { positions } : {}) };
  }
}

export interface RecentMatch {
  id: number;
  startDateTime?: number;
  durationSeconds?: number;
  gameMode?: string;
  lobbyType?: string;
  didRadiantWin?: boolean;
  parsedDateTime?: number | null;
  players?: Array<{ heroId: number; isVictory: boolean; position?: string; kills: number; deaths: number; assists: number }>;
}

// ------------------------------------------------------------- history ----

export function loadHistory(): MatchReview[] {
  try {
    return JSON.parse(localStorage.getItem(HISTORY) ?? "[]") as MatchReview[];
  } catch {
    return [];
  }
}
export function saveReview(r: MatchReview): MatchReview[] {
  const rest = loadHistory().filter((x) => x.matchId !== r.matchId);
  // keep the plan out of storage: it is rebuilt on demand and is the bulk of a review
  const { plan: _plan, ...slim } = r;
  const all = [slim as MatchReview, ...rest].sort((a, b) => (b.at ?? 0) - (a.at ?? 0)).slice(0, HISTORY_MAX);
  try {
    localStorage.setItem(HISTORY, JSON.stringify(all));
  } catch {
    /* storage full / blocked: the review is shown but not kept */
  }
  return all;
}
