// Match review (ADR-029) on a synthetic STRATZ match: each check fires on its case.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { loadKB } from "../src/kb.js";
import type { ItemStats } from "../src/item-plan.js";
import { reviewMatch, trends, type Benchmarks, type Ids, type MatchData, type MatchReview } from "../src/review.js";

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
        abilityLearnEvents: [1, 2, 3, 4, 5].map((i) => ({ time: i * 60, abilityId: 100 + (i % 3), level: 0 })).concat([{ time: 400, abilityId: 999, level: 0 }]),
        abilityUsedEvents: [{ time: 1000, abilityId: 999 }],
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
  const ids = r.findings.map((f) => f.id);
  const bf = r.checks.find((c) => c.key === "bfury")!;
  assert.equal(bf.actual, 1260);
  assert.equal(bf.verdict, "slow", "Battle Fury at 21:00 is late");
  assert.ok(ids.includes("slow_core"));
  assert.ok(ids.includes("low_cs10"), "20 last hits at 10:00");
  const d2100 = r.deaths.find((d) => d.time === 2100)!;
  assert.deepEqual(d2100.unused, ["black_king_bar"], "BKB ready and unused");
  assert.ok(d2100.flags.includes("ultimate not used"));
  assert.equal(d2100.alone, false, "Crystal Maiden is next to him");
  assert.deepEqual(r.deaths.find((d) => d.time === 1805)!.unused, [], "BKB was just used");
  assert.ok(r.deaths.find((d) => d.time === 900)!.alone, "nobody within range");
  assert.ok(ids.includes("died_with_item_ready"));
  assert.ok(ids.includes("heal_unused"));
  assert.ok(ids.includes("died_alone"));
  assert.ok(ids.includes("died_with_gold"));
  assert.ok(r.growth.length > 0 && r.growth.length <= 3);
  assert.ok(r.growth.every((g, i) => i === 0 || r.growth[i - 1]!.severity >= g.severity), "growth sorted by severity");
});

test("review: turbo is not compared with ranked timings and averages", () => {
  const m = match();
  m.summary.gameMode = "TURBO";
  const r = reviewMatch(m, ACC, ctx);
  assert.equal(r.comparable, false);
  const ids = r.findings.map((f) => f.id);
  assert.ok(!ids.includes("slow_core") && !ids.includes("low_cs10"), "no timing / farm verdicts in turbo");
  assert.ok(ids.includes("died_with_item_ready"), "execution checks still apply");
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
});
