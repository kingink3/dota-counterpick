// =============================================================================
//  Engine behavior tests - run with `npm test` (node:test via tsx).
//  Cover the ADR-012 contract guarantees against the real KB, plus a couple of
//  synthetic-census unit tests for conditions that no live edge exercises yet.
// =============================================================================

import assert from "node:assert/strict";
import { test } from "node:test";

import type { Census } from "../src/census.js";
import { evaluateConditions } from "../src/conditions.js";
import { CounterPickEngine } from "../src/engine.js";
import type { EngineResult, Recommendation } from "../src/types.js";

const engine = CounterPickEngine.load();

function rec(list: Recommendation[], code: string): Recommendation | undefined {
  return list.find((r) => r.code === code);
}
function allRecs(r: EngineResult): Recommendation[] {
  return [...r.heroes, ...r.items];
}

test("KB loads without validation warnings", () => {
  assert.deepEqual(engine.warnings, []);
});

test("detection edge resolves invis carriers (Sentry vs Riki/Clinkz)", () => {
  const r = engine.recommend({ enemyHeroes: ["riki", "clinkz"] });
  const sentry = rec(r.items, "sentry_ward");
  assert.ok(sentry, "Sentry Ward should be recommended");
  assert.deepEqual(new Set(sentry.coverage), new Set(["riki", "clinkz"]));
  // mechanism string is present on every reason (ADR-012 §4)
  assert.ok(sentry.reasons.every((x) => x.mechanism.length > 0));
});

test("every scored reason carries a mechanism (no bare numbers)", () => {
  const r = engine.recommend({ enemyHeroes: ["medusa", "phantom_lancer", "huskar"] });
  for (const rc of allRecs(r)) {
    assert.ok(rc.reasons.length > 0, `${rc.code} has reasons`);
    for (const reason of rc.reasons) {
      assert.ok(reason.mechanism.trim().length > 0, `${rc.code} reason has mechanism`);
    }
  }
});

test("BKB-guard suppresses the disarm TAG route vs bkb_reliant target", () => {
  // Sven is bkb_reliant: Halberd must not earn the disarm tag-edge (guarded, no
  // pierce). A wiki note may still list it - we only assert the guarded tag route.
  const guarded = engine.recommend({ enemyHeroes: ["sven"] });
  const halberdVsSven = rec(guarded.items, "heavens_halberd");
  assert.ok(!halberdVsSven?.reasons.some((x) => x.basis === "edge" && x.tool === "disarm"));

  // Drow is attack_reliant but NOT bkb_reliant -> the disarm tag route applies.
  const open = engine.recommend({ enemyHeroes: ["drow_ranger"] });
  assert.ok(
    rec(open.items, "heavens_halberd")?.reasons.some((x) => x.basis === "edge" && x.tool === "disarm"),
  );
});

test("BKB-guard escapes when the subject supplies bkb_piercing_disable", () => {
  // Storm Spirit is bkb_reliant; Shadow Shaman lockdown_root + carries pierce.
  const r = engine.recommend({ enemyHeroes: ["storm_spirit"], myRole: 5 });
  const ss = rec(r.heroes, "shadow_shaman");
  assert.ok(ss, "Shadow Shaman should still counter Storm via pierced root");
  const rootReason = ss.reasons.find((x) => x.tool === "lockdown_root");
  assert.ok(rootReason, "root reason present");
  assert.ok(
    (rootReason.notes ?? []).some((n) => /pierced/i.test(n)),
    "pierce note recorded",
  );
});

test("hero->hero enrichment fires on top of the tag basis (AA vs Huskar)", () => {
  const r = engine.recommend({ enemyHeroes: ["huskar"], myRole: 4 });
  const aa = rec(r.heroes, "ancient_apparition");
  assert.ok(aa, "AA recommended vs Huskar");
  const bases = new Set(aa.reasons.map((x) => x.basis));
  assert.ok(bases.has("hero_edge"), "has hero-specific reason");
  assert.ok(bases.has("edge"), "also has the generic tag-edge reason");
});

test("Faceless Void: true_strike is NOT offered vs backtrack, but break IS", () => {
  const r = engine.recommend({ enemyHeroes: ["faceless_void"] });
  // MKB / Bloodthorn (true_strike) must never be suggested vs backtrack (ADR-010).
  assert.equal(rec(r.items, "monkey_king_bar"), undefined);
  assert.ok(!rec(r.heroes, "phantom_assassin")?.reasons.some((x) => x.tool === "true_strike" && x.contribution > 0));
  // break (Silver Edge) is the real answer - it removes the Backtrack passive.
  const silver = rec(r.items, "silver_edge");
  assert.ok(silver, "Silver Edge (break) recommended vs Void");
  assert.ok(silver.reasons.some((x) => x.reliance === "dodge_backtrack"));
});

