// =============================================================================
//  STRATZ access from the page for the match review (ADR-029). The token and the
//  review history stay in this browser (localStorage) - nothing personal goes to the
//  repository. The page cannot call STRATZ itself: a request needs an Authorization
//  header (or another custom header when the token is in the URL), that makes the
//  browser send a CORS preflight, and STRATZ's Cloudflare answers the preflight 403
//  (checked 2026-11-04). So `npm run companion` on this PC forwards the queries.
// =============================================================================

import {
  ME_PARTS,
  matchMeQuery,
  matchHealthQuery,
  matchPositionsQuery,
  matchSummaryQuery,
  recentMatchesQuery,
} from "../stratz-queries.js";
import type { MatchData, MatchReview, StratzHealth, StratzMe, StratzPositions, StratzSummary } from "../review.js";

const KEY = "dotaapp.stratz.v1";
const HISTORY = "dotaapp.reviews.v1";
const HISTORY_MAX = 40;
export const COMPANION = "http://127.0.0.1:5174";

export interface StratzSettings {
  token?: string;
  account?: number;
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

/** the companion serves the app too: same origin when the page comes from it. */
function companionBase(): string {
  return typeof location !== "undefined" && location.origin === COMPANION ? "" : COMPANION;
}

async function viaCompanion(query: string, token: string | undefined): Promise<unknown> {
  let r: Response;
  try {
    r = await fetch(`${companionBase()}/stratz`, {
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
    return (await viaCompanion(query, this.s.token)) as T;
  }

  recent(take = 20): Promise<RecentMatch[]> {
    const acc = this.s.account!;
    return this.q<{ player: { matches: RecentMatch[] } }>(recentMatchesQuery(acc, take)).then((d) => d.player?.matches ?? []);
  }

  /** what every player's review shares: summary, positions and HP of all ten (3 requests). */
  async base(id: number): Promise<MatchBase> {
    const sum = await this.q<{ match: StratzSummary }>(matchSummaryQuery(id));
    if (!sum.match) throw new StratzError(`match ${id} not found`, "query");
    let positions: StratzPositions | undefined;
    try {
      positions = (await this.q<{ match: StratzPositions }>(matchPositionsQuery(id))).match;
    } catch {
      positions = undefined; // the "alone" / battle checks are reduced
    }
    let health: StratzHealth | undefined;
    try {
      health = (await this.q<{ match: StratzHealth }>(matchHealthQuery(id))).match;
    } catch {
      health = undefined; // saves on allied cores are not judged
    }
    return { summary: sum.match, ...(positions ? { positions } : {}), ...(health ? { health } : {}) };
  }

  /** one player's events, in 4 parts (STRATZ's complexity limit). Needs an open profile. */
  async player(id: number, account: number): Promise<StratzMe> {
    const me: StratzMe = { playerSlot: -1, heroId: 0, isRadiant: true, playbackData: {} };
    for (const part of Object.keys(ME_PARTS) as Array<keyof typeof ME_PARTS>) {
      const r = await this.q<{ match: { players: StratzMe[] } }>(matchMeQuery(id, account, part));
      const p = r.match?.players?.[0];
      if (!p) throw new StratzError("this player is not in the match (or it is not parsed yet)", "query");
      const { playbackData, ...rest } = p;
      Object.assign(me, rest);
      if (playbackData) Object.assign(me.playbackData!, playbackData);
    }
    if (!me.playbackData?.deathEvents && !me.playbackData?.inventoryEvents) {
      throw new StratzError("STRATZ has no event data for this player (private profile, old match or not parsed yet)", "query");
    }
    return me;
  }

  /** a match for one player: base + that player (7 requests). */
  async match(id: number, account = this.s.account!): Promise<MatchData> {
    const b = await this.base(id);
    return { ...b, me: await this.player(id, account) };
  }
}

export type MatchBase = Omit<MatchData, "me">;

/** players whose events STRATZ gives out: an id and "Expose Public Match Data" on. */
export function openPlayer(p: { steamAccountId?: number | null; steamAccount?: { isAnonymous?: boolean | null } | null }): boolean {
  return !!p.steamAccountId && !p.steamAccount?.isAnonymous;
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
  const rest = loadHistory().filter((x) => !(x.matchId === r.matchId && (x.account ?? r.account) === r.account));
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
