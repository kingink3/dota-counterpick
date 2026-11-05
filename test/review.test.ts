// Match review (ADR-029) on a synthetic STRATZ match: each check fires on its case.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { loadKB } from "../src/kb.js";
import type { ItemStats } from "../src/item-plan.js";
import { GROWTH, openPlayer, reviewMatch, trends, type Benchmarks, type Ids, type MatchData, type MatchReview } from "../src/review.js";
import { analyseBattles, castRate } from "../src/review-battles.js";

const kb = loadKB();
const ids = JSON.parse(readFileSync("data/ids.json", "utf8")) as Ids;
const stats = JSON.parse(readFileSync("data/item-stats.json", "utf8")) as ItemStats;
const bench = JSON.parse(readFileSync("data/benchmarks.json", "utf8")) as Benchmarks;
const idOf = (code: string, table: Record<string, string>) => Number(Object.entries(table).find(([, v]) => v === code)![0]);
const H = (c: string) => idOf(c, ids.heroes);
const I = (k: string) => idOf(k, ids.items);
const ctx = { kb, ids, stats, bench, label: (c: string) => c };

const ACC = 42;
function match(over: Partial<{ deaths: MatchData["me"]["playbackData"] }> = {}): MatchData {
  const allies = ["anti_mage", "crystal_maiden", "mars", "pudge", "invoker"];
  const enemies = ["phantom_assassin", "zeus", "lion", "axe", "necrophos"];
  const players = [...allies, ...enemies].map((h, i) => ({
    playerSlot: i < 5 ? i : 128 + i - 5,
    steamAccountId: i === 0 ? ACC : 1000 + i,
    isRadiant: i < 5,
    heroId: H(h),
    position: `POSITION_${(i % 5) + 1}`,
    isVictory: i >= 5,
    kills: 3,
    deaths: i === 0 ? 4 : 2,
    assists: 5,
  }));
  const inv = (t: number, items: string[]) => ({ time: t, ...Object.fromEntries(items.map((k, j) => [`item${j}`, { itemId: I(k) }])) });
  return {
    summary: { id: 1, durationSeconds: 2400, gameMode: "ALL_PICK", lobbyType: "RANKED", didRadiantWin: false, players },
    me: {
      playerSlot: 0,
      heroId: H("anti_mage"),
      position: "POSITION_1",
      isRadiant: true,
      stats: {
        // 2 last hits a minute -> 20 at 10:00 vs ~38 average
        lastHitsPerMinute: Array.from({ length: 40 }, () => 2),
        networthPerMinute: Array.from({ length: 41 }, (_, m) => 600 + m * 250),
        experiencePerMinute: Array.from({ length: 40 }, () => 300),
      },
      playbackData: {
        inventoryEvents: [inv(150, ["wraith_band"]), inv(500, ["wraith_band", "power_treads"]), inv(1260, ["power_treads", "bfury"]), inv(1700, ["power_treads", "bfury", "black_king_bar"])],
        itemUsedEvents: [{ time: 1800, itemId: I("black_king_bar") }],
        // Blink / Counterspell / Mana Break in levels 1-5, Mana Void (the ultimate) at 6
        abilityLearnEvents: [5004, 7314, 5003, 5004, 7314].map((id, i) => ({ time: (i + 1) * 60, abilityId: id, level: 0 })).concat([{ time: 400, abilityId: 5006, level: 0 }]),
        abilityUsedEvents: [{ time: 1000, abilityId: 5006 }],
        deathEvents: [
          // BKB ready (used 300 s earlier, cooldown 95) and not pressed; ultimate not cast for 90+ s
          { time: 2100, positionX: 100, positionY: 100, isEngagedOnDeath: true, reliableGold: 2500, unreliableGold: 100 },
          // BKB used 5 s before: not "ready and unused"
          { time: 1805, positionX: 150, positionY: 150, hasHealAvailable: true },
          { time: 900, positionX: 70, positionY: 70, hasHealAvailable: true, reliableGold: 2200 },
          { time: 600, positionX: 72, positionY: 72, hasHealAvailable: true },
        ],
        ...over.deaths,
      },
    },
    positions: {
      players: players.map((p) => ({
        playerSlot: p.playerSlot,
        playbackData: { playerUpdatePositionEvents: [0, 590, 895, 1800, 2095].map((t) => ({ time: t, x: p.playerSlot === 1 ? 105 : 200, y: p.playerSlot === 1 ? 105 : 200 })) },
      })),
    },
  };
}