test("v0.2: bkb_piercing_disable now scores directly vs mobility (item + heroes)", () => {
  // Storm is mobility_dependent AND bkb_reliant. Magic roots are guarded off, but a
  // BKB-piercing lock answers it - Abyssal (item) and Doom/Enigma (heroes) get credit.
  const r = engine.recommend({ enemyHeroes: ["storm_spirit"] });
  const abyssal = rec(r.items, "abyssal_blade");
  assert.ok(abyssal, "Abyssal Blade recommended vs mobile target");
  assert.ok(abyssal.reasons.some((x) => x.tool === "bkb_piercing_disable" && x.reliance === "mobility_dependent"));
  // a pure magic-root item (Atos, no pierce) must not get the TAG lockdown_root route
  // vs the BKB target (the guard suppresses it; a wiki note may still mention it).
  const atos = rec(r.items, "rod_of_atos");
  assert.ok(!atos?.reasons.some((x) => x.basis === "edge" && x.tool === "lockdown_root"));
  assert.ok(rec(r.heroes, "doom"), "Doom credited vs Storm via BKB-pierce");
});

test("v0.2: pickoff carriers answer squishy / immobile targets", () => {
  const r = engine.recommend({ enemyHeroes: ["sniper"] });
  const pudge = rec(r.heroes, "pudge");
  assert.ok(pudge, "Pudge recommended vs Sniper");
  assert.ok(pudge.reasons.some((x) => x.tool === "pickoff"), "via a pickoff edge");
});

test("v0.2: physical_burst answers low_armor (filled answered_by hole)", () => {
  const r = engine.recommend({ enemyHeroes: ["terrorblade"] }); // low_armor 0.4
  const sven = rec(r.heroes, "sven"); // physical_burst carrier
  assert.ok(sven?.reasons.some((x) => x.tool === "physical_burst" && x.reliance === "low_armor"));
});

test("v0.2: break removes passive evasion (break->evasion), distinct from true_strike", () => {
  const r = engine.recommend({ enemyHeroes: ["phantom_assassin"] });
  const silver = rec(r.items, "silver_edge");
  assert.ok(silver?.reasons.some((x) => x.tool === "break" && x.reliance === "evasion"));
  // MKB (true_strike) is still valid vs PA's *real* evasion (unlike Void's backtrack)
  assert.ok(rec(r.items, "monkey_king_bar"), "MKB still applies vs genuine evasion");
});

test("myHero lock yields item-only recommendations", () => {
  const r = engine.recommend({ enemyHeroes: ["riki"], myHero: "juggernaut" });
  assert.equal(r.heroes.length, 0);
  assert.ok(r.items.length > 0);
});

test("v0.3: item_edge Nullifier counters Necrophos (item-specific)", () => {
  const r = engine.recommend({ enemyHeroes: ["necrophos"] });
  const nullifier = rec(r.items, "nullifier");
  assert.ok(nullifier, "Nullifier recommended vs Necrophos");
  assert.ok(nullifier.reasons.some((x) => x.basis === "item_edge"));
  // it should outrank the generic healing-reduction items vs Necro
  assert.equal(r.items[0]?.code, "nullifier");
});

test("v0.3: hero_edge counters fire (Huskar/Bloodseeker vs Anti-Mage)", () => {
  const r = engine.recommend({ enemyHeroes: ["anti_mage"] });
  for (const code of ["huskar", "bloodseeker"]) {
    const h = rec(r.heroes, code);
    assert.ok(h, `${code} recommended vs AM`);
    assert.ok(h.reasons.some((x) => x.basis === "hero_edge"));
  }
});

test("v0.3: key_passive tag - break answers Timbersaw via Silver Edge", () => {
  const r = engine.recommend({ enemyHeroes: ["timbersaw"] });
  const silver = rec(r.items, "silver_edge");
  assert.ok(silver?.reasons.some((x) => x.reliance === "key_passive"));
});

test("v0.3: damage read + combos are present in the result", () => {
  // Sniper + Tinker are explicitly magic_burst_vulnerable, with no low_armor.
  const r = engine.recommend({ enemyHeroes: ["sniper", "tinker"] });
  assert.equal(r.damage.offenseLean, "magic");
  assert.ok(r.damage.magicVuln > r.damage.physicalVuln);
  assert.ok(Array.isArray(r.combos) && r.combos.length > 0);
  assert.ok(r.combos.every((c) => c.pair.length === 2 && c.mechanism.length > 0));
});

