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

/** default thresholds; a goal can set its own `target`. */
export const GOAL_DEFAULT: Record<GoalId, number> = {
  deaths: 5, // at most
  cs10: 1, // x the ranked average
  nw20: 1, // x the ranked average
  xp10: 1, // x the ranked average
  idle: 2, // minutes, under
  observers: 8,
  stacks: 3,
  dewards: 2,
  kp: 0.5,
  answers: 0, // "missing / late answer" problems allowed
};

/** one match against one goal: ok, and the value shown. */
export function checkMatch(id: GoalId, r: MatchReview, target = GOAL_DEFAULT[id]): { ok: boolean | null; value: string } {
  const bench = (minute: number, f: "cs" | "nw" | "xp", unit: string) => {
    const row = r.farm.find((x) => x.minute === minute);
    const v = row?.[f];
    const b = row?.[`${f}Bench` as "csBench" | "nwBench" | "xpBench"];
    if (!r.comparable || v === undefined || b === undefined) return { ok: null, value: `no ${minute}:00 benchmark` };
    return { ok: v >= b * target, value: `${Math.round(v)} vs ${Math.round(b * target)} ${unit}` };
  };
  switch (id) {
    case "deaths":
      return { ok: r.kda[1] <= target, value: `${r.kda[1]} deaths` };
    case "cs10":
      return bench(10, "cs", "last hits");
    case "nw20":
      return bench(20, "nw", "net worth");
    case "xp10":
      return bench(10, "xp", "XP");
    case "idle": {
      const i = r.idle;
      if (!i) return { ok: null, value: "no positions" };
      const min = i.seconds !== undefined ? i.seconds / 60 : i.minutes.length;
      return { ok: min < target, value: `${min.toFixed(1)} idle min` };
    }
    case "observers":
      return r.vision ? { ok: r.vision.observers >= target, value: `${r.vision.observers} observers` } : { ok: null, value: "no ward data" };
    case "stacks":
      return r.vision ? { ok: r.vision.stacks >= target, value: `${r.vision.stacks} stacks` } : { ok: null, value: "no stack data" };
    case "dewards":
      return r.vision ? { ok: r.vision.dewards >= target, value: `${r.vision.dewards} wards destroyed` } : { ok: null, value: "no ward data" };
    case "answers": {
      // ADR-029g: a missing or late answer counts only when it answers the real killers
      const n = r.findings.filter((f) => (f.id === "counter_missing" || f.id === "counter_late") && !f.good && !f.note).length;
      return { ok: n <= target, value: n ? `${n} missing / late answer${n > 1 ? "s" : ""}` : "answers bought" };
    }
    case "kp":
      return r.kp !== undefined ? { ok: r.kp >= target, value: `${Math.round(r.kp * 100)}% of kills` } : { ok: null, value: "too few kills" };
  }
}

export function checkGoal(g: PracticeGoal, reviews: MatchReview[]): GoalCheck {
  const fit = reviews.filter((r) => !g.roles || (r.position !== undefined && g.roles.includes(r.position)));
  const per: GoalCheck["per"] = [];
  for (const r of fit) {
    const c = checkMatch(g.id, r, g.target ?? GOAL_DEFAULT[g.id]);
    if (c.ok === null) continue;
    per.push({ matchId: r.matchId, ...c });
    if (per.length >= g.of) break;
  }
  const met = per.filter((p) => p.ok).length;
  return { per, met, counted: per.length, done: met >= g.need };
}
