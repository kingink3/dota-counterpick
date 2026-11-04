// Game tab (ADR-026): clock reading on real captures + map-event timers.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { GameClock, readClock } from "../src/clock-match.js";
import { formatClock, upcoming } from "../src/game-timers.js";
import { loadKB } from "../src/kb.js";

const fx = JSON.parse(readFileSync(new URL("./fixtures/clock.json", import.meta.url), "utf8")) as {
  frames: Array<{ text: string; night: boolean; w: number; h: number; rgba: string }>;
};
const px = (b: string) => new Uint8ClampedArray(Buffer.from(b, "base64"));

test("clock: all 9 real captures read exactly, incl. day/night icon", () => {
  for (const f of fx.frames) {
    const r = readClock(px(f.rgba), f.w, f.h);
    assert.equal(r?.text, f.text);
    assert.equal(r?.night, f.night, `${f.text} icon`);
  }
});

test("clock: robust to a 1-2 px offset of the region", () => {
  for (const f of fx.frames) {
    const src = px(f.rgba);
    const shifted = new Uint8ClampedArray(src.length);
    for (let y = 0; y < f.h; y++) for (let x = 0; x < f.w; x++) {
      const sx = Math.min(f.w - 1, x + 2);
      shifted.set(src.subarray((y * f.w + sx) * 4, (y * f.w + sx) * 4 + 4), (y * f.w + x) * 4);
    }
    assert.equal(readClock(shifted, f.w, f.h)?.text, f.text);
  }
});

test("GameClock: counting down = pre-horn (negative), stalled = paused", () => {
  const c = new GameClock();
  const read = (seconds: number, night: boolean) => ({ seconds, night, text: "", minScore: 1 });
  let s = c.push(read(80, true), 0);
  assert.equal(s.gameSeconds, -80);
  assert.equal(s.pregame, true);
  s = c.push(read(79, true), 1000);
  assert.equal(s.gameSeconds, -79);
  const g = new GameClock();
  g.push(read(117, false), 0);
  s = g.push(read(118, false), 1000);
  assert.equal(s.gameSeconds, 118);
  assert.equal(s.pregame, false);
  s = g.push(read(118, false), 4000);
  assert.equal(s.paused, true);
});

test("timers: schedule from data/timings.yaml, filtered by role", () => {
  const kb = loadKB();
  const tm = kb.timings!;
  assert.equal(tm.patch, "7.41");
  for (const e of tm.events) assert.ok(e.source.length > 10, `${e.id} has a source`);
  // 6:40 as a support: stack window at 6:53, shrine at 7:00, power rune not for pos 5
  const sup = upcoming(tm, 400, 5);
  const ids = sup.map((u) => u.id);
  assert.ok(ids.includes("stack") && ids.includes("wisdom_shrine") && ids.includes("lotus"));
  assert.ok(!ids.includes("power_rune"), "power runes are for 2/4");
  const stack = sup.find((u) => u.id === "stack")!;
  assert.equal(stack.at, 413);
  assert.equal(stack.state, "later");
  assert.equal(upcoming(tm, 408, 5).find((u) => u.id === "stack")!.state, "soon");
  assert.equal(upcoming(tm, 414, 5).find((u) => u.id === "stack")!.state, "now", "inside the 3 s window");
  // bounty runes every 4 min since 7.38, Tormentor first at 20:00 since 7.39
  assert.equal(upcoming(tm, 255, 1).find((u) => u.id === "bounty_rune")!.at, 480);
  assert.equal(upcoming(tm, 245, 1).find((u) => u.id === "bounty_rune")!.state, "now", "shown 10 s after it spawned");
  assert.equal(upcoming(tm, 1000, 1).find((u) => u.id === "tormentor")!.at, 1200);
  // pre-horn: the first bounty runes at 0:00
  assert.equal(upcoming(tm, -60, 4).find((u) => u.id === "bounty_rune")!.at, 0);
});

test("timers: manual marks - Roshan window 8-11 min after the kill", () => {
  const tm = loadKB().timings!;
  assert.equal(upcoming(tm, 1300, 3).find((u) => u.id === "roshan_window"), undefined);
  const r = upcoming(tm, 1300, 3, { roshan_killed: 1250 }).find((u) => u.id === "roshan_window")!;
  assert.equal(r.at, 1250 + 480);
  assert.equal(r.window, 180);
  assert.equal(upcoming(tm, 1250 + 600, 3, { roshan_killed: 1250 }).find((u) => u.id === "roshan_window")!.state, "now");
  assert.equal(formatClock(-75), "-1:15");
  assert.equal(formatClock(3725), "62:05");
});

test("ClockConfirm: a game clock confirms after 3 s, a draft timer or a stall never does", async () => {
  const { ClockConfirm } = await import("../src/game-timers.js");
  const up = new ClockConfirm();
  const ok = [0, 1, 2, 3].map((k) => up.push(36 + k, false, false, k * 1000));
  assert.deepEqual(ok, [false, false, false, true]);
  const pre = new ClockConfirm();
  assert.equal([0, 1, 2, 3].map((k) => pre.push(80 - k, true, false, k * 1000)).at(-1), true, "pre-horn countdown under the moon");
  const draft = new ClockConfirm();
  assert.equal([0, 1, 2, 3, 4].some((k) => draft.push(25 - k, false, false, k * 1000)), false, "countdown without the moon");
  const stall = new ClockConfirm();
  assert.equal([0, 1, 2, 3, 4].some((k) => stall.push(120, false, false, k * 1000)), false, "stalled clock");
});

test("parseClock / isNight", async () => {
  const { parseClock, isNight } = await import("../src/game-timers.js");
  assert.equal(parseClock("12:30"), 750);
  assert.equal(parseClock("-0:45"), -45);
  assert.equal(parseClock("1230"), 750);
  assert.equal(parseClock("7"), 420);
  assert.equal(parseClock("1:75"), undefined);
  assert.equal(parseClock("abc"), undefined);
  assert.equal(isNight(-10), true);
  assert.equal(isNight(299), false);
  assert.equal(isNight(300), true);
  assert.equal(isNight(600), false);
});