test("v0.4: scraped wiki counters enrich hero picks (sourced + low weight)", () => {
  const r = engine.recommend({ enemyHeroes: ["necrophos"] });
  const wikiReasons = r.heroes.flatMap((h) => h.reasons).filter((x) => x.source === "wiki");
  assert.ok(wikiReasons.length > 0, "wiki-sourced reasons present");
  assert.ok(wikiReasons.every((x) => x.basis === "hero_edge" && x.mechanism.length > 0));
  // curated edge (Muerta) must still outrank a hero that exists only via a wiki note
  const muerta = rec(r.heroes, "muerta");
  assert.ok(muerta && muerta.reasons.some((x) => x.source !== "wiki"), "Muerta is curated, not wiki");
});

test("v0.5: allied team adds synergy reasons on top of counter value", () => {
  const noAlly = engine.recommend({ enemyHeroes: ["sniper"], myRole: 2 });
  const withAlly = engine.recommend({ enemyHeroes: ["sniper"], myRole: 2, allyHeroes: ["juggernaut"] });

  const zeusNo = rec(noAlly.heroes, "zeus");
  const zeusYes = rec(withAlly.heroes, "zeus");
  assert.ok(zeusNo && zeusYes);
  // Zeus combos with Juggernaut -> a synergy reason + higher score with the ally
  assert.ok(zeusYes.reasons.some((x) => x.basis === "synergy" && x.enemy === "juggernaut"));
  assert.ok(zeusYes.synergyWith?.includes("juggernaut"));
  assert.ok(zeusYes.score > zeusNo.score);
  // an allied hero is never recommended as a pick
  assert.equal(rec(withAlly.heroes, "juggernaut"), undefined);
});

test("defense layer: enemy magic burst -> BKB/Pipe with a blocks-mechanism", () => {
  const r = engine.recommend({ enemyHeroes: ["lina", "zeus"] }); // both carry magic_burst
  const bkb = rec(r.defense, "black_king_bar");
  assert.ok(bkb, "BKB recommended vs magic burst");
  assert.deepEqual(new Set(bkb.coverage), new Set(["lina", "zeus"]));
  assert.ok(bkb.reasons.every((x) => x.basis === "defense" && x.mechanism.length > 0));
});

test("defense layer: BKB is absent vs BKB-piercing disables (it pierces)", () => {
  // Doom/Beastmaster bring bkb_piercing_disable - BKB must NOT be offered as defense;
  // Linken's / Aeon Disk are the honest answers.
  const r = engine.recommend({ enemyHeroes: ["doom", "beastmaster"] });
  const fromPierce = r.defense.filter((d) =>
    d.reasons.some((x) => x.tool === "bkb_piercing_disable"),
  );
  assert.ok(fromPierce.length > 0, "some defense answers the pierce threat");
  assert.ok(!fromPierce.some((d) => d.code === "black_king_bar"), "BKB not among them");
  assert.ok(rec(r.defense, "linkens_sphere"), "Linken's offered vs single-target pierce");
});

test("defense layer: min_threat gates team items (Pipe needs 2 magic dealers)", () => {
  const one = engine.recommend({ enemyHeroes: ["lina"] });
  assert.equal(rec(one.defense, "pipe_of_insight"), undefined);
  const two = engine.recommend({ enemyHeroes: ["lina", "zeus"] });
  assert.ok(rec(two.defense, "pipe_of_insight"), "Pipe appears with 2+ magic dealers");
});

test("myRole filters hero candidates by position", () => {
  const r = engine.recommend({ enemyHeroes: ["medusa"], myRole: 1 });
  assert.ok(r.heroes.every((h) => h.pos?.includes(1)), "all hero recs are pos 1");
});

test("unknown enemy is reported as uncovered, not silently dropped", () => {
  const r = engine.recommend({ enemyHeroes: ["not_a_hero"] });
  assert.ok(r.uncovered.includes("not_a_hero"));
});

test("results are ranked by score descending", () => {
  const r = engine.recommend({ enemyHeroes: ["riki", "clinkz", "slark"], myRole: 3 });
  for (const list of [r.heroes, r.items]) {
    for (let i = 1; i < list.length; i++) {
      assert.ok(list[i - 1]!.score >= list[i]!.score, "non-increasing score");
    }
  }
});

// --- synthetic-census unit tests for conditions not exercised by live edges ---

function fakeCensus(relianceCount: Record<string, number>): Census {
  return {
    relianceCount: new Map(Object.entries(relianceCount)),
    toolCount: new Map(),
    enemies: [],
    unknownEnemies: [],
    allSelected: [],
    tagsOf: () => undefined,
    viaOf: () => undefined,
  };
}

test("min_targets gates an edge on the team census", () => {
  const enemyTags = { pos: [2], reliance: { spell_reliant: 0.7 }, tool: {} };
  const below = evaluateConditions(
    { min_targets: 3 },
    enemyTags,
    () => false,
    fakeCensus({ spell_reliant: 2 }),
    "spell_reliant",
  );
  assert.equal(below.ok, false);

  const met = evaluateConditions(
    { min_targets: 3 },
    enemyTags,
    () => false,
    fakeCensus({ spell_reliant: 3 }),
    "spell_reliant",
  );
  assert.equal(met.ok, true);
});

