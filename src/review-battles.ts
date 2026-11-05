// =============================================================================
//  Battle analysis for the match review (ADR-029b). Pure.
//
//  A battle = your deaths / kills / assists, sharp HP drops and spells on enemy heroes,
//  clustered (gap <= 20 s), with 5+ heroes near you at some moment, 2+ of each side
//  (2v3 / 3v2 or bigger: a 2v2 is any side lane - ADR-029i), at some
//  moment (you count). 1-on-1 pick-offs are left to the death checks.
//  Inside a battle, every 0.5 s while you are alive, each active ability / combat item
//  is "ready" when its cooldown (at its current level) is over and you have the mana.
//  A chance = a stretch it is ready AND usable:
//    enemy spells (Shackleshot, Orchid, Powershot): an enemy hero within cast range + radius
//      (+300 units you can walk);
//    ally spells (Glimmer, Force, Mekansm): an allied core (pos 1-3) in range losing HP;
//    saves on yourself (Windrun, BKB, Blink, Wand): only your last 5 s before dying.
//  A chance ending in a cast is used; 2+ s without one is missed (1 s to react is not
//  counted). Cooldown reduction, stuns on you and vision are not in the data.
//  Targets: who your unit-target enemy spells went on (core / support) and whether
//  that hero died within 8 s. Positioning: were you the closest of your team to the
//  enemy when you died, did you die deep on their half.
// =============================================================================

import type { StratzHealth, StratzMe, StratzPositions, StratzSummary } from "./review.js";

export interface AbilityInfo {
  k: string;
  n: string;
  cd: number[];
  mc: number[];
  /** p passive, h hidden (shard / scepter / sub-ability), u unit target, t point target, n no target,
   *  e enemy target, a ally target, c channelled */
  f: string;
  /** cast range and effect radius, world units (max over levels). */
  r?: number;
  ra?: number;
}

/** what makes a moment a chance to use it. */
export type UseKind = "enemy" | "ally" | "save";

export interface UseStat {
  name: string;
  kind: "ability" | "item";
  /** enemy: an enemy hero in reach; ally: an allied core in reach losing HP; save: your last 5 s before dying. */
  use: UseKind;
  /** reach in world units (cast range + radius) for enemy / ally uses. */
  reach?: number;
  /** battles where it was available. */
  battles: number;
  casts: number;
  /** chances: stretches it was ready (cooldown, mana, alive) with the use condition met. */
  windows: number;
  /** chances that ended in a cast. */
  used: number;
  /** chances of 2+ s (saves: 1.5+ s) with no cast. */
  missed: number;
  /** seconds of the missed chances, minus 1 s to react each. */
  idle: number;
  /** longest missed chance, seconds. */
  longest: number;
  /** seconds off cooldown at all (no use condition), while alive in battles. */
  ready: number;
  /** seconds off cooldown but without the mana for it. */
  manaShort: number;
  /** seconds alive in the battles where it was available. */
  alive: number;
  /** cooldown range over its levels, seconds. */
  cd?: [number, number];
  ult?: boolean;
  /** 2 = the ultimate or control (stun, hex, silence, root...), 1 = routine (ADR-029f). */
  weight: 1 | 2;
}

export interface Battle {
  from: number;
  to: number;
  died: boolean;
  kills: number;
  assists: number;
  uses: UseStat[];
  /** most heroes of each side near you at one moment (you count). */
  allies?: number;
  enemies?: number;
  /** your side near you (you count) vs theirs at your death: 2+ fewer, or 2 v 3+. */
  outnumbered?: boolean;
  /** you were the closest of your team to the enemy just before dying. */
  frontmost?: boolean;
  /** died on the enemy half of the map. */
  deep?: boolean;
  /** nothing cast in the last 10 s before dying while alive. */
  silentDeath?: boolean;
  enemiesNear?: number;
  alliesNear?: number;
}

export interface TargetStat {
  name: string;
  casts: number;
  onCores: number;
  onSupports: number;
  /** the target died within 8 s (you got the kill or an assist). */
  converted: number;
}

export interface BattleReport {
  battles: Battle[];
  totals: UseStat[];
  targets: TargetStat[];
  /** allies' HP was loaded: saves on cores were judged. */
  allyHealth: boolean;
}

/**
 * Combat actives: how they are used and their reach (cast range + radius, world units; Dota wiki
 * values as of 7.39-7.40 - dotaconstants has no item cast ranges). Saves count only at your death.
 */
