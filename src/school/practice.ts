// =============================================================================
//  Practice goals (ADR-046): checked on your own reviewed matches. A goal is met
//  when `need` of your last `of` reviewed matches in a fitting position meet it.
//  Thresholds are expert values for the Foundations module, not calibrated.
//  Pure: the caller passes the reviews (newest first).
// =============================================================================

import type { MatchReview } from "../review.js";
import type { GoalId, PracticeGoal } from "./types.js";

export interface GoalCheck {
  /** null = no data in that match for this goal. */
  per: Array<{ matchId: number; ok: boolean | null; value: string }>;
  met: number;
  counted: number;
  done: boolean;
}

/** one match against one goal: ok, and the value shown. */
export function checkMatch(id: GoalId, r: MatchReview): { ok: boolean | null; value: string } {
  switch (id) {
    case "deaths":
      return { ok: r.kda[1] <= 5, value: `${r.kda[1]} deaths` };
    case "cs10": {
      const row = r.farm.find((f) => f.minute === 10);
      if (!r.comparable || row?.cs === undefined || row.csBench === undefined) return { ok: null, value: "no 10:00 benchmark" };
      return { ok: row.cs >= row.csBench, value: `${row.cs} vs ${Math.round(row.csBench)} last hits` };
    }
    case "idle": {
      const i = r.idle;
      if (!i) return { ok: null, value: "no positions" };
      const min = i.seconds !== undefined ? i.seconds / 60 : i.minutes.length;
      return { ok: min < 2, value: `${min.toFixed(1)} idle min` };
    }
    case "observers":
      return r.vision ? { ok: r.vision.observers >= 8, value: `${r.vision.observers} observers` } : { ok: null, value: "no ward data" };
    case "stacks":
      return r.vision ? { ok: r.vision.stacks >= 3, value: `${r.vision.stacks} stacks` } : { ok: null, value: "no stack data" };
    case "kp":
      return r.kp !== undefined ? { ok: r.kp >= 0.5, value: `${Math.round(r.kp * 100)}% of kills` } : { ok: null, value: "too few kills" };
  }
}

export function checkGoal(g: PracticeGoal, reviews: MatchReview[]): GoalCheck {
  const fit = reviews.filter((r) => !g.roles || (r.position !== undefined && g.roles.includes(r.position)));
  const per: GoalCheck["per"] = [];
  for (const r of fit) {
    const c = checkMatch(g.id, r);
    if (c.ok === null) continue;
    per.push({ matchId: r.matchId, ...c });
    if (per.length >= g.of) break;
  }
  const met = per.filter((p) => p.ok).length;
  return { per, met, counted: per.length, done: met >= g.need };
}
