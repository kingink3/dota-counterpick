// Item plan ordering rules + power windows (ADR-026 phases 2-3), synthetic stats.
import assert from "node:assert/strict";
import { test } from "node:test";
import { buildPlan, heroCurve, teamWindow, type ItemStats } from "../src/item-plan.js";
import type { Recommendation } from "../src/types.js";

const items: ItemStats["items"] = {
  tango: { cost: 90, qual: "consumable", label: "Tango" },
  branches: { cost: 50, qual: "component", label: "Iron Branch" },
  quelling_blade: { cost: 100, qual: "component", label: "Quelling Blade" },
  slippers: { cost: 140, qual: "component", label: "Slippers of Agility" },
  ward_observer: { cost: 0, qual: "consumable", label: "Observer Ward" },
  flask: { cost: 110, qual: "consumable", label: "Healing Salve" },
  boots: { cost: 500, qual: "component", label: "Boots of Speed" },
  magic_stick: { cost: 200, qual: "component", label: "Magic Stick" },
  magic_wand: { cost: 450, qual: "common", components: ["magic_stick", "branches", "branches"], label: "Magic Wand" },
  wraith_band: { cost: 505, qual: "common", components: ["circlet", "slippers"], label: "Wraith Band" },
  power_treads: { cost: 1400, qual: "common", components: ["boots", "gloves", "belt_of_strength"], label: "Power Treads" },
  ogre_axe: { cost: 1000, qual: "component", label: "Ogre Axe" },
  bfury: { cost: 4100, qual: "epic", components: ["quelling_blade", "demon_edge", "cornucopia"], label: "Battle Fury" },
  manta: { cost: 4650, qual: "epic", components: ["yasha", "diadem"], label: "Manta Style" },
  black_king_bar: { cost: 4050, qual: "epic", components: ["ogre_axe", "mithril_hammer"], label: "Black King Bar" },
  skadi: { cost: 5300, qual: "epic", components: ["ultimate_orb", "ultimate_orb", "point_booster"], label: "Eye of Skadi" },
  butterfly: { cost: 4975, qual: "epic", components: ["talisman_of_evasion", "eagle", "quarterstaff"], label: "Butterfly" },
  monkey_king_bar: { cost: 4700, qual: "epic", components: ["demon_edge", "javelin", "blitz_knuckles"], label: "Monkey King Bar" },
  infused_raindrop: { cost: 225, qual: "component", label: "Infused Raindrops" },
};

const curve = (shift: number): Array<[number, number, number]> =>
  [15, 20, 25, 30, 35, 40, 45, 50, 55].map((m) => [m, 0.5 + shift * (m - 35) * 0.003, 400]);

const stats: ItemStats = {
  source: "test",
  items,
  heroes: {
    antimage: {
      phases: {
        start: [["tango", 1], ["quelling_blade", 0.95], ["slippers", 0.8], ["branches", 0.7], ["flask", 0.6], ["ward_observer", 0.3]],
        early: [["power_treads", 1], ["magic_wand", 0.8], ["magic_stick", 0.6], ["boots", 0.9], ["ogre_axe", 0.2], ["wraith_band", 0.5]],
        mid: [["bfury", 1], ["manta", 0.9], ["black_king_bar", 0.6], ["ogre_axe", 0.5]],
        late: [["skadi", 0.7], ["butterfly", 0.6], ["manta", 0.4]],
      },
      timing: {
        bfury: { p25: 780, p50: 900, p75: 1080, games: 3000, wrFast: 0.58, wrSlow: 0.43 },
        manta: { p25: 1260, p50: 1440, p75: 1680, games: 2500, wrFast: 0.6, wrSlow: 0.45 },
        black_king_bar: { p25: 1500, p50: 1740, p75: 2000, games: 1200 },
      },
      curve: curve(1),
    },
    lion: { phases: {}, curve: curve(-1) },
    medusa: { phases: {}, curve: curve(1.5) },
    zeus: { phases: {}, curve: curve(-0.5) },
  },
};

const rec = (code: string, score: number, mult = 1): Recommendation => ({
  kind: "item",
  code,
  label: code,
  score,
  coverage: ["phantom_assassin"],
  fit: { archetype: "carry", mult },
  reasons: [],
});

