// =============================================================================
//  Item plan + power spikes for the hero you play (ADR-026 phases 2-3). Pure.
//
//  Two layers, kept apart on purpose:
//    - what the hero usually buys and when: OpenDota statistics, compacted into
//      data/item-stats.json by scripts/build-item-stats.ts (phases, purchase
//      timings, win rate by match length);
//    - what THIS enemy draft calls for: the engine's counter / defensive items
//      (ADR-024), each with its reasons.
//  Ordering rules make the plan sane: the start and the lane phase are always the
//  hero's standard items; a counter item enters the lane only when it is cheap,
//  otherwise it goes after the first core item (or upgrades a core item that is
//  already standard, which then carries the "vs X" reason).
// =============================================================================

import type { Archetype, Recommendation } from "./types.js";

export type Phase = "start" | "early" | "mid" | "late";

export interface ItemTiming {
  /** purchase time quartiles, game seconds. */
  p25: number;
  p50: number;
  p75: number;
  games: number;
  /** win rate when bought by `fastBy` / after `slowAfter` (the cost of being late);
   *  bucket edges holding >= 15% of the games on each side. */
  fastBy?: number;
  wrFast?: number;
  slowAfter?: number;
  wrSlow?: number;
}

export interface HeroStats {
  /** item -> share of the most bought item of that phase (0..1). */
  phases: Partial<Record<Phase, Array<[string, number]>>>;
  timing?: Record<string, ItemTiming>;
  /** win rate by match length: [minute bin start, win rate, games]. */
  curve?: Array<[number, number, number]>;
}

export interface ItemInfo {
  cost: number;
  qual?: string;
  /** what this item is built from (built items only). */
  components?: string[];
  label?: string;
}

export interface ItemStats {
  source: string;
  fetchedAt?: string;
  /** what the per-phase lists come from (e.g. professional matches). */
  phasesFrom?: string;
  timingsFrom?: string;
  curveFrom?: string;
  items: Record<string, ItemInfo>;
  heroes: Record<string, HeroStats>;
}

export interface PlanItem {
  /** dotaconstants item key (icons in web/items use it too). */
  key: string;
  label: string;
  cost: number;
  /** typical purchase time for this hero, seconds. */
  at?: number;
  timing?: ItemTiming;
  /** "standard" = what the hero usually buys; "counter" = for this draft;
   *  "both" = standard AND called for by this draft. */
  kind: "standard" | "counter" | "both";
  /** engine recommendation behind a counter / both item. */
  counter?: Recommendation;
  /** where a counter item goes, in words. */
  place?: string;
}

export interface PlanPhase {
  id: "start" | "lane" | "core" | "situational" | "late";
  label: string;
  items: PlanItem[];
}

export interface Spike {
  at: number;
  label: string;
  why: string;
}

export interface ItemPlan {
  hero: string;
  archetype?: Archetype;
  phases: PlanPhase[];
  spikes: Spike[];
}

/** starting gold (7.41). */
export const START_GOLD = 600;
/** a counter this cheap can be bought during the lane. */
export const CHEAP_COUNTER = 1000;
/** core items: built items at least this expensive. */
const CORE_MIN = 1500;
const LATE_MIN = 2500;
/** components worth buying on their own in the lane. */
const STANDALONE = new Set([
  "boots", "magic_stick", "blight_stone", "orb_of_venom", "infused_raindrop", "wind_lace",
  "quelling_blade", "ring_of_basilius", "fluffy_hat", "cloak", "blades_of_attack", "chainmail",
  "blink", "ghost", "shadow_amulet", "voodoo_mask",
]);
const SUPPORT_ONLY = new Set(["ward_observer", "ward_sentry", "ward_dispenser", "smoke_of_deceit", "dust"]);
const CORE_ONLY = new Set(["quelling_blade"]);
const BOOTS = new Set([
  "boots", "phase_boots", "power_treads", "arcane_boots", "tranquil_boots", "travel_boots",
  "travel_boots_2", "guardian_greaves", "boots_of_bearing",
]);

export interface PlanInput {
  hero: string;
  archetype?: Archetype;
  stats: ItemStats;
  /** engine counter items for this draft (EngineResult.items + defense, fit applied). */
  counters?: Recommendation[];
  /** our item id -> dotaconstants key (kb.itemDcKey). */
  dcKey?: (ourId: string) => string | undefined;
  label?: (key: string) => string;
}

