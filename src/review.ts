// =============================================================================
//  Match review (ADR-029): a played match (STRATZ) vs the plan the app would have
//  made for that draft, vs Crusader-Ancient averages, plus execution checks.
//  Pure: no fetch, no DOM. Every finding carries its evidence (times, counts).
// =============================================================================

import { idleRuns, idleSeconds, idleTime, type IdleReport } from "./review-idle.js";
import { disabledAt, type ReplayTimeline } from "./replay.js";
import { buildPlan, mmss, teamWindow, WINDOW_PP, type ItemPlan, type ItemStats, type ItemTiming } from "./item-plan.js";
import type { KnowledgeBase } from "./knowledge.js";
import { archetypeOf, resolve } from "./resolver.js";
import { analyseBattles, type AbilityInfo, type BattleReport } from "./review-battles.js";

// ---------------------------------------------------------------- input ----

export interface StratzPlayerLight {
  playerSlot: number;
  steamAccountId?: number | null;
  /** STRATZ: the profile name; isAnonymous = "Expose Public Match Data" off. */
  steamAccount?: { name?: string | null; isAnonymous?: boolean | null } | null;
  isRadiant: boolean;
  heroId: number;
  position?: string | null;
  lane?: string | null;
  isVictory: boolean;
  kills: number;
  deaths: number;
  assists: number;
  networth?: number;
  numLastHits?: number;
  numDenies?: number;
  imp?: number | null;
  stats?: { networthPerMinute?: number[] | null; lastHitsPerMinute?: number[] | null } | null;
}
export interface StratzSummary {
  id: number;
  durationSeconds: number;
  gameMode?: string | null;
  lobbyType?: string | null;
  didRadiantWin: boolean;
  startDateTime?: number;
  averageRank?: number | null;
  /** STRATZ rank bracket 1 (Herald) .. 8 (Immortal), when given. */
  bracket?: number | null;
  players: StratzPlayerLight[];
  bottomLaneOutcome?: string | null;
  midLaneOutcome?: string | null;
  topLaneOutcome?: string | null;
}
interface TimeEvt {
  time: number;
}
export interface StratzDeath extends TimeEvt {
  attacker?: number | null;
  positionX?: number | null;
  positionY?: number | null;
  reliableGold?: number | null;
  unreliableGold?: number | null;
  goldLost?: number | null;
  isBurst?: boolean | null;
  isEngagedOnDeath?: boolean | null;
  isAttemptTpOut?: boolean | null;
  isDieBack?: boolean | null;
  hasHealAvailable?: boolean | null;
  isWardWalkThrough?: boolean | null;
  isTracked?: boolean | null;
  isFeed?: boolean | null;
  timeDead?: number | null;
}
type Inv = { itemId?: number | null } | null;
export interface StratzInventory extends TimeEvt {
  item0?: Inv;
  item1?: Inv;
  item2?: Inv;
  item3?: Inv;
  item4?: Inv;
  item5?: Inv;
  backPack0?: Inv;
  backPack1?: Inv;
  backPack2?: Inv;
  neutral0?: Inv;
}
export interface StratzMe {
  playerSlot: number;
  heroId: number;
  position?: string | null;
  isRadiant: boolean;
  stats?: {
    lastHitsPerMinute?: number[] | null;
    deniesPerMinute?: number[] | null;
    networthPerMinute?: number[] | null;
    experiencePerMinute?: number[] | null;
    impPerMinute?: number[] | null;
    heroDamagePerMinute?: number[] | null;
    heroDamageReceivedPerMinute?: number[] | null;
    tripsFountainPerMinute?: number[] | null;
    campStack?: number[] | null;
    wards?: Array<{ time: number; type: number }> | null;
    /** enemy wards (isWard) and other units you destroyed. */
    wardDestruction?: Array<{ time: number; isWard?: boolean | null }> | null;
  } | null;
  playbackData?: {
    purchaseEvents?: Array<TimeEvt & { itemId?: number | null }> | null;
    deathEvents?: StratzDeath[] | null;
    killEvents?: TimeEvt[] | null;
    assistEvents?: TimeEvt[] | null;
    itemUsedEvents?: Array<TimeEvt & { itemId?: number | null }> | null;
    abilityUsedEvents?: Array<TimeEvt & { abilityId?: number | null }> | null;
    abilityLearnEvents?: Array<TimeEvt & { abilityId?: number | null; isUltimate?: boolean | null }> | null;
    playerUpdateGoldEvents?: Array<TimeEvt & { gold: number; networth: number }> | null;
    buyBackEvents?: Array<TimeEvt & { cost: number }> | null;
    runeEvents?: Array<TimeEvt & { rune?: string | null; action?: string | null }> | null;
    inventoryEvents?: StratzInventory[] | null;
  } | null;
}
export interface StratzPositions {
  players: Array<{ playerSlot: number; playbackData?: { playerUpdatePositionEvents?: Array<TimeEvt & { x: number; y: number }> | null } | null }>;
}
export interface StratzHealth {
  players: Array<{ playerSlot: number; playbackData?: { playerUpdateHealthEvents?: Array<TimeEvt & { hp: number; maxHp: number }> | null } | null }>;
}
export interface StratzVision {
  players: Array<{ playerSlot: number; stats?: { campStack?: number[] | null; wards?: Array<{ time: number; type: number }> | null; wardDestruction?: Array<{ time: number; isWard?: boolean | null }> | null } | null }>;
}
/** observers / sentries placed, enemy wards destroyed, camps stacked. */
export interface VisionStats {
  observers: number;
  sentries: number;
  dewards: number;
  stacks: number;
}
export function visionOf(st: StratzVision["players"][number]["stats"] | StratzMe["stats"] | undefined): VisionStats {
  const w = st?.wards ?? [];
  return {
    // type 0 = observer, 1 = sentry (checked against purchases)
    observers: w.filter((x) => x.type === 0).length,
    sentries: w.filter((x) => x.type === 1).length,
    dewards: (st?.wardDestruction ?? []).filter((x) => x.isWard).length,
    // campStack is cumulative per minute
    stacks: Math.max(0, ...(st?.campStack ?? [0])),
  };
}
export interface MatchData {
  summary: StratzSummary;
  me: StratzMe;
  positions?: StratzPositions;
  /** per-second timeline and disables from the .dem (ADR-045), when the replay was parsed. */
  replay?: ReplayTimeline;
  /** every hero's HP (optional: saves on allied cores need it). */
  health?: StratzHealth;
  /** every player's wards / dewards / stacks (optional: the match overview). */
  vision?: StratzVision;
}

export interface Ids {
  heroes: Record<string, string>;
  items: Record<string, string>;
  cd: Record<string, number>;
  /** item mana costs. */
  mc?: Record<string, number>;
  names: Record<string, string>;
  /** hero abilities by id (cooldowns / mana per level, kind flags). */
  abilities?: Record<string, AbilityInfo>;
}
export interface Benchmarks {
  minutes: number[];
  heroes: Record<string, Record<string, Record<string, number[]> & { games: number }>>;
}

/** players that can be reviewed: STRATZ gives out events by Steam id, private profiles included (ADR-029c). */
export function openPlayer(p: { steamAccountId?: number | null; steamAccount?: { isAnonymous?: boolean | null } | null }): boolean {
  return !!p.steamAccountId;
}

export interface ReviewContext {
  kb: KnowledgeBase;
  stats?: ItemStats;
  bench?: Benchmarks;
  ids: Ids;
  /** hero code -> display name. */
  label: (code: string) => string;
}

// --------------------------------------------------------------- output ----

export type Area = "plan" | "farm" | "deaths" | "battles" | "map" | "execution";
export interface Finding {
  id: string;
  area: Area;
  /** 0..1: how much this usually costs (heuristic weights, see SEVERITY). */
  severity: number;
  title: string;
  detail: string;
  times?: number[];
  /** a strength rather than a problem. */
  good?: boolean;
  /** 1 = cost fights / deaths (fix first), 2 = efficiency (farm, timings, vision). */
  tier?: 1 | 2;
  /** a deviation with no sign it cost anything: shown in its section, not as a problem. */
  note?: boolean;
  /** how sure the finding is (ADR-036) - separate from severity (what it costs):
   *  confirmed = the events show it directly; likely = strong indirect evidence;
   *  possible = a heuristic, check the moment in the replay. Possible never goes to Fix first. */
  confidence?: Confidence;
  /** what the data could not see, for likely / possible findings. */
  missingContext?: MissingContext[];
}
export interface MacroStats {
  /** enemy towers + barracks that fell, and how many you damaged in their last 20 s. */
  enemyBuildings: number;
  buildingsWith: number;
  /** your own towers + barracks lost. */
  ownLost: number;
  /** Roshan / Tormentor kills by your team (most of the damage dealers on your side), and yours among them. */
  roshan: { team: number; mine: number; enemy: number };
  tormentor: { team: number; mine: number; enemy: number };
  /** your building damage and its share of your team's. */
  towerDamage?: number;
  towerShare?: number;
}