test("review: plan vs fact, farm, deaths and execution checks", () => {
  const r = reviewMatch(match(), ACC, ctx);
  assert.equal(r.hero, "anti_mage");
  assert.equal(r.position, 1);
  assert.equal(r.mode, "ranked");
  assert.equal(r.account, ACC);
  assert.equal(r.slot, 0);
  const ids = r.findings.map((f) => f.id);
  const bf = r.checks.find((c) => c.key === "bfury")!;
  assert.equal(bf.actual, 1260);
  assert.equal(bf.verdict, "slow", "Battle Fury at 21:00 is late");
  assert.ok(ids.includes("slow_core"));
  assert.ok(ids.includes("low_cs10"), "20 last hits at 10:00");
  const d2100 = r.deaths.find((d) => d.time === 2100)!;
  assert.deepEqual(d2100.unused, ["black_king_bar"], "BKB ready and unused");
  assert.ok(d2100.flags.includes("ultimate not used"));
  // a passive ultimate is never "not used"
  const m2 = match();
  m2.me.playbackData!.abilityLearnEvents = [5004, 7314, 5004, 7314, 5004].map((id, i) => ({ time: (i + 1) * 60, abilityId: id, level: 0 })).concat([{ time: 400, abilityId: 1447, level: 0 }, { time: 500, abilityId: 0, level: 0 }]);
  m2.me.playbackData!.abilityUsedEvents = [];
  assert.ok(!reviewMatch(m2, ACC, ctx).deaths.some((x) => x.flags.includes("ultimate not used")), "passive / id 0 are not an ultimate");
  assert.equal(d2100.alone, false, "Crystal Maiden is next to him");
  assert.deepEqual(r.deaths.find((d) => d.time === 1805)!.unused, [], "BKB was just used");
  assert.ok(r.deaths.find((d) => d.time === 900)!.alone, "nobody within range");
  // with battle data the precise "save ready before dying" replaces the older death checks
  if (r.battles) {
    assert.ok(!ids.includes("died_with_item_ready") && !ids.includes("heal_unused"), "no duplicates of the battle checks");
  } else {
    assert.ok(ids.includes("died_with_item_ready"));
    assert.ok(ids.includes("heal_unused"));
  }
  assert.ok(r.fixFirst.length <= 3 && r.workOn.length <= 5 && r.fixFirst.every((f) => f.tier === 1));
  assert.ok(ids.includes("died_alone"));
  assert.ok(ids.includes("died_with_gold"));
  assert.ok(r.growth.length > 0 && r.growth.length <= GROWTH);
  for (const part of [r.fixFirst, r.workOn]) assert.ok(part.every((g, i) => i === 0 || part[i - 1]!.severity >= g.severity), "each tier sorted by severity");
});

test("review: turbo is not compared with ranked timings and averages", () => {
  const m = match();
  m.summary.gameMode = "TURBO";
  const r = reviewMatch(m, ACC, ctx);
  assert.equal(r.comparable, false);
  const ids = r.findings.map((f) => f.id);
  assert.ok(!ids.includes("slow_core") && !ids.includes("low_cs10"), "no timing / farm verdicts in turbo");
  assert.ok(ids.includes("died_with_item_ready") || ids.some((x) => x.startsWith("idle:")) || ids.includes("died_alone"), "execution checks still apply");
});

