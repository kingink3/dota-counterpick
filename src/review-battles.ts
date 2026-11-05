// =============================================================================
//  Battle analysis for the match review (ADR-029b). Pure.
//
//  A battle = your deaths / kills / assists, sharp HP drops and spells on enemy heroes,
//  clustered (gap <= 20 s), with at least 2 heroes of each side near you at some
//  moment (you count). 1-on-1 pick-offs are left to the death checks.
//  Inside a battle, every 0.5 s while you are alive, each active ability / combat item
//  is "ready" when its cooldown (at its current level) is over and you have the
//  mana; ready and not pressed = idle. Cooldown reductions (Octarine, talents) are
//  ignored, so idle time is a lower bound on what was available.
//  Targets: who your unit-target enemy spells went on (core / support) and whether
//  that hero died within 8 s. Positioning: were you the closest of your team to the
//  enemy when you died, did you die deep on their half.
// =============================================================================

import type { StratzMe, StratzSummary, StratzPositions } from "./review.js";

export interface AbilityInfo {
  k: string;
  n: string;
  cd: number[];
  mc: number[];
  /** p passive, h hidden (shard / scepter / sub-ability), u unit target, e enemy target, c channelled */
  f: string;
}

export interface UseStat {
  name: string;
  kind: "ability" | "item";
  /** battles where it was available. */
  battles: number;
  casts: number;
  /** seconds ready and not used, while alive in battles. */
  ready: number;
  /** longest single stretch ready and unused. */
  longest: number;
  /** seconds off cooldown but without the mana for it. */
  manaShort: number;
  /** seconds alive in the battles where it was available. */
  alive: number;
  /** cooldown range over its levels, seconds. */
  cd?: [number, number];
  ult?: boolean;
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
}

/** combat actives worth pressing in a battle (wand / stick only with charges). */
const COMBAT_ITEMS = new Set([
  "black_king_bar", "blink", "overwhelming_blink", "swift_blink", "arcane_blink", "manta", "glimmer_cape", "force_staff",
  "hurricane_pike", "cyclone", "wind_waker", "ghost", "ethereal_blade", "lotus_orb", "satanic", "invis_sword", "silver_edge",
  "pipe", "crimson_guard", "blade_mail", "sheepstick", "abyssal_blade", "magic_wand", "magic_stick", "faerie_fire",
  "mekansm", "guardian_greaves", "shivas_guard", "orchid", "bloodthorn", "nullifier", "rod_of_atos", "gungir",
  "diffusal_blade", "disperser", "solar_crest", "spirit_vessel", "urn_of_shadows", "holy_locket", "heavens_halberd",
  "harpoon", "veil_of_discord", "mjollnir", "mask_of_madness", "refresher", "boots_of_bearing", "ancient_janggo",
  "medallion_of_courage", "dagon", "dagon_2", "dagon_3", "dagon_4", "dagon_5", "aeon_disk", "meteor_hammer",
]);
const STEP = 0.5;
const GAP = 20;
const BATTLE_R = 40; // map cells: heroes this close to you are in the battle
const NEAR = 30; // map cells (~1900 world units)

type Inv = { itemId?: number | null; charges?: number | null } | null | undefined;