/** objectives from the replay timeline, seen from player slot `slot` (ADR-051). */
export function macroOf(tl: ReplayTimeline, slot: number): MacroStats | undefined {
  if (!tl.objectives) return undefined;
  const radiant = slot < 128;
  const mineSide = (s: number) => s < 128 === radiant;
  const myOwner = radiant ? "radiant" : "dire";
  const bld = tl.objectives.filter((o) => o.kind === "tower" || o.kind === "rax");
  const enemyB = bld.filter((o) => o.owner && o.owner !== myOwner);
  const boss = (kind: "roshan" | "tormentor") => {
    const ks = tl.objectives!.filter((o) => o.kind === kind);
    const team = ks.filter((o) => o.by.filter(mineSide).length > o.by.length / 2);
    return { team: team.length, mine: team.filter((o) => o.by.includes(slot)).length, enemy: ks.length - team.length };
  };
  const td = tl.towerDamage;
  const mineTd = td?.[String(slot)];
  const teamTd = td ? Object.entries(td).filter(([k]) => mineSide(Number(k))).reduce((a, [, v]) => a + v, 0) : 0;
  return {
    enemyBuildings: enemyB.length,
    buildingsWith: enemyB.filter((o) => o.by.includes(slot)).length,
    ownLost: bld.filter((o) => o.owner === myOwner).length,
    roshan: boss("roshan"),
    tormentor: boss("tormentor"),
    ...(mineTd !== undefined ? { towerDamage: mineTd, ...(teamTd > 0 ? { towerShare: Math.round((mineTd / teamTd) * 100) / 100 } : {}) } : {}),
  };
}

export type Confidence = "confirmed" | "likely" | "possible";
/** self_disabled: stuns / silences / hexes on you are not in the data; target_vision: whether the
 *  target was visible; cdr: cooldown reduction; range_approx: cast range + walking distance;
 *  position_sampling: positions are sampled, not continuous; causality: a correlation, the cause
 *  is not shown; role_context: role, split push, objectives; historical_stat: a statistic over
 *  other games, not this one; benchmark_mode: averages from ranked games, this is another mode. */
export type MissingContext =
  | "self_disabled"
  | "target_vision"
  | "cdr"
  | "range_approx"
  | "position_sampling"
  | "causality"
  | "role_context"
  | "historical_stat"
  | "benchmark_mode"
  | "minute_stats";
export const MISSING_LABEL: Record<MissingContext, string> = {
  self_disabled: "stuns / silences on you are not in the data",
  target_vision: "whether the target was visible is unknown",
  cdr: "cooldown reduction is not counted",
  range_approx: "cast range is approximate (+ walking distance)",
  position_sampling: "positions are sampled, not continuous",
  causality: "a link, not a proven cause",
  role_context: "role, split push and objectives are not weighed",
  historical_stat: "based on other games' statistics, not this match",
  benchmark_mode: "averages are from ranked games, this match is another mode",
  minute_stats: "farm data is per minute: a walk between camps can look idle",
};

/** default confidence per finding id (prefix before ':' for per-spell ids), ADR-036. */
const CONFIDENCE: Record<string, [Confidence, MissingContext[]?]> = {
  time_dead: ["confirmed"],
  many_deaths: ["confirmed"],
  died_with_gold: ["confirmed"],
  ward_walk: ["confirmed"],
  low_cs10: ["confirmed"],
  good_cs10: ["confirmed"],
  low_nw20: ["confirmed"],
  behind_late: ["confirmed"],
  slow_core: ["likely", ["causality"]],
  fast_core: ["confirmed"],
  few_power_runes: ["confirmed"],
  few_wards: ["confirmed"],
  good_wards: ["confirmed"],
  few_stacks: ["confirmed"],
  no_dewards: ["confirmed"],
  good_dewards: ["confirmed"],
  fountain_trips: ["confirmed"],
  no_bounties: ["confirmed"],
  own_build: ["confirmed"],
  high_kp: ["confirmed"],
  counter_late: ["likely", ["causality"]],
  counter_missing: ["likely", ["causality"]],
  farm_stall: ["likely", ["position_sampling"]],
  died_alone: ["likely", ["position_sampling"]],
  died_with_item_ready: ["likely", ["self_disabled", "target_vision"]],
  ult_unused: ["likely", ["self_disabled", "cdr"]],
  heal_unused: ["likely", ["self_disabled"]],
  silent_death: ["likely", ["self_disabled"]],
  silent_battles: ["likely", ["self_disabled", "target_vision"]],
  front_deaths: ["likely", ["position_sampling"]],
  outnumbered: ["likely", ["position_sampling"]],
  deep_deaths: ["likely", ["position_sampling"]],
  battle_mana: ["likely", ["cdr"]],
  targets: ["likely", ["causality"]],
  convert: ["likely", ["causality"]],
  idle_time: ["possible", ["minute_stats", "position_sampling"]],
  idle: ["possible", ["self_disabled", "target_vision", "cdr", "range_approx"]],
  low_kp: ["possible", ["role_context"]],
  died_in_their_window: ["possible", ["historical_stat"]],
  low_imp: ["possible", ["role_context"]],
  high_imp: ["possible", ["role_context"]],
};
/** findings judged against ranked averages: only possible when the mode does not match. */
const BENCH_IDS = new Set(["low_cs10", "good_cs10", "low_nw20", "behind_late", "slow_core", "fast_core", "many_deaths", "farm_stall"]);
/** problems are ranked by severity x this weight: a cheap sure thing can beat a costly guess. */
const CONF_WEIGHT: Record<Confidence, number> = { confirmed: 1, likely: 0.85, possible: 0.55 };

function assess(f: Finding, comparable: boolean): void {
  if (!f.confidence) {
    const [c, m] = CONFIDENCE[f.id] ?? CONFIDENCE[f.id.split(":")[0]!] ?? ["likely", ["causality"]];
    f.confidence = c;
    if (m?.length) f.missingContext = [...m];
  }
  if (!comparable && BENCH_IDS.has(f.id)) {
    f.confidence = "possible";
    f.missingContext = [...new Set([...(f.missingContext ?? []), "benchmark_mode" as const])];
  }
}
export interface PlanCheck {
  key: string;
  label: string;
  phase: string;
  kind: "standard" | "counter" | "both";
  planned?: number;
  actual?: number;
  verdict: "fast" | "typical" | "slow" | "missing" | "bought";
  timing?: ItemTiming;
}
export interface FarmRow {
  minute: number;
  cs?: number;
  csBench?: number;
  nw?: number;
  nwBench?: number;
  xp?: number;
  xpBench?: number;
}
export interface DeathRow {
  time: number;
  /** the enemy hero that got the kill (STRATZ attacker), when it was a hero. */
  killer?: string;
  inEnemyWindow: boolean;
  alone?: boolean;
  unspent: number;
  unused: string[];
  flags: string[];
}
export interface MatchReview {
  matchId: number;
  /** whose review: the player's Steam account id and slot. */
  account?: number;
  slot?: number;
  /** STRATZ profile name, when open. */
  player?: string;
  at?: number;
  hero: string;
  position?: number;
  won: boolean;
  mode: "ranked" | "normal" | "turbo" | "other";
  /** the mode matches the benchmarks (ranked / normal All Pick); turbo and other modes
   *  get no farm / timing verdicts at all (ADR-038). */
  comparable: boolean;
  /** what does not match the benchmarks even when comparable: rank outside the
   *  benchmark brackets. Benchmark findings then become "possible" (ADR-038). */
  compat?: string[];
  duration: number;
  kda: [number, number, number];
  /** share of the team's kills you took part in (0..1), when the team had kills. */
  kp?: number;
  plan?: ItemPlan;
  checks: PlanCheck[];
  farm: FarmRow[];
  deaths: DeathRow[];
  findings: Finding[];
  /** wards placed / destroyed and stacks: the support metrics, shown for every position. */
  vision?: VisionStats;
  /** minutes alive and out of base with nothing that pays (ADR-041). */
  idle?: IdleReport;
  /** objectives from the replay (ADR-051): building falls, Roshan, Tormentor, building damage. */
  macro?: MacroStats;
  /** spell / item use in battles (2v3 / 3v2 or bigger), targets, positioning. */
  battles?: BattleReport;
  /** fixFirst + workOn (kept for the copy text / older code). */
  growth: Finding[];
  /** up to 3: what cost deaths / fights, with evidence. */
  fixFirst: Finding[];
  /** up to 5 more. */
  workOn: Finding[];
  /** up to 3: what went well (an own build that worked counts). */
  strengths: Finding[];
  /** finished items in order, with how they compare to the hero's typical timing. */
  build: BuildItem[];
  /** one line on the build: plan items vs own choices. */
  buildNote?: string;
  /** runes taken. */
  runes?: { power: number; bounty: number };
}

export interface BuildItem {
  key: string;
  label: string;
  at: number;
  verdict?: "fast" | "typical" | "slow";
  /** in the plan the app made for this draft. */
  planned: boolean;
  /** the hero's typical (median) time for it. */
  typical?: number;
}