test("exclude_target_tag hard-suppresses a trap match (true_strike vs backtrack)", () => {
  const voidTags = { pos: [1], reliance: { dodge_backtrack: 1.0, evasion: 1.0 }, tool: {} };
  const out = evaluateConditions(
    { exclude_target_tag: "dodge_backtrack" },
    voidTags,
    () => false,
    fakeCensus({}),
    "evasion",
  );
  assert.equal(out.ok, false);
});

// --- Slark: Shadow Dance is HIDDEN, not invisibility (special_cases) ---------

test("Slark: detection does NOT fire (Shadow Dance ignores True Sight)", () => {
  const r = engine.recommend({ enemyHeroes: ["slark"] });
  for (const rc of allRecs(r)) {
    for (const reason of rc.reasons) {
      if (reason.enemy !== "slark") continue;
      assert.notEqual(reason.tool, "detection", `${rc.code} must not counter Slark via detection`);
      assert.notEqual(reason.reliance, "relies_on_invisibility", `${rc.code} hits a reliance Slark lacks`);
    }
  }
  for (const code of ["sentry_ward", "dust_of_appearance", "gem_of_true_sight", "gem"]) {
    const it = rec(r.items, code);
    assert.ok(!it || !it.coverage.includes("slark"), `${code} must not be recommended vs Slark`);
  }
});

test("Slark: Orchid / Bloodthorn are the item answer (pre-Dance silence)", () => {
  const r = engine.recommend({ enemyHeroes: ["slark"] });
  const orchid = rec(r.items, "orchid");
  assert.ok(orchid, "Orchid should be recommended vs Slark");
  assert.ok(orchid.coverage.includes("slark"));
  assert.ok(orchid.reasons.some((x) => x.basis === "item_edge" && /Shadow Dance/.test(x.mechanism)));
});

// --- item fit (ADR-018): does the item belong in the build of the hero you play? ---

import { archetypeOf } from "../src/resolver.js";
import { loadKB } from "../src/kb.js";

test("item fit: archetype of the hero you play (position heuristic + overrides + selected role)", () => {
  const kb = loadKB();
  assert.equal(archetypeOf(kb, "sniper"), "carry");
  assert.equal(archetypeOf(kb, "tidehunter"), "offlane");
  assert.equal(archetypeOf(kb, "invoker"), "caster");
  assert.equal(archetypeOf(kb, "lion"), "support");
  assert.equal(archetypeOf(kb, "huskar"), "carry"); // override: right-click, not a caster
  assert.equal(archetypeOf(kb, "sniper", 5), "support"); // your selected position wins
  assert.equal(archetypeOf(kb, undefined, 3), "offlane");
  assert.equal(archetypeOf(kb), undefined);
  assert.equal(kb.heroAttack?.sniper, "ranged");
  assert.equal(kb.heroAttack?.anti_mage, "melee");
});

test("item fit: a carry Sniper is not told to build Eul's; a support CM is", () => {
  const enemies = ["phantom_assassin", "invoker", "mars", "slark", "axe"];
  const sniper = engine.recommend({ enemyHeroes: enemies, myHero: "sniper" });
  const top = sniper.items.slice(0, 8).map((r) => r.code);
  assert.ok(!top.includes("euls_scepter"), `Eul's in Sniper top 8: ${top.join(", ")}`);
  assert.ok(!top.includes("glimmer_cape"));
  assert.ok(top.includes("bloodthorn") && top.includes("monkey_king_bar"));
  assert.equal(sniper.items[0]!.fit?.archetype, "carry");
  assert.equal(sniper.items[0]!.fit?.attack, "ranged");

  const cm = engine.recommend({ enemyHeroes: enemies, myHero: "crystal_maiden" });
  const cmTop = cm.items.slice(0, 5).map((r) => r.code);
  assert.ok(cmTop.includes("euls_scepter") || cmTop.includes("glimmer_cape") || cmTop.includes("force_staff"));
  assert.ok(!cmTop.includes("monkey_king_bar"));
});

test("item fit: attack-type items - Battle Fury is off-build on a ranged carry, fine on a melee one", () => {
  const kb = loadKB();
  const enemies = ["phantom_lancer", "naga_siren"]; // illusions -> aoe_clear (Battle Fury)
  const fitOf = (hero: string) =>
    engine.recommend({ enemyHeroes: enemies, myHero: hero }).items.find((r) => r.code === "battlefury")?.fit?.mult;
  assert.equal(fitOf("sniper"), kb.itemFit!.wrongAttack);
  assert.equal(fitOf("anti_mage"), 1);
});

