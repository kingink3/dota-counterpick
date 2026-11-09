// =============================================================================
//  Replay -> review input (ADR-053): the match the review reads (summary, every
//  player's per-minute stats and events, positions, wards), built from odota/parser's
//  NDJSON instead of STRATZ. STRATZ stays the fallback when there is no replay.
//  OpenDota's match JSON is optional: it adds the lobby type, ranks and positions.
//  Pure: no I/O.
//
//  What the replay cannot give (the review skips what needs it, see ADR-053):
//    HP of heroes (saves on allied cores), STRATZ death flags (walked into vision,
//    tried to TP out, burst, heal available, engaged), IMP, lane outcomes, fountain
//    trips; the inventory is rebuilt from purchases (no sells, no backpack).
// =============================================================================

import { heroKey, playerSlot } from "./replay.js";
import type { Ids, StratzDeath, StratzHealth, StratzInventory, StratzMe, StratzPositions, StratzSummary, StratzVision } from "./review.js";

/** the part of OpenDota's /matches/{id} this reads. */
export interface OdMatch {
  match_id?: number;
  duration?: number;
  start_time?: number;
  game_mode?: number;
  lobby_type?: number;
  radiant_win?: boolean;
  players?: Array<{
    player_slot: number;
    account_id?: number | null;
    personaname?: string | null;
    rank_tier?: number | null;
    position_est?: number | null;
    lane_role?: number | null;
    is_roaming?: boolean | null;
  }>;
}

export interface ReplayMatch {
  summary: StratzSummary;
  /** Steam account id -> that player's stats and events (same shape as STRATZ). */
  players: Record<string, StratzMe>;
  positions: StratzPositions;
  vision: StratzVision;
  health?: StratzHealth;
  source: "replay";
}

/** OpenDota game_mode / lobby_type numbers -> STRATZ names (the review's modeOf reads names). */
const GAME_MODE: Record<number, string> = {
  1: "ALL_PICK", 2: "CAPTAINS_MODE", 3: "RANDOM_DRAFT", 4: "SINGLE_DRAFT", 5: "ALL_RANDOM", 7: "THE_DIRETIDE",
  8: "REVERSE_CAPTAINS_MODE", 11: "MID_ONLY", 12: "LEAST_PLAYED", 13: "NEW_PLAYER_POOL", 15: "CUSTOM", 16: "CAPTAINS_DRAFT",
  18: "ABILITY_DRAFT", 19: "EVENT", 20: "ALL_RANDOM_DEATH_MATCH", 21: "MID_1V1", 22: "ALL_PICK_RANKED", 23: "TURBO", 24: "MUTATION",
};
const LOBBY: Record<number, string> = { 0: "UNRANKED", 1: "PRACTICE", 2: "TOURNAMENT", 4: "COOP_VS_BOTS", 5: "TEAM_MATCH", 6: "SOLO_QUEUE", 7: "RANKED", 8: "SOLO_MID", 9: "BATTLE_CUP", 12: "EVENT" };
/** DOTA_RUNES order (checked on a parse against STRATZ, ADR-053). */
const RUNE = ["DOUBLE_DAMAGE", "HASTE", "ILLUSION", "INVISIBILITY", "REGEN", "BOUNTY", "ARCANE", "WATER", "WISDOM", "SHIELD"];
/** bought and used up: not kept in the rebuilt inventory. */
const CONSUMABLE = /^(aghanims_shard|ultimate_scepter_2|tango|tango_single|flask|clarity|faerie_fire|enchanted_mango|tpscroll|ward_observer|ward_sentry|ward_dispenser|smoke_of_deceit|dust|bottle_refill|famango|great_famango|greater_famango|blood_grenade|cheese|refresher_shard|aghanims_shard_roshan|royal_jelly|food_of|courier)/;
const STEAM64 = 76561197960265728n;
/** items that heal on use; Wand / Stick count from WAND_HEAL_CHARGES charges (~150+ HP). */
const HEAL_ITEMS = /^item_(flask|faerie_fire|enchanted_mango|cheese|greater_faerie_fire|royal_jelly|famango|great_famango|greater_famango)$/;
const WAND_HEAL_CHARGES = 5;
/** cells from the fountain: inside / away (the fountain area is ~10 cells across). */
const FOUNTAIN_IN = 8;
const FOUNTAIN_AWAY = 30;
/** a hero alive again this soon after dying reincarnated (Aegis, Reincarnation). */
const REINCARNATION = 8;