export const GROWTH = 8;
const FIX_FIRST = 3;
const WORK_ON = 5;
/** kill participation below this is "far from the fights", by position (expert values). */
const KP_LOW: Record<number, number> = { 1: 0.35, 2: 0.45, 3: 0.4, 4: 0.5, 5: 0.5 };
/** findings that cost deaths or fights (tier 1); the rest is efficiency (tier 2). */
const TIER1 = new Set(["many_deaths", "died_alone", "ward_walk", "front_deaths", "outnumbered", "silent_death", "silent_battles", "deep_deaths", "low_kp", "ult_unused", "died_with_item_ready", "heal_unused"]);
/** plan-conformity findings: problems only with evidence that the game went badly for this player. */
const PLAN_IDS = new Set(["counter_missing", "counter_late"]);

/** items that save you when used in time (escape, immunity, defence). */
export const SAVE_ITEMS = new Set([
  "black_king_bar", "blink", "overwhelming_blink", "swift_blink", "arcane_blink", "manta", "glimmer_cape",
  "force_staff", "hurricane_pike", "cyclone", "wind_waker", "ghost", "ethereal_blade", "lotus_orb", "satanic",
  "invis_sword", "silver_edge", "pipe", "crimson_guard", "blade_mail", "sheepstick", "abyssal_blade", "aeon_disk",
]);
/** a death counts as "alone" when no ally hero is within this distance. STRATZ
 *  positions are map cells (~64 world units each; the map spans ~62..194): 28 cells
 *  ~ 1800 world units, about two screens. */
export const ALONE_DIST = 28;

const posNum = (p?: string | null) => {
  const m = /POSITION_(\d)/.exec(p ?? "");
  return m ? Number(m[1]) : undefined;
};

/** brackets the benchmarks and timings were taken from: Crusader-Archon + Legend-Ancient
 *  (data/benchmarks.json, data/item-stats.json `curveFrom` / `posFrom`). */
const BENCH_BRACKETS = [3, 4, 5, 6];
const BRACKET_LABEL = ["", "Herald", "Guardian", "Crusader", "Archon", "Legend", "Ancient", "Divine", "Immortal"];

/** explicit compatibility with the ranked benchmarks (ADR-038): the mode decides whether
 *  farm / timing verdicts exist at all; the rank only lowers how sure they are. */
export function compatibility(s: StratzSummary, mode: MatchReview["mode"]): { comparable: boolean; issues: string[] } {
  const comparable = mode === "ranked" || mode === "normal";
  const issues: string[] = [];
  const bracket = s.bracket ?? (s.averageRank ? Math.floor(s.averageRank / 10) : undefined);
  if (comparable && bracket && bracket >= 1 && bracket <= 8 && !BENCH_BRACKETS.includes(bracket)) {
    issues.push(`${BRACKET_LABEL[bracket]} game; averages are from Crusader-Ancient`);
  }
  return { comparable, issues };
}

function modeOf(s: StratzSummary): MatchReview["mode"] {
  const g = (s.gameMode ?? "").toUpperCase();
  const l = (s.lobbyType ?? "").toUpperCase();
  if (g.includes("TURBO")) return "turbo";
  // only regular-pace drafts are compared with the All Pick benchmarks (ADR-038);
  // Ability Draft, All Random Deathmatch, event modes etc. are "other"
  if (g && !/^(ALL_PICK|ALL_PICK_RANKED|CAPTAINS_MODE|SINGLE_DRAFT|RANDOM_DRAFT|CAPTAINS_DRAFT|LEAST_PLAYED)$/.test(g)) return "other";
  // "UNRANKED" contains "RANKED": check it first
  if (l.includes("UNRANKED")) return "normal";
  if (l.includes("RANKED")) return "ranked";
  if (g.includes("ALL_PICK")) return "normal";
  return "other";
}

