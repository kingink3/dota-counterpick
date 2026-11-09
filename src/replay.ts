// =============================================================================
//  Replay timeline (ADR-045): what the .dem adds to a match, cut down to what the
//  review uses. Built in Actions from odota/parser's NDJSON (ADR-043), stored
//  encrypted inside the match. Pure: no I/O.
//
//    heroes[slot]  per second from `start`: x, y (map cells x10, integers), alive (1/0),
//                  lh (last hits + denies), xp, gold
//    disables      stuns / silences / hexes / roots / fears ... on heroes, with duration
// =============================================================================

export interface ReplayHero {
  hero: string; // npc_dota_hero_*
  x: number[];
  y: number[];
  alive: number[];
  lh: number[];
  xp: number[];
  gold: number[];
}

export interface ReplayDisable {
  /** start, seconds of game time. */
  t: number;
  /** duration, seconds. */
  d: number;
  /** player slot of the hero it landed on (0-4 Radiant, 128-132 Dire). */
  slot: number;
  /** the modifier, e.g. modifier_stunned. */
  kind: string;
}

/** a building, Roshan or Tormentor that died, and who hit it shortly before (ADR-051). */
export interface ReplayObjective {
  t: number;
  kind: "tower" | "rax" | "fort" | "roshan" | "tormentor";
  /** for buildings: whose building it was. */
  owner?: "radiant" | "dire";
  /** player slots whose hero (or its summons) damaged it in the last OBJ_WINDOW s. */
  by: number[];
}

export interface ReplayTimeline {
  v: 1;
  /** game time (s) of index 0. */
  start: number;
  heroes: Record<string, ReplayHero>;
  disables: ReplayDisable[];
  /** ADR-051 (older stored matches lack these). */
  objectives?: ReplayObjective[];
  /** building damage per player slot, end of game. */
  towerDamage?: Record<string, number>;
}

/** how far back damage counts as taking part: buildings fall fast, Roshan takes a while. */
export const OBJ_WINDOW = { building: 20, boss: 60 } as const;
const objKind = (name: string): ReplayObjective["kind"] | undefined =>
  /^npc_dota_(goodguys|badguys)_tower/.test(name) ? "tower"
  : /^npc_dota_(goodguys|badguys)_(melee|range)_rax/.test(name) ? "rax"
  : /^npc_dota_(goodguys|badguys)_fort/.test(name) ? "fort"
  : name === "npc_dota_roshan" ? "roshan"
  : /miniboss|tormentor/.test(name) ? "tormentor" // name not yet seen in a parsed match (ADR-051)
  : undefined;

/** modifiers that stop you from acting (casting or moving the way you want). */
export const DISABLE_RE = /stun|hex|sheep|silence|taunt|fear|cyclone|eul|sleep|nightmare|root|ensnare|bash|frozen|freeze|petrif|banish|disarm|duel|black_hole|chrono|reverse_polarity|fiends_grip|shackle|dream_coil|mute|doom/;
/** ...except these, which only slow or are positive. */
const NOT_DISABLE_RE = /slow|immune|_aura|debuff_immune|buff$|charge_counter/;

/** one key for both spellings of a hero: interval rows say CDOTA_Unit_Hero_DarkWillow, the
 *  combat log npc_dota_hero_dark_willow (checked on a real parse, ADR-045). */
export const heroKey = (name: string): string =>
  name.toLowerCase().replace(/^cdota_unit_hero_|^npc_dota_hero_/, "").replace(/[^a-z0-9]/g, "");

/** odota/parser `slot` (0-9) -> player slot (0-4, 128-132). */
export const playerSlot = (s: number): number => (s < 5 ? s : 128 + s - 5);

interface IntervalEvt { type: "interval"; time: number; slot: number; unit?: string; x?: number; y?: number; life_state?: number; lh?: number; denies?: number; xp?: number; gold?: number }
interface ModEvt { type: string; time: number; targetname?: string; targethero?: boolean; targetillusion?: boolean; inflictor?: string; stun_duration?: number; sourcename?: string; attackername?: string }