interface Ev {
  type: string;
  time: number;
  slot?: number;
  unit?: string;
  hero_id?: number;
  x?: number;
  y?: number;
  life_state?: number;
  gold?: number;
  networth?: number;
  lh?: number;
  denies?: number;
  xp?: number;
  kills?: number;
  deaths?: number;
  assists?: number;
  hero_damage?: number;
  camps_stacked?: number;
  value?: number;
  key?: string;
  player1?: number;
  attackername?: string;
  targetname?: string;
  sourcename?: string;
  targethero?: boolean;
  attackerhero?: boolean;
  targetillusion?: boolean;
  attackerillusion?: boolean;
  inflictor?: string;
  valuename?: string;
  abilitylevel?: number;
  assist_slots?: number[];
}

const bytes = (s: string) => new TextDecoder().decode(new Uint8Array(s.split(",").map((b) => Number(b) & 255)));

/** the epilogue's players: hero, name, account. steamid_ is a 64-bit number, so it is read as text. */
function epiloguePlayers(key: string): Array<{ hero: string; name: string; account: number; radiant: boolean }> {
  const out: Array<{ hero: string; name: string; account: number; radiant: boolean }> = [];
  const re = /"heroName_":\{"bytes":\[([-\d,\s]*)\][^}]*\},"playerName_":\{"bytes":\[([-\d,\s]*)\][^}]*\},"isFakeClient_":(?:true|false),"steamid_":(\d+),"gameTeam_":(\d+)/g;
  for (const m of key.matchAll(re)) {
    const id = BigInt(m[3]!);
    out.push({ hero: bytes(m[1]!), name: bytes(m[2]!), account: id > STEAM64 ? Number(id - STEAM64) : 0, radiant: m[4] === "2" });
  }
  return out;
}