export function reviewMatch(d: MatchData, account: number, ctx: ReviewContext): MatchReview {
  const { summary: s, me } = d;
  const { ids, kb } = ctx;
  const heroOf = (id: number) => ids.heroes[String(id)] ?? `hero_${id}`;
  const itemOf = (id?: number | null) => (id ? ids.items[String(id)] : undefined);
  const name = (k: string) => ctx.stats?.items[k]?.label ?? ids.names[k] ?? k;
  const mine = s.players.find((p) => p.steamAccountId === account) ?? s.players.find((p) => p.playerSlot === me.playerSlot)!;
  const hero = heroOf(mine.heroId);
  const position = posNum(me.position ?? mine.position);
  const mode = modeOf(s);
  const compat = compatibility(s, mode);
  const comparable = compat.comparable;
  const benchSure = comparable && !compat.issues.length;
  const duration = s.durationSeconds;
  const allies = s.players.filter((p) => p.isRadiant === mine.isRadiant).map((p) => heroOf(p.heroId));
  const enemies = s.players.filter((p) => p.isRadiant !== mine.isRadiant).map((p) => heroOf(p.heroId));
  const pb = me.playbackData ?? {};
  const findings: Finding[] = [];

  // --- the plan the app would have made for this draft -------------------------
  const known = (h: string) => !!kb.taxonomy.hero_tags[h];
  let plan: ItemPlan | undefined;
  if (ctx.stats && known(hero)) {
    const r = resolve(kb, { enemyHeroes: enemies.filter(known), allyHeroes: allies.filter(known), myHero: hero, ...(position ? { myRole: position } : {}) });
    const archetype = archetypeOf(kb, hero, position);
    plan = buildPlan({
      hero,
      ...(archetype ? { archetype } : {}),
      ...(position ? { role: position } : {}),
      stats: ctx.stats,
      counters: [...r.items, ...r.defense].sort((a, b) => b.score - a.score),
      dcKey: (id) => kb.itemDcKey?.[id],
      allies: allies.filter((h) => h !== hero),
    });
  }

  // --- when each item was finished: first inventory snapshot that holds it ------
  const done = new Map<string, number>();
  for (const ev of pb.inventoryEvents ?? []) {
    for (const slot of ["item0", "item1", "item2", "item3", "item4", "item5", "backPack0", "backPack1", "backPack2"] as const) {
      const k = itemOf(ev[slot]?.itemId);
      if (k && !done.has(k)) done.set(k, ev.time);
    }
  }
  for (const ev of pb.purchaseEvents ?? []) {
    const k = itemOf(ev.itemId);
    if (k && !done.has(k)) done.set(k, ev.time);
  }

  const checks: PlanCheck[] = [];
  const core1 = plan?.phases.find((p) => p.id === "core")?.items[0];
  for (const ph of plan?.phases ?? []) {
    if (ph.id === "start") continue;
    for (const it of ph.items) {
      const actual = done.get(it.key);
      const t = it.timing;
      let verdict: PlanCheck["verdict"] = actual === undefined ? "missing" : "bought";
      if (actual !== undefined && t && comparable && ph.id !== "situational") {
        verdict = actual <= (t.fastBy ?? t.p25) ? "fast" : actual >= (t.slowAfter ?? t.p75) ? "slow" : "typical";
      }
      if (actual === undefined && it.at !== undefined && duration < it.at + 300) continue; // the game ended before it was due
      checks.push({ key: it.key, label: it.label, phase: ph.id, kind: it.kind, ...(it.at !== undefined ? { planned: it.at } : {}), ...(actual !== undefined ? { actual } : {}), verdict, ...(t ? { timing: t } : {}) });
    }
  }
  for (const c of checks) {
    if (c.verdict === "slow" && c.timing?.wrFast !== undefined && c.timing.wrSlow !== undefined && c.phase === "core") {
      const stake = c.timing.wrFast - c.timing.wrSlow;
      findings.push({
        id: "slow_core",
        area: "plan",
        // fast vs slow win rates mix the item with being ahead in gold (ADR-037): a modest weight
        severity: clamp(0.15 + stake * 0.75, 0.15, 0.45),
        title: `${c.label} late: ${mmss(c.actual!)}`,
        detail: `Typical ~${mmss(c.planned ?? c.timing.p50)}; done by ${mmss(c.timing.fastBy ?? c.timing.p25)} it wins ${pct(c.timing.wrFast)}, after ${mmss(c.timing.slowAfter ?? c.timing.p75)} ${pct(c.timing.wrSlow)} (partly because richer games buy faster).`,
        times: [c.actual!],
      });
    }
    if (c.verdict === "fast" && c.phase === "core") {
      findings.push({ id: "fast_core", area: "plan", severity: 0.2, good: true, title: `${c.label} on time: ${mmss(c.actual!)}`, detail: `Faster than ~75% of games (typical ~${mmss(c.planned ?? 0)}).`, times: [c.actual!] });
    }
    if (c.phase === "situational") {
      const after = done.get(core1?.key ?? "") ?? core1?.at;
      if (after !== undefined && c.actual !== undefined && c.actual > after + 600) {
        findings.push({ id: "counter_late", area: "plan", severity: 0.2, title: `${c.label} late: ${mmss(c.actual)}`, detail: `${Math.round((c.actual - after) / 60)} min after ${core1?.label}; the draft called for it right after.`, times: [c.actual] });
      }
    }
  }

  const answers = checks.filter((c) => c.phase === "situational");
  const missing = answers.filter((c) => c.actual === undefined);
  if (answers.length && missing.length === answers.length) {
    const after = done.get(core1?.key ?? "") ?? core1?.at;
    findings.push({
      id: "counter_missing",
      area: "plan",
      severity: 0.35,
      title: `None of the draft's answers bought (${missing.map((c) => c.label).join(", ")})`,
      detail: `The enemy draft called for at least one of them${after ? ` after ${core1?.label} (~${mmss(after)})` : ""}.`,
    });
  }

  // --- farm and lane vs Crusader-Ancient averages --------------------------------
  const bench = position ? ctx.bench?.heroes[hero]?.[String(position)] : undefined;
  const cum = (xs?: number[] | null) => {
    let a = 0;
    return (xs ?? []).map((x) => (a += x));
  };
  const csCum = cum(me.stats?.lastHitsPerMinute);
  const nw = me.stats?.networthPerMinute ?? [];
  const xpCum = cum(me.stats?.experiencePerMinute);
  const farm: FarmRow[] = [];
  for (const [i, m] of (ctx.bench?.minutes ?? [5, 10, 15, 20, 25, 30]).entries()) {
    if (m * 60 > duration) break;
    farm.push({
      minute: m,
      ...(csCum[m - 1] !== undefined ? { cs: csCum[m - 1] } : {}),
      ...(nw[m] !== undefined ? { nw: nw[m] } : {}),
      ...(xpCum[m - 1] !== undefined ? { xp: xpCum[m - 1] } : {}),
      ...(bench ? { csBench: bench.cs?.[i], nwBench: bench.networth?.[i], xpBench: bench.xp?.[i] } : {}),
    });
  }
  const at10 = farm.find((f) => f.minute === 10);
  if (comparable && at10?.cs !== undefined && at10.csBench && position && position <= 3) {
    const r = at10.cs / at10.csBench;
    if (r < 0.8) {
      findings.push({ id: "low_cs10", area: "farm", severity: clamp((0.8 - r) * 1.5 + 0.2, 0.2, 0.6), title: `Last hits at 10:00: ${at10.cs} (avg ${Math.round(at10.csBench)})`, detail: `${Math.round((1 - r) * 100)}% below the Crusader-Ancient average for ${ctx.label(hero)} on position ${position}.` });
    } else if (r > 1.15) {
      findings.push({ id: "good_cs10", area: "farm", severity: 0.2, good: true, title: `Last hits at 10:00: ${at10.cs} (avg ${Math.round(at10.csBench)})`, detail: `${Math.round((r - 1) * 100)}% above average.` });
    }
  }
  const at20 = farm.find((f) => f.minute === 20);
  if (comparable && at20?.nw !== undefined && at20.nwBench && at20.nw < 0.8 * at20.nwBench) {
    findings.push({ id: "low_nw20", area: "farm", severity: 0.35, title: `Networth at 20:00: ${Math.round(at20.nw)} (avg ${Math.round(at20.nwBench)})`, detail: `${Math.round((1 - at20.nw / at20.nwBench) * 100)}% below the average for this hero and position.` });
  }

  // falling behind later: networth / XP at 30:00 (or the last full 5 minutes)
  const late = [...farm].reverse().find((f) => f.minute <= 30 && f.minute >= 20);
  if (comparable && late?.nw !== undefined && late.nwBench && late.nw < 0.85 * late.nwBench && !findings.some((f) => f.id === "low_nw20" && late.minute === 20)) {
    const xpPart = late.xp !== undefined && late.xpBench ? `, XP ${pctD(late.xp, late.xpBench)}` : "";
    findings.push({
      id: "behind_late",
      area: "farm",
      severity: clamp((1 - late.nw / late.nwBench) * 1.2, 0.2, 0.5),
      title: `Behind at ${late.minute}:00: networth ${pctD(late.nw, late.nwBench)}${xpPart}`,
      detail: `${Math.round(late.nw)} vs ${Math.round(late.nwBench)} on average for ${ctx.label(hero)} on position ${position}.`,
    });
  }

  // lane outcome (STRATZ): your lane by side
  const side = mine.isRadiant ? "RADIANT" : "DIRE";
  const laneKey = mine.lane === "MID_LANE" ? "midLaneOutcome" : mine.lane === "SAFE_LANE" ? (mine.isRadiant ? "bottomLaneOutcome" : "topLaneOutcome") : mine.lane === "OFF_LANE" ? (mine.isRadiant ? "topLaneOutcome" : "bottomLaneOutcome") : undefined;
  const outcome = laneKey ? (s as unknown as Record<string, string | null | undefined>)[laneKey] : undefined;
  if (outcome && outcome !== "TIE") {
    const won = outcome.startsWith(side);
    const stomp = outcome.includes("STOMP");
    findings.push({
      id: won ? "lane_won" : "lane_lost",
      area: "farm",
      severity: won ? 0.2 : stomp ? 0.4 : 0.25,
      ...(won ? { good: true } : {}),
      title: `Lane ${won ? "won" : "lost"}${stomp ? " hard" : ""} (${(mine.lane ?? "").replace("_LANE", "").toLowerCase()} lane)`,
      detail: won ? "STRATZ lane outcome for your lane." : "STRATZ lane outcome for your lane: look at the first 10 minutes - trades, pulls, rotations.",
    });
  }

  // farm stalls: >= 4 minutes in a row with under half the average networth growth, while alive
  const deathsList = pb.deathEvents ?? [];
  if (comparable && bench?.networth && nw.length > 12) {
    const benchSlope = (m: number) => {
      const xs = ctx.bench!.minutes;
      const i = xs.findIndex((x) => x >= m);
      if (i <= 0) return (bench.networth![0] ?? 0) / xs[0]!;
      return ((bench.networth![i] ?? 0) - (bench.networth![i - 1] ?? 0)) / (xs[i]! - xs[i - 1]!);
    };
    const deadIn = (m: number) => deathsList.some((dd) => dd.time < (m + 1) * 60 && dd.time + (dd.timeDead ?? 30) > m * 60);
    let run = 0;
    const stalls: number[] = [];
    for (let m = 10; m < Math.min(nw.length - 1, Math.floor(duration / 60) - 2); m++) {
      const g = nw[m + 1]! - nw[m]!;
      if (g < 0.5 * benchSlope(m) && !deadIn(m)) run++;
      else {
        if (run >= 4) stalls.push(m - run);
        run = 0;
      }
    }
    if (run >= 4) stalls.push(nw.length - 1 - run);
    if (stalls.length) {
      findings.push({ id: "farm_stall", area: "farm", severity: 0.3, title: `Farm stalled ${stalls.length > 1 ? `${stalls.length} times` : `from ${stalls[0]}:00`}`, detail: "4+ minutes in a row with under half the usual networth growth, while alive.", times: stalls.map((m) => m * 60) });
    }
  }

  // --- deaths: when, in whose window, alone, with what unused --------------------
  const win = ctx.stats ? teamWindow(ctx.stats, allies.filter(known), enemies.filter(known)) : undefined;
  const binOf = (t: number) => (t < 1500 ? 0 : t < 2100 ? 1 : t < 2700 ? 2 : 3);
  const used = (pb.itemUsedEvents ?? []).map((u) => ({ t: u.time, k: itemOf(u.itemId) })).filter((u): u is { t: number; k: string } => !!u.k);
  const invAt = (t: number) => {
    const evs = (pb.inventoryEvents ?? []).filter((e) => e.time <= t);
    const ev = evs[evs.length - 1];
    if (!ev) return [] as string[];
    return (["item0", "item1", "item2", "item3", "item4", "item5"] as const).map((k) => itemOf(ev[k]?.itemId)).filter((k): k is string => !!k);
  };
  // STRATZ leaves isUltimate false: the ultimate is the non-talent ability first
  // learned at hero level 6+ (each learn event is one level) with at most 3 levels
  const learns = (pb.abilityLearnEvents ?? []) as Array<TimeEvt & { abilityId?: number | null; level?: number | null; isUltimate?: boolean | null; isTalent?: boolean | null }>;
  const firstAt = new Map<number, number>();
  const maxLevel = new Map<number, number>();
  learns.forEach((a, i) => {
    // id 0 / unknown ids are attribute bonuses and talents STRATZ does not flag
    if (!a.abilityId || a.isTalent || (ids.abilities && !ids.abilities[String(a.abilityId)])) return;
    if (!firstAt.has(a.abilityId)) firstAt.set(a.abilityId, i + 1);
    maxLevel.set(a.abilityId, Math.max(maxLevel.get(a.abilityId) ?? 0, a.level ?? 0));
  });
  // a passive ultimate (Riki's Cloak and Dagger, ...) cannot be "not cast"
  const passive = (id: number) => !!ids.abilities?.[String(id)]?.f.includes("p");
  const ultIds = new Set(
    [...firstAt]
      .filter(([id, lvl]) => !passive(id) && (learns.some((a) => a.abilityId === id && a.isUltimate) || (lvl >= 6 && (maxLevel.get(id) ?? 0) <= 2)))
      .map(([id]) => id),
  );
  const ultCasts = (pb.abilityUsedEvents ?? []).filter((a) => a.abilityId != null && ultIds.has(a.abilityId)).map((a) => a.time);
  const allySlots = new Set(s.players.filter((p) => p.isRadiant === mine.isRadiant && p.playerSlot !== mine.playerSlot).map((p) => p.playerSlot));
  const posOf = (slot: number, t: number) => {
    const evs = d.positions?.players.find((p) => p.playerSlot === slot)?.playbackData?.playerUpdatePositionEvents ?? [];
    let best: { x: number; y: number; time: number } | undefined;
    for (const e of evs) {
      if (e.time > t + 2) break;
      best = e;
    }
    return best && t - best.time < 15 ? best : undefined;
  };
  const deaths: DeathRow[] = deathsList.map((dd) => {
    const unused = invAt(dd.time).filter((k) => {
      if (!SAVE_ITEMS.has(k)) return false;
      const cd = ids.cd[k] ?? 30;
      const last = used.filter((u) => u.k === k && u.t <= dd.time).map((u) => u.t).pop();
      return last === undefined || dd.time - last > cd; // ready and not pressed
    });
    const flags: string[] = [];
    if (dd.hasHealAvailable) flags.push("heal available");
    if (dd.isWardWalkThrough) flags.push("walked into enemy vision");
    if (dd.isAttemptTpOut) flags.push("tried to TP out");
    if (dd.isBurst) flags.push("burst");
    if (dd.isTracked) flags.push("tracked");
    const ultReady = ultIds.size > 0 && dd.isEngagedOnDeath && !ultCasts.some((t) => t <= dd.time && dd.time - t < 90);
    if (ultReady) flags.push("ultimate not used");
    let alone: boolean | undefined;
    if (d.positions && dd.positionX != null && dd.positionY != null) {
      const near = [...allySlots].map((sl) => posOf(sl, dd.time)).filter((p): p is { x: number; y: number; time: number } => !!p);
      if (near.length) alone = near.every((p) => Math.hypot(p.x - dd.positionX!, p.y - dd.positionY!) > ALONE_DIST);
    }
    const killer = dd.attacker ? ids.heroes[String(dd.attacker)] : undefined;
    return {
      time: dd.time,
      ...(killer && enemies.includes(killer) ? { killer } : {}),
      inEnemyWindow: (win?.diff[binOf(dd.time)] ?? 0) < -WINDOW_PP,
      ...(alone !== undefined ? { alone } : {}),
      unspent: (dd.reliableGold ?? 0) + (dd.unreliableGold ?? 0),
      unused,
      flags,
    };
  });
  const unusedDeaths = deaths.filter((x) => x.unused.length);
  if (unusedDeaths.length) {
    const items = [...new Set(unusedDeaths.flatMap((x) => x.unused))].map(name);
    findings.push({ id: "died_with_item_ready", area: "execution", severity: clamp(0.2 * unusedDeaths.length, 0.25, 0.8), title: `${unusedDeaths.length} death${unusedDeaths.length > 1 ? "s" : ""} with ${items.join(" / ")} ready`, detail: "The item was off cooldown and not used in the fight.", times: unusedDeaths.map((x) => x.time) });
  }
  const ultDeaths = deaths.filter((x) => x.flags.includes("ultimate not used"));
  if (ultDeaths.length >= 2) {
    findings.push({ id: "ult_unused", area: "execution", severity: clamp(0.15 * ultDeaths.length, 0.2, 0.6), title: `${ultDeaths.length} death${ultDeaths.length > 1 ? "s" : ""} in a fight without casting the ultimate`, detail: "Engaged on death, ultimate not cast in the 90 s before (likely ready).", times: ultDeaths.map((x) => x.time) });
  }
  const healDeaths = deaths.filter((x) => x.flags.includes("heal available"));
  if (healDeaths.length >= 3 && healDeaths.length >= deaths.length / 2) {
    findings.push({ id: "heal_unused", area: "execution", severity: 0.2, title: `${healDeaths.length} of ${deaths.length} deaths with a heal available`, detail: "STRATZ marks a heal (Wand / Stick charges, Salve, Mango, a healing ability) that was not used before dying.", times: healDeaths.map((x) => x.time) });
  }
  const aloneDeaths = deaths.filter((x) => x.alone);
  if (aloneDeaths.length >= 2) {
    findings.push({ id: "died_alone", area: "deaths", severity: clamp(0.12 * aloneDeaths.length, 0.2, 0.6), title: `${aloneDeaths.length} deaths with no ally nearby`, detail: `No allied hero within ${ALONE_DIST} units: pick-offs, not fights.`, times: aloneDeaths.map((x) => x.time) });
  }
  const windowDeaths = deaths.filter((x) => x.inEnemyWindow);
  if (deaths.length >= 4 && windowDeaths.length / deaths.length >= 0.5) {
    findings.push({ id: "died_in_their_window", area: "deaths", severity: 0.35, title: `${windowDeaths.length} of ${deaths.length} deaths in a stretch their lineup tends to win`, detail: "In past games of that length their lineup wins more: a tendency, not proof the fights favoured them.", times: windowDeaths.map((x) => x.time) });
  }
  const richDeaths = deaths.filter((x) => x.unspent >= 2000);
  if (richDeaths.length >= 2) {
    findings.push({ id: "died_with_gold", area: "deaths", severity: 0.2, title: `${richDeaths.length} deaths holding 2000+ gold`, detail: `Up to ${Math.max(...richDeaths.map((x) => x.unspent))} gold unspent: buy before you fight.`, times: richDeaths.map((x) => x.time) });
  }
  const walkDeaths = deaths.filter((x) => x.flags.includes("walked into enemy vision"));
  if (walkDeaths.length >= 2) {
    findings.push({ id: "ward_walk", area: "execution", severity: clamp(0.12 * walkDeaths.length, 0.2, 0.5), title: `${walkDeaths.length} deaths right after walking into enemy vision`, detail: "STRATZ: you walked through an enemy ward before the kill - check the minimap / sentry the path.", times: walkDeaths.map((x) => x.time) });
  }
  const dead = deathsList.reduce((a, x) => a + (x.timeDead ?? 0), 0);
  if (dead > 0.08 * duration && deaths.length >= 4) {
    findings.push({ id: "time_dead", area: "deaths", severity: 0.2, title: `Dead for ${mmss(dead)} (${Math.round((dead / duration) * 100)}% of the game)`, detail: "Respawn time is lost farm, XP and map presence." });
  }
  // kill participation
  const teamKills = s.players.filter((p) => p.isRadiant === mine.isRadiant).reduce((a, p) => a + p.kills, 0);
  let kpShare: number | undefined;
  if (teamKills >= 10) {
    const kp = (mine.kills + mine.assists) / teamKills;
    kpShare = kp;
    // by role (ADR-038, expert values): a safe-lane carry farms while others fight,
    // supports and the mid are expected in most kills
    const low = KP_LOW[position ?? 0] ?? 0.4;
    if (kp < low) findings.push({ id: "low_kp", area: "deaths", severity: 0.25, title: `Kill participation ${Math.round(kp * 100)}%`, detail: `In ${mine.kills + mine.assists} of your team's ${teamKills} kills (below ${Math.round(low * 100)}% for ${position ? `position ${position}` : "this role"}): far from the fights.` });
    else if (kp > 0.7) findings.push({ id: "high_kp", area: "deaths", severity: 0.15, good: true, title: `Kill participation ${Math.round(kp * 100)}%`, detail: `In ${mine.kills + mine.assists} of ${teamKills} kills.` });
  }
  // STRATZ IMP: overall and the weakest 5 minutes
  const imp = mine.imp ?? undefined;
  if (imp !== undefined && imp !== null && imp <= -10) {
    const per = me.stats?.impPerMinute ?? [];
    let worst: { at: number; v: number } | undefined;
    for (let m = 0; m + 5 <= per.length; m++) {
      const v = per.slice(m, m + 5).reduce((a, b) => a + b, 0) / 5;
      if (!worst || v < worst.v) worst = { at: m, v };
    }
    findings.push({
      id: "low_imp",
      area: "execution",
      severity: clamp(-imp / 80, 0.15, 0.35),
      title: `STRATZ performance (IMP) ${imp}`,
      detail: `0 is an average game for this hero and position${worst ? `; the weakest stretch was ${worst.at}:00-${worst.at + 5}:00` : ""}.`,
      ...(worst ? { times: [worst.at * 60] } : {}),
    });
  }

  const deathsBench = bench?.deaths;
  const benchAt = (arr: number[] | undefined, t: number) => {
    const xs = ctx.bench?.minutes ?? [];
    const i = xs.findIndex((m) => m * 60 >= t);
    return arr?.[i >= 0 ? i : xs.length - 1];
  };
  const dB = benchAt(deathsBench, duration);
  if (comparable && dB !== undefined && deaths.length >= Math.max(5, dB * 1.6)) {
    findings.push({ id: "many_deaths", area: "deaths", severity: 0.3, title: `${deaths.length} deaths (avg ~${dB.toFixed(1)} by ${mmss(duration)})`, detail: "Well above the average for this hero and position at this game length." });
  }

  // --- map and role --------------------------------------------------------------
  const runes = pb.runeEvents ?? [];
  const power = runes.filter((r) => r.rune && !["BOUNTY", "WATER", "WISDOM"].includes(r.rune)).length;
  const bounty = runes.filter((r) => r.rune === "BOUNTY").length;
  if (position === 2 || position === 4) {
    const spawns = Math.max(0, Math.floor((Math.min(duration, 2400) - 360) / 120) + 1);
    if (spawns >= 5 && power / spawns < 0.25) {
      findings.push({ id: "few_power_runes", area: "map", severity: 0.2, title: `Power runes: ${power} of ~${spawns} spawns`, detail: "A mid / roaming support usually controls more of them (spawn every 2 min from 6:00)." });
    }
  }
  const vision = visionOf(me.stats);
  const stacks = vision.stacks;
  if (position && position >= 4) {
    const per10 = (n: number) => (n / Math.max(1, duration / 600)).toFixed(1);
    const obs = vision.observers;
    if (obs / Math.max(1, duration / 600) < 1.5) {
      findings.push({ id: "few_wards", area: "map", severity: 0.25, title: `${obs} observer wards (${per10(obs)} per 10 min)`, detail: "A support usually keeps 2+ observers up per 10 minutes." });
    }
    if (duration > 1200 && stacks / Math.max(1, (duration - 120) / 600) < 0.5) {
      findings.push({ id: "few_stacks", area: "map", severity: 0.15, title: `${stacks} stacks`, detail: `Under 1 per 20 minutes; stack windows are on the Game tab (:53).` });
    }
    // dewarding: sentries bought / placed and enemy wards destroyed (heuristic: ~1 per 10 min for a support)
    if (me.stats?.wardDestruction !== undefined && duration > 1500) {
      const dw = vision.dewards;
      if (dw === 0) findings.push({ id: "no_dewards", area: "map", severity: 0.2, title: `No enemy wards destroyed (${vision.sentries} sentries placed)`, detail: "Supports clear the enemy's vision around their own jungle, Roshan and the next objective: sentry + gem / dust before fights." });
      else if (dw / (duration / 600) >= 1) findings.push({ id: "good_dewards", area: "map", severity: 0.15, good: true, title: `${dw} enemy wards destroyed`, detail: `${per10(dw)} per 10 min with ${vision.sentries} sentries placed.` });
    }
    if (obs / Math.max(1, duration / 600) >= 2.5) findings.push({ id: "good_wards", area: "map", severity: 0.15, good: true, title: `${obs} observer wards (${per10(obs)} per 10 min)`, detail: "Good vision count." });
  }
  // ---- idle time (ADR-041): alive, out of base, nothing that pays ----------------
  const slotPos = (slot: number) => d.positions?.players.find((p) => p.playerSlot === slot)?.playbackData?.playerUpdatePositionEvents ?? [];
  const idle = d.positions
    ? idleTime({
        lastHits: me.stats?.lastHitsPerMinute,
        denies: me.stats?.deniesPerMinute,
        networth: me.stats?.networthPerMinute,
        xp: me.stats?.experiencePerMinute,
        heroDamage: me.stats?.heroDamagePerMinute,
        damageReceived: me.stats?.heroDamageReceivedPerMinute,
        campStack: me.stats?.campStack,
        actions: [
          ...(pb.abilityUsedEvents ?? []).map((e) => e.time),
          ...(pb.itemUsedEvents ?? []).map((e) => e.time),
          ...(pb.runeEvents ?? []).map((e) => e.time),
          ...(me.stats?.wards ?? []).map((w) => w.time),
        ],
        me: slotPos(mine.playerSlot),
        enemies: s.players.filter((p) => p.isRadiant !== mine.isRadiant).map((p) => slotPos(p.playerSlot)),
        dead: deathsList.map((dd) => [dd.time, dd.time + (dd.timeDead ?? 30)] as [number, number]),
        duration,
        ...(position ? { position } : {}),
      })
    : undefined;
  // with the replay: idle by the second (ADR-045); the minute data still gives the farming pace
  const myTl = d.replay?.heroes[String(mine.playerSlot)];
  if (idle && d.replay && myTl) {
    const sec = idleSeconds({
      start: d.replay.start,
      me: myTl,
      enemies: s.players.filter((p) => p.isRadiant !== mine.isRadiant).map((p) => d.replay!.heroes[String(p.playerSlot)]).filter((h): h is NonNullable<typeof h> => !!h),
      actions: [
        ...(pb.abilityUsedEvents ?? []).map((e) => e.time),
        ...(pb.itemUsedEvents ?? []).map((e) => e.time),
        ...(pb.runeEvents ?? []).map((e) => e.time),
        ...(me.stats?.wards ?? []).map((w) => w.time),
        ...(me.stats?.campStack ?? []).flatMap((v, m, a) => (v > (a[m - 1] ?? 0) ? [m * 60 - 6] : [])),
      ],
      duration,
    });
    idle.seconds = sec.seconds;
    idle.checkedSeconds = sec.checked;
    idle.runs = sec.runs;
    if (idle.pace !== undefined) idle.goldLost = Math.round((idle.pace * sec.seconds) / 60);
    if (idle.stackChances !== undefined) idle.stackChances = Math.floor(sec.seconds / 60);
  }
  if (idle?.seconds !== undefined && idle.checkedSeconds) {
    const min = idle.seconds / 60;
    if (min >= 3 && idle.seconds >= 0.06 * idle.checkedSeconds) {
      const cost =
        idle.goldLost !== undefined
          ? ` - up to ~${idle.goldLost} gold at your farming pace (${idle.pace} per minute)`
          : idle.stackChances
            ? ` - about ${idle.stackChances} stack / ward window${idle.stackChances > 1 ? "s" : ""}`
            : "";
      findings.push({
        id: "idle_time",
        area: position && position >= 4 ? "map" : "farm",
        severity: clamp(0.1 + 0.03 * min, 0.15, 0.4),
        confidence: "likely",
        missingContext: ["causality"],
        title: `${min.toFixed(1)} idle minutes (${Math.round((idle.seconds / idle.checkedSeconds) * 100)}% of your time out of base)${cost}`,
        detail: `From the replay: alive, out of base, no last hit, XP, cast, ward, rune, stack or enemy nearby for 30+ s: ${idle.runs!.slice(0, 8).map(([a, b]) => `${mmss(a)}-${mmss(b)}`).join(", ")}${idle.runs!.length > 8 ? "…" : ""}.`,
        times: idle.runs!.map(([a]) => a),
      });
    }
  } else if (idle && idle.minutes.length >= 3 && idle.minutes.length >= 0.08 * idle.checked) {
    const n = idle.minutes.length;
    const runs = idleRuns(idle.minutes);
    const cost =
      idle.goldLost !== undefined
        ? ` - up to ~${idle.goldLost} gold at your farming pace (${idle.pace} per minute)`
        : idle.stackChances !== undefined
          ? ` - ${idle.stackChances} minute${idle.stackChances > 1 ? "s" : ""} in which a stack or a ward was possible`
          : "";
    findings.push({
      id: "idle_time",
      area: position && position >= 4 ? "map" : "farm",
      severity: clamp(0.1 + 0.03 * n, 0.15, 0.4),
      title: `${n} idle minute${n > 1 ? "s" : ""} (${Math.round((n / Math.max(1, idle.checked)) * 100)}% of your time out of base)${cost}`,
      detail: `Alive and out of base with no last hit, stack, ward, rune, cast, hero damage or enemy nearby: ${runs.map(([a, b]) => (a === b ? `${a}:00` : `${a}:00-${b + 1}:00`)).join(", ")}.`,
      times: runs.map(([a]) => a * 60),
    });
  }

  // ---- objectives from the replay (ADR-051) ------------------------------------------
  const macro = d.replay ? macroOf(d.replay, mine.playerSlot) : undefined;
  if (macro && position !== undefined && position <= 3 && macro.enemyBuildings >= 4) {
    const share = macro.buildingsWith / macro.enemyBuildings;
    const line = `You hit ${macro.buildingsWith} of the ${macro.enemyBuildings} enemy towers and barracks in their last 20 s${macro.towerShare !== undefined ? `; ${Math.round(macro.towerShare * 100)}% of your team's building damage` : ""}.`;
    if (share < 0.3)
      findings.push({ id: "objectives_low", area: "map", severity: 0.2, title: `Present at ${macro.buildingsWith} of ${macro.enemyBuildings} enemy buildings taken`, detail: `${line} As a core, buildings are where a lead is cashed in.`, confidence: "likely", missingContext: ["role_context"] });
    else if (share >= 0.6)
      findings.push({ id: "objectives_high", area: "map", severity: 0.2, good: true, title: `Present at ${macro.buildingsWith} of ${macro.enemyBuildings} enemy buildings taken`, detail: line, confidence: "confirmed" });
  }

  const fountain = (me.stats?.tripsFountainPerMinute ?? []).reduce((a, b) => a + b, 0);
  if (duration > 1200 && fountain / (duration / 600) > 3) {
    findings.push({ id: "fountain_trips", area: "execution", severity: 0.15, title: `${fountain} fountain trips`, detail: "Over 3 per 10 minutes: regen, a Bottle or a lane switch may save the walks." });
  }
  if (bounty === 0 && duration > 600 && position && position >= 4) {
    findings.push({ id: "no_bounties", area: "map", severity: 0.1, title: "No bounty runes taken", detail: "Supports usually take the 0:00 / 4:00 bounties." });
  }

  // ---- battles: idle spells / items, mana, targets, positioning ---------------
  const battles = analyseBattles(s, me, d.positions, ids, name, ultIds, d.health, d.replay ? disabledAt(d.replay, mine.playerSlot) : undefined);
  if (battles?.battles.length) findings.push(...battleFindings(battles, position, !!d.replay));

  // ---- priorities: a problem is what cost the game, not what differs from the plan ----
  const nwAt = [...farm].reverse().find((f) => f.minute <= 20 && f.nw !== undefined && f.nwBench);
  const nwRatio = nwAt ? nwAt.nw! / nwAt.nwBench! : undefined;
  const deadShare = dead / Math.max(1, duration);
  const struggling = deathsList.length >= Math.max(4, (dB ?? 5) * 1.2) || deadShare >= 0.1 || (nwRatio !== undefined && nwRatio < 0.9);
  const farmBehind = nwRatio !== undefined ? nwRatio < 0.95 : !mine.isVictory;
  const evidence = `${deathsList.length} deaths${dB !== undefined ? ` (avg ${dB.toFixed(1)})` : ""}${nwRatio !== undefined ? `, networth ${pctD(nwRatio, 1)} at ${nwAt!.minute}:00` : ""}`;
  // with battle data the precise checks replace the older heuristics about the same deaths
  const dup = battles?.battles.length ? new Set(["ult_unused", "died_with_item_ready", "heal_unused"]) : new Set<string>();
  const kept = findings.filter((f) => !dup.has(f.id));
  findings.length = 0;
  findings.push(...kept);
  // who killed you: a missed answer matters when it answers one of them (ADR-029g)
  const killers = new Map<string, number>();
  for (const x of deaths) if (x.killer) killers.set(x.killer, (killers.get(x.killer) ?? 0) + 1);
  const threats = new Set([...killers].filter(([, n]) => n >= 2 || n >= 0.3 * deaths.length).map(([h]) => h));
  const answersFor = (key: string) => new Set((plan?.phases ?? []).flatMap((p) => p.items).find((i) => i.key === key)?.counter?.reasons.map((r) => r.enemy) ?? []);
  const topKillers = [...killers].sort((a, b) => b[1] - a[1]).slice(0, 2).map(([h, n]) => `${ctx.label(h)} ${n}`).join(", ");
  for (const f of findings) {
    if (f.good) continue;
    if (PLAN_IDS.has(f.id) && !struggling) {
      f.note = true;
      f.detail = `No sign it cost you (${evidence}): an own build that worked. ${f.detail}`;
    } else if (PLAN_IDS.has(f.id) && threats.size) {
      const missing = checks.filter((c) => c.phase === "situational" && (f.id === "counter_late" ? f.title.startsWith(`${c.label} late`) : c.actual === undefined));
      const useful = missing.filter((c) => [...answersFor(c.key)].some((h) => threats.has(h)));
      if (!useful.length) {
        f.note = true;
        f.detail = `They answer heroes that did not kill you (deaths: ${topKillers}). ${f.detail}`;
      } else {
        const vs = [...new Set(useful.flatMap((c) => [...answersFor(c.key)].filter((h) => threats.has(h))))].map((h) => `${ctx.label(h)} (killed you ${killers.get(h)}x)`);
        f.title = `${f.id === "counter_late" ? "Late" : "Not bought"}: ${useful.map((c) => c.label).join(", ")} - the answer to ${vs.join(", ")}`;
      }
    } else if (f.id === "slow_core" && !farmBehind) {
      f.note = true;
      f.detail = `Farm was on track (${evidence}), so other items came first. ${f.detail}`;
    } else if (f.id === "low_kp" && !farmBehind && position !== undefined && position <= 3) {
      // a core away from fights but on farm: split push / farming was the job (ADR-038)
      f.note = true;
      f.detail = `Farm was on track (${evidence}): away from fights while farming or pushing. ${f.detail}`;
    } else if (f.id === "low_imp" || f.id === "high_imp") {
      f.note = true; // IMP is the summary in the header / overview, not a separate problem
    }
    const idle = /^idle:/.test(f.id) && /before \d+ death|ultimate/.test(f.title);
    f.tier = TIER1.has(f.id) || idle ? 1 : 2;
    // few deaths overall: how they happened is worth a look, not the first thing to fix
    if (f.tier === 1 && f.id !== "low_kp" && !/ultimate/.test(f.title) && deathsList.length <= Math.max(2, (dB ?? 4) * 0.5)) f.tier = 2;
  }

  // ---- the build: finished items in order, vs the hero's typical timing ----------
  const hs = ctx.stats?.heroes[hero];
  const hsPos = position ? hs?.byPos?.[String(position)] : undefined;
  const planned = new Set((plan?.phases ?? []).flatMap((p) => p.items.map((i) => i.key)));
  const comps = new Set<string>();
  for (const k of done.keys()) for (const c of ctx.stats?.items[k]?.components ?? []) if (done.has(k)) comps.add(c);
  const build: BuildItem[] = [...done.entries()]
    .filter(([k]) => (ctx.stats?.items[k]?.cost ?? 0) >= 1000 && !comps.has(k) && !/^(recipe_|ward_|tango|clarity|flask|tpscroll|dust|smoke)/.test(k))
    .sort((a, b) => a[1] - b[1])
    .map(([k, at]) => {
      const t = hsPos?.timing?.[k] ?? hs?.timing?.[k];
      const verdict = t && comparable ? (at <= (t.fastBy ?? t.p25) ? "fast" : at >= (t.slowAfter ?? t.p75) ? "slow" : "typical") : undefined;
      return { key: k, label: name(k), at, ...(verdict ? { verdict } : {}), planned: planned.has(k), ...(t ? { typical: t.p50 } : {}) } as BuildItem;
    });
  const own = build.filter((b) => !b.planned);
  const onTime = build.filter((b) => b.verdict === "fast" || b.verdict === "typical").length;
  const buildNote = build.length
    ? `${build.length} items, ${onTime} on time or faster` +
      (own.length ? `; own choices: ${own.map((b) => `${b.label}${b.verdict === "fast" ? " (fast)" : b.verdict === "slow" ? " (late)" : ""}`).join(", ")}` : "; all from the plan")
    : undefined;
  if (!struggling && findings.some((f) => f.note && PLAN_IDS.has(f.id))) {
    const skipped = checks.filter((c) => c.phase === "situational" && c.actual === undefined).map((c) => c.label);
    const fast = build.filter((b) => b.verdict === "fast").map((b) => b.label);
    const went = fast.length ? `${fast.join(", ")} fast` : own.length ? own.map((b) => b.label).join(", ") : "your own items";
    findings.push({
      id: "own_build",
      area: "plan",
      severity: 0.3,
      good: true,
      title: `Own build worked: ${went}${skipped.length ? ` (skipped ${skipped.join(", ")})` : ""}`,
      detail: `Away from the draft's answers, and it paid off (${evidence}).`,
    });
  }

  for (const f of findings) assess(f, benchSure);
  const weight = (f: Finding) => f.severity * CONF_WEIGHT[f.confidence ?? "likely"];
  const problems = findings.filter((f) => !f.good && !f.note).sort((a, b) => weight(b) - weight(a));
  // a guess is never the first thing to fix: it waits in Work on with "check the replay"
  const fixFirst = problems.filter((f) => f.tier === 1 && f.confidence !== "possible").slice(0, FIX_FIRST);
  const workOn = problems.filter((f) => !fixFirst.includes(f)).slice(0, WORK_ON);
  const strengths = findings.filter((f) => f.good).sort((a, b) => b.severity - a.severity).slice(0, 3);
  const growth = [...fixFirst, ...workOn];
  return {
    matchId: s.id,
    account,
    slot: mine.playerSlot,
    ...(mine.steamAccount?.name ? { player: mine.steamAccount.name } : {}),
    ...(s.startDateTime ? { at: s.startDateTime } : {}),
    hero,
    ...(position ? { position } : {}),
    won: mine.isVictory,
    mode,
    comparable,
    ...(compat.issues.length ? { compat: compat.issues } : {}),
    duration,
    ...(kpShare !== undefined ? { kp: Math.round(kpShare * 100) / 100 } : {}),
    kda: [mine.kills, mine.deaths, mine.assists],
    ...(plan ? { plan } : {}),
    checks,
    farm,
    deaths,
    findings,
    vision,
    ...(idle ? { idle } : {}),
    ...(macro ? { macro } : {}),
    ...(battles?.battles.length ? { battles } : {}),
    growth,
    fixFirst,
    workOn,
    strengths,
    build,
    ...(buildNote ? { buildNote } : {}),
    runes: { power, bounty },
  };
}