const ITEM_USE: Record<string, [UseKind, number?]> = {
  // on an enemy
  orchid: ["enemy", 900], bloodthorn: ["enemy", 900], sheepstick: ["enemy", 800], rod_of_atos: ["enemy", 1100], gungir: ["enemy", 1375],
  nullifier: ["enemy", 900], abyssal_blade: ["enemy", 150], heavens_halberd: ["enemy", 650], diffusal_blade: ["enemy", 600],
  disperser: ["enemy", 600], harpoon: ["enemy", 700], ethereal_blade: ["enemy", 800], spirit_vessel: ["enemy", 950],
  urn_of_shadows: ["enemy", 950], medallion_of_courage: ["enemy", 1000], dagon: ["enemy", 800], dagon_2: ["enemy", 800],
  dagon_3: ["enemy", 800], dagon_4: ["enemy", 800], dagon_5: ["enemy", 800], shivas_guard: ["enemy", 900], veil_of_discord: ["enemy", 1200],
  // on an allied core (and yourself at death)
  glimmer_cape: ["ally", 600], lotus_orb: ["ally", 900], solar_crest: ["ally", 1000], force_staff: ["ally", 550], hurricane_pike: ["ally", 650],
  wind_waker: ["ally", 550], holy_locket: ["ally", 500], mekansm: ["ally", 1200], guardian_greaves: ["ally", 1200], pipe: ["ally", 1200],
  crimson_guard: ["ally", 1200],
  // on yourself
  black_king_bar: ["save"], ghost: ["save"], satanic: ["save"], manta: ["save"], blade_mail: ["save"], invis_sword: ["save"],
  silver_edge: ["save"], blink: ["save"], overwhelming_blink: ["save"], swift_blink: ["save"], arcane_blink: ["save"],
  cyclone: ["save"], magic_wand: ["save"], magic_stick: ["save"], faerie_fire: ["save"],
};
/** items that disable (weighted x2 like control spells). */
const CONTROL_ITEMS = new Set(["sheepstick", "orchid", "bloodthorn", "abyssal_blade", "rod_of_atos", "gungir", "heavens_halberd", "harpoon", "wind_waker", "cyclone"]);
/** weighted share of chances used: the ultimate and control count double. */
export function castRate(us: readonly UseStat[]): { used: number; windows: number; rate?: number } {
  const used = us.reduce((a, u) => a + u.used * (u.weight ?? 1), 0);
  const windows = us.reduce((a, u) => a + u.windows * (u.weight ?? 1), 0);
  return { used, windows, ...(windows ? { rate: used / windows } : {}) };
}

const STEP = 0.5;
const GAP = 20;
const CELL = 64; // world units per map cell (STRATZ positions)
const BATTLE_R = 40; // map cells: heroes this close to you are in the battle
const NEAR = 30; // map cells (~1900 world units)
const WALK = 300; // you can close ~1 s of distance before casting
const REACT = 1; // seconds to react, not counted as missed
const SAVE_LOOKBACK = 5;

type Inv = { itemId?: number | null; charges?: number | null } | null | undefined;
type HealthEvt = { time: number; hp: number; maxHp: number };

