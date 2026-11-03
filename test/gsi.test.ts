// =============================================================================
//  GSI normalisation + hero-name mapping (ADR-013). Pure - no bridge, no game.
// =============================================================================

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { gsiConfig, gsiHeroToValve, normalizeGsi, normalizePhase } from "../src/gsi.js";
import { readRawKB } from "../src/kb.js";
import { heroValveName } from "../src/web/hero-art.js";

const roster = JSON.parse(readFileSync(new URL("../data/roster.json", import.meta.url), "utf8")) as {
  heroes: Array<{ valve: string; label: string }>;
};
const rosterValve = new Set(roster.heroes.map((h) => h.valve));

test("gsiHeroToValve strips the npc prefix, rejects empties", () => {
  assert.equal(gsiHeroToValve("npc_dota_hero_antimage"), "antimage");
  assert.equal(gsiHeroToValve("npc_dota_hero_"), undefined);
  assert.equal(gsiHeroToValve(""), undefined);
  assert.equal(gsiHeroToValve(undefined), undefined);
  assert.equal(gsiHeroToValve("antimage"), undefined);
});

test("legacy Valve names resolve to roster heroes with the right labels", () => {
  const expected: Record<string, string> = {
    antimage: "Anti-Mage",
    nevermore: "Shadow Fiend",
    zuus: "Zeus",
    furion: "Nature's Prophet",
    necrolyte: "Necrophos",
    obsidian_destroyer: "Outworld Destroyer",
    shredder: "Timbersaw",
    skeleton_king: "Wraith King",
    life_stealer: "Lifestealer",
    windrunner: "Windranger",
    queenofpain: "Queen of Pain",
    magnataur: "Magnus",
    doom_bringer: "Doom",
    abyssal_underlord: "Underlord",
    centaur: "Centaur Warrunner",
    vengefulspirit: "Vengeful Spirit",
    wisp: "Io",
    rattletrap: "Clockwerk",
    treant: "Treant Protector",
  };
  const byValve = new Map(roster.heroes.map((h) => [h.valve, h.label]));
  for (const [valve, label] of Object.entries(expected)) {
    assert.equal(byValve.get(gsiHeroToValve(`npc_dota_hero_${valve}`)!), label, valve);
  }
});

test("every KB hero is reachable from a GSI name (KB code -> valve in roster)", () => {
  const kb = readRawKB(fileURLToPath(new URL("..", import.meta.url)));
  for (const code of Object.keys(kb.taxonomy.hero_tags)) {
    assert.ok(rosterValve.has(heroValveName(code)), `${code} -> ${heroValveName(code)} not in roster`);
  }
});

test("normalizeGsi: in-game player payload", () => {
  const s = normalizeGsi(
    {
      provider: { name: "Dota 2", appid: 570 },
      map: { matchid: "8012345678", game_state: "DOTA_GAMERULES_STATE_GAME_IN_PROGRESS", clock_time: 612 },
      player: { team_name: "dire", gold: 1450, gpm: 512 },
      hero: { id: 1, name: "npc_dota_hero_antimage", level: 11, alive: true },
      items: {
        slot0: { name: "item_power_treads" },
        slot1: { name: "empty" },
        slot2: { name: "item_bfury" },
        slot6: { name: "item_tango" }, // backpack - ignored
        neutral0: { name: "item_occult_bracelet" },
      },
    },
    1000,
  );
  assert.deepEqual(s, {
    receivedAt: 1000,
    matchId: "8012345678",
    phase: "in_progress",
    rawState: "DOTA_GAMERULES_STATE_GAME_IN_PROGRESS",
    myHeroValve: "antimage",
    heroLevel: 11,
    alive: true,
    team: "dire",
    gold: 1450,
    gpm: 512,
    clock: 612,
    items: ["power_treads", "bfury"],
    neutral: "occult_bracelet",
  });
});

test("normalizeGsi: menus / hero selection before a pick", () => {
  const menus = normalizeGsi({ provider: { appid: 570 } }, 1);
  assert.equal(menus.phase, "idle");
  assert.equal(menus.matchId, undefined);
  assert.equal(menus.myHeroValve, undefined);

  const pick = normalizeGsi(
    { map: { matchid: "0", game_state: "DOTA_GAMERULES_STATE_HERO_SELECTION" }, hero: { id: -1 } },
    1,
  );
  assert.equal(pick.phase, "hero_selection");
  assert.equal(pick.matchId, undefined, '"0" is not a match id');
  assert.equal(pick.myHeroValve, undefined);
  assert.equal(normalizePhase("DOTA_GAMERULES_STATE_SOMETHING_NEW"), "unknown");
});

test("gsiConfig carries uri + token", () => {
  const cfg = gsiConfig({ port: 5174, token: "abc" });
  assert.match(cfg, /"uri"\s+"http:\/\/127\.0\.0\.1:5174\/"/);
  assert.match(cfg, /"token"\s+"abc"/);
  assert.match(cfg, /"hero"\s+"1"/);
});