function battleFindings(b: BattleReport, position?: number, replay = false): Finding[] {
  const out: Finding[] = [];
  const n = b.battles.length;
  const s = (x: number) => `${Math.round(x)} s`;
  const pct = (a: number, z: number) => `${Math.round((a / Math.max(1, z)) * 100)}%`;
  // chances not taken: one finding each, the 4 worst (2+ missed, 40%+ of the chances)
  const idle = b.totals.filter((u) => u.missed >= 2 && u.missed / Math.max(1, u.windows) >= 0.4).slice(0, 4);
  for (const u of idle) {
    const share = u.missed / u.windows;
    const cd = u.cd ? (u.cd[0] === u.cd[1] ? `${u.cd[0]} s` : `${u.cd[1]}-${u.cd[0]} s`) : "?";
    const what =
      u.use === "enemy" ? `with an enemy hero within ${u.reach} range` : u.use === "ally" ? "with an allied core in range losing HP (or in your last 5 s)" : "in your last 5 s before dying";
    // many repeated chances: unlikely that you were stunned / blind every time (ADR-036)
    const sure = u.missed >= 4 && share >= 0.6;
    out.push({
      id: `idle:${u.name}`,
      // the replay shows disables on you (ADR-045): those seconds are not chances any more
      confidence: sure || replay ? "likely" : "possible",
      missingContext: replay ? ["target_vision", "cdr", "range_approx"] : ["self_disabled", "target_vision", "cdr", "range_approx"],
      area: "battles",
      severity: clamp(0.1 + 0.25 * share + 0.02 * u.missed + (u.ult ? 0.08 : 0) + (u.use === "save" ? 0.05 : 0), 0.15, 0.45),
      title:
        u.use === "save"
          ? `${u.name} ready and not used before ${u.missed} death${u.missed > 1 ? "s" : ""}`
          : `${u.name}${u.ult ? " (ultimate)" : ""}: ${u.used} of ${u.windows} chances used`,
      detail:
        `Ready (cooldown ${cd}, mana) ${what}: ${u.missed} time${u.missed > 1 ? "s" : ""} not cast, ${s(u.idle)} in total, longest ${s(u.longest)}.`,
    });
  }
  const mana = b.totals.filter((u) => u.manaShort >= 15);
  if (mana.length) {
    out.push({
      id: "battle_mana",
      area: "battles",
      severity: 0.2,
      title: `Out of mana in battles: ${mana.map((u) => `${u.name} ${s(u.manaShort)}`).join(", ")}`,
      detail: "Off cooldown but not enough mana: Arcane Boots / Clarity / a Soul Ring, or skip the harass before a fight.",
    });
  }
  const silent = b.battles.filter((f) => f.uses.length && f.uses.every((u) => u.casts === 0) && f.to - f.from >= 8);
  if (silent.length >= 2) {
    out.push({ id: "silent_battles", area: "battles", severity: clamp(0.08 * silent.length, 0.2, 0.4), title: `${silent.length} of ${n} battles without a single spell or item`, detail: "You were there, alive, and cast nothing.", times: silent.map((f) => f.from + 5) });
  }
  const deathsIn = b.battles.filter((f) => f.died);
  const silentDeaths = deathsIn.filter((f) => f.silentDeath);
  if (silentDeaths.length) {
    out.push({ id: "silent_death", area: "battles", severity: clamp(0.12 * silentDeaths.length, 0.15, 0.35), title: `${silentDeaths.length} battle death${silentDeaths.length > 1 ? "s" : ""} with nothing cast in the last 10 s`, detail: "Died without using what you had: press the save / disable before the burst lands.", times: silentDeaths.map((f) => f.to) });
  }
  const front = deathsIn.filter((f) => f.frontmost);
  if (front.length >= 2 || (front.length >= 1 && position !== undefined && position >= 4)) {
    out.push({
      id: "front_deaths",
      area: "battles",
      severity: clamp(0.12 * front.length + (position && position >= 4 ? 0.08 : 0), 0.2, 0.45),
      title: `${front.length} battle death${front.length > 1 ? "s" : ""} as your team's closest hero to the enemy`,
      detail: position && position >= 4 ? "A support in front is the first target: cast from the edge of your range, behind your cores." : "You were the first one they reached: let the initiator / frontliner go first.",
      times: front.map((f) => f.to),
    });
  }
  const outnumbered = deathsIn.filter((f) => f.outnumbered);
  if (outnumbered.length >= 2) {
    out.push({ id: "outnumbered", area: "battles", severity: clamp(0.1 * outnumbered.length, 0.2, 0.4), title: `${outnumbered.length} deaths outnumbered`, detail: outnumbered.map((f) => `${mmss(f.to)}: ${f.alliesNear! + 1}v${f.enemiesNear}`).join("; ") + ". Fight where your team is, or back off.", times: outnumbered.map((f) => f.to) });
  }
  const deep = deathsIn.filter((f) => f.deep);
  if (deep.length >= 2) {
    out.push({ id: "deep_deaths", area: "battles", severity: 0.2, title: `${deep.length} battle deaths on the enemy half`, detail: "Chasing or fighting under their towers / vision.", times: deep.map((f) => f.to) });
  }
  for (const t of b.targets) {
    if (t.casts < 4) continue;
    if (t.onSupports / t.casts > 0.5 && (position === undefined || position >= 3)) {
      out.push({ id: `targets:${t.name}`, area: "battles", severity: 0.2, title: `${t.name}: ${t.onSupports} of ${t.casts} on supports`, detail: "The disable is worth most on their carry / mid / initiator." });
    }
    const conv = t.converted / t.casts;
    if (conv < 0.35) out.push({ id: `convert:${t.name}`, area: "battles", severity: 0.2, title: `${t.name}: ${t.converted} of ${t.casts} targets died after it`, detail: "Within 8 s of the cast. Use it when your team can follow up, on the hero they can reach." });
    else if (conv >= 0.6) out.push({ id: `convert:${t.name}`, area: "battles", severity: 0.15, good: true, title: `${t.name}: ${t.converted} of ${t.casts} targets died after it`, detail: "Good follow-up timing." });
  }
  return out;
}