test("item fit: wiki duplicates are merged and every recommendable item has a fit row", () => {
  const kb = loadKB();
  const ids = new Set([...kb.items.map((i) => i.code), ...kb.itemEdges.map((e) => e.item), ...kb.defenseEdges.map((d) => d.item)]);
  for (const dup of ["orchid_malevolence", "battle_fury", "shiva_s_guard"]) assert.ok(!ids.has(dup), dup);
  const missing = [...ids].filter((id) => !kb.itemFit!.fit[id]);
  assert.deepEqual(missing, [], `items without a fit row: ${missing.join(", ")}`);
});

test("every roster hero is described in the KB (a new hero after a patch fails here - PATCH_RUNBOOK B5)", async () => {
  const { readFileSync } = await import("node:fs");
  const { heroValveName } = await import("../src/web/hero-art.js");
  const kb = loadKB();
  const roster = JSON.parse(readFileSync(new URL("../data/roster.json", import.meta.url), "utf8")) as {
    heroes: Array<{ valve: string; label: string }>;
  };
  const described = new Set(Object.keys(kb.taxonomy.hero_tags).map(heroValveName));
  const missing = roster.heroes.filter((h) => !described.has(h.valve)).map((h) => h.label);
  assert.deepEqual(missing, [], `heroes without hero_tags: ${missing.join(", ")}`);
});

test("unavailable items (left the shop) are never recommended", () => {
  const kb = loadKB();
  const gone = new Set(kb.itemFit!.unavailable);
  assert.ok(gone.has("hood_of_defiance"));
  const r = engine.recommend({ enemyHeroes: ["invoker", "lina", "zeus", "skywrath_mage", "leshrac"] }); // magic-heavy -> defense items
  for (const rec of [...r.items, ...r.defense]) assert.ok(!gone.has(rec.code), `${rec.code} is unavailable`);
});

// ---------------------------------------------------------------------------
//  ADR-020: two-sided scoring (resist / risk / blunted)
// ---------------------------------------------------------------------------

test("resist: Medusa surfaces vs health-based damage (Lifestealer + Witch Doctor) without a hero edge", () => {
  const r = engine.recommend({ enemyHeroes: ["lifestealer", "witch_doctor"] });
  const i = r.heroes.findIndex((h) => h.code === "medusa");
  // top-8: with the tools of the 21 heroes filled in (2026-11-05) Chaos Knight (Chaos Bolt
  // interrupts Death Ward) rightly joins the top; the point is that Medusa surfaces at all
  assert.ok(i >= 0 && i < 8, `Medusa should be top-8, got rank ${i + 1}`);
  const med = r.heroes[i]!;
  for (const enemy of ["lifestealer", "witch_doctor"]) {
    assert.ok(
      med.reasons.some((x) => x.basis === "resist" && x.resistance === "mana_shield" && x.tool === "health_based_damage" && x.enemy === enemy),
      `Mana Shield vs health-based damage from ${enemy}`,
    );
  }
  assert.ok(!med.reasons.some((x) => x.basis === "hero_edge"), "carried by the general rule, not a point edge");
});

test("risk: Medusa is exposed to mana burn and gets no Mana Shield credit vs Anti-Mage", () => {
  const r = engine.recommend({ enemyHeroes: ["anti_mage", "witch_doctor"] });
  const med = rec(r.heroes, "medusa")!;
  assert.ok(med, "still listed (resist vs Witch Doctor)");
  assert.ok(med.reasons.some((x) => x.basis === "risk" && x.enemy === "anti_mage" && x.tool === "mana_burn" && x.contribution < 0));
  assert.ok(!med.reasons.some((x) => x.basis === "resist" && x.enemy === "anti_mage"), "mana_shield is pierced_by mana_burn");
  assert.deepEqual(med.risks, ["anti_mage"]);
});

test("blunted: health-based damage is penalised into Medusa, but mana burn pierces the shield", () => {
  const r = engine.recommend({ enemyHeroes: ["medusa", "rubick"] });
  // Feast into Mana Shield: either not suggested at all, or low with the penalty shown
  const ls = rec(r.heroes, "lifestealer");
  if (ls) {
    assert.ok(ls.reasons.some((x) => x.basis === "risk" && x.resistance === "mana_shield" && x.tool === "health_based_damage"));
    assert.ok(r.heroes.indexOf(ls) > r.heroes.length / 2, "Feast into Mana Shield ranks low");
  }
  const solo = engine.recommend({ enemyHeroes: ["medusa"] });
  const ls2 = rec(solo.heroes, "lifestealer");
  assert.ok(!ls2 || ls2.reasons.some((x) => x.resistance === "mana_shield" && x.contribution < 0));
  const nyx = rec(r.heroes, "nyx_assassin");
  assert.ok(nyx, "Nyx recommended vs Medusa");
  assert.ok(!nyx.reasons.some((x) => x.basis === "risk" && x.resistance === "mana_shield"), "Nyx carries mana_burn -> not blunted");
  const top = r.heroes.slice(0, 5).map((h) => h.code);
  assert.ok(top.includes("anti_mage") && top.includes("nyx_assassin"), `mana burners lead vs Medusa: ${top}`);
});