/** last element with time <= t (events sorted by time). */
function lastAt<T extends { time: number }>(evs: readonly T[], t: number): T | undefined {
  let lo = 0;
  let hi = evs.length - 1;
  let best = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (evs[mid]!.time <= t) {
      best = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return best >= 0 ? evs[best] : undefined;
}

/** how an ability is used, from its target flags. */
function abilityUse(a: AbilityInfo): { use: UseKind; reach?: number } | undefined {
  const f = a.f;
  if (f.includes("p")) return undefined;
  if (f.includes("u")) {
    if (f.includes("a") && !f.includes("e")) return { use: "ally", reach: a.r ?? 600 };
    return { use: "enemy", reach: a.r ?? 600 };
  }
  if (f.includes("t")) {
    if (f.includes("a") && !f.includes("e")) return { use: "ally", reach: (a.r ?? 600) + (a.ra ?? 0) };
    return { use: "enemy", reach: (a.r ?? 600) + (a.ra ?? 0) };
  }
  // no target: an area around you hits enemies; otherwise a buff / escape on yourself
  if (a.ra && !f.includes("a")) return { use: "enemy", reach: a.ra };
  return { use: "save" };
}

export function analyseBattles(
  summary: StratzSummary,
  me: StratzMe,
  positions: StratzPositions | undefined,
  ids: { items: Record<string, string>; cd: Record<string, number>; mc?: Record<string, number>; names: Record<string, string>; abilities?: Record<string, AbilityInfo> },
  itemLabel: (k: string) => string,
  ultIds: Set<number> = new Set(),
  health?: StratzHealth,
): BattleReport | undefined {
  const pb = me.playbackData as (StratzMe["playbackData"] & {
    playerUpdateHealthEvents?: Array<{ time: number; hp: number; maxHp: number; mp?: number | null; maxMp?: number | null }> | null;
    killEvents?: Array<{ time: number; target?: number | null }> | null;
    assistEvents?: Array<{ time: number; target?: number | null }> | null;
    abilityUsedEvents?: Array<{ time: number; abilityId?: number | null; target?: number | null }> | null;
  }) | undefined;
  if (!pb || !ids.abilities) return undefined;
  const AB = ids.abilities;
  const deaths = pb.deathEvents ?? [];
  const kills = pb.killEvents ?? [];
  const assists = pb.assistEvents ?? [];
  const hp = pb.playerUpdateHealthEvents ?? [];
  const casts = ((pb.abilityUsedEvents ?? []) as Array<{ time: number; abilityId?: number | null; target?: number | null }>).filter((a) => a.abilityId != null);
  const itemUses = (pb.itemUsedEvents ?? []).map((u) => ({ t: u.time, k: ids.items[String(u.itemId)] })).filter((u): u is { t: number; k: string } => !!u.k);
  const inv = (pb.inventoryEvents ?? []) as Array<{ time: number } & Record<string, Inv>>;
  const SLOTS = ["item0", "item1", "item2", "item3", "item4", "item5"];

  // --- battles ---------------------------------------------------------------------
  const anchors: Array<{ t: number; kind: "death" | "kill" | "assist" | "hit" }> = [
    ...deaths.map((d) => ({ t: d.time, kind: "death" as const })),
    ...kills.map((k) => ({ t: k.time, kind: "kill" as const })),
    ...assists.map((a) => ({ t: a.time, kind: "assist" as const })),
  ];
  for (let i = 0, j = 0; i < hp.length; i++) {
    while (hp[j]!.time < hp[i]!.time - 5) j++;
    if (hp[i]!.maxHp > 0 && hp[j]!.hp - hp[i]!.hp >= 0.15 * hp[i]!.maxHp) anchors.push({ t: hp[i]!.time, kind: "hit" });
  }
  const enemyHeroes = new Set(summary.players.filter((p) => p.isRadiant !== me.isRadiant).map((p) => p.heroId));
  for (const c of casts) if (c.target && enemyHeroes.has(c.target)) anchors.push({ t: c.time, kind: "hit" });
  anchors.sort((a, b) => a.t - b.t);
  const groups: Array<typeof anchors> = [];
  for (const a of anchors) {
    const g = groups[groups.length - 1];
    if (g && a.t - g[g.length - 1]!.t <= GAP) g.push(a);
    else groups.push([a]);
  }

  const deadAt = (t: number) => deaths.some((d) => t >= d.time && t < d.time + (d.timeDead ?? 25));
  const mpAt = (t: number) => lastAt(hp, t)?.mp ?? undefined;
  const invAt = (t: number) => lastAt(inv, t);

  // ability level at t: learn events (each is one level up; level field is 0-based)
  const learns = (pb.abilityLearnEvents ?? []) as Array<{ time: number; abilityId?: number | null; level?: number | null }>;
  const levelAt = (id: number, t: number) => {
    let lv = -1;
    for (const l of learns) if (l.abilityId === id && l.time <= t) lv = Math.max(lv, l.level ?? 0);
    return lv;
  };
  const firstCast = new Map<number, number>();
  for (const c of casts) if (!firstCast.has(c.abilityId!)) firstCast.set(c.abilityId!, c.time);
  const myAbilities = [...new Set([...learns.map((l) => l.abilityId), ...casts.map((c) => c.abilityId)])].filter(
    (id): id is number => id != null && !!AB[String(id)] && !AB[String(id)]!.f.includes("p") && AB[String(id)]!.cd.length > 0,
  );
  const castTimes = (id: number) => casts.filter((c) => c.abilityId === id).map((c) => c.time);
  const itemTimes = (k: string) => itemUses.filter((u) => u.k === k).map((u) => u.t);

  // positions (map cells) and HP of every hero
  const mine = summary.players.find((p) => p.playerSlot === me.playerSlot);
  const posBySlot = new Map((positions?.players ?? []).map((p) => [p.playerSlot, p.playbackData?.playerUpdatePositionEvents ?? []]));
  const posAt = (slot: number, t: number) => {
    const best = lastAt(posBySlot.get(slot) ?? [], t + 1);
    return best && t - best.time <= 8 ? best : undefined;
  };
  const hpBySlot = new Map((health?.players ?? []).map((p) => [p.playerSlot, (p.playbackData?.playerUpdateHealthEvents ?? []) as HealthEvt[]]));
  const allyCores = summary.players.filter(
    (p) => mine && p.isRadiant === mine.isRadiant && p.playerSlot !== mine.playerSlot && /POSITION_[123]/.test(p.position ?? "") && (hpBySlot.get(p.playerSlot)?.length ?? 0) > 0,
  );
  const enemySlots = summary.players.filter((p) => mine && p.isRadiant !== mine.isRadiant).map((p) => p.playerSlot);
  const distCells = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);
  /** an enemy hero within reach (world units) of you at t; a hero whose HP is known to be 0 does not count. */
  const enemyInReach = (t: number, reach: number) => {
    const meP = mine && posAt(mine.playerSlot, t);
    if (!meP) return false;
    return enemySlots.some((slot) => {
      const q = posAt(slot, t);
      const h = lastAt(hpBySlot.get(slot) ?? [], t);
      return !!q && (!h || h.hp > 0) && distCells(meP, q) * CELL <= reach + WALK;
    });
  };
  /** an allied core within reach, alive and losing HP: 12%+ of max in the last 3 s and under 75%. */
  const coreInTrouble = (t: number, reach: number) => {
    const meP = mine && posAt(mine.playerSlot, t);
    if (!meP) return false;
    return allyCores.some((p) => {
      const evs = hpBySlot.get(p.playerSlot)!;
      const now = lastAt(evs, t);
      const before = lastAt(evs, t - 3);
      const q = posAt(p.playerSlot, t);
      if (!now || !before || !q || now.hp <= 0 || now.maxHp <= 0) return false;
      return before.hp - now.hp >= 0.12 * now.maxHp && now.hp / now.maxHp < 0.75 && distCells(meP, q) * CELL <= reach + WALK;
    });
  };

  // 5+ heroes, 2+ of each side, within BATTLE_R of you (you count) at one of the moments
  const sidesAt = (t: number): { allies: number; enemies: number } | undefined => {
    if (!mine) return undefined;
    const meP = posAt(mine.playerSlot, t);
    if (!meP) return undefined;
    let allies = 1;
    let enemies = 0;
    for (const p of summary.players) {
      if (p.playerSlot === mine.playerSlot) continue;
      const q = posAt(p.playerSlot, t);
      if (!q || distCells(q, meP) > BATTLE_R) continue;
      if (p.isRadiant === mine.isRadiant) allies++;
      else enemies++;
    }
    return { allies, enemies };
  };
  const sized = groups.map((g) => {
    let allies = 0;
    let enemies = 0;
    let both = false;
    for (const a of g) {
      for (const dt of [0, -3]) {
        const s = sidesAt(a.t + dt);
        if (!s) continue;
        allies = Math.max(allies, s.allies);
        enemies = Math.max(enemies, s.enemies);
        // 2v3 / 3v2 or bigger: a 2v2 is just a side lane (ADR-029i)
        if (s.allies >= 2 && s.enemies >= 2 && s.allies + s.enemies >= 5) both = true;
      }
    }
    // a kill / assist / death of yours, or a big clash (3+ a side) you were in - lane harass is not a battle
    const real = g.some((a) => a.kind !== "hit") || (allies >= 3 && enemies >= 3 && g.length >= 3);
    // without positions: fall back to "you killed / assisted / died"
    const ok = positions ? both && real : g.some((a) => a.kind !== "hit");
    return { g, ok, allies, enemies };
  });
  const battles: Battle[] = sized.filter((x) => x.ok).map(({ g, allies, enemies }) => {
    const died = g.find((a) => a.kind === "death");
    const from = g[0]!.t - 5;
    const to = died ? died.t : g[g.length - 1]!.t + 5;
    const uses: UseStat[] = [];

    /** chance condition for a use at t (positions needed for enemy / ally). */
    const chance = (use: UseKind, reach: number | undefined, t: number): boolean => {
      if (use === "save") return !!died && t >= died.t - SAVE_LOOKBACK;
      if (!positions) return use === "enemy"; // no positions: every ready moment counts (old behaviour)
      if (use === "enemy") return enemyInReach(t, reach ?? 600);
      // an allied core in trouble; ally spells can go on you too - so also your last seconds
      return coreInTrouble(t, reach ?? 600) || (!!died && t >= died.t - SAVE_LOOKBACK);
    };

    const track = (
      name: string,
      kind: UseStat["kind"],
      use: { use: UseKind; reach?: number },
      extra: Pick<UseStat, "cd" | "ult" | "weight">,
      times: number[],
      cdAt: (t: number) => number | undefined,
      mcAt: (t: number) => number,
      availAt: (t: number) => boolean,
    ) => {
      const st: UseStat = { ...extra, name, kind, ...use, battles: 1, casts: times.filter((x) => x >= from && x <= to).length, windows: 0, used: 0, missed: 0, idle: 0, longest: 0, ready: 0, manaShort: 0, alive: 0 };
      const minRun = use.use === "save" ? 1.5 : 2;
      let run = 0;
      let any = false;
      const close = (castEnded: boolean) => {
        if (castEnded) {
          st.windows++;
          st.used++;
        } else if (run >= minRun) {
          st.windows++;
          st.missed++;
          st.idle += run - (use.use === "save" ? 0 : REACT);
          st.longest = Math.max(st.longest, run);
        }
        run = 0;
      };
      for (let t = from; t < to; t += STEP) {
        const castNow = times.some((x) => x >= t && x < t + STEP);
        if (deadAt(t) || !availAt(t)) {
          close(false);
          continue;
        }
        const cd = cdAt(t);
        if (cd === undefined) continue;
        any = true;
        st.alive += STEP;
        const last = times.filter((x) => x < t).pop();
        const offCd = last === undefined || t >= last + cd;
        if (!offCd) {
          close(false);
          continue;
        }
        const mp = mpAt(t);
        if (mp !== undefined && mp < mcAt(t)) {
          st.manaShort += STEP;
          close(false);
          continue;
        }
        st.ready += STEP;
        if (castNow) {
          // a cast ends the chance it was in; a cast with no chance we can see (fog, a target out of our data) is not one
          if (run > 0 || chance(use.use, use.reach, t)) close(true);
          else close(false);
          continue;
        }
        if (chance(use.use, use.reach, t)) run += STEP;
        else close(false);
      }
      close(false);
      if (any) uses.push(st);
    };

    for (const id of myAbilities) {
      const a = AB[String(id)]!;
      const u = abilityUse(a);
      if (!u) continue;
      const hidden = a.f.includes("h");
      track(
        a.n,
        "ability",
        u,
        { cd: [Math.min(...a.cd), Math.max(...a.cd)], ...(ultIds.has(id) ? { ult: true } : {}), weight: ultIds.has(id) || a.f.includes("x") ? 2 : 1 },
        castTimes(id),
        (t) => {
          const lv = hidden ? 0 : levelAt(id, t);
          return lv < 0 ? undefined : a.cd[Math.min(lv, a.cd.length - 1)];
        },
        (t) => {
          const lv = Math.max(0, hidden ? 0 : levelAt(id, t));
          return a.mc.length ? a.mc[Math.min(lv, a.mc.length - 1)]! : 0;
        },
        // shard / scepter abilities: available once they were first used
        (t) => !hidden || (firstCast.get(id) ?? Infinity) <= t,
      );
    }
    const held = new Set<string>();
    for (let t = from; t < to; t += 2) {
      const ev = invAt(t);
      for (const s of SLOTS) {
        const k = ids.items[String(ev?.[s]?.itemId)];
        if (k && ITEM_USE[k]) held.add(k);
      }
    }
    for (const k of held) {
      const [use, reach] = ITEM_USE[k]!;
      const charged = k === "magic_wand" || k === "magic_stick";
      track(
        itemLabel(k),
        "item",
        { use, ...(reach ? { reach } : {}) },
        { cd: [ids.cd[k] ?? 20, ids.cd[k] ?? 20], weight: CONTROL_ITEMS.has(k) ? 2 : 1 },
        itemTimes(k),
        () => ids.cd[k] ?? 20,
        () => ids.mc?.[k] ?? 0,
        (t) => {
          const ev = invAt(t);
          const slot = SLOTS.map((s) => ev?.[s]).find((x) => ids.items[String(x?.itemId)] === k);
          // Wand / Stick: worth pressing with 2+ charges
          return !!slot && (!charged || (slot.charges ?? 0) >= 2);
        },
      );
    }

    const f: Battle = {
      from,
      to,
      died: !!died,
      kills: g.filter((a) => a.kind === "kill").length,
      assists: g.filter((a) => a.kind === "assist").length,
      uses: uses.sort((a, b) => b.missed - a.missed || b.idle - a.idle),
      allies: positions ? allies : undefined,
      enemies: positions ? enemies : undefined,
    };

    // positioning just before you died
    if (died && positions && mine) {
      const t = died.t - 3;
      const meP = posAt(mine.playerSlot, t);
      const enemies = summary.players.filter((p) => p.isRadiant !== mine.isRadiant).map((p) => posAt(p.playerSlot, t)).filter((p): p is NonNullable<typeof p> => !!p);
      const allies = summary.players.filter((p) => p.isRadiant === mine.isRadiant && p.playerSlot !== mine.playerSlot).map((p) => posAt(p.playerSlot, t)).filter((p): p is NonNullable<typeof p> => !!p);
      if (meP && enemies.length) {
        const nearestEnemy = (p: { x: number; y: number }) => Math.min(...enemies.map((e) => distCells(p, e)));
        const mineD = nearestEnemy(meP);
        const alliesInFight = allies.filter((a) => distCells(a, meP) <= NEAR * 1.5);
        f.enemiesNear = enemies.filter((e) => distCells(e, meP) <= NEAR).length;
        f.alliesNear = allies.filter((a) => distCells(a, meP) <= NEAR).length;
        const team = f.alliesNear + 1;
        f.outnumbered = f.enemiesNear >= team + 2 || (team <= 2 && f.enemiesNear > team);
        f.frontmost = alliesInFight.length > 0 && alliesInFight.every((a) => nearestEnemy(a) > mineD + 2);
      }
      const dd = deaths.find((d) => d.time === died.t);
      if (dd?.positionX != null && dd.positionY != null) {
        const s = dd.positionX + dd.positionY;
        f.deep = mine.isRadiant ? s > 268 : s < 244;
      }
      const lastCast = Math.max(-Infinity, ...casts.map((c) => c.time).filter((x) => x <= died.t), ...itemUses.map((u) => u.t).filter((x) => x <= died.t));
      f.silentDeath = died.t - lastCast > 10 && died.t - g[0]!.t >= 4;
    }
    return f;
  });

  // --- totals across battles ---------------------------------------------------------
  const byName = new Map<string, UseStat>();
  for (const f of battles) {
    for (const u of f.uses) {
      const t = byName.get(u.name);
      if (!t) byName.set(u.name, { ...u });
      else {
        t.battles += 1;
        for (const k of ["casts", "windows", "used", "missed", "idle", "ready", "manaShort", "alive"] as const) t[k] += u[k];
        t.longest = Math.max(t.longest, u.longest);
      }
    }
  }
  const totals = [...byName.values()].sort((a, b) => b.missed - a.missed || b.idle - a.idle);

  // --- targets of unit-target enemy spells in battles ----------------------------------
  const enemyPos = new Map(summary.players.filter((p) => p.isRadiant !== mine?.isRadiant).map((p) => [p.heroId, Number(/(\d)/.exec(p.position ?? "")?.[1] ?? 0)]));
  const inBattle = (t: number) => battles.some((f) => t >= f.from && t <= f.to);
  const targets: TargetStat[] = [];
  for (const id of myAbilities) {
    const a = AB[String(id)]!;
    if (!a.f.includes("u") || !a.f.includes("e")) continue;
    const cs = casts.filter((c) => c.abilityId === id && c.target && enemyPos.has(c.target) && inBattle(c.time));
    if (!cs.length) continue;
    const st: TargetStat = { name: a.n, casts: cs.length, onCores: 0, onSupports: 0, converted: 0 };
    for (const c of cs) {
      const pos = enemyPos.get(c.target!) ?? 0;
      if (pos >= 4) st.onSupports++;
      else if (pos >= 1) st.onCores++;
      if ([...kills, ...assists].some((k) => k.target === c.target && k.time >= c.time && k.time - c.time <= 8)) st.converted++;
    }
    targets.push(st);
  }
  return { battles, totals, targets, allyHealth: allyCores.length > 0 };
}
