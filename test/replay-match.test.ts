// ADR-053: replay -> review input (STRATZ shape) on a small synthetic parse.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { matchFromReplay } from "../src/replay-match.js";
import { reviewMatch, type Ids } from "../src/review.js";
import { loadKB } from "../src/kb.js";

const ids = JSON.parse(readFileSync("data/ids.json", "utf8")) as Ids;
const idOf = (code: string, table: Record<string, string>) => Number(Object.entries(table).find(([, v]) => v === code)![0]);
const HEROES = ["axe", "lina", "lion", "sven", "zeus", "pudge", "mirana", "tiny", "viper", "bane"];
const UNIT: Record<string, string> = { axe: "Axe", lina: "Lina", lion: "Lion", sven: "Sven", zeus: "Zuus", pudge: "Pudge", mirana: "Mirana", tiny: "Tiny", viper: "Viper", bane: "Bane" };
const NPC: Record<string, string> = { zeus: "zuus" };
const npc = (h: string) => `npc_dota_hero_${NPC[h] ?? h}`;
const j = (o: Record<string, unknown>) => JSON.stringify(o);

function parse(): string[] {
  const L: string[] = [];
  for (let t = 0; t <= 180; t++) {
    HEROES.forEach((h, slot) => {
      const dead = slot === 0 && t >= 100 && t < 130; // axe dies at 100, back at 130
      const reinc = slot === 5 && t >= 150 && t < 153; // pudge "dies" at 150 and is back at 153 (Aegis)
      L.push(j({ type: "interval", time: t, slot, unit: `CDOTA_Unit_Hero_${UNIT[h]}`, hero_id: idOf(h, ids.heroes), x: 100 + (t > 60 && slot === 0 ? 2 : 0), y: 100, life_state: dead || reinc ? 2 : 0, lh: Math.floor(t / 10), denies: 0, xp: t * 10, gold: 600 + t * 5, networth: 600 + t * 5, kills: 0, deaths: slot === 0 && t >= 100 ? 1 : 0, assists: 0, camps_stacked: t >= 70 && slot === 4 ? 1 : 0 }));
    });
  }
  const steam = (n: number) => (76561197960265728n + BigInt(n)).toString();
  const info = HEROES.map((h, i) => `{"heroName_":{"bytes":[${[...Buffer.from(npc(h))].join(",")}],"hash":0},"playerName_":{"bytes":[${[...Buffer.from(`p${i}`)].join(",")}],"hash":0},"isFakeClient_":false,"steamid_":${steam(1000 + i)},"gameTeam_":${i < 5 ? 2 : 3}}`).join(",");
  L.push(j({ type: "epilogue", time: -800, key: `{"gameInfo_":{"dota_":{"matchId_":7,"gameMode_":22,"gameWinner_":3,"playerInfo_":[${info}],"endTime_":1000}}}` }));
  L.push(j({ type: "DOTA_COMBATLOG_PURCHASE", time: 20, targetname: npc("axe"), valuename: "item_blink" }));
  L.push(j({ type: "DOTA_COMBATLOG_PURCHASE", time: 25, targetname: npc("axe"), valuename: "item_tango" }));
  L.push(j({ type: "DOTA_COMBATLOG_ITEM", time: 90, attackername: npc("axe"), inflictor: "item_blink" }));
  L.push(j({ type: "DOTA_COMBATLOG_DAMAGE", time: 95, sourcename: npc("pudge"), targetname: npc("axe"), targethero: true, value: 300 }));
  L.push(j({ type: "DOTA_COMBATLOG_DAMAGE", time: 96, sourcename: npc("lina"), targetname: npc("axe"), targethero: true, value: 50 })); // ally: not counted
  L.push(j({ type: "DOTA_COMBATLOG_DEATH", time: 100, attackername: npc("pudge"), sourcename: npc("pudge"), targetname: npc("axe"), targethero: true, assist_slots: [5, 6] }));
  L.push(j({ type: "DOTA_COMBATLOG_DEATH", time: 150, attackername: npc("axe"), sourcename: npc("axe"), targetname: npc("pudge"), targethero: true, assist_slots: [] }));
  L.push(j({ type: "CHAT_MESSAGE_RUNE_BOTTLE", time: 120, value: 1, player1: 1 }));
  L.push(j({ type: "CHAT_MESSAGE_RUNE_PICKUP", time: 140, value: 1, player1: 1 }));
  L.push(j({ type: "obs", time: 30, slot: 4, x: 120, y: 110 }));
  L.push(j({ type: "obs_left", time: 60, slot: 4, attackername: npc("mirana") }));
  L.push(j({ type: "sen_left", time: 61, slot: 4, attackername: npc("mirana") }));
  L.push(j({ type: "obs_left", time: 62, slot: 4, attackername: npc("zeus") })); // own ward: not a deward
  L.push(j({ type: "DOTA_ABILITY_LEVEL", time: -80, targetname: npc("axe"), valuename: "axe_berserkers_call", abilitylevel: 0 }));
  L.push(j({ type: "DOTA_ABILITY_LEVEL", time: 5, targetname: npc("axe"), valuename: "axe_berserkers_call", abilitylevel: 1 }));
  L.push("not json");
  return L;
}