test("two-sided terms are capped per enemy and never make coverage", () => {
  const r = engine.recommend({ enemyHeroes: ["zeus", "lina", "lion"] });
  for (const h of r.heroes) {
    for (const enemy of ["zeus", "lina", "lion"]) {
      const neg = h.reasons.filter((x) => x.enemy === enemy && x.contribution < 0).reduce((s, x) => s + x.contribution, 0);
      const res = h.reasons.filter((x) => x.enemy === enemy && x.basis === "resist").reduce((s, x) => s + x.contribution, 0);
      assert.ok(neg >= -0.8 - 1e-6, `${h.code} risk vs ${enemy} capped (${neg})`);
      assert.ok(res <= 1.0 + 1e-6, `${h.code} resist vs ${enemy} capped (${res})`);
    }
    assert.ok(h.reasons.some((x) => x.contribution > 0), `${h.code} has an argument for it`);
    for (const c of h.coverage) assert.ok(h.reasons.some((x) => x.enemy === c && x.contribution > 0));
  }
});

test("wiki layer never displays a line naming a retired ability (data/retired-abilities.json)", async () => {
  const { readRawKB, loadRetiredAbilities, retiredMatcher } = await import("../src/kb.js");
  const names = loadRetiredAbilities();
  assert.ok(names.includes("Poison Nova"), "retired list present");
  const stale = retiredMatcher(names);
  const raw = readRawKB();
  const shown = [
    ...raw.combos.map((c) => c.mechanism),
    ...raw.heroEdges.filter((e) => e.source === "wiki").map((e) => e.mechanism),
    ...raw.itemEdges.filter((e) => e.source === "wiki").map((e) => e.mechanism),
  ];
  const bad = shown.filter((t) => stale(t).length);
  assert.deepEqual(bad, []);
});

// ---------------------------------------------------------------------------
//  ADR-021: vocabulary from the howdoiplay review (purge / saves / illusions / creeps)
// ---------------------------------------------------------------------------

test("purge: offensive dispels answer buff-reliant heroes (Dark Seer)", () => {
  const r = engine.recommend({ enemyHeroes: ["dark_seer"] });
  for (const code of ["shadow_demon", "oracle"]) {
    assert.ok(rec(r.heroes, code)?.reasons.some((x) => x.tool === "purge" && x.reliance === "dispellable_buffs"), `${code} purges Ion Shell / Surge`);
  }
  assert.ok(rec(r.items, "nullifier")?.reasons.some((x) => x.tool === "purge"), "Nullifier recommended vs Dark Seer");
});

test("ally_save: saves answer one-target killers, and the killer is told it is risky", () => {
  const r = engine.recommend({ enemyHeroes: ["legion_commander"] });
  for (const code of ["oracle", "dazzle"]) {
    assert.ok(rec(r.heroes, code)?.reasons.some((x) => x.tool === "ally_save"), `${code} saves the Duel target`);
  }
  const vsOracle = engine.recommend({ enemyHeroes: ["oracle"] });
  const lc = rec(vsOracle.heroes, "legion_commander");
  assert.ok(!lc || lc.reasons.some((x) => x.basis === "risk" && x.tool === "ally_save"), "LC exposed to False Promise");
});

test("illusion_execute and creep_execute reach illusion / summon heroes", () => {
  const pl = engine.recommend({ enemyHeroes: ["phantom_lancer"] });
  assert.ok(rec(pl.heroes, "lion")?.reasons.some((x) => x.tool === "illusion_execute"));
  const chen = engine.recommend({ enemyHeroes: ["chen"] });
  assert.ok(rec(chen.heroes, "doom")?.reasons.some((x) => x.tool === "creep_execute"), "Devour vs Chen's creeps");
});

test("curated combos load first and replace the wiki line for the same pair", async () => {
  const { readRawKB } = await import("../src/kb.js");
  const raw = readRawKB();
  const key = (p: string[]) => [...p].sort().join("+");
  const ls = raw.combos.filter((c) => key(c.pair) === key(["lifestealer", "storm_spirit"]));
  assert.equal(ls.length, 1);
  assert.equal(ls[0]!.source, "curated");
  const keys = raw.combos.map((c) => key(c.pair));
  assert.equal(new Set(keys).size, keys.length, "no duplicate pairs");
});