export function analyseBattles(
  summary: StratzSummary,
  me: StratzMe,
  positions: StratzPositions | undefined,
  ids: { items: Record<string, string>; cd: Record<string, number>; mc?: Record<string, number>; names: Record<string, string>; abilities?: Record<string, AbilityInfo> },
  itemLabel: (k: string) => string,
  ultIds: Set<number> = new Set(),
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
  const mpAt = (t: number) => {
    let v: number | undefined;
    for (const e of hp) {
      if (e.time > t) break;
      v = e.mp ?? undefined;
    }
    return v;
  };
  const hpShare = (t: number) => {
    let v = 1;
    for (const e of hp) {
      if (e.time > t) break;
      if (e.maxHp > 0) v = e.hp / e.maxHp;
    }
    return v;
  };
  const invAt = (t: number) => {
    let ev: (typeof inv)[number] | undefined;
    for (const e of inv) {
      if (e.time > t) break;
      ev = e;
    }
    return ev;
  };

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

  // positions
  const mine = summary.players.find((p) => p.playerSlot === me.playerSlot);
  const posAt = (slot: number, t: number) => {
    const evs = positions?.players.find((p) => p.playerSlot === slot)?.playbackData?.playerUpdatePositionEvents ?? [];
    let best: { x: number; y: number; time: number } | undefined;
    for (const e of evs) {
      if (e.time > t + 1) break;
      best = e;
    }
    return best && t - best.time <= 8 ? best : undefined;
  };

  // 2+ heroes of each side within BATTLE_R of you (you count) at one of the moments
  const sidesAt = (t: number): { allies: number; enemies: number } | undefined => {
    if (!mine) return undefined;
    const meP = posAt(mine.playerSlot, t);
    if (!meP) return undefined;
    let allies = 1;
    let enemies = 0;
    for (const p of summary.players) {
      if (p.playerSlot === mine.playerSlot) continue;
      const q = posAt(p.playerSlot, t);
      if (!q || Math.hypot(q.x - meP.x, q.y - meP.y) > BATTLE_R) continue;
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
        if (s.allies >= 2 && s.enemies >= 2) both = true;
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

    const track = (name: string, kind: UseStat["kind"], extra: Pick<UseStat, "cd" | "ult">, times: number[], cdAt: (t: number) => number | undefined, mcAt: (t: number) => number, availAt: (t: number) => boolean) => {
      let ready = 0;
      let longest = 0;
      let run = 0;
      let manaShort = 0;
      let alive = 0;
      let any = false;
      for (let t = from; t < to; t += STEP) {
        if (deadAt(t) || !availAt(t)) {
          run = 0;
          continue;
        }
        const cd = cdAt(t);
        if (cd === undefined) continue;
        any = true;
        alive += STEP;
        const last = times.filter((x) => x <= t).pop();
        const castNow = times.some((x) => x >= t && x < t + STEP);
        const offCd = last === undefined || t >= last + cd;
        if (!offCd || castNow) {
          run = 0;
          continue;
        }
        const mp = mpAt(t);
        if (mp !== undefined && mp < mcAt(t)) {
          manaShort += STEP;
          run = 0;
          continue;
        }
        ready += STEP;
        run += STEP;
        longest = Math.max(longest, run);
      }
      if (any) uses.push({ ...extra, name, kind, battles: 1, casts: times.filter((x) => x >= from && x <= to).length, ready, longest, manaShort, alive });
    };

    for (const id of myAbilities) {
      const a = AB[String(id)]!;
      const hidden = a.f.includes("h");
      track(
        a.n,
        "ability",
        { cd: [Math.min(...a.cd), Math.max(...a.cd)], ...(ultIds.has(id) ? { ult: true } : {}) },
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
      for (const s of ["item0", "item1", "item2", "item3", "item4", "item5"]) {
        const k = ids.items[String(ev?.[s]?.itemId)];
        if (k && COMBAT_ITEMS.has(k)) held.add(k);
      }
    }
    for (const k of held) {
      const charged = k === "magic_wand" || k === "magic_stick";
      track(
        itemLabel(k),
        "item",
        { cd: [ids.cd[k] ?? 20, ids.cd[k] ?? 20] },
        itemTimes(k),
        () => ids.cd[k] ?? 20,
        () => ids.mc?.[k] ?? 0,
        (t) => {
          const ev = invAt(t);
          const slot = ["item0", "item1", "item2", "item3", "item4", "item5"].map((s) => ev?.[s]).find((x) => ids.items[String(x?.itemId)] === k);
          // Wand / Stick: worth pressing with 2+ charges and under 70% HP
          return !!slot && (!charged || ((slot.charges ?? 0) >= 2 && hpShare(t) < 0.7));
        },
      );
    }

    const f: Battle = {
      from,
      to,
      died: !!died,
      kills: g.filter((a) => a.kind === "kill").length,
      assists: g.filter((a) => a.kind === "assist").length,
      uses: uses.sort((a, b) => b.ready - a.ready),
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
        const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);
        const nearestEnemy = (p: { x: number; y: number }) => Math.min(...enemies.map((e) => dist(p, e)));
        const mineD = nearestEnemy(meP);
        const alliesInFight = allies.filter((a) => dist(a, meP) <= NEAR * 1.5);
        f.enemiesNear = enemies.filter((e) => dist(e, meP) <= NEAR).length;
        f.alliesNear = allies.filter((a) => dist(a, meP) <= NEAR).length;
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
        t.casts += u.casts;
        t.ready += u.ready;
        t.longest = Math.max(t.longest, u.longest);
        t.manaShort += u.manaShort;
        t.alive += u.alive;
      }
    }
  }
  const totals = [...byName.values()].sort((a, b) => b.ready - a.ready);

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
  return { battles, totals, targets };
}
