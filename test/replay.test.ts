// ADR-045: the replay timeline (odota/parser NDJSON -> per-second arrays + disables).
import assert from "node:assert/strict";
import { test } from "node:test";
import { buildTimeline, disabledAt } from "../src/replay.js";
import { idleSeconds } from "../src/review-idle.js";

const iv = (time: number, slot: number, o: Record<string, unknown> = {}) =>
  JSON.stringify({ type: "interval", time, slot, unit: slot === 0 ? "npc_dota_hero_axe" : "npc_dota_hero_lina", x: 100, y: 100, life_state: 0, lh: 0, denies: 0, xp: 0, gold: 600, ...o });

test("replay: interval rows become per-second arrays; disables pair add/remove on heroes only", () => {
  const lines = [
    iv(-5, 0), // before the horn: dropped
    iv(0, 0), iv(1, 0, { lh: 1, x: 101.27 }), iv(3, 0, { life_state: 2, lh: 1 }),
    iv(0, 5), iv(3, 5),
    JSON.stringify({ type: "DOTA_COMBATLOG_MODIFIER_ADD", time: 1.5, targetname: "npc_dota_hero_axe", targethero: true, inflictor: "modifier_earthshaker_fissure_stun", stun_duration: 1.3 }),
    JSON.stringify({ type: "DOTA_COMBATLOG_MODIFIER_REMOVE", time: 2.8, targetname: "npc_dota_hero_axe", targethero: true, inflictor: "modifier_earthshaker_fissure_stun" }),
    JSON.stringify({ type: "DOTA_COMBATLOG_MODIFIER_ADD", time: 2, targetname: "npc_dota_hero_axe", targethero: true, inflictor: "modifier_crystal_maiden_crystal_nova_slow" }),
    JSON.stringify({ type: "DOTA_COMBATLOG_MODIFIER_ADD", time: 2, targetname: "npc_dota_hero_lina", targethero: true, targetillusion: true, inflictor: "modifier_stunned", stun_duration: 2 }),
    JSON.stringify({ type: "DOTA_COMBATLOG_MODIFIER_ADD", time: 2.5, targetname: "npc_dota_hero_lina", targethero: true, inflictor: "modifier_stunned", stun_duration: 1 }), // never removed: uses stun_duration
    "garbage",
  ];
  const tl = buildTimeline(lines)!;
  assert.equal(tl.start, 0);
  const axe = tl.heroes["0"]!;
  assert.equal(axe.hero, "npc_dota_hero_axe");
  assert.deepEqual(axe.lh, [0, 1, 1, 1], "second 2 carries second 1 forward");
  assert.deepEqual(axe.x, [1000, 1013, 1013, 1000]);
  assert.deepEqual(axe.alive, [1, 1, 1, 0]);
  assert.ok(tl.heroes["128"], "parser slot 5 -> player slot 128");
  assert.deepEqual(tl.disables.map((d) => [d.slot, d.kind, d.t, d.d]), [[0, "modifier_earthshaker_fissure_stun", 1.5, 1.3], [128, "modifier_stunned", 2.5, 1]]);
  const axeOff = disabledAt(tl, 0);
  assert.equal(axeOff(2), true);
  assert.equal(axeOff(3), false);
});

test("replay idle: 30+ s stretches with nothing; last hits, XP, casts and enemies keep it busy", () => {
  const n = 600; // 10 minutes
  const flat = (v: number) => Array(n).fill(v);
  const me = { x: [700, ...flat(1300).slice(1)], y: [700, ...flat(1300).slice(1)], alive: flat(1), lh: flat(0), xp: flat(0) };
  // farm every 10 s until 300 s, then nothing until 420 s, then an enemy shows up
  for (let i = 0; i < n; i++) me.lh[i] = Math.min(i, 300) / 10 | 0;
  const enemy = { x: flat(1900), y: flat(1900), alive: flat(1) };
  for (let i = 420; i < n; i++) { enemy.x[i] = 1350; enemy.y[i] = 1300; }
  const r = idleSeconds({ start: 0, me, enemies: [enemy], actions: [], duration: n });
  // the last hit at 300 keeps 285..315 busy, the enemy from 420 keeps 405.. busy: idle 316..404
  assert.deepEqual(r.runs, [[316, 405]]);
  assert.equal(r.seconds, 89);
  // a cast at 6:00 keeps 345..375 busy: 316..344 and 376..404 are both under 30 s
  const withCast = idleSeconds({ start: 0, me, enemies: [enemy], actions: [360], duration: n });
  assert.deepEqual(withCast.runs, []);
});