test("trends: a problem in 3 of 4 matches recurs; a one-off does not", () => {
  const base = reviewMatch(match(), ACC, ctx);
  const clone = (id: number, keep: (f: string) => boolean): MatchReview => ({ ...base, matchId: id, findings: base.findings.filter((f) => keep(f.id)) });
  const t = trends([clone(1, () => true), clone(2, (f) => f !== "died_alone"), clone(3, (f) => f !== "died_alone"), clone(4, (f) => f === "low_cs10")]);
  const rec = t.recurring.map((x) => x.id);
  assert.ok(rec.includes("low_cs10"));
  assert.ok(!rec.includes("died_alone"), "1 of 4 is not a trend");
});

test("review on the real STRATZ sample match (when present)", () => {
  const f = "test/fixtures/stratz-match.json";
  if (!existsSync(f)) return;
  const s = JSON.parse(readFileSync(f, "utf8")) as MatchData & { account: number };
  const r = reviewMatch(s, s.account, ctx);
  assert.ok(r.hero && r.duration > 600);
  assert.ok(r.checks.length > 0, "plan checks");
  assert.ok(r.farm.length > 0, "farm rows");
  assert.equal(r.deaths.length, s.me.playbackData?.deathEvents?.length ?? 0);
  if (s.positions && (s.me.playbackData as { playerUpdateHealthEvents?: unknown[] })?.playerUpdateHealthEvents?.length) {
    assert.ok(r.battles && r.battles.battles.length > 0, "battles found");
    assert.ok(r.battles!.battles.every((b) => (b.allies ?? 2) >= 2 && (b.enemies ?? 2) >= 2), "2+ heroes a side");
    assert.ok(r.battles!.totals.some((u) => u.casts > 0));
    if (s.health) assert.ok(r.battles!.allyHealth, "allies' HP loaded");
  }
});

function battleMatch(paFarAfter = Infinity) {
  const SHACKLE = 5130; // Windranger Shackleshot: unit target, enemy, cd 16/14/12/10, range 800
  const heroes = ["windranger", "anti_mage", "mars", "pudge", "invoker", "phantom_assassin", "lion", "zeus", "axe", "necrophos"];
  const players = heroes.map((h, i) => ({
    playerSlot: i < 5 ? i : 128 + i - 5, steamAccountId: i === 0 ? ACC : 1000 + i, isRadiant: i < 5, heroId: H(h),
    position: `POSITION_${(i % 5) + 1}`, isVictory: i >= 5, kills: 0, deaths: 0, assists: 0,
  }));
  const pa = H("phantom_assassin");
  // t < 700: you (slot 0) alone vs PA; t >= 700: you + Anti-Mage (pos 2) vs PA + Lion; the rest far away
  const at = (slot: number, t: number) => {
    if (slot === 0) return { x: 100, y: 100 };
    if (slot === 128) return t >= paFarAfter ? { x: 125, y: 125 } : { x: 104, y: 104 };
    if (t >= 700 && slot === 1) return { x: 95, y: 95 };
    if (t >= 700 && slot === 129) return t >= paFarAfter ? { x: 126, y: 126 } : { x: 106, y: 106 };
    return { x: 200, y: 40 };
  };
  // Anti-Mage loses 300 of 1000 HP at 1004-1006: a core in trouble 5 cells from you
  const amHp = Array.from({ length: 400 }, (_, k) => ({ time: k * 5, hp: 1000, maxHp: 1000 }))
    .filter((e) => e.time < 1000 || e.time > 1010)
    .concat([1000, 1002, 1004, 1006, 1008, 1010].map((t) => ({ time: t, hp: t <= 1002 ? 1000 : 700, maxHp: 1000 })))
    .sort((a, b) => a.time - b.time);
  return {
    SHACKLE,
    d: {
      summary: { id: 1, durationSeconds: 1800, didRadiantWin: false, players },
      me: {
        playerSlot: 0, heroId: H("windranger"), position: "POSITION_4", isRadiant: true,
        playbackData: {
          abilityLearnEvents: [{ time: 60, abilityId: SHACKLE, level: 0 }],
          abilityUsedEvents: [{ time: 1000, abilityId: SHACKLE, target: pa }],
          assistEvents: [{ time: 1005, target: pa }],
          inventoryEvents: [{ time: 900, item0: { itemId: I("glimmer_cape") } }],
          deathEvents: [{ time: 600, positionX: 100, positionY: 100 }, { time: 1020, positionX: 100, positionY: 100 }],
        },
      },
      positions: { players: players.map((p) => ({ playerSlot: p.playerSlot, playbackData: { playerUpdatePositionEvents: Array.from({ length: 300 }, (_, k) => ({ time: k * 5, ...at(p.playerSlot, k * 5) })) } })) },
      health: { players: [{ playerSlot: 1, playbackData: { playerUpdateHealthEvents: amHp } }] },
    } as unknown as MatchData,
  };
}

