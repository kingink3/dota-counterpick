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
  /** item -> share (OpenDota: of the phase's most bought item; STRATZ: of all games
   *  on the position), optional quantity for starting items (Iron Branch x2). */
  phases: Partial<Record<Phase, Array<[string, number] | [string, number, number]>>>;
  timing?: Record<string, ItemTiming>;
  /** win rate by match length: [minute bin start, win rate, games]. */
  curve?: Array<[number, number, number]>;
  /** STRATZ, per position "1".."5" (rank-filtered; preferred when present). */
  byPos?: Record<string, HeroStats>;
  /** the position with the most games in byPos. */
  mainPos?: string;
  /** games behind a byPos entry. */
  games?: number;
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
  /** what byPos comes from. */
  posFrom?: string;
  posFetchedAt?: string;
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
  /** components bought first on the way (Yasha for Manta). */
  via?: string[];
  /** typical time of that component, when the item itself has no timing. */
  viaAt?: number;
  /** starting items bought more than once (Iron Branch x2); cost is the total. */
  qty?: number;
  /** moved up into the core because this draft calls for it. */
  promoted?: boolean;
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
  /** where the standard items come from, e.g. "STRATZ, position 1, 212k games". */
  basis?: string;
  phases: PlanPhase[];
  spikes: Spike[];
}

/** starting gold (7.41). */
export const START_GOLD = 600;
/** a counter this cheap can be bought during the lane. */
export const CHEAP_COUNTER = 1000;
/** core items: built (or standalone) items at least this expensive. */
const CORE_MIN = 1400;
const LATE_MIN = 2500;
/** components worth buying on their own in the lane. */
const STANDALONE = new Set([
  "boots", "magic_stick", "blight_stone", "orb_of_venom", "infused_raindrop", "wind_lace",
  "quelling_blade", "ring_of_basilius", "fluffy_hat", "cloak", "blades_of_attack", "chainmail",
  "blink", "ghost", "shadow_amulet", "voodoo_mask", "aghanims_shard",
]);
const SUPPORT_ONLY = new Set(["ward_observer", "ward_sentry", "ward_dispenser", "smoke_of_deceit", "dust"]);
const CORE_ONLY = new Set(["quelling_blade"]);
/** stat parts with no use of their own. */
const INTERMEDIATE = new Set(["soul_booster", "point_booster", "mystic_staff", "reaver", "sacred_relic", "hyperstone"]);
/** boots bought late (not a lane item). */
const LATE_BOOTS = new Set(["travel_boots", "travel_boots_2", "guardian_greaves", "boots_of_bearing"]);
const BOOTS = new Set([
  "boots", "phase_boots", "power_treads", "arcane_boots", "tranquil_boots", "travel_boots",
  "travel_boots_2", "guardian_greaves", "boots_of_bearing",
]);

export interface PlanInput {
  hero: string;
  archetype?: Archetype;
  /** your position (picks the STRATZ per-position build). */
  role?: number;
  stats: ItemStats;
  /** engine counter items for this draft (EngineResult.items + defense, fit applied). */
  counters?: Recommendation[];
  /** our item id -> dotaconstants key (kb.itemDcKey). */
  dcKey?: (ourId: string) => string | undefined;
  label?: (key: string) => string;
}

