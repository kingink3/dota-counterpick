// =============================================================================
//  In-game coach (ADR-030): short English voice cues / chimes and a two-line
//  overlay, so nothing has to be read during a fight. Pure: game time + the
//  timers + the item plan + the power window -> the cues due now.
//
//  Rules (a voice that talks too much gets muted):
//    - one cue per event occurrence, said once when its lead time starts;
//      a cue that is no longer fresh (the clock jumped, the app opened late) is dropped;
//    - phrases are a few words ("Power rune in 15");
//    - routine, frequent events (stacks) default to a chime, not a voice;
//    - categories are on / chime / off per role (defaults below), user-editable.
// =============================================================================

import type { ItemPlan, PlanItem, TeamWindow } from "./item-plan.js";
import type { Upcoming } from "./game-timers.js";

export type CueCat = "runes" | "stacks" | "pulls" | "jungle" | "objectives" | "neutrals" | "items" | "windows" | "daynight";
export type CueMode = "voice" | "chime" | "off";

export const CUE_CATS: Array<{ id: CueCat; label: string; hint: string }> = [
  { id: "runes", label: "Runes", hint: "bounty, water, power runes" },
  { id: "stacks", label: "Stacks", hint: "every minute at :45 (stack at :53-:55)" },
  { id: "pulls", label: "Pulls", hint: "lane pulls every 30 s" },
  { id: "jungle", label: "Shrines & lotus", hint: "wisdom shrines, healing lotus" },
  { id: "objectives", label: "Tormentor", hint: "first spawn at 20:00, a minute ahead" },
  { id: "neutrals", label: "Neutral items", hint: "next tier" },
  { id: "items", label: "Item targets", hint: "next item of the plan and its typical time; late warning (off by default)" },
  { id: "windows", label: "Power windows", hint: "who is stronger now: take or avoid fights" },
  { id: "daynight", label: "Day / night", hint: "for night heroes" },
];

const CAT_OF: Record<string, CueCat> = {
  bounty_rune: "runes",
  water_rune: "runes",
  power_rune: "runes",
  stack: "stacks",
  pull: "pulls",
  wisdom_shrine: "jungle",
  lotus: "jungle",
  tormentor: "objectives",
  neutral_tier: "neutrals",
  night: "daynight",
  day: "daynight",
};

/** what to say for an event (the timers' labels are written to be read, not heard). */
const SAY: Record<string, string> = {
  bounty_rune: "Bounty runes",
  water_rune: "Water rune",
  power_rune: "Power rune",
  stack: "Stack",
  pull: "Pull",
  wisdom_shrine: "Wisdom shrine",
  lotus: "Lotus",
  tormentor: "Tormentor spawns",
  night: "Night",
  day: "Day",
};

/** short names for the overlay line. */
const SHORT: Record<string, string> = {
  bounty_rune: "Bounty",
  water_rune: "Water",
  power_rune: "Power rune",
  stack: "Stack",
  pull: "Pull",
  wisdom_shrine: "Shrine",
  lotus: "Lotus",
  tormentor: "Tormentor",
  neutral_tier: "Neutrals",
  night: "Night",
  day: "Day",
};

/** defaults: what each position cares about; stacks and pulls are chimes (frequent). */
export function defaultModes(role: number | undefined): Record<CueCat, CueMode> {
  const support = role === 4 || role === 5;
  return {
    runes: "voice",
    stacks: support ? "chime" : "off",
    pulls: "off",
    jungle: "voice",
    objectives: "voice",
    neutrals: "voice",
    items: "off",
    windows: "voice",
    daynight: "off",
  };
}

export interface Cue {
  key: string;
  cat: CueCat;
  mode: Exclude<CueMode, "off">;
  text: string;
  /** game second it is meant for; the speaker drops it when it is too old. */
  at: number;
  /** seconds after `at` it is still worth saying. */
  ttl: number;
  /** higher first when several are due together. */
  priority: number;
}

export interface CoachInput {
  t: number;
  events: Upcoming[];
  modes: Record<CueCat, CueMode>;
  plan?: ItemPlan;
  have?: Set<string>;
  window?: TeamWindow;
}

const PRIORITY: Record<CueCat, number> = { windows: 6, objectives: 5, items: 4, runes: 3, neutrals: 3, jungle: 2, stacks: 2, pulls: 1, daynight: 1 };
/** a lead crossing older than this is not said (the clock jumped / the app started late). */
const FRESH = 4;
/** power-window bins (minutes) - the same as the Game tab's line. */
const BIN_EDGES = [25, 35, 45];

export function spokenIn(sec: number): string {
  const s = Math.max(1, Math.round(sec));
  if (s >= 55 && s <= 65) return "in one minute";
  if (s > 65) return `in ${Math.round(s / 60)} minutes`;
  return `in ${s > 20 ? Math.round(s / 5) * 5 : s}`;
}