// --------------------------------------------------------------- trends ----

export interface Trend {
  id: string;
  title: string;
  area: Area;
  matches: number;
  share: number;
  severity: number;
  /** most recent example title. */
  example: string;
}

/** recurring problems across reviews: in >= 30% of the matches and at least 3 of them. */
export function trends(reviews: MatchReview[]): { n: number; recurring: Trend[]; strengths: Trend[] } {
  const by = new Map<string, Finding[]>();
  for (const r of reviews) for (const f of r.findings) (by.get(f.id) ?? by.set(f.id, []).get(f.id)!).push(f);
  const rows = [...by.entries()].map(([id, fs]) => {
    const matches = new Set(reviews.filter((r) => r.findings.some((f) => f.id === id)).map((r) => r.matchId)).size;
    return {
      id,
      title: TREND_TITLES[id] ?? fs[0]!.title,
      area: fs[0]!.area,
      matches,
      share: matches / Math.max(1, reviews.length),
      severity: fs.reduce((s, f) => s + f.severity, 0) / fs.length,
      example: fs[fs.length - 1]!.title,
      good: !!fs[0]!.good,
    };
  });
  const keep = (r: (typeof rows)[number]) => r.matches >= Math.min(3, reviews.length) && r.share >= 0.3;
  const order = (a: (typeof rows)[number], b: (typeof rows)[number]) => b.share * b.severity - a.share * a.severity;
  return {
    n: reviews.length,
    recurring: rows.filter((r) => !r.good && keep(r)).sort(order).slice(0, 5),
    strengths: rows.filter((r) => r.good && keep(r)).sort(order).slice(0, 3),
  };
}

