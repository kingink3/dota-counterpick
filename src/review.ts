// =============================================================================
//  Match review (ADR-029): a played match (STRATZ) vs the plan the app would have
//  made for that draft, vs Crusader-Ancient averages, plus execution checks.
//  Pure: no fetch, no DOM. Every finding carries its evidence (times, counts).
// =============================================================================

import { buildPlan, mmss, teamWindow, type ItemPlan, type ItemStats, type ItemTiming } from "./item-plan.js";
import type { KnowledgeBase } from "./knowledge.js";
import { archetypeOf, resolve } from "./resolver.js";

// ---------------------------------------------------------------- input ----

export interface StratzPlayerLight {
  playerSlot: number;
  steamAccountId?: number | null;
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
export interface MatchData {
  summary: StratzSummary;
  me: StratzMe;
  positions?: StratzPositions;
}

export interface Ids {
  heroes: Record<string, string>;
  items: Record<string, string>;
  cd: Record<string, number>;
  names: Record<string, string>;
}
export interface Benchmarks {
  minutes: number[];
  heroes: Record<string, Record<string, Record<string, number[]> & { games: number }>>;
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

export type Area = "plan" | "farm" | "deaths" | "map" | "execution";
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
  inEnemyWindow: boolean;
  alone?: boolean;
  unspent: number;
  unused: string[];
  flags: string[];
}
export interface MatchReview {
  matchId: number;
  at?: number;
  hero: string;
  position?: number;
  won: boolean;
  mode: "ranked" | "normal" | "turbo" | "other";
  /** benchmarks and timings are from ranked games: turbo is not comparable. */
  comparable: boolean;
  duration: number;
  kda: [number, number, number];
  plan?: ItemPlan;
  checks: PlanCheck[];
  farm: FarmRow[];
  deaths: DeathRow[];
  findings: Finding[];
  /** the top 3 problems by severity. */
  growth: Finding[];
}

/** items that save you when used in time (escape, immunity, defence). */
export const SAVE_ITEMS = new Set([
  "black_king_bar", "blink", "overwhelming_blink", "swift_blink", "arcane_blink", "manta", "glimmer_cape",
  "force_staff", "hurricane_pike", "cyclone", "wind_waker", "ghost", "ethereal_blade", "lotus_orb", "satanic",
  "invis_sword", "silver_edge", "pipe", "crimson_guard", "blade_mail", "sheepstick", "abyssal_blade", "aeon_disk",
]);
/** a death counts as "alone" when no ally hero is within this distance (STRATZ map units). */
export const ALONE_DIST = 1800;

const posNum = (p?: string | null) => {
  const m = /POSITION_(\d)/.exec(p ?? "");
  return m ? Number(m[1]) : undefined;
};

function modeOf(s: StratzSummary): MatchReview["mode"] {
  const g = (s.gameMode ?? "").toUpperCase();
  const l = (s.lobbyType ?? "").toUpperCase();
  if (g.includes("TURBO")) return "turbo";
  if (l.includes("RANKED")) return "ranked";
  if (l.includes("UNRANKED") || g.includes("ALL_PICK")) return "normal";
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
  const comparable = mode !== "turbo";
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
        severity: clamp(stake * 1.5, 0.15, 0.7),
        title: `${c.label} late: ${mmss(c.actual!)}`,
        detail: `Typical ~${mmss(c.planned ?? c.timing.p50)}; done by ${mmss(c.timing.fastBy ?? c.timing.p25)} it wins ${pct(c.timing.wrFast)}, after ${mmss(c.timing.slowAfter ?? c.timing.p75)} ${pct(c.timing.wrSlow)}.`,
        times: [c.actual!],
      });
    }
    if (c.verdict === "fast" && c.phase === "core") {
      findings.push({ id: "fast_core", area: "plan", severity: 0.2, good: true, title: `${c.label} on time: ${mmss(c.actual!)}`, detail: `Faster than ~75% of games (typical ~${mmss(c.planned ?? 0)}).`, times: [c.actual!] });
    }
    if (c.phase === "situational") {
      const after = done.get(core1?.key ?? "") ?? core1?.at;
      if (c.actual === undefined) {
        findings.push({ id: "counter_missing", area: "plan", severity: 0.3, title: `No ${c.label}`, detail: `The draft called for it${after ? ` after ${core1?.label} (~${mmss(after)})` : ""}.` });
      } else if (after !== undefined && c.actual > after + 600) {
        findings.push({ id: "counter_late", area: "plan", severity: 0.2, title: `${c.label} late: ${mmss(c.actual)}`, detail: `${Math.round((c.actual - after) / 60)} min after ${core1?.label}; the draft called for it right after.`, times: [c.actual] });
      }
    }
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
  const ultIds = new Set((pb.abilityLearnEvents ?? []).filter((a) => a.isUltimate).map((a) => a.abilityId));
  const ultCasts = (pb.abilityUsedEvents ?? []).filter((a) => ultIds.has(a.abilityId)).map((a) => a.time);
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
    return {
      time: dd.time,
      inEnemyWindow: (win?.diff[binOf(dd.time)] ?? 0) < -0.5,
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
    findings.push({ id: "ult_unused", area: "execution", severity: clamp(0.15 * ultDeaths.length, 0.2, 0.6), title: `${ultDeaths.length} fights died in without casting the ultimate`, detail: "Engaged on death, ultimate not cast in the 90 s before (likely ready).", times: ultDeaths.map((x) => x.time) });
  }
  const healDeaths = deaths.filter((x) => x.flags.includes("heal available"));
  if (healDeaths.length >= 2) {
    findings.push({ id: "heal_unused", area: "execution", severity: 0.2, title: `${healDeaths.length} deaths with a heal available`, detail: "STRATZ marks these deaths as having a heal (item / ability) not used.", times: healDeaths.map((x) => x.time) });
  }
  const aloneDeaths = deaths.filter((x) => x.alone);
  if (aloneDeaths.length >= 2) {
    findings.push({ id: "died_alone", area: "deaths", severity: clamp(0.12 * aloneDeaths.length, 0.2, 0.6), title: `${aloneDeaths.length} deaths with no ally nearby`, detail: `No allied hero within ${ALONE_DIST} units: pick-offs, not fights.`, times: aloneDeaths.map((x) => x.time) });
  }
  const windowDeaths = deaths.filter((x) => x.inEnemyWindow);
  if (deaths.length >= 4 && windowDeaths.length / deaths.length >= 0.5) {
    findings.push({ id: "died_in_their_window", area: "deaths", severity: 0.35, title: `${windowDeaths.length} of ${deaths.length} deaths in the enemy's power window`, detail: "Their lineup wins more games of that length: fights there favour them.", times: windowDeaths.map((x) => x.time) });
  }
  const richDeaths = deaths.filter((x) => x.unspent >= 2000);
  if (richDeaths.length >= 2) {
    findings.push({ id: "died_with_gold", area: "deaths", severity: 0.2, title: `${richDeaths.length} deaths holding 2000+ gold`, detail: `Up to ${Math.max(...richDeaths.map((x) => x.unspent))} gold unspent: buy before you fight.`, times: richDeaths.map((x) => x.time) });
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
  const wards = me.stats?.wards ?? [];
  const stacks = (me.stats?.campStack ?? []).reduce((a, b) => a + b, 0);
  if (position && position >= 4) {
    const per10 = (n: number) => (n / Math.max(1, duration / 600)).toFixed(1);
    const obs = wards.filter((w) => w.type === 0).length;
    if (obs / Math.max(1, duration / 600) < 1.5) {
      findings.push({ id: "few_wards", area: "map", severity: 0.25, title: `${obs} observer wards (${per10(obs)} per 10 min)`, detail: "A support usually keeps 2+ observers up per 10 minutes." });
    }
    if (duration > 1200 && stacks / Math.max(1, (duration - 120) / 600) < 0.5) {
      findings.push({ id: "few_stacks", area: "map", severity: 0.15, title: `${stacks} stacks`, detail: `Under 1 per 20 minutes; stack windows are on the Game tab (:53).` });
    }
  }
  const fountain = (me.stats?.tripsFountainPerMinute ?? []).reduce((a, b) => a + b, 0);
  if (duration > 1200 && fountain / (duration / 600) > 3) {
    findings.push({ id: "fountain_trips", area: "execution", severity: 0.15, title: `${fountain} fountain trips`, detail: "Over 3 per 10 minutes: regen, a Bottle or a lane switch may save the walks." });
  }
  if (bounty === 0 && duration > 600 && position && position >= 4) {
    findings.push({ id: "no_bounties", area: "map", severity: 0.1, title: "No bounty runes taken", detail: "Supports usually take the 0:00 / 4:00 bounties." });
  }

  const growth = findings.filter((f) => !f.good).sort((a, b) => b.severity - a.severity).slice(0, 3);
  return {
    matchId: s.id,
    ...(s.startDateTime ? { at: s.startDateTime } : {}),
    hero,
    ...(position ? { position } : {}),
    won: mine.isVictory,
    mode,
    comparable,
    duration,
    kda: [mine.kills, mine.deaths, mine.assists],
    ...(plan ? { plan } : {}),
    checks,
    farm,
    deaths,
    findings,
    growth,
  };
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
  counter_missing: "Skipping the item the draft calls for",
  counter_late: "Counter items bought late",
  low_cs10: "Low last hits at 10:00",
  low_nw20: "Low networth at 20:00",
  farm_stall: "Farm stalls in the mid game",
  died_with_item_ready: "Dying with a save item ready",
  ult_unused: "Dying without casting the ultimate",
  heal_unused: "Dying with a heal available",
  died_alone: "Dying alone (pick-offs)",
  died_in_their_window: "Dying in the enemy's power window",
  died_with_gold: "Dying with unspent gold",
  many_deaths: "Many deaths",
  few_power_runes: "Few power runes",
  few_wards: "Few observer wards",
  few_stacks: "Few stacks",
  fountain_trips: "Many fountain trips",
  fast_core: "Core items on time",
  good_cs10: "Strong laning last hits",
};

function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x));
}
function pct(x: number): string {
  return `${Math.round(x * 100)}%`;
}
