// =============================================================================
//  Review data kept in this browser (ADR-029, ADR-034): who "you" are and the
//  reviews already computed. Matches themselves come only from the encrypted
//  GitHub store (ADR-031); the page never talks to STRATZ and holds no token.
// =============================================================================

import type { MatchData, MatchReview } from "../review.js";

const KEY = "dotaapp.stratz.v1";
const HISTORY = "dotaapp.reviews.v1";
const HISTORY_MAX = 40;

export interface ReviewSettings {
  account?: number;
}

/** reads the settings; a STRATZ token left by an older build is dropped from storage. */
export function loadSettings(): ReviewSettings {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "{}") as { account?: number; token?: string };
    const s: ReviewSettings = raw.account ? { account: raw.account } : {};
    if (raw.token !== undefined) saveSettings(s);
    return s;
  } catch {
    return {};
  }
}
export function saveSettings(s: ReviewSettings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* private mode: settings live for this page only */
  }
}

export type MatchBase = Omit<MatchData, "me">;

export { openPlayer } from "../review.js";

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