export function buildPlan(inp: PlanInput): ItemPlan | undefined {
  const base = inp.stats.heroes[inp.hero];
  if (!base) return undefined;
  const posKey = inp.role !== undefined && base.byPos?.[String(inp.role)] ? String(inp.role) : base.mainPos;
  const pos = posKey ? base.byPos?.[posKey] : undefined;
  const hs: HeroStats = pos ? { ...pos, ...(base.curve ? { curve: base.curve } : {}) } : base;
  const basis = pos
    ? `${inp.stats.posFrom ?? "by position"}: position ${posKey}${inp.role !== undefined && String(inp.role) !== posKey ? ` (no data for position ${inp.role})` : ""}, ${Math.round((pos.games ?? 0) / 1000)}k games`
    : inp.stats.phasesFrom;
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
  const standalone = (k: string) => (items[k]?.components?.length ?? 0) > 0 || STANDALONE.has(k);
  const share = (ph: Phase, k: string) => hs.phases[ph]?.find(([x]) => x === k)?.[1] ?? 0;
  /** is `part` (recursively) built into `whole`? */
  const within = (part: string, whole: string, depth = 0): boolean =>
    depth < 4 && (items[whole]?.components ?? []).some((c) => c === part || within(part, c, depth + 1));
  const related = (x: string, y: string) => x === y || within(x, y) || within(y, x);

  // --- start: the hero's usual starting items within the starting gold --------
  const start: PlanItem[] = [];
  let gold = START_GOLD;
  const startList = (hs.phases.start ?? []).filter(([k, sh]) => sh >= 0.12 && roleOk(k));
  const hasDispenser = startList.some(([k]) => k === "ward_dispenser");
  for (const [k, , q] of startList) {
    if (hasDispenser && (k === "ward_observer" || k === "ward_sentry")) continue; // the pair covers both
    let qty = q ?? 1;
    while (qty > 1 && cost(k) * qty > gold) qty--;
    const c = cost(k) * qty;
    if (c > gold || start.length >= 7) continue;
    gold -= c;
    const it = take(k);
    if (qty > 1) {
      it.qty = qty;
      it.cost = c;
    }
    start.push(it);
  }

  // --- boots: the upgrade the hero actually goes for, else plain boots ------------
  const upgrades = [...BOOTS]
    .filter((k) => k !== "boots" && !LATE_BOOTS.has(k) && roleOk(k))
    .map((k) => [k, Math.max(share("early", k), 0.8 * share("mid", k))] as [string, number])
    .sort((x, y) => y[1] - x[1]);
  const bootsKey = upgrades[0] && upgrades[0][1] >= 0.3 ? upgrades[0][0] : share("early", "boots") >= 0.15 ? "boots" : undefined;

  // --- lane (to ~10 min): standard early items only ------------------------------
  const lane: PlanItem[] = [];
  for (const [k, sh] of hs.phases.early ?? []) {
    if (lane.length >= 4 || sh < 0.15 || used.has(k) || !roleOk(k) || BOOTS.has(k)) continue;
    if (items[k]?.qual?.startsWith("consumable")) continue;
    if (!standalone(k)) continue; // a bare component is part of something else
    if (cost(k) >= LATE_MIN) continue; // an early big item belongs to core
    lane.push(take(k));
  }
  if (bootsKey && !used.has(bootsKey)) lane.splice(Math.min(1, lane.length), 0, take(bootsKey));
  if (lane.every((x) => x.at !== undefined)) lane.sort((x, y) => x.at! - y.at!);
  // a component the lane already builds into (stick -> wand) is noise
  for (let i = lane.length - 1; i >= 0; i--) {
    if (lane.some((o, j) => j !== i && within(lane[i]!.key, o.key))) lane.splice(i, 1);
  }

  // --- core: standard items of the mid game, in purchase order -------------------
  // supports buy their core (Force Staff, Glimmer) after 25 min in pro games, so the
  // late list counts too, at half weight
  const coreScore = new Map<string, number>();
  // STRATZ phases come from real completion times, so its late items are late;
  // OpenDota's pro phases put a support's Force Staff after 25 min
  for (const [ph, w] of [["mid", 1], ["late", pos ? 0 : support ? 0.5 : 0.25]] as const) {
    for (const [k, sh] of hs.phases[ph] ?? []) coreScore.set(k, (coreScore.get(k) ?? 0) + w * sh);
  }
  const coreKeys = [...coreScore.entries()]
    .filter(([k, sc]) => sc >= 0.2 && !used.has(k) && roleOk(k) && standalone(k) && cost(k) >= CORE_MIN && !BOOTS.has(k) && !INTERMEDIATE.has(k))
    .sort((x, y) => y[1] - x[1])
    .map(([k]) => k);
  // an intermediate item the hero usually finishes into something bigger (Yasha ->
  // Manta, Crystalys -> Daedalus, Soul Booster -> Octarine) is shown as that item
  const parentOf = (k: string) =>
    [...coreScore.entries()]
      .filter(([p, sc]) => p !== k && sc >= 0.15 && within(k, p) && roleOk(p))
      .sort((x, y) => y[1] - x[1])[0]?.[0];
  const core: PlanItem[] = [];
  const coreCap = support ? 4 : 3;
  for (const k0 of coreKeys) {
    if (core.length >= coreCap) break;
    const parent = parentOf(k0);
    const k = parent ?? k0;
    if (used.has(k) || core.some((c) => related(c.key, k))) {
      const same = core.find((c) => c.key === k);
      if (same && parent && !same.via?.includes(label(k0))) {
        same.via = [...(same.via ?? []), label(k0)];
        const t = hs.timing?.[k0];
        if (t) same.viaAt = Math.min(same.viaAt ?? 9e9, t.p50);
      }
      continue; // one item per upgrade family
    }
    const it = take(k);
    if (parent) {
      it.via = [label(k0)];
      // the first visible step of the item: when its component is usually done
      const t = hs.timing?.[k0];
      if (t) it.viaAt = t.p50;
    }
    core.push(it);
  }
  // a core component (Yasha -> Manta, Perseverance -> Battle Fury) folds into the item
  const fold = (list: PlanItem[], into: PlanItem[]) => {
    for (let i = list.length - 1; i >= 0; i--) {
      const parent = into.find((o) => o !== list[i] && within(list[i]!.key, o.key));
      if (parent) {
        parent.via = [...(parent.via ?? []), list[i]!.label];
        list.splice(i, 1);
      }
    }
  };
  const orderKey = (c: PlanItem) =>
    Math.min(c.at ?? 9e9, c.viaAt ?? 9e9) < 9e9
      ? Math.min(c.at ?? 9e9, c.viaAt ?? 9e9)
      : share("mid", c.key) >= share("late", c.key) ? 1200 : 1800;
  core.sort((x, y) => orderKey(x) - orderKey(y));

  // --- late ------------------------------------------------------------------------
  const late: PlanItem[] = [];
  for (const [k, sh] of hs.phases.late ?? []) {
    if (late.length >= 3) break;
    if (sh < 0.15 || used.has(k) || !roleOk(k) || !standalone(k) || cost(k) < LATE_MIN || BOOTS.has(k) || INTERMEDIATE.has(k)) continue;
    if ([...core, ...late].some((c) => related(c.key, k))) continue;
    const parent = parentOf(k);
    if (parent && (used.has(parent) || late.some((c) => c.key === parent))) continue;
    late.push(take(k));
  }
  if (late.every((x) => x.at !== undefined)) late.sort((x, y) => x.at! - y.at!);
  fold(lane, [...core, ...late]);
  fold(core, [...core, ...late]);

  // --- this draft: counter items ---------------------------------------------------
  const situational: PlanItem[] = [];
  const counters = (inp.counters ?? []).filter((r) => (r.fit?.mult ?? 1) >= 0.6 && r.score > 0);
  const topCounters = new Set(counters.slice(0, 3).map((r) => inp.dcKey?.(r.code) ?? r.code));
  for (const rec of counters) {
    const key = inp.dcKey?.(rec.code) ?? rec.code;
    if (!items[key]) continue;
    const planned = [...start, ...lane, ...core, ...late];
    const already = planned.find((x) => x.key === key);
    if (already) {
      if (already.kind === "standard") {
        already.kind = "both";
        already.counter = rec;
      }
      // a late item this draft calls for first: buy it right after the first core item
      const li = late.indexOf(already);
      if (li >= 0 && topCounters.has(key) && core.length) {
        late.splice(li, 1);
        already.place = `earlier than usual for this hero${already.at !== undefined ? ` (usually ~${mmss(already.at)})` : ""}`;
        already.promoted = true;
        delete already.at;
        core.splice(1, 0, already);
      }
      continue;
    }
    if ([...planned, ...situational].some((x) => related(x.key, key))) continue; // Orchid vs Bloodthorn
    const it = mk(key, "counter");
    it.counter = rec;
    situational.push(it);
    if (situational.length >= 3) break;
  }
  const firstCore = core[0];
  for (const it of situational) {
    if (it.cost <= CHEAP_COUNTER) it.place = "in the lane, after your lane items";
    else if (firstCore) it.place = `after ${firstCore.label}${firstCore.at ? ` (~${mmss(firstCore.at)})` : ""}`;
    else it.place = "after your first core item";
    // the hero's usual time for it is context, not the target here
    if (it.at !== undefined) {
      if (firstCore?.at === undefined || it.at > firstCore.at + 300) it.place += `; usually ~${mmss(it.at)} on this hero`;
      delete it.at;
    }
  }

  const phases: PlanPhase[] = [
    { id: "start", label: "Start", items: start },
    { id: "lane", label: "Lane (to ~10 min)", items: lane },
    { id: "core", label: "Core", items: core },
    { id: "situational", label: "For this draft", items: situational },
    { id: "late", label: "Late game", items: late },
  ];
  return {
    hero: inp.hero,
    ...(inp.archetype ? { archetype: inp.archetype } : {}),
    ...(basis ? { basis } : {}),
    phases,
    spikes: itemSpikes(core),
  };
}

function itemSpikes(core: PlanItem[]): Spike[] {
  return core
    .filter((c) => c.timing && c.timing.games >= 50 && !c.promoted)
    .sort((x, y) => x.timing!.p50 - y.timing!.p50)
    .map((c) => {
      const t = c.timing!;
      const delta = t.wrFast !== undefined && t.wrSlow !== undefined ? t.wrFast - t.wrSlow : undefined;
      const why =
        delta !== undefined && delta > 0.02
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