/** the plan item you are working towards (same rule as the Game tab's "Item target"). */
export function currentTarget(plan: ItemPlan | undefined, have: Set<string> | undefined, t: number): PlanItem | undefined {
  if (!plan) return undefined;
  const seq = ["lane", "core", "late"].flatMap((id) => plan.phases.find((x) => x.id === id)?.items ?? []);
  const i = have?.size ? seq.findIndex((x) => !have.has(x.key)) : seq.findIndex((x) => x.at === undefined || x.at >= t - 120);
  return seq[i >= 0 ? i : seq.length - 1];
}

function windowBin(t: number): number {
  const m = t / 60;
  return m < 25 ? 0 : m < 35 ? 1 : m < 45 ? 2 : 3;
}

function windowText(d: number, bin: number): string {
  const until = BIN_EDGES[bin];
  const u = until ? ` until ${until}` : "";
  if (d > 0.5) return `Your power window${u}. Take fights.`;
  if (d < -0.5) return `Their power window${u}. Avoid even fights.`;
  return `Even game${u}.`;
}

export class Coach {
  private said = new Set<string>();
  private last?: number;

  reset(): void {
    this.said.clear();
    this.last = undefined;
  }

  /** cues that became due since the last tick. Call it often (every 250 ms). */
  tick(x: CoachInput): Cue[] {
    const { t } = x;
    // a jump back (a new game, a fixed clock) forgets what was said
    if (this.last !== undefined && t < this.last - 30) this.said.clear();
    this.last = t;
    const out: Cue[] = [];
    const push = (c: Omit<Cue, "mode" | "priority">) => {
      const mode = x.modes[c.cat];
      if (mode === "off" || this.said.has(c.key)) return;
      this.said.add(c.key);
      out.push({ ...c, mode, priority: PRIORITY[c.cat] });
    };

    // map events: once, when the lead time starts
    for (const e of x.events) {
      const cat = CAT_OF[e.id];
      if (!cat || e.state !== "soon") continue;
      const lead = Math.ceil(e.in);
      // fresh only: the lead started less than FRESH seconds ago
      if (e.lead - e.in > FRESH) continue;
      const name = SAY[e.id] ?? e.label; // neutral tiers carry their own names ("Tier 2 neutrals")
      push({ key: `${e.id}@${e.at}`, cat, text: `${name} ${spokenIn(lead)}`, at: t, ttl: 3 });
    }

    // power windows: at 0:30 (the start) and at each bin edge
    if (x.window && t >= 30) {
      const bin = windowBin(t);
      const edge = bin === 0 ? 30 : BIN_EDGES[bin - 1]! * 60;
      if (t - edge <= FRESH * 2) push({ key: `window@${bin}`, cat: "windows", text: windowText(x.window.diff[bin]!, bin), at: t, ttl: 10 });
    }

    // item target: 90 s before its typical time; late once past "slow after"
    const cur = currentTarget(x.plan, x.have, t);
    if (cur?.at !== undefined && t > 60) {
      const before = cur.at - 90;
      if (t >= before && t - before <= FRESH) push({ key: `item@${cur.key}`, cat: "items", text: `Next item: ${cur.label}, typical ${clock(cur.at)}`, at: t, ttl: 15 });
      const late = cur.timing?.slowAfter ?? cur.at + 180;
      if (x.have?.size && t >= late && t - late <= FRESH) push({ key: `late@${cur.key}`, cat: "items", text: `${cur.label} is running late`, at: t, ttl: 15 });
    }
    return out.sort((a, b) => b.priority - a.priority);
  }
}

function clock(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** the overlay: two short lines. */
export function overlayLines(x: Omit<CoachInput, "modes"> & { modes: Record<CueCat, CueMode> }): [string, string] {
  const ev = x.events
    .filter((e) => {
      const cat = CAT_OF[e.id];
      return cat && x.modes[cat] !== "off" && e.in > -3;
    })
    .slice(0, 2)
    .map((e) => `${SHORT[e.id] ?? e.label} ${e.in > 0 ? clock(Math.ceil(e.in)) : "now"}`);
  const cur = x.modes.items !== "off" ? currentTarget(x.plan, x.have, x.t) : undefined;
  const parts: string[] = [];
  if (cur) parts.push(`${cur.label}${cur.at !== undefined ? ` ~${clock(cur.at)}` : ""}`);
  if (x.window && x.t >= 0) {
    const d = x.window.diff[windowBin(x.t)]!;
    parts.push(d > 0.5 ? "your window" : d < -0.5 ? "their window" : "even");
  }
  return [ev.join(" · ") || "-", parts.join(" · ") || "-"];
}