/** NDJSON lines of odota/parser -> timeline. Lines that are not JSON are skipped. */
export function buildTimeline(lines: Iterable<string>): ReplayTimeline | undefined {
  const rows = new Map<number, IntervalEvt[]>(); // slot -> events
  const opened = new Map<string, { t: number; slotName: string; kind: string; d?: number }>();
  const mods: Array<{ t: number; d: number; target: string; kind: string }> = [];
  const objHits = new Map<string, Array<{ t: number; src: string }>>(); // target -> hits
  const objDeaths: Array<{ t: number; target: string }> = [];
  const towerDmg = new Map<number, number>(); // parser slot -> last tower_damage
  let start = Infinity;
  let end = -Infinity;
  for (const line of lines) {
    if (!line || line[0] !== "{") continue;
    let e: IntervalEvt | ModEvt;
    try {
      e = JSON.parse(line) as IntervalEvt | ModEvt;
    } catch {
      continue;
    }
    if (e.type === "interval") {
      const iv = e as IntervalEvt;
      if (iv.time < 0 || iv.x === undefined) continue; // before the horn, or no hero yet
      start = Math.min(start, iv.time);
      end = Math.max(end, iv.time);
      (rows.get(iv.slot) ?? rows.set(iv.slot, []).get(iv.slot)!).push(iv);
      const td = (e as IntervalEvt & { tower_damage?: number }).tower_damage;
      if (typeof td === "number") towerDmg.set(iv.slot, td);
    } else if (e.type === "DOTA_COMBATLOG_DAMAGE" || e.type === "DOTA_COMBATLOG_DEATH") {
      const m = e as ModEvt;
      if (!m.targetname || !objKind(m.targetname)) continue;
      if (e.type === "DOTA_COMBATLOG_DEATH") objDeaths.push({ t: m.time, target: m.targetname });
      const src = m.sourcename ?? m.attackername;
      if (src && /^npc_dota_hero_/.test(src)) (objHits.get(m.targetname) ?? objHits.set(m.targetname, []).get(m.targetname)!).push({ t: m.time, src });
    } else if (e.type === "DOTA_COMBATLOG_MODIFIER_ADD" || e.type === "DOTA_COMBATLOG_MODIFIER_REMOVE") {
      const m = e as ModEvt;
      if (!m.targethero || m.targetillusion || !m.targetname || !m.inflictor) continue;
      if (!DISABLE_RE.test(m.inflictor) || NOT_DISABLE_RE.test(m.inflictor)) continue;
      const key = `${m.targetname}|${m.inflictor}`;
      if (e.type === "DOTA_COMBATLOG_MODIFIER_ADD") {
        if (!opened.has(key)) opened.set(key, { t: m.time, slotName: m.targetname, kind: m.inflictor, ...(m.stun_duration ? { d: m.stun_duration } : {}) });
      } else {
        const o = opened.get(key);
        if (o) {
          opened.delete(key);
          const d = m.time - o.t;
          if (d > 0 && d < 30) mods.push({ t: o.t, d, target: o.slotName, kind: o.kind });
        }
      }
    }
  }
  // never closed (died with it, end of the replay): the duration the log gave, if any
  for (const o of opened.values()) if (o.d && o.d > 0 && o.d < 30) mods.push({ t: o.t, d: o.d, target: o.slotName, kind: o.kind });
  if (!rows.size || !Number.isFinite(start)) return undefined;

  const n = end - start + 1;
  const heroes: Record<string, ReplayHero> = {};
  const slotOfHero = new Map<string, number>();
  for (const [slot, evs] of rows) {
    evs.sort((a, b) => a.time - b.time);
    const h: ReplayHero = { hero: evs.find((x) => x.unit)?.unit ?? "", x: [], y: [], alive: [], lh: [], xp: [], gold: [] };
    let j = 0;
    let last = evs[0]!;
    for (let i = 0; i < n; i++) {
      const t = start + i;
      while (j < evs.length && evs[j]!.time <= t) last = evs[j++]!;
      h.x.push(Math.round((last.x ?? 0) * 10));
      h.y.push(Math.round((last.y ?? 0) * 10));
      h.alive.push(last.life_state === undefined || last.life_state === 0 ? 1 : 0);
      h.lh.push((last.lh ?? 0) + (last.denies ?? 0));
      h.xp.push(last.xp ?? 0);
      h.gold.push(last.gold ?? 0);
    }
    const ps = playerSlot(slot);
    heroes[String(ps)] = h;
    if (h.hero) slotOfHero.set(heroKey(h.hero), ps);
  }
  const disables: ReplayDisable[] = mods
    .filter((m) => slotOfHero.has(heroKey(m.target)))
    .map((m) => ({ t: Math.round(m.t * 10) / 10, d: Math.round(m.d * 10) / 10, slot: slotOfHero.get(heroKey(m.target))!, kind: m.kind }))
    .sort((a, b) => a.t - b.t);
  const objectives: ReplayObjective[] = objDeaths
    .map((o) => {
      const kind = objKind(o.target)!;
      const win = kind === "roshan" || kind === "tormentor" ? OBJ_WINDOW.boss : OBJ_WINDOW.building;
      const by = new Set<number>();
      for (const h of objHits.get(o.target) ?? []) if (h.t <= o.t && h.t >= o.t - win && slotOfHero.has(heroKey(h.src))) by.add(slotOfHero.get(heroKey(h.src))!);
      const owner = /goodguys/.test(o.target) ? "radiant" : /badguys/.test(o.target) ? "dire" : undefined;
      return { t: Math.round(o.t), kind, ...(owner ? { owner } : {}), by: [...by].sort((a, b) => a - b) } as ReplayObjective;
    })
    .sort((a, b) => a.t - b.t);
  const towerDamage: Record<string, number> = {};
  for (const [slot, v] of towerDmg) towerDamage[String(playerSlot(slot))] = v;
  return { v: 1, start, heroes, disables, objectives, towerDamage };
}

/** is the hero in `slot` under a disable at game time t? */
export function disabledAt(tl: ReplayTimeline, slot: number): (t: number) => boolean {
  const mine = tl.disables.filter((d) => d.slot === slot);
  return (t) => mine.some((d) => t >= d.t && t < d.t + d.d);
}