export function buildPlan(inp: PlanInput): ItemPlan | undefined {
  const hs = inp.stats.heroes[inp.hero];
  if (!hs) return undefined;
  const items = inp.stats.items;
  const support = inp.archetype === "support";
  const label = (k: string) => inp.label?.(k) ?? items[k]?.label ?? k;
  const cost = (k: string) => items[k]?.cost ?? 0;
  const roleOk = (k: string) => (support ? !CORE_ONLY.has(k) : !SUPPORT_ONLY.has(k));
  const mk = (k: string, kind: PlanItem["kind"] = "standard"): PlanItem => {
    const t = hs.timing?.[k];
    return { key: k, label: label(k), cost: cost(k), kind, ...(t ? { at: t.p50, timing: t } : {}) };
  };
  const used = new Set<string>();
  const take = (k: string) => (used.add(k), mk(k));
  const built = (k: string) => (items[k]?.components?.length ?? 0) > 0;
  const partOfUsed = (k: string) => [...used].some((u) => items[u]?.components?.includes(k));

  // --- start: the hero's usual starting items within the starting gold --------
  const start: PlanItem[] = [];
  let gold = START_GOLD;
  for (const [k, share] of hs.phases.start ?? []) {
    if (share < 0.12 || !roleOk(k)) continue;
    const c = cost(k);
    if (c > gold) continue;
    gold -= c;
    start.push(take(k));
  }

  // --- lane (to ~10 min): standard early items only ------------------------------
  const lane: PlanItem[] = [];
  for (const [k, share] of hs.phases.early ?? []) {
    if (lane.length >= 4 || share < 0.15 || used.has(k) || !roleOk(k)) continue;
    const q = items[k]?.qual;
    if (q === "consumable") continue;
    if (!built(k) && !STANDALONE.has(k)) continue; // a bare component is part of something else
    if (cost(k) >= LATE_MIN) continue; // an early big item belongs to core
    if (BOOTS.has(k) && lane.some((x) => BOOTS.has(x.key))) continue;
    lane.push(take(k));
  }
  // a bare component that the lane already builds into (stick -> wand) is noise
  for (let i = lane.length - 1; i >= 0; i--) if (partOfUsed(lane[i]!.key)) lane.splice(i, 1);

  // --- core: standard built items, in purchase order -----------------------------
  const coreCand = (hs.phases.mid ?? []).filter(
    ([k, share]) => share >= 0.15 && !used.has(k) && roleOk(k) && built(k) && cost(k) >= CORE_MIN && !BOOTS.has(k),
  );
  const core = coreCand.slice(0, 4).map(([k]) => take(k));
  core.sort((a, b) => (a.at ?? 9e9) - (b.at ?? 9e9));
  // boots upgrade bought in the mid game (travel boots etc.) stays out of the core list

  // --- late ------------------------------------------------------------------------
  const late = (hs.phases.late ?? [])
    .filter(([k, share]) => share >= 0.15 && !used.has(k) && roleOk(k) && built(k) && cost(k) >= LATE_MIN)
    .slice(0, 3)
    .map(([k]) => take(k));

  // --- this draft: counter items ---------------------------------------------------
  const situational: PlanItem[] = [];
  const firstCore = core[0];
  for (const rec of inp.counters ?? []) {
    if ((rec.fit?.mult ?? 1) < 0.6 || rec.score <= 0) continue;
    const key = inp.dcKey?.(rec.code) ?? rec.code;
    if (!items[key]) continue;
    const already = [...start, ...lane, ...core, ...late].find((x) => x.key === key);
    if (already) {
      if (already.kind === "standard") {
        already.kind = "both";
        already.counter = rec;
      }
      continue;
    }
    if (situational.some((x) => x.key === key)) continue;
    const it = mk(key, "counter");
    it.counter = rec;
    if (it.cost <= CHEAP_COUNTER) it.place = "in the lane, after your lane items";
    else if (firstCore) it.place = `after ${firstCore.label}${firstCore.at ? ` (~${mmss(firstCore.at)})` : ""}`;
    else it.place = "after your first core item";
    situational.push(it);
    if (situational.length >= 4) break;
  }

  const phases: PlanPhase[] = [
    { id: "start", label: "Start", items: start },
    { id: "lane", label: "Lane (to ~10 min)", items: lane },
    { id: "core", label: "Core", items: core },
    { id: "situational", label: "For this draft", items: situational },
    { id: "late", label: "Late game", items: late },
  ];
  return { hero: inp.hero, ...(inp.archetype ? { archetype: inp.archetype } : {}), phases, spikes: itemSpikes(core) };
}

