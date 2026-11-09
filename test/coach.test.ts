// In-game coach (ADR-030): which cues are said, once, on time; stale ones are not.
import assert from "node:assert/strict";
import { test } from "node:test";
import { Coach, defaultModes, overlayLines, spokenIn, type Cue } from "../src/coach.js";
import { upcoming } from "../src/game-timers.js";
import { loadKB } from "../src/kb.js";

const tm = loadKB().timings!;

function run(role: number, from: number, to: number, extra: Partial<Parameters<Coach["tick"]>[0]> = {}): Array<Cue & { t: number }> {
  const c = new Coach();
  const modes = defaultModes(role);
  const out: Array<Cue & { t: number }> = [];
  for (let t = from; t <= to; t += 0.25) {
    for (const q of c.tick({ t, events: upcoming(tm, t, role), modes, ...extra })) out.push({ ...q, t });
  }
  return out;
}

test("coach: a pos 4 hears runes by voice, stacks as a chime, each once and on its lead", () => {
  const cues = run(4, -40, 400);
  const power = cues.filter((c) => c.key.startsWith("power_rune@"));
  assert.deepEqual(power.map((c) => c.key), ["power_rune@360"], "the 6:00 power rune once");
  assert.equal(power[0]!.mode, "voice");
  assert.match(power[0]!.text, /^Power rune in 15$/);
  assert.ok(Math.abs(power[0]!.t - 345) <= 0.5, "said 15 s before");
  const stacks = cues.filter((c) => c.cat === "stacks");
  assert.ok(stacks.length >= 4 && stacks.every((c) => c.mode === "chime"), "a chime every minute");
  assert.ok(new Set(cues.map((c) => c.key)).size === cues.length, "nothing twice");
  assert.ok(!cues.some((c) => c.cat === "pulls"), "pulls are off by default");
});

test("coach: a carry is not told about stacks; opening late does not replay old cues", () => {
  assert.ok(!run(1, 0, 400).some((c) => c.cat === "stacks"));
  // the app starts at 5:55: the 6:00 power rune lead (5:45) is 10 s old - not said
  const late = run(2, 355, 380);
  assert.ok(!late.some((c) => c.key === "power_rune@360"));
});

test("coach: game-length tendency at the start and at 25:00; overlay lines are short", () => {
  const window = { diff: [-2, 3, 0, 0], drivers: [], missing: [] };
  const cues = run(1, 0, 1520, { window });
  const w = cues.filter((c) => c.cat === "windows");
  assert.equal(w.length, 2);
  assert.match(w[0]!.text, /Games this long tend to go their way until 25\./);
  assert.match(w[1]!.text, /tend to go your way until 35/);
  const [l1, l2] = overlayLines({ t: 340, events: upcoming(tm, 340, 4), modes: defaultModes(4), window });
  assert.ok(l1.length <= 40 && /Power rune|Stack|Bounty/.test(l1), l1);
  assert.equal(l2, "length favours them");
  assert.equal(spokenIn(60), "in one minute");
  assert.equal(spokenIn(28), "in 30");
  assert.equal(spokenIn(8), "in 8");
});

test("coach: shrines and lotus for every role; only the first Tormentor; item targets off by default", () => {
  const carry = run(1, 0, 1230);
  assert.ok(carry.some((c) => c.key.startsWith("lotus@")) && carry.some((c) => c.key.startsWith("wisdom_shrine@")), "a carry hears lotus / shrines");
  const torm = carry.filter((c) => c.cat === "objectives");
  assert.deepEqual(torm.map((c) => c.text), ["Tormentor spawns in one minute"]);
  assert.ok(Math.abs(torm[0]!.t - 1140) <= 0.5, "at 19:00");
  assert.equal(defaultModes(1).items, "off");
  // Roshan / Tormentor respawn marks give no cues
  const c = new Coach();
  const said = [] as string[];
  for (let t = 1500; t <= 2200; t += 0.25) for (const q of c.tick({ t, events: upcoming(tm, t, 1, { roshan_killed: 1500, tormentor_killed: 1500 }), modes: defaultModes(1) })) said.push(q.key);
  assert.ok(!said.some((k) => /roshan|tormentor/.test(k)), said.join(","));
});

test("coach: supports hear every observer ward restock (2:15); cores do not", () => {
  const sup = run(5, 0, 600).filter((c) => c.cat === "wards");
  assert.deepEqual(sup.map((c) => c.text), ["Observer ward restocked", "Observer ward restocked", "Observer ward restocked", "Observer ward restocked"]);
  assert.ok(Math.abs(sup[0]!.t - 133) <= 0.5, "said as it restocks (2:15)");
  assert.ok(!run(1, 0, 600).some((c) => c.cat === "wards"));
});