// ---------------------------------------------------------------------------
//  ADR-022: "X does not work against Y" (blunted by the candidate's reliance too)
// ---------------------------------------------------------------------------

test("blunted by reliance: right-clickers into evasion, unless they carry true strike", () => {
  const r = engine.recommend({ enemyHeroes: ["phantom_assassin"] });
  const hasEvasionPenalty = (code: string) =>
    !!rec(r.heroes, code)?.reasons.some((x) => x.basis === "risk" && x.reliance === "attack_reliant" && x.resistance === "evades_attacks");
  const troll = rec(r.heroes, "troll_warlord");
  assert.ok(!troll || hasEvasionPenalty("troll_warlord"), "Troll's attacks miss into Immaterial");
  const drow = rec(r.heroes, "drow_ranger");
  assert.ok(drow, "Drow listed vs PA");
  assert.ok(!hasEvasionPenalty("drow_ranger"), "Marksmanship accuracy pierces evasion");
});

test("Mana Shield: lifesteal and minus armor do not work, mana burn does", () => {
  const r = engine.recommend({ enemyHeroes: ["medusa"] });
  assert.equal(rec(r.heroes, "lifestealer"), undefined, "Feast + lifesteal into Mana Shield is not a pick");
  for (const h of r.heroes) {
    if ((engine.kb.taxonomy.hero_tags[h.code]?.tool?.armor_reduction ?? 0) > 0) {
      assert.ok(h.reasons.some((x) => x.tool === "armor_reduction" && x.resistance === "mana_shield" && x.contribution < 0), `${h.code}: minus armor blunted`);
    }
  }
  // top-3 (Invoker's Deafening Blast disarm joined them once his tools were completed, 2026-11-05)
  const top3 = r.heroes.slice(0, 3).map((h) => h.code);
  assert.ok(top3.includes("anti_mage") && top3.includes("nyx_assassin"), top3.join(","));
});

test("no mana pool: mana burn is blunted into Huskar", () => {
  const r = engine.recommend({ enemyHeroes: ["huskar"] });
  for (const h of r.heroes) {
    if ((engine.kb.taxonomy.hero_tags[h.code]?.tool?.mana_burn ?? 0) > 0) {
      assert.ok(h.reasons.some((x) => x.tool === "mana_burn" && x.resistance === "no_mana_pool"), `${h.code}: nothing to burn`);
      assert.ok(!h.reasons.some((x) => x.tool === "mana_burn" && x.contribution > 0));
    }
  }
});

test("a pick whose net score is not positive is not suggested", () => {
  for (const enemies of [["medusa"], ["phantom_assassin"], ["huskar"], ["zeus", "lina", "lion"]]) {
    const r = engine.recommend({ enemyHeroes: enemies });
    for (const x of [...r.heroes, ...r.items, ...r.defense]) assert.ok(x.score > 0, `${x.code} vs ${enemies}: ${x.score}`);
  }
});

test("defense except: Ghost Scepter is not offered vs Muerta (Pierce the Veil hits ethereal)", () => {
  const vsMuerta = engine.recommend({ enemyHeroes: ["muerta"] });
  assert.equal(rec(vsMuerta.defense, "ghost_scepter"), undefined);
  const vsSniper = engine.recommend({ enemyHeroes: ["sniper"] });
  assert.ok(rec(vsSniper.defense, "ghost_scepter"), "still offered vs a plain right-clicker");
});

// ---------------------------------------------------------------------------
//  ADR-023: composition - team gaps, damage mix, lane opponents
// ---------------------------------------------------------------------------

test("team gaps: a lineup without disables rewards a candidate that brings them", () => {
  const draft = { enemyHeroes: ["phantom_assassin", "axe"], allyHeroes: ["sniper", "drow_ranger", "luna"] };
  const r = engine.recommend(draft);
  const disable = r.team?.needs.find((n) => n.code === "disable");
  assert.ok(disable && disable.have < disable.want, "no disables yet");
  const doom = rec(r.heroes, "doom");
  assert.ok(doom?.reasons.some((x) => x.basis === "team" && x.need === "disable" && x.contribution > 0));
  assert.ok(!doom!.coverage.includes("disable"), "team reasons never count as enemy coverage");
  assert.ok(doom!.reasons.some((x) => x.basis === "team" && x.need === "damage_mix") === false, "Doom deals physical - no damage-mix bonus");
  const sd = rec(r.heroes, "shadow_demon");
  assert.ok(sd?.reasons.some((x) => x.need === "damage_mix"), "all-physical team -> magic damage is a plus");
});