/** the value at game time t of a time-sorted series (the last row at or before t). */
function at<T extends { time: number }>(rows: T[], t: number): T | undefined {
  let lo = 0;
  let hi = rows.length - 1;
  let best: T | undefined;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (rows[mid]!.time <= t) {
      best = rows[mid];
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return best;
}

/** position 1..5 when OpenDota gave none: mid = 2; safe lane richer = 1, other = 5; off lane richer = 3, other = 4. */
function guessPositions(team: Array<{ slot: number; laneRole?: number | null; nw: number }>): Map<number, number> {
  const out = new Map<number, number>();
  const by = (r: number) => team.filter((p) => p.laneRole === r).sort((a, b) => b.nw - a.nw);
  const mid = by(2);
  if (mid[0]) out.set(mid[0].slot, 2);
  const pair = (r: number, core: number, sup: number) => {
    const ps = by(r);
    if (ps[0]) out.set(ps[0].slot, core);
    if (ps[1]) out.set(ps[1].slot, sup);
  };
  pair(1, 1, 5);
  pair(3, 3, 4);
  const free = [1, 2, 3, 4, 5].filter((n) => ![...out.values()].includes(n));
  for (const p of [...team].sort((a, b) => b.nw - a.nw)) if (!out.has(p.slot)) out.set(p.slot, free.shift() ?? 5);
  return out;
}

/** lane_role (1 safe, 2 mid, 3 off) from where the hero stood 1:30-8:00: the map's diagonal
 *  is mid; above it (top-left) is the top lane, below it the bottom lane. Radiant's safe lane is
 *  the bottom one. Map cells: Radiant fountain ~(64, 64), Dire ~(192, 192). */
export function laneFromPositions(rows: Array<{ time: number; x?: number; y?: number }>, isRadiant: boolean): number | undefined {
  const xs = rows.filter((r) => r.time >= 90 && r.time <= 480 && r.x !== undefined && r.y !== undefined);
  if (xs.length < 30) return undefined;
  let top = 0;
  let mid = 0;
  let bot = 0;
  for (const r of xs) {
    const d = r.y! - r.x!;
    if (Math.abs(d) < MID_BAND) mid++;
    else if (d > 0) top++;
    else bot++;
  }
  const best = Math.max(top, mid, bot);
  if (best === mid) return 2;
  const safeIsBot = isRadiant;
  return (best === bot) === safeIsBot ? 1 : 3;
}
/** cells either side of the diagonal that count as mid. */
const MID_BAND = 14;

export interface ReplayMatchCtx {
  ids: Ids;
  /** item -> its components and gold cost (item-stats.json), to rebuild the inventory. */
  components?: Record<string, string[] | undefined>;
  costs?: Record<string, number | undefined>;
  /** our clarity extractor's lines (tools/clarity, ADR-055): HP, mana, gold, items per second. */
  extract?: Iterable<string>;
}

/** what each side could see before a death (ADR-056); seconds, capped at VISION_CAP. */
export interface DeathVision {
  vision?: {
    /** the enemy saw you without a break this long before their first hit. */
    enemySawFor: number;
    /** your team saw any of the killers this long before the first hit; null = no hero killer. */
    sawKillersFor: number | null;
    /** enemy heroes your team had not seen for MISSING_FOR s when the fight started. */
    missing: number;
    firstHit: number;
  };
}
/** fight start = the first enemy-hero damage within this many seconds before the death. */
const FIGHT_LOOKBACK = 30;
const VISION_CAP = 60;
export const MISSING_FOR = 15;

/** one second of one hero from the clarity extractor. */
export interface ExtractRow {
  t: number;
  s: number;
  lv?: number;
  hp: number;
  mhp: number;
  mp: number;
  mmp: number;
  rg: number;
  ug: number;
  /** visible to Radiant / Dire: 1, 0, -1 = unknown (older extracts lack these). */
  vr?: number;
  vd?: number;
  it: Array<string | null>;
  ch: number[];
}

export function readExtract(lines: Iterable<string>): Map<number, ExtractRow[]> {
  const by = new Map<number, ExtractRow[]>();
  for (const line of lines) {
    if (!line || line[0] !== "{") continue;
    try {
      const r = JSON.parse(line) as ExtractRow;
      (by.get(r.s) ?? by.set(r.s, []).get(r.s)!).push(r);
    } catch {
      /* skip */
    }
  }
  for (const rows of by.values()) rows.sort((a, b) => a.t - b.t);
  return by;
}

/** seconds to add to the extractor's clock to get the parser's: the extractor counts from
 *  the game-start time, the parser a few seconds differently (8 s on the sample, constant
 *  through pauses). Matched on hero level-ups and deaths; median of the nearest pairs. */
export function extractOffset(ex: Map<number, ExtractRow[]>, intervals: Map<number, Array<{ time: number; level?: number; life_state?: number }>>): number {
  const diffs: number[] = [];
  const near = (a: number[], b: number[]) => {
    for (const x of a) {
      let best: number | undefined;
      for (const y of b) if (Math.abs(y - x) <= 30 && (best === undefined || Math.abs(y - x) < Math.abs(best))) best = y - x;
      if (best !== undefined) diffs.push(best);
    }
  };
  for (const [s, rows] of ex) {
    const iv = intervals.get(s);
    if (!iv) continue;
    const mine = (f: (r: ExtractRow) => number) => rows.filter((r, i) => i > 0 && f(r) !== f(rows[i - 1]!)).map((r) => r.t);
    const theirs = (f: (r: { level?: number; life_state?: number }) => number) => iv.filter((r, i) => i > 0 && f(r) !== f(iv[i - 1]!)).map((r) => r.time);
    near(mine((r) => r.lv ?? 0), theirs((r) => r.level ?? 0));
    near(mine((r) => (r.hp > 0 ? 0 : 1)), theirs((r) => ((r.life_state ?? 0) === 0 ? 0 : 1)));
  }
  if (!diffs.length) return 0;
  diffs.sort((a, b) => a - b);
  return diffs[diffs.length >> 1]!;
}

/** NDJSON lines of odota/parser (+ OpenDota's match, optional) -> the review's input. */
export function matchFromReplay(lines: Iterable<string>, od: OdMatch | undefined, ctx: ReplayMatchCtx): ReplayMatch | undefined {
  const { ids } = ctx;
  const itemId = new Map(Object.entries(ids.items).map(([id, k]) => [k, Number(id)]));
  const abilityId = new Map(Object.entries(ids.abilities ?? {}).map(([id, a]) => [a.k, Number(id)]));
  const intervals = new Map<number, Ev[]>(); // parser slot -> rows
  const evs: Ev[] = [];
  let epilogue: ReturnType<typeof epiloguePlayers> = [];
  let gameMode: number | undefined;
  let winner: number | undefined;
  let endTime: number | undefined;
  for (const line of lines) {
    if (!line || line[0] !== "{") continue;
    let e: Ev;
    try {
      e = JSON.parse(line) as Ev;
    } catch {
      continue;
    }
    if (e.type === "interval") {
      if (e.x === undefined || e.unit === undefined) continue;
      (intervals.get(e.slot!) ?? intervals.set(e.slot!, []).get(e.slot!)!).push(e);
    } else if (e.type === "epilogue" && e.key) {
      epilogue = epiloguePlayers(e.key);
      gameMode = Number(/"gameMode_":(\d+)/.exec(e.key)?.[1] ?? NaN);
      winner = Number(/"gameWinner_":(\d+)/.exec(e.key)?.[1] ?? NaN);
      endTime = Number(/"endTime_":(\d+)/.exec(e.key)?.[1] ?? NaN);
    } else if (
      /^DOTA_COMBATLOG_(PURCHASE|ITEM|ABILITY|DEATH|DAMAGE|BUYBACK)$|^DOTA_ABILITY_LEVEL$|^CHAT_MESSAGE_RUNE_(PICKUP|BOTTLE)$|^(obs|sen|obs_left|sen_left)$/.test(e.type)
    ) {
      evs.push(e);
    }
  }
  if (intervals.size < 2) return undefined;

  // --- who is who: parser slot <-> hero <-> account -------------------------------
  const slots = [...intervals.keys()].sort((a, b) => a - b);
  for (const s of slots) intervals.get(s)!.sort((a, b) => a.time - b.time);
  const heroIdOf = new Map<number, number>(); // parser slot -> hero id
  const slotOfKey = new Map<string, number>(); // heroKey -> parser slot
  for (const s of slots) {
    const rows = intervals.get(s)!;
    const r = rows.find((x) => x.hero_id) ?? rows[rows.length - 1]!;
    if (r.hero_id) heroIdOf.set(s, r.hero_id);
    slotOfKey.set(heroKey(r.unit!), s);
  }
  const slotOf = (name?: string) => (name && /^npc_dota_hero_/.test(name) ? slotOfKey.get(heroKey(name)) : undefined);
  const heroOfName = (name?: string) => {
    const s = slotOf(name);
    return s === undefined ? undefined : heroIdOf.get(s);
  };
  const odBy = new Map((od?.players ?? []).map((p) => [p.player_slot, p]));
  const accountOf = new Map<number, number>(); // parser slot -> Steam account
  const nameOf = new Map<number, string>();
  for (const p of epilogue) {
    const s = slotOfKey.get(heroKey(p.hero));
    if (s === undefined) continue;
    if (p.account) accountOf.set(s, p.account);
    if (p.name) nameOf.set(s, p.name);
  }
  for (const s of slots) {
    const o = odBy.get(playerSlot(s));
    if (!accountOf.has(s) && o?.account_id) accountOf.set(s, o.account_id);
  }

  const last = (s: number) => intervals.get(s)![intervals.get(s)!.length - 1]!;
  const endT = Math.max(...slots.map((s) => last(s).time));
  const duration = od?.duration ?? endT;
  const minutes = Math.floor(duration / 60); // STRATZ: per-minute gains have floor(duration / 60) entries
  const val = (s: number, t: number, f: keyof Ev) => Number(at(intervals.get(s)!, t)?.[f] ?? 0);
  const gains = (s: number, f: keyof Ev) => Array.from({ length: minutes }, (_, i) => val(s, 60 * (i + 1), f) - val(s, 60 * i, f));
  const marks = (s: number, f: keyof Ev, n: number, off = 0) => Array.from({ length: n }, (_, i) => val(s, 60 * (i + off), f));

  // --- positions ------------------------------------------------------------------
  const radiant = (s: number) => s < 5;
  const posOf = new Map<number, number>();
  for (const s of slots) {
    const est = odBy.get(playerSlot(s))?.position_est;
    if (est && est >= 1 && est <= 5) posOf.set(s, est);
  }
  for (const side of [true, false]) {
    const team = slots.filter((s) => radiant(s) === side);
    if (team.every((s) => posOf.has(s))) continue;
    const g = guessPositions(team.map((s) => ({ slot: s, laneRole: odBy.get(playerSlot(s))?.lane_role ?? laneFromPositions(intervals.get(s)!, radiant(s)), nw: val(s, 600, "networth") })));
    for (const s of team) posOf.set(s, g.get(s)!);
  }
  const laneOf = (p?: number) => (p === 2 ? "MID_LANE" : p === 1 || p === 5 ? "SAFE_LANE" : p === 3 || p === 4 ? "OFF_LANE" : null);

  // --- events per player ------------------------------------------------------------
  const me = new Map<number, StratzMe & { playbackData: NonNullable<StratzMe["playbackData"]>; stats: NonNullable<StratzMe["stats"]> }>();
  for (const s of slots) {
    me.set(s, {
      playerSlot: playerSlot(s),
      heroId: heroIdOf.get(s) ?? 0,
      position: posOf.has(s) ? `POSITION_${posOf.get(s)}` : null,
      isRadiant: radiant(s),
      stats: {
        lastHitsPerMinute: gains(s, "lh"),
        deniesPerMinute: gains(s, "denies"),
        experiencePerMinute: gains(s, "xp"),
        networthPerMinute: marks(s, "networth", minutes + 1),
        heroDamagePerMinute: new Array<number>(minutes).fill(0),
        heroDamageReceivedPerMinute: new Array<number>(minutes).fill(0),
        campStack: marks(s, "camps_stacked", minutes, 1),
        wards: [],
        wardDestruction: [],
      },
      playbackData: {
        purchaseEvents: [],
        deathEvents: [],
        killEvents: [],
        assistEvents: [],
        itemUsedEvents: [],
        abilityUsedEvents: [],
        abilityLearnEvents: [],
        buyBackEvents: [],
        runeEvents: [],
        inventoryEvents: [],
      },
    });
  }
  const minuteOf = (t: number) => Math.min(minutes - 1, Math.max(0, Math.ceil(t / 60) - 1)); // gains: index i = (60i, 60i+60]
  const held = new Map<number, string[]>(); // parser slot -> rebuilt inventory
  const hitsOn = new Map<number, number[]>(); // parser slot -> times an enemy hero damaged it
  const comps = ctx.components ?? {};
  const cost = ctx.costs ?? {};
  const removeOnce = (bag: string[], k: string) => {
    const i = bag.indexOf(k);
    if (i >= 0) bag.splice(i, 1);
    return i >= 0;
  };
  evs.sort((a, b) => a.time - b.time);
  const buybacks = evs.filter((e) => e.type === "DOTA_COMBATLOG_BUYBACK").map((e) => ({ t: e.time, slot: e.value }));
  for (const e of evs) {
    switch (e.type) {
      case "DOTA_COMBATLOG_DAMAGE": {
        if (!e.targethero || e.targetillusion) break;
        const from = slotOf(e.sourcename);
        const to = slotOf(e.targetname);
        if (from === undefined || to === undefined || radiant(from) === radiant(to)) break;
        const m = minuteOf(e.time);
        if (m < 0 || minutes === 0) break;
        (hitsOn.get(to) ?? hitsOn.set(to, []).get(to)!).push(e.time);
        me.get(from)!.stats.heroDamagePerMinute![m]! += e.value ?? 0;
        me.get(to)!.stats.heroDamageReceivedPerMinute![m]! += e.value ?? 0;
        break;
      }
      case "DOTA_COMBATLOG_PURCHASE": {
        const s = slotOf(e.targetname);
        const k = e.valuename?.replace(/^item_/, "");
        if (s === undefined || !k) break;
        const id = itemId.get(k);
        if (id) me.get(s)!.playbackData.purchaseEvents!.push({ time: e.time, itemId: id });
        // inventory: an assembled item takes its components (and recipe) out of the bag
        if (/^recipe_/.test(k) || CONSUMABLE.test(k)) break;
        const bag = held.get(s) ?? held.set(s, []).get(s)!;
        const parts = comps[k] ?? [];
        for (const c of parts) removeOnce(bag, c);
        bag.push(k);
        // 9 slots: the cheapest goes (sold or left behind - the replay's purchases do not say);
        // the 6 most expensive are taken to be the main inventory
        bag.sort((a, b) => (cost[b] ?? 0) - (cost[a] ?? 0));
        bag.splice(9);
        const inv: StratzInventory = { time: e.time };
        const order = bag;
        const keys = ["item0", "item1", "item2", "item3", "item4", "item5", "backPack0", "backPack1", "backPack2"] as const;
        order.forEach((it, i) => {
          const iid = itemId.get(it);
          if (iid) inv[keys[i]!] = { itemId: iid };
        });
        me.get(s)!.playbackData.inventoryEvents!.push(inv);
        break;
      }
      case "DOTA_COMBATLOG_ITEM": {
        if (e.attackerillusion) break;
        const s = slotOf(e.attackername);
        const id = itemId.get(e.inflictor?.replace(/^item_/, "") ?? "");
        if (s === undefined || !id) break;
        me.get(s)!.playbackData.itemUsedEvents!.push({ time: e.time, itemId: id, ...({ attacker: heroIdOf.get(s) ?? null, target: heroOfName(e.targetname) ?? null } as object) });
        break;
      }
      case "DOTA_COMBATLOG_ABILITY": {
        if (e.attackerillusion) break;
        const s = slotOf(e.attackername);
        const id = abilityId.get(e.inflictor ?? "");
        if (s === undefined || !id) break;
        me.get(s)!.playbackData.abilityUsedEvents!.push({ time: e.time, abilityId: id, ...({ target: heroOfName(e.targetname) ?? 0 } as object) });
        break;
      }
      case "DOTA_ABILITY_LEVEL": {
        // level 0 rows list the kit at the start; level >= 1 before the horn is the innate
        const s = slotOf(e.targetname);
        if (s === undefined || !e.valuename || !e.abilitylevel || e.time < 0) break;
        // hidden (Shard / Scepter / sub-ability): levelled without a skill point, so not a hero level
        const aid = abilityId.get(e.valuename);
        if (aid && ids.abilities?.[String(aid)]?.f.includes("h")) break;
        const talent = /^special_bonus_/.test(e.valuename);
        me.get(s)!.playbackData.abilityLearnEvents!.push({
          time: e.time,
          abilityId: aid ?? 0,
          isUltimate: false,
          ...({ level: e.abilitylevel - 1, isTalent: talent } as object),
        });
        break;
      }
      case "DOTA_COMBATLOG_DEATH": {
        if (!e.targethero || e.targetillusion) break;
        const s = slotOf(e.targetname);
        if (s === undefined) break;
        const rows = intervals.get(s)!;
        const now = at(rows, Math.floor(e.time));
        const back = rows.find((r) => r.time > e.time + 1 && (r.life_state ?? 0) === 0);
        // back within a few seconds: Aegis / Reincarnation, not a death (checked: OpenDota does not count it)
        if (back && back.time - e.time < REINCARNATION && !buybacks.some((b) => b.slot === s && b.t >= e.time && b.t <= back.time)) break;
        const killer = slotOf(e.sourcename) ?? slotOf(e.attackername);
        const assists = (e.assist_slots ?? []).filter((a) => a !== killer);
        const d: StratzDeath & { target?: number; assist?: number[] } = {
          time: e.time,
          attacker: killer !== undefined && radiant(killer) !== radiant(s) ? (heroIdOf.get(killer) ?? null) : null,
          target: heroIdOf.get(s),
          positionX: now?.x !== undefined ? Math.round(now.x) : null,
          positionY: now?.y !== undefined ? Math.round(now.y) : null,
          // interval `gold` is gold earned, not on hand: the gold carried is unknown here
          reliableGold: null,
          unreliableGold: null,
          timeDead: back ? back.time - e.time : null,
          assist: assists.map((a) => heroIdOf.get(a)).filter((x): x is number => !!x),
        };
        me.get(s)!.playbackData.deathEvents!.push(d);
        if (killer !== undefined && radiant(killer) !== radiant(s)) me.get(killer)!.playbackData.killEvents!.push({ time: e.time, ...({ target: heroIdOf.get(s) } as object) });
        for (const a of assists) if (me.has(a) && radiant(a) !== radiant(s)) me.get(a)!.playbackData.assistEvents!.push({ time: e.time, ...({ target: heroIdOf.get(s) } as object) });
        break;
      }
      case "DOTA_COMBATLOG_BUYBACK": {
        if (e.value !== undefined && me.has(e.value)) me.get(e.value)!.playbackData.buyBackEvents!.push({ time: e.time, cost: 0 });
        break;
      }
      case "CHAT_MESSAGE_RUNE_PICKUP":
      case "CHAT_MESSAGE_RUNE_BOTTLE": {
        if (e.player1 === undefined || !me.has(e.player1)) break;
        me.get(e.player1)!.playbackData.runeEvents!.push({ time: e.time, rune: RUNE[e.value ?? -1] ?? null, action: e.type.endsWith("BOTTLE") ? "BOTTLE" : "PICKUP" });
        break;
      }
      case "obs":
      case "sen": {
        if (e.slot === undefined || !me.has(e.slot)) break;
        me.get(e.slot)!.stats.wards!.push({ time: e.time, type: e.type === "obs" ? 0 : 1, ...({ positionX: Math.round(e.x ?? 0), positionY: Math.round(e.y ?? 0) } as object) });
        break;
      }
      case "obs_left":
      case "sen_left": {
        const by = slotOf(e.attackername);
        if (by === undefined || e.slot === undefined || radiant(by) === radiant(e.slot)) break; // expired, or own ward
        // STRATZ semantics (checked on the same match): isWard = an observer; sentries are "other units"
        me.get(by)!.stats.wardDestruction!.push({ time: e.time, isWard: e.type === "obs_left" });
        break;
      }
    }
  }

  // STRATZ: damage received is cumulative per minute, damage dealt is per minute
  for (const m of me.values()) {
    const r = m.stats.heroDamageReceivedPerMinute!;
    for (let i = 1; i < r.length; i++) r[i]! += r[i - 1]!;
  }

  // --- fountain trips: back in your fountain, alive, from away (not a respawn) ----------
  const spawn = (side: boolean) => {
    const pts = slots.filter((s) => radiant(s) === side).map((s) => intervals.get(s)![0]!).filter((r) => r.x !== undefined);
    return pts.length ? { x: pts.reduce((a, r) => a + r.x!, 0) / pts.length, y: pts.reduce((a, r) => a + r.y!, 0) / pts.length } : undefined;
  };
  const fountain = new Map([true, false].map((side) => [side, spawn(side)]));
  for (const [s, m] of me) {
    const f = fountain.get(radiant(s));
    if (!f) continue;
    const trips = new Array<number>(minutes).fill(0);
    let away = false;
    let aliveFor = 0;
    for (const r of intervals.get(s)!) {
      const alive = (r.life_state ?? 0) === 0;
      aliveFor = alive ? aliveFor + 1 : 0;
      const dist = Math.hypot(r.x! - f.x, r.y! - f.y);
      if (dist > FOUNTAIN_AWAY) away = true;
      if (away && alive && aliveFor > 10 && dist <= FOUNTAIN_IN && r.time > 0) {
        trips[minuteOf(r.time)]!++;
        away = false;
      }
      if (!alive) away = false; // dying is not a trip; the respawn starts at home
    }
    m.stats.tripsFountainPerMinute = trips;
  }

  // --- HP, mana, gold, items from our extractor (ADR-055) -----------------------------
  let health: StratzHealth | undefined;
  if (ctx.extract) {
    const ex = readExtract(ctx.extract);
    const off = extractOffset(ex, intervals);
    health = { players: [] };
    const keys = ["item0", "item1", "item2", "item3", "item4", "item5", "backPack0", "backPack1", "backPack2", "neutral0"] as const;
    for (const [s, rows0] of ex) {
      const m = me.get(s);
      if (!m) continue;
      const rows = rows0.map((r) => ({ ...r, t: r.t + off }));
      const hp: Array<{ time: number; hp: number; maxHp: number; mp: number; maxMp: number }> = [];
      const inv: StratzInventory[] = [];
      let lastInv = "";
      for (const r of rows) {
        const p = hp[hp.length - 1];
        if (!p || p.hp !== r.hp || p.maxHp !== r.mhp || Math.abs(p.mp - r.mp) >= 5 || p.maxMp !== r.mmp) hp.push({ time: r.t, hp: r.hp, maxHp: r.mhp, mp: r.mp, maxMp: r.mmp });
        const sig = r.it.join(",") + "|" + r.ch.join(",");
        if (sig !== lastInv) {
          lastInv = sig;
          const ev: StratzInventory = { time: r.t };
          r.it.forEach((name, i) => {
            const id = name ? itemId.get(name.replace(/^item_/, "")) : undefined;
            if (id && keys[i]) (ev as unknown as Record<string, unknown>)[keys[i]!] = { itemId: id, charges: r.ch[i] ?? 0 };
          });
          inv.push(ev);
        }
      }
      (m.playbackData as Record<string, unknown>).playerUpdateHealthEvents = hp;
      m.playbackData.inventoryEvents = inv;
      health.players.push({ playerSlot: playerSlot(s), playbackData: { playerUpdateHealthEvents: hp } });
      // gold on hand a second before each death; a heal in the bag (our rule, not STRATZ's)
      for (const d of m.playbackData.deathEvents!) {
        const r = at(rows.map((x) => ({ ...x, time: x.t })), d.time - 1);
        if (!r) continue;
        d.reliableGold = r.rg;
        d.unreliableGold = r.ug;
        d.hasHealAvailable = r.it.some((k, i) => !!k && (HEAL_ITEMS.test(k) || (/^item_magic_(wand|stick)$/.test(k) && (r.ch[i] ?? 0) >= WAND_HEAL_CHARGES)));
      }
    }
    // --- who saw whom before each death (ADR-056): the team visibility bits -------------
    const seen = new Map<number, Map<number, ExtractRow>>(); // slot -> time (parser clock) -> row
    for (const [s, rows] of ex) seen.set(s, new Map(rows.map((r) => [r.t + off, r])));
    const sees = (byRadiant: boolean, target: number, t: number) => {
      const r = seen.get(target)?.get(t);
      const v = r ? (byRadiant ? r.vr : r.vd) : undefined;
      return v === undefined || v < 0 ? undefined : v === 1;
    };
    for (const [s, m] of me) {
      const enemies = slots.filter((o) => radiant(o) !== radiant(s));
      for (const d of m.playbackData.deathEvents!) {
        const de = d as DeathVision & typeof d;
        const hits = (hitsOn.get(s) ?? []).filter((t) => t <= d.time && t >= d.time - FIGHT_LOOKBACK);
        const first = Math.floor(hits.length ? Math.min(...hits) : d.time);
        if (sees(!radiant(s), s, first) === undefined) continue; // no visibility data here
        // how long the enemy had sight of you, without a break, before the first hit
        let lead = 0;
        while (lead < VISION_CAP && sees(!radiant(s), s, first - lead - 1)) lead++;
        // how long your team had sight of any of the killers before the first hit
        const killers = [d.attacker, ...((de as { assist?: number[] }).assist ?? [])]
          .map((h) => slots.find((o) => heroIdOf.get(o) === h))
          .filter((o): o is number => o !== undefined && radiant(o) !== radiant(s));
        let saw = 0;
        while (saw < VISION_CAP && killers.some((k) => sees(radiant(s), k, first - saw))) saw++;
        // enemies your team had not seen for MISSING_FOR s when the fight started
        const missing = enemies.filter((o) => {
          for (let t = first; t > first - MISSING_FOR; t--) if (sees(radiant(s), o, t) !== false) return false;
          return true;
        }).length;
        de.vision = { enemySawFor: lead, sawKillersFor: killers.length ? saw : null, missing, firstHit: first };
      }
    }
  }

  // --- positions (map cells), on change ---------------------------------------------
  const positions: StratzPositions = {
    players: slots.map((s) => {
      const out: Array<{ time: number; x: number; y: number }> = [];
      for (const r of intervals.get(s)!) {
        if (r.time < -90) continue;
        const x = Math.round(r.x!);
        const y = Math.round(r.y!);
        const p = out[out.length - 1];
        if (!p || p.x !== x || p.y !== y) out.push({ time: r.time, x, y });
      }
      return { playerSlot: playerSlot(s), playbackData: { playerUpdatePositionEvents: out } };
    }),
  };
  const vision: StratzVision = {
    players: slots.map((s) => ({ playerSlot: playerSlot(s), stats: { campStack: me.get(s)!.stats.campStack, wards: me.get(s)!.stats.wards, wardDestruction: me.get(s)!.stats.wardDestruction } })),
  };

  // --- summary ----------------------------------------------------------------------
  const radiantWin = od?.radiant_win ?? (winner === 2 ? true : winner === 3 ? false : undefined);
  if (radiantWin === undefined) return undefined;
  const tiers = (od?.players ?? []).map((p) => p.rank_tier ?? 0).filter((t) => t > 0);
  const avgTier = tiers.length ? tiers.reduce((a, b) => a + b, 0) / tiers.length : undefined;
  const mode = od?.game_mode ?? gameMode;
  const summary: StratzSummary = {
    id: od?.match_id ?? 0,
    durationSeconds: duration,
    gameMode: mode !== undefined && Number.isFinite(mode) ? (GAME_MODE[mode] ?? `MODE_${mode}`) : null,
    lobbyType: od?.lobby_type !== undefined ? (LOBBY[od.lobby_type] ?? `LOBBY_${od.lobby_type}`) : null,
    didRadiantWin: radiantWin,
    ...(od?.start_time ? { startDateTime: od.start_time } : endTime && Number.isFinite(endTime) ? { startDateTime: endTime - duration } : {}),
    averageRank: avgTier !== undefined ? Math.round(avgTier) : null,
    // rank_tier 11..80: the tens are the medal (1 Herald .. 8 Immortal), like STRATZ's bracket
    bracket: avgTier !== undefined ? Math.max(1, Math.min(8, Math.round(avgTier / 10))) : null,
    players: slots.map((s) => {
      const l = last(s);
      const o = odBy.get(playerSlot(s));
      const name = o?.personaname ?? nameOf.get(s);
      return {
        playerSlot: playerSlot(s),
        steamAccountId: accountOf.get(s) ?? null,
        steamAccount: { ...(name ? { name } : {}), isAnonymous: od ? !o?.account_id : null },
        isRadiant: radiant(s),
        heroId: heroIdOf.get(s) ?? 0,
        position: posOf.has(s) ? `POSITION_${posOf.get(s)}` : null,
        lane: laneOf(posOf.get(s)),
        isVictory: radiant(s) === radiantWin,
        kills: l.kills ?? 0,
        deaths: l.deaths ?? 0,
        assists: l.assists ?? 0,
        networth: l.networth ?? 0,
        numLastHits: l.lh ?? 0,
        numDenies: l.denies ?? 0,
        imp: null,
        stats: { networthPerMinute: me.get(s)!.stats.networthPerMinute, lastHitsPerMinute: me.get(s)!.stats.lastHitsPerMinute },
      };
    }),
  };
  const players: Record<string, StratzMe> = {};
  for (const s of slots) {
    const acc = accountOf.get(s);
    if (acc) players[String(acc)] = me.get(s)!;
  }
  return { summary, players, positions, vision, ...(health ? { health } : {}), source: "replay" };
}