function itemSpikes(core: PlanItem[]): Spike[] {
  return core
    .filter((c) => c.timing && c.timing.games >= 50)
    .map((c) => {
      const t = c.timing!;
      const delta = t.wrFast !== undefined && t.wrSlow !== undefined ? t.wrFast - t.wrSlow : undefined;
      const why =
        delta !== undefined
          ? `typical ${mmss(t.p50)}; done by ${mmss(t.fastBy ?? t.p25)}: ${pct(t.wrFast!)} wins, after ${mmss(t.slowAfter ?? t.p75)}: ${pct(t.wrSlow!)}`
          : `typical ${mmss(t.p50)}`;
      return { at: t.p50, label: `${c.label} done`, why };
    });
}

// -----------------------------------------------------------------------------
//  Power curve: win rate by match length (ADR-026 phase 3, heuristic)
// -----------------------------------------------------------------------------

/** minute bins used for team comparison. */
export const CURVE_BINS = [20, 30, 40, 50] as const;

/** a hero's win rate relative to its own average, per bin [<25, 25-35, 35-45, 45+].
 *  undefined if there is too little data. */
export function heroCurve(hs: HeroStats | undefined, minGames = 200): number[] | undefined {
  const c = hs?.curve;
  if (!c?.length) return undefined;
  const edges = [0, 25, 35, 45, 1e9];
  const wins = [0, 0, 0, 0];
  const games = [0, 0, 0, 0];
  for (const [min, wr, n] of c) {
    const b = edges.findIndex((e, i) => min >= e && min < edges[i + 1]!);
    if (b < 0) continue;
    wins[b] = wins[b]! + wr * n;
    games[b] = games[b]! + n;
  }
  const total = games.reduce((a, b) => a + b, 0);
  if (total < minGames || games.some((g) => g < minGames / 10)) return undefined;
  const avg = wins.reduce((a, b) => a + b, 0) / total;
  return games.map((g, i) => wins[i]! / g - avg);
}

export const CURVE_LABELS = ["before 25 min", "25-35 min", "35-45 min", "after 45 min"] as const;

export interface TeamWindow {
  /** our minus their mean relative win rate per bin (percentage points). */
  diff: number[];
  /** per-bin contributors: hero, side, pp (relative win rate). */
  drivers: Array<Array<{ hero: string; side: "ally" | "enemy"; pp: number }>>;
  /** heroes without data (left out). */
  missing: string[];
}

export function teamWindow(stats: ItemStats, allies: string[], enemies: string[]): TeamWindow | undefined {
  const missing: string[] = [];
  const curves = (hs: string[]) =>
    hs.flatMap((h) => {
      const c = heroCurve(stats.heroes[h]);
      if (!c) missing.push(h);
      return c ? [{ hero: h, c }] : [];
    });
  const a = curves(allies);
  const e = curves(enemies);
  if (!a.length || !e.length) return undefined;
  const mean = (xs: Array<{ c: number[] }>, i: number) => xs.reduce((s, x) => s + x.c[i]!, 0) / xs.length;
  const diff = CURVE_LABELS.map((_, i) => (mean(a, i) - mean(e, i)) * 100);
  const drivers = CURVE_LABELS.map((_, i) =>
    [
      ...a.map((x) => ({ hero: x.hero, side: "ally" as const, pp: x.c[i]! * 100 })),
      ...e.map((x) => ({ hero: x.hero, side: "enemy" as const, pp: x.c[i]! * 100 })),
    ].sort((p, q) => Math.abs(q.pp) - Math.abs(p.pp)),
  );
  return { diff, drivers, missing };
}

export function mmss(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
function pct(x: number): string {
  return `${(x * 100).toFixed(0)}%`;
}