test("battles: 2+ heroes a side; chances need a target in range; targets, positioning", () => {
  const { SHACKLE, d } = battleMatch();
  assert.equal(ids.abilities?.[String(SHACKLE)]?.r, 800, "ids.json has cast ranges");
  const b = analyseBattles(d.summary, d.me, d.positions, ids as never, (k) => k, new Set(), d.health)!;
  assert.equal(b.battles.length, 1, "the 1v1 death at 10:00 is not a battle");
  assert.ok(b.allyHealth);
  const f = b.battles[0]!;
  assert.ok(f.died && f.assists === 1);
  assert.equal(f.allies, 2);
  assert.equal(f.enemies, 2);
  const u = f.uses.find((x) => x.name === "Shackleshot")!;
  assert.equal(u.use, "enemy");
  assert.equal(u.weight, 2, "Shackleshot is control: counts double");
  // chance 1: 995-1000, ended by the cast (used); chance 2: 1016-1020 after the 16 s cooldown, PA in range (missed)
  assert.equal(u.casts, 1);
  assert.equal(u.windows, 2);
  assert.equal(u.used, 1);
  assert.equal(u.missed, 1);
  assert.ok(Math.abs(u.idle - 3) <= 0.5, `idle ${u.idle}`);
  // Glimmer: Anti-Mage losing HP next to you at 1004-1008, and your last 5 s - never pressed
  const g = f.uses.find((x) => x.name === "glimmer_cape")!;
  assert.equal(g.use, "ally");
  assert.ok(g.missed >= 2 && g.used === 0, `glimmer ${g.missed}/${g.windows}`);
  assert.deepEqual(b.targets[0], { name: "Shackleshot", casts: 1, onCores: 1, onSupports: 0, converted: 1 });
  assert.equal(f.frontmost, true, "you were closer to PA than Anti-Mage");
});

test("battles: no enemy in range -> not a missed chance", () => {
  // PA and Lion step 25+ cells away (1600+ units, beyond 800 + 300) once Shackleshot is back
  const { d } = battleMatch(1010);
  const b = analyseBattles(d.summary, d.me, d.positions, ids as never, (k) => k, new Set(), d.health)!;
  const u = b.battles[0]!.uses.find((x) => x.name === "Shackleshot")!;
  assert.equal(u.missed, 0);
  assert.ok(u.ready >= 3, "it was off cooldown, just with nobody to cast it on");
});