test("team gaps fade once the need is covered, and need known allies", () => {
  const solo = engine.recommend({ enemyHeroes: ["phantom_assassin"] });
  assert.equal(solo.team, undefined, "no allies, no role -> no team read");
  assert.ok(!solo.heroes.some((h) => h.reasons.some((x) => x.basis === "team")));
  const stacked = engine.recommend({ enemyHeroes: ["phantom_assassin"], allyHeroes: ["lion", "shadow_shaman", "bane"] });
  assert.ok(!stacked.heroes.some((h) => h.reasons.some((x) => x.need === "disable")), "three disablers already");
});

test("lane: with a role, reasons vs the enemies you lane against weigh more", () => {
  const draft = { enemyHeroes: ["phantom_assassin", "axe", "lion", "crystal_maiden", "zeus"], myRole: 3 };
  const r = engine.recommend(draft);
  assert.deepEqual([...(r.team?.laneOpponents ?? [])].sort(), ["crystal_maiden", "phantom_assassin"]);
  const h = r.heroes.find((x) => x.reasons.some((y) => y.notes?.includes("lane opponent")));
  assert.ok(h, "some reason is tagged as a lane matchup");
  for (const x of h!.reasons) if (x.notes?.includes("lane opponent")) assert.ok(["crystal_maiden", "phantom_assassin"].includes(x.enemy));
});

// ---------------------------------------------------------------------------
//  ADR-024: enemy items change the enemy's tags
// ---------------------------------------------------------------------------

test("enemy items: Butterfly raises true strike, BKB blunts silences, reasons name the item", () => {
  const plain = engine.recommend({ enemyHeroes: ["troll_warlord"] });
  const geared = engine.recommend({ enemyHeroes: ["troll_warlord"], enemyItems: { troll_warlord: ["butterfly", "black_king_bar"] } });
  const mkb = rec(geared.items, "monkey_king_bar");
  assert.ok(mkb?.reasons.some((x) => x.tool === "true_strike" && x.via?.includes("Butterfly")), "MKB vs Butterfly, labelled");
  assert.equal(rec(plain.items, "monkey_king_bar"), undefined, "no MKB vs a Troll without evasion");
  const silencer = rec(geared.heroes, "silencer");
  assert.ok(!silencer || silencer.reasons.some((x) => x.resistance === "self_debuff_immunity" && x.via?.includes("Black King Bar")));
});

test("enemy items: Linken's blunts targeted lockdown, Manta makes illusion clear count", () => {
  const r = engine.recommend({ enemyHeroes: ["sniper"], enemyItems: { sniper: ["linkens_sphere"] } });
  assert.ok(rec(r.heroes, "pudge")?.reasons.some((x) => x.resistance === "spell_block" && x.contribution < 0));
  const am = engine.recommend({ enemyHeroes: ["anti_mage"], enemyItems: { anti_mage: ["manta_style"] } });
  assert.ok(rec(am.heroes, "earthshaker")?.reasons.some((x) => x.reliance === "illusion_based" && x.via?.includes("Manta Style")));
});

test("item traits reference only known tags; an unknown item id is ignored", () => {
  assert.deepEqual(engine.warnings, []);
  const r = engine.recommend({ enemyHeroes: ["sniper"], enemyItems: { sniper: ["not_an_item"] } });
  assert.ok(r.heroes.length > 0);
});

test("taxonomy: every hero has its tools (what it brings to a fight)", () => {
  const missing = Object.entries(engine.kb.taxonomy.hero_tags)
    .filter(([, t]) => !Object.keys((t as { tool?: Record<string, number> }).tool ?? {}).length)
    .map(([h]) => h);
  assert.deepEqual(missing, [], "fill tool: {...} (scripts/audit-tools.ts lists what the abilities suggest)");
});

test("items: a tool the hero you play already has is worth less (Drow's Gust = silence)", () => {
  const draft = { enemyHeroes: ["disruptor", "invoker", "pugna", "abaddon", "lone_druid"], allyHeroes: ["dark_seer", "chaos_knight"], myRole: 1 };
  const drow = engine.recommend({ ...draft, myHero: "drow_ranger" });
  const sven = engine.recommend({ ...draft, myHero: "sven" });
  const orchid = (r: EngineResult) => r.items.find((i) => i.code === "orchid");
  const d = orchid(drow)!;
  assert.ok(d.reasons.some((x) => x.tool === "silence" && x.selfHas), "silence marked as already yours");
  assert.ok(!orchid(sven) || orchid(sven)!.reasons.every((x) => !x.selfHas), "Sven has no silence");
  const sil = (r: EngineResult) => orchid(r)?.reasons.filter((x) => x.tool === "silence").reduce((a, x) => a + x.contribution, 0) ?? 0;
  assert.ok(sil(drow) < sil(sven) * 0.6, `Drow ${sil(drow).toFixed(2)} vs Sven ${sil(sven).toFixed(2)}`);
});