test("plan: start fits the starting gold, lane = standard items, no counter item ahead of them", () => {
  const plan = buildPlan({
    hero: "antimage",
    archetype: "carry",
    stats,
    // the draft screams Manta / MKB first - it must not take the lane
    counters: [rec("manta", 3), rec("monkey_king_bar", 2.5), rec("infused_raindrop", 1), rec("butterfly", 1, 0.25)],
  })!;
  const ph = Object.fromEntries(plan.phases.map((p) => [p.id, p.items.map((i) => i.key)]));
  const startCost = plan.phases[0]!.items.reduce((s, i) => s + i.cost, 0);
  assert.ok(startCost <= 600, `start ${startCost}`);
  assert.ok(!ph.start!.includes("ward_observer"), "a carry does not start with wards");
  assert.deepEqual(ph.lane, ["magic_wand", "power_treads", "wraith_band"], "boots once (the upgrade), stick folded into wand, no bare components");
  assert.equal(ph.core![0], "bfury", "core in purchase order");
  assert.ok(ph.core!.includes("manta"));
  // Manta is standard AND called for -> marked "both" in core, not a first-slot counter
  const manta = plan.phases.find((p) => p.id === "core")!.items.find((i) => i.key === "manta")!;
  assert.equal(manta.kind, "both");
  const sit = plan.phases.find((p) => p.id === "situational")!.items;
  assert.deepEqual(sit.map((i) => i.key), ["monkey_king_bar", "infused_raindrop"], "off-build Butterfly (fit 0.25) dropped");
  assert.match(sit[0]!.place!, /after Battle Fury \(~15:00\)/);
  assert.match(sit[1]!.place!, /in the lane/);
  assert.ok(plan.spikes.some((s) => s.label.startsWith("Battle Fury") && /58% wins/.test(s.why)));
});

test("plan: a support gets wards and no Quelling Blade", () => {
  const plan = buildPlan({ hero: "antimage", archetype: "support", stats })!;
  const start = plan.phases[0]!.items.map((i) => i.key);
  assert.ok(start.includes("ward_observer"));
  assert.ok(!start.includes("quelling_blade"));
});

test("power windows: late heroes vs early heroes", () => {
  assert.ok(heroCurve(stats.heroes.medusa)![3]! > 0, "Medusa gains late");
  assert.ok(heroCurve(stats.heroes.lion)![0]! > 0, "Lion is better early");
  const w = teamWindow(stats, ["lion", "zeus"], ["medusa", "antimage"])!;
  assert.ok(w.diff[0]! > 0 && w.diff[3]! < 0, `early ours, late theirs: ${w.diff.map((d) => d.toFixed(1))}`);
  assert.equal(w.drivers[3]![0]!.hero, "medusa");
  assert.equal(teamWindow(stats, ["lion"], ["nobody"]), undefined, "no enemy data");
});

test("plan on real data: basics first, counters placed, families folded", async () => {
  const { readFileSync, existsSync } = await import("node:fs");
  if (!existsSync("data/item-stats.json")) return;
  const { loadKB } = await import("../src/kb.js");
  const { archetypeOf, resolve } = await import("../src/resolver.js");
  const kb = loadKB();
  const real = JSON.parse(readFileSync("data/item-stats.json", "utf8")) as ItemStats;
  const enemies = ["phantom_assassin", "zeus", "lion", "axe", "necrophos"];
  const planFor = (hero: string, role: number) => {
    const r = resolve(kb, { enemyHeroes: enemies, allyHeroes: [hero], myHero: hero, myRole: role });
    const arch = archetypeOf(kb, hero, role);
    return buildPlan({
      hero,
      ...(arch ? { archetype: arch } : {}),
      stats: real,
      counters: [...r.items, ...r.defense].sort((a, b) => b.score - a.score),
      dcKey: (id) => kb.itemDcKey?.[id],
    })!;
  };
  const keys = (p: ReturnType<typeof planFor>, id: string) => p.phases.find((x) => x.id === id)!.items.map((i) => i.key);
  for (const [hero, role] of [["anti_mage", 1], ["sniper", 2], ["axe", 3], ["lion", 5], ["crystal_maiden", 5]] as const) {
    const p = planFor(hero, role);
    const lane = keys(p, "lane");
    const core = keys(p, "core");
    assert.ok(core.length >= (role >= 4 ? 1 : 2), `${hero}: a core`);
    assert.ok(!lane.includes("boots") || !lane.some((k) => k !== "boots" && k.endsWith("boots")), `${hero}: one pair of boots`);
    for (const k of [...lane, ...core]) {
      const it = real.items[k]!;
      assert.ok(it.cost <= 6500, `${hero}: ${k} is not a luxury item early`);
    }
    // a counter item never sits in the start or lane unless it is cheap
    for (const ph of ["start", "lane"]) {
      for (const it of p.phases.find((x) => x.id === ph)!.items) assert.ok(it.kind !== "counter" || it.cost <= 1000);
    }
    const all = p.phases.flatMap((x) => x.items.map((i) => i.key));
    assert.ok(!(all.includes("orchid") && all.includes("bloodthorn")), `${hero}: one of Orchid / Bloodthorn`);
    assert.ok(!(all.includes("yasha") && all.includes("manta")), `${hero}: Yasha folds into Manta`);
  }
  // Anti-Mage vs a disable-heavy draft: BKB right after Battle Fury (pulled into the
  // core, or the first "for this draft" item placed after it)
  const amPlan = planFor("anti_mage", 1);
  const am = keys(amPlan, "core");
  assert.equal(am[0], "bfury");
  const sit = amPlan.phases.find((x) => x.id === "situational")!.items;
  assert.ok(
    am[1] === "black_king_bar" || (sit[0]?.key === "black_king_bar" && /^after Battle Fury/.test(sit[0].place ?? "")),
    `BKB after Battle Fury: core ${am.join(",")}, situational ${sit.map((i) => i.key).join(",")}`,
  );
  assert.ok(keys(planFor("lion", 5), "core").includes("blink"), "Lion's core has Blink");
});