test("players: anyone with a Steam id can be reviewed", () => {
  assert.equal(openPlayer({ steamAccountId: 5, steamAccount: { isAnonymous: false } }), true);
  assert.equal(openPlayer({ steamAccountId: 5 }), true);
  assert.equal(openPlayer({ steamAccountId: 5, steamAccount: { isAnonymous: true } }), true, "private profiles are read too");
  assert.equal(openPlayer({ steamAccountId: null }), false);
  // an opponent of the synthetic match, with "his" events
  const m = match();
  const opp = m.summary.players.find((p) => p.playerSlot === 128)!;
  m.me = { ...m.me, playerSlot: 128, heroId: opp.heroId, position: "POSITION_1", isRadiant: false };
  const r = reviewMatch(m, opp.steamAccountId!, ctx);
  assert.equal(r.hero, "phantom_assassin");
  assert.equal(r.account, opp.steamAccountId);
  assert.equal(r.slot, 128);
  assert.equal(r.won, true);
});

test("match overview: every player graded; reviews add timings and battles; advice text fits Discord", async () => {
  const { matchOverview, adviceText } = await import("../src/review-match.js");
  const m = match();
  m.summary.players.forEach((p, i) => {
    p.imp = i === 5 ? 40 : i === 0 ? -40 : 0;
    p.stats = { networthPerMinute: Array.from({ length: 41 }, (_, k) => 600 + k * (i === 5 ? 600 : 250)) };
  });
  const heroOf = (id: number) => ids.heroes[String(id)]!;
  const r = reviewMatch(m, ACC, ctx);
  const ov = matchOverview(m.summary, { bench, heroOf }, new Map([[ACC, r]]));
  assert.equal(ov.rows.length, 10);
  const pa = ov.rows.find((x) => x.hero === "phantom_assassin")!;
  const am = ov.rows.find((x) => x.hero === "anti_mage")!;
  assert.ok(pa.score > am.score, "IMP +40 and big networth beat IMP -40");
  assert.ok(am.reviewed && !pa.reviewed);
  assert.ok(am.timing, "a reviewed player gets item timings");
  assert.equal(am.workOn, r.growth[0]!.title);
  const t = adviceText(r, (h) => h);
  assert.ok(t.length <= 1900 && /Fix first|Work on/.test(t) && t.includes(r.growth[0]!.title));
});

test("priorities: skipping the draft's answers is not a problem when the game went well", () => {
  const m = match();
  const pb = m.me.playbackData!;
  pb.inventoryEvents = pb.inventoryEvents!.map((e) => ({ time: e.time, item0: { itemId: I("power_treads") }, item1: { itemId: I("bfury") } }));
  pb.itemUsedEvents = [];
  pb.deathEvents = [{ time: 2100, positionX: 100, positionY: 100 }];
  m.me.stats!.networthPerMinute = Array.from({ length: 41 }, (_, k) => 600 + k * 700);
  m.summary.players[0]!.isVictory = true;
  const good = reviewMatch(m, ACC, ctx);
  const cm = good.findings.find((f) => f.id === "counter_missing");
  assert.ok(cm, "the draft's answers were skipped");
  assert.ok(cm.note, "a deviation that worked is a note");
  assert.ok(!good.growth.includes(cm));
  // the same build in a game that went badly is a problem
  const bad = match();
  bad.me.playbackData!.inventoryEvents = pb.inventoryEvents;
  const r = reviewMatch(bad, ACC, ctx);
  const cm2 = r.findings.find((f) => f.id === "counter_missing");
  assert.ok(cm2 && !cm2.note, "a problem when the game went badly");
  assert.ok(good.build.length > 0 && good.build.every((b, i) => i === 0 || good.build[i - 1]!.at <= b.at), "the build in order");
});

test("casts: the ultimate and control count double", () => {
  const u = (used: number, windows: number, weight: 1 | 2) => ({ used, windows, weight }) as never;
  // control 1 of 4 (x2) + routine 4 of 4 -> (2 + 4) / (8 + 4) = 50%, not 5 / 8
  const r = castRate([u(1, 4, 2), u(4, 4, 1)]);
  assert.equal(r.rate, 0.5);
  assert.equal(castRate([]).rate, undefined);
  assert.ok(ids.abilities!["5130"]!.f.includes("x") && !ids.abilities!["5131"]!.f.includes("x"), "Shackleshot control, Powershot not");
});