const TREND_TITLES: Record<string, string> = {
  slow_core: "Core items later than typical",
  counter_missing: "Skipping the items the draft calls for",
  behind_late: "Falling behind in networth by 20-30 min",
  lane_lost: "Losing the lane",
  lane_won: "Winning the lane",
  ward_walk: "Walking into enemy vision before deaths",
  time_dead: "Long time dead",
  low_kp: "Low kill participation",
  high_kp: "High kill participation",
  low_imp: "Low STRATZ performance (IMP)",
  counter_late: "Counter items bought late",
  low_cs10: "Low last hits at 10:00",
  low_nw20: "Low networth at 20:00",
  farm_stall: "Farm stalls in the mid game",
  died_with_item_ready: "Dying with a save item ready",
  ult_unused: "Dying without casting the ultimate",
  heal_unused: "Dying with a heal available",
  died_alone: "Dying alone (pick-offs)",
  died_in_their_window: "Dying in a stretch their lineup tends to win",
  died_with_gold: "Dying with unspent gold",
  many_deaths: "Many deaths",
  few_power_runes: "Few power runes",
  few_wards: "Few observer wards",
  few_stacks: "Few stacks",
  no_dewards: "No enemy wards destroyed",
  fountain_trips: "Many fountain trips",
  fast_core: "Core items on time",
  good_cs10: "Strong laning last hits",
  good_wards: "Good observer count",
  good_dewards: "Dewarding",
};

function pctD(v: number, b: number): string {
  const d = Math.round((v / b - 1) * 100);
  return `${d >= 0 ? "+" : ""}${d}%`;
}
export function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x));
}
function pct(x: number): string {
  return `${Math.round(x * 100)}%`;
}