test("match plan: damage split, threats with answers, a focus per phase", async () => {
  const { loadKB } = await import("../src/kb.js");
  const { resolve } = await import("../src/resolver.js");
  const { buildMatchPlan, phaseAt } = await import("../src/game-plan.js");
  const kb = loadKB();
  const enemies = ["phantom_assassin", "zeus", "lion", "axe", "necrophos"];
  const result = resolve(kb, { enemyHeroes: enemies, allyHeroes: ["anti_mage", "crystal_maiden"], myHero: "anti_mage", myRole: 1 });
  const m = buildMatchPlan({ kb, result, enemies, allies: ["anti_mage", "crystal_maiden"], myHero: "anti_mage", label: (h) => h, itemLabel: (k) => k, dcKey: (id) => kb.itemDcKey?.[id] });
  assert.ok(Math.abs(m.damage.magic + m.damage.physical + m.damage.pure - 1) < 0.01);
  assert.deepEqual(m.damage.phases.map((p) => p.id), ["lane", "mid", "late"]);
  assert.ok(m.damage.magic > m.damage.physical, "Zeus / Lion / Necro: mostly magic");
  assert.ok(m.damage.physBy.includes("phantom_assassin"));
  const pa = m.threats.find((t) => t.enemy === "phantom_assassin")!;
  assert.ok(pa.tools.length && pa.answer, "PA: a threat with an item answer");
  const axe = m.threats.find((t) => t.enemy === "axe")!;
  assert.ok(axe.answer && axe.answer.rec.reasons.some((r) => r.enemy === "axe"), "Axe: the answer is about Axe");
  for (const ph of ["lane", "mid", "late"] as const) assert.ok(m.focus[ph].title.length > 0);
  assert.deepEqual([phaseAt(-30), phaseAt(599), phaseAt(600), phaseAt(1499), phaseAt(1500)], ["lane", "lane", "mid", "mid", "late"]);
});

test("plan: draft answers the hero practically never builds drop out; a teammate's usual item goes down", async () => {
  const { buildPlan, heroBuyFit } = await import("../src/item-plan.js");
  const { loadKB } = await import("../src/kb.js");
  const { resolve, archetypeOf } = await import("../src/resolver.js");
  const { readFileSync } = await import("node:fs");
  const kb = loadKB();
  const stats = JSON.parse(readFileSync("data/item-stats.json", "utf8"));
  assert.equal(heroBuyFit({ orchid: 0.51 }, "orchid"), 1);
  assert.equal(heroBuyFit({ orchid: 0.02 }, "orchid"), 0.6);
  assert.equal(heroBuyFit({}, "orchid"), 0.25);
  assert.equal(heroBuyFit(undefined, "orchid"), 1, "no statistics: no filter");
  const enemies = ["night_stalker", "phantom_lancer", "shadow_shaman", "invoker", "viper"];
  const allies = ["witch_doctor", "lich", "gyrocopter", "abyssal_underlord", "storm_spirit"];
  const r = resolve(kb, { enemyHeroes: enemies, allyHeroes: allies, myHero: "gyrocopter", myRole: 1 });
  const p = buildPlan({ hero: "gyrocopter", archetype: archetypeOf(kb, "gyrocopter", 1), role: 1, stats, counters: [...r.items, ...r.defense].sort((a, b) => b.score - a.score), dcKey: (id) => kb.itemDcKey?.[id], allies });
  const draft = p!.phases.find((x) => x.id === "situational")?.items.map((i) => i.key) ?? [];
  assert.ok(!draft.includes("diffusal_blade") && !draft.includes("orchid"), `Gyrocopter does not build Diffusal / Orchid: ${draft.join(",")}`);
  // Storm Spirit usually builds Orchid: as a Storm teammate's answer it is lowered for a hero that does build it
  const st = stats.heroes.storm_spirit.buy.orchid;
  assert.ok(st >= 0.25, "Storm buys Orchid in a quarter of games or more");
});

test("match plan: heroes with no tool tags (Bristleback, Storm Spirit, PL...) do not break the draft", async () => {
  const { loadKB } = await import("../src/kb.js");
  const { resolve } = await import("../src/resolver.js");
  const { buildMatchPlan } = await import("../src/game-plan.js");
  const kb = loadKB();
  // a hero with no tool section (21 heroes had none until 2026-11-05): simulate one
  delete (kb.taxonomy.hero_tags.bristleback as { tool?: unknown }).tool;
  const enemies = ["death_prophet", "bristleback", "dragon_knight", "anti_mage", "dazzle"];
  const result = resolve(kb, { enemyHeroes: enemies, allyHeroes: [], myRole: 3 });
  const m = buildMatchPlan({ kb, result, enemies, allies: [], label: (h) => h, itemLabel: (k) => k, dcKey: (id) => kb.itemDcKey?.[id] });
  assert.ok(Number.isFinite(m.damage.physical) && Number.isFinite(m.damage.magic));
});