test("replay match: players, per-minute stats and events in the STRATZ shape", () => {
  const m = matchFromReplay(parse(), undefined, { ids })!;
  assert.ok(m);
  assert.equal(m.summary.didRadiantWin, false);
  assert.equal(m.summary.gameMode, "ALL_PICK_RANKED");
  assert.equal(Object.keys(m.players).length, 10, "accounts from the epilogue's 64-bit steam ids");
  const axe = m.players["1000"]!;
  assert.equal(axe.playerSlot, 0);
  assert.equal(m.players["1005"]!.playerSlot, 128);
  assert.deepEqual(axe.stats!.lastHitsPerMinute, [6, 6, 6], "gains per minute, floor(duration / 60) of them");
  assert.deepEqual(axe.stats!.networthPerMinute, [600, 900, 1200, 1500], "values at the minute marks");
  assert.deepEqual(axe.stats!.heroDamageReceivedPerMinute, [0, 300, 300], "from enemy heroes only, cumulative");
  assert.equal(m.players["1005"]!.stats!.heroDamagePerMinute![1], 300);
  const d = axe.playbackData!.deathEvents!;
  assert.equal(d.length, 1);
  assert.equal(d[0]!.attacker, idOf("pudge", ids.heroes));
  assert.equal(d[0]!.timeDead, 30);
  assert.equal(m.players["1005"]!.playbackData!.deathEvents!.length, 0, "back after 3 s: reincarnation, not a death");
  assert.equal(m.players["1005"]!.playbackData!.killEvents!.length, 1);
  assert.equal(m.players["1006"]!.playbackData!.assistEvents!.length, 1);
  assert.deepEqual(axe.playbackData!.purchaseEvents!.map((p) => ids.items[String(p.itemId)]), ["blink", "tango"]);
  const inv = axe.playbackData!.inventoryEvents!;
  assert.equal(ids.items[String(inv[inv.length - 1]!.item0?.itemId)], "blink", "consumables are not kept");
  assert.equal(axe.playbackData!.itemUsedEvents!.length, 1);
  assert.deepEqual(m.players["1001"]!.playbackData!.runeEvents!.map((r) => [r.rune, r.action]), [["HASTE", "BOTTLE"], ["HASTE", "PICKUP"]]);
  const mir = m.players["1006"]!.stats!;
  assert.deepEqual(mir.wardDestruction, [{ time: 60, isWard: true }, { time: 61, isWard: false }], "observer = isWard, like STRATZ");
  assert.equal(m.players["1004"]!.stats!.wards!.length, 1);
  assert.deepEqual(m.players["1004"]!.stats!.campStack, [0, 1, 1]);
  assert.equal(axe.playbackData!.abilityLearnEvents!.length, 1, "level-0 kit rows are not learns");
  const pos = m.positions.players.find((p) => p.playerSlot === 0)!.playbackData!.playerUpdatePositionEvents!;
  assert.deepEqual(pos.map((p) => p.x), [100, 102], "positions on change only");
  assert.equal(m.summary.players.filter((p) => p.position).length, 10, "positions guessed without OpenDota");
});

test("replay match: the review runs on it", () => {
  const m = matchFromReplay(parse(), { match_id: 7, lobby_type: 7, duration: 180, players: HEROES.map((_, i) => ({ player_slot: i < 5 ? i : 128 + i - 5, account_id: 1000 + i, rank_tier: 45, position_est: (i % 5) + 1 })) }, { ids })!;
  assert.equal(m.summary.lobbyType, "RANKED");
  assert.equal(m.summary.bracket, 5);
  assert.equal(m.summary.players[0]!.position, "POSITION_1");
  const r = reviewMatch({ summary: m.summary, me: m.players["1000"]!, positions: m.positions, vision: m.vision }, 1000, { kb: loadKB(), ids, label: (c) => c });
  assert.equal(r.kda[1], 1);
});

test("replay match + our extractor: HP, mana, gold at death, real inventory; clocks aligned", () => {
  // the extractor's clock runs 8 s behind the parser's (as on the real sample)
  const ex: string[] = [];
  for (let t = -8; t <= 172; t++) {
    HEROES.forEach((_, s) => {
      const real = t + 8;
      const dead = s === 0 && real >= 100 && real < 130;
      ex.push(JSON.stringify({ t, s, lv: 1 + Math.floor(real / 40), hp: dead ? 0 : 500, mhp: 600, mp: 200, mmp: 300, rg: 150, ug: 350, it: s === 0 ? ["item_blink", "item_magic_wand", null, null, null, null, null, null, null, null] : [null, null, null, null, null, null, null, null, null, null], ch: s === 0 ? [0, real > 50 ? 9 : 2, 0, 0, 0, 0, 0, 0, 0, 0] : [0, 0, 0, 0, 0, 0, 0, 0, 0, 0] }));
    });
  }
  const lines = parse().map((l) => (l.includes('"interval"') ? l.replace(/"level":\d+,?/, "") : l));
  // parser level per second, like the extractor's
  const withLevel = lines.map((l) => {
    if (!l.includes('"interval"')) return l;
    const o = JSON.parse(l) as { time: number };
    return JSON.stringify({ ...o, level: 1 + Math.floor(o.time / 40) });
  });
  const m = matchFromReplay(withLevel, undefined, { ids, extract: ex })!;
  assert.ok(m.health, "health for every player");
  const axe = m.players["1000"]!;
  const hp = (axe.playbackData as { playerUpdateHealthEvents?: Array<{ time: number; hp: number }> }).playerUpdateHealthEvents!;
  assert.equal(hp.find((h) => h.hp === 0)!.time, 100, "HP 0 at the parser's death time: offset found");
  const d = axe.playbackData!.deathEvents![0]!;
  assert.equal((d.reliableGold ?? 0) + (d.unreliableGold ?? 0), 500);
  assert.equal(d.hasHealAvailable, true, "Wand with 9 charges");
  const inv = axe.playbackData!.inventoryEvents!;
  assert.equal(inv[inv.length - 1]!.item1?.itemId, idOf("magic_wand", ids.items));
  assert.equal((inv[inv.length - 1]!.item1 as { charges?: number }).charges, 9);
});
