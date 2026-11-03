// =============================================================================
//  Screen reading (ADR-013 P1): geometry + tracker semantics. Pure, no DOM.
//  The image-level check (real 1440p screenshots) runs as a browser e2e.
// =============================================================================

import assert from "node:assert/strict";
import { test } from "node:test";

import { ScreenTracker, slotRects, type Frame, type SlotRead } from "../src/screen-match.js";

const E: SlotRead = { kind: "empty" };
const U: SlotRead = { kind: "unknown", score: 0.4 };
const H = (valve: string): SlotRead => ({ kind: "hero", valve, score: 0.95, margin: 0.4 });
const frame = (left: SlotRead[], right: SlotRead[]): Frame => ({ left, right });
const empty5 = [E, E, E, E, E];

test("slot geometry matches the 1440p calibration and scales with height", () => {
  const r = slotRects(2560, 1440);
  assert.equal(r.length, 10);
  // measured slot left edges: 280 / 1476 (+14 px inner crop)
  assert.ok(Math.abs(r[0]!.x - 294) < 1.5, `left0 ${r[0]!.x}`);
  assert.ok(Math.abs(r[5]!.x - 1490) < 1.5, `right0 ${r[5]!.x}`);
  assert.ok(Math.abs(r[9]!.x - (2136 + 14)) < 2, `right4 ${r[9]!.x}`);
  const s = slotRects(1920, 1080);
  assert.ok(Math.abs(s[0]!.x - 294 * 0.75) < 1.5);
  assert.ok(Math.abs(s[0]!.w - 114 * 0.75) < 0.5);
});

test("tracker: a hero needs two identical reads before it is applied", () => {
  const t = new ScreenTracker(2);
  assert.equal(t.push(frame([H("axe"), E, E, E, E], empty5)), undefined);
  const c = t.push(frame([H("axe"), E, E, E, E], empty5));
  assert.ok(c);
  assert.equal(c.left[0], "axe");
  assert.deepEqual(c.changed, [{ side: "left", index: 0, to: "axe" }]);
});

test("tracker: unknown reads never clear a slot (in-game HUD must not wipe the draft)", () => {
  const t = new ScreenTracker(1);
  t.push(frame([H("axe"), E, E, E, E], [H("lich"), E, E, E, E]));
  assert.equal(t.push(frame([U, U, U, U, U], [U, U, U, U, U])), undefined);
  const c = t.push(frame([H("axe"), H("viper"), U, U, U], [U, U, U, U, U]));
  assert.equal(c?.left[0], "axe");
  assert.equal(c?.right[0], "lich");
  assert.equal(c?.left[1], "viper");
});

test("tracker: repick replaces the slot; all-empty after a draft is a reset", () => {
  const t = new ScreenTracker(1);
  t.push(frame([H("axe"), E, E, E, E], empty5));
  const swap = t.push(frame([H("mars"), E, E, E, E], empty5));
  assert.deepEqual(swap?.changed, [{ side: "left", index: 0, from: "axe", to: "mars" }]);
  const reset = t.push(frame(empty5, empty5));
  assert.equal(reset?.reset, true);
  // empty bars before anything was seen are NOT a reset
  assert.equal(new ScreenTracker(1).push(frame(empty5, empty5)), undefined);
});

test("tracker: a hero claimed by two slots keeps only the stronger read", () => {
  const t = new ScreenTracker(1);
  const weak: SlotRead = { kind: "hero", valve: "axe", score: 0.8, margin: 0.2 };
  const c = t.push(frame([H("axe"), weak, E, E, E], empty5));
  assert.equal(c?.left[0], "axe");
  assert.equal(c?.left[1], undefined);
});

test("tracker: the preview ghost marks YOUR slot after confirm+1 frames", () => {
  const t = new ScreenTracker(2);
  const P: SlotRead = { kind: "preview", valve: "sniper", score: 0.6 };
  const pre = frame(empty5, [P, E, E, E, E]);
  assert.equal(t.push(pre), undefined);
  assert.equal(t.push(pre), undefined);
  const c = t.push(pre);
  assert.deepEqual(c?.mine, { side: "right", index: 0 });
  // mine is carried on later changes
  t.push(frame(empty5, [H("sniper"), E, E, E, E]));
  const c2 = t.push(frame(empty5, [H("sniper"), E, E, E, E]));
  assert.deepEqual(c2?.mine, { side: "right", index: 0 });
  assert.equal(c2?.right[0], "sniper");
});

test("bright name label: only an unambiguous white name counts", async () => {
  const { brightName, lumPercentile } = await import("../src/screen-match.js");
  // measured on the user's 1440p screenshots (after / before the pick)
  assert.equal(brightName([158, 158, 158, 158, 158, 219, 158, 158, 158, 158]), 5);
  assert.equal(brightName([38, 37, 46, 53, 55, 219, 40, 43, 32, 28]), 5);
  assert.equal(brightName([150, 153, 156, 149, 157, 205, 150, 151, 153, 150]), 5); // 1080p
  assert.equal(brightName([158, 158, 158, 158, 158, 170, 158, 158, 158, 158]), undefined); // not bright
  assert.equal(brightName([210, 158, 158, 158, 158, 219, 158, 158, 158, 158]), undefined); // two bright
  const px = new Uint8ClampedArray(100 * 4);
  for (let i = 0; i < 100; i++) px.fill(i < 98 ? 40 : 230, i * 4, i * 4 + 3);
  assert.equal(lumPercentile(px, 0.99), 230);
});

test("tracker: the bright name marks YOUR slot even after the pick (no ghost needed)", () => {
  const t = new ScreenTracker(2);
  const names = [158, 158, 158, 158, 158, 219, 158, 158, 158, 158];
  const picked: Frame = { ...frame([H("viper"), E, E, E, E], [H("sniper"), E, E, E, E]), names };
  t.push(picked);
  const c = t.push(picked);
  assert.deepEqual(c?.mine, { side: "right", index: 0 });
  // a HUD-looking frame (mostly unknown) never sets mine
  const t2 = new ScreenTracker(1);
  const hud: Frame = { ...frame([U, U, U, U, U], [U, U, U, E, E]), names };
  t2.push(hud);
  assert.equal(t2.push(hud)?.mine, undefined);
});

test("classify: a dark, flat portrait is NOT an empty slot when it is colourful (cosmetic Faceless Void)", async () => {
  const { classifySlot, toFeature, GRID_W, GRID_H } = await import("../src/screen-match.js");
  const n = GRID_W * GRID_H;
  const px = (rgb: (i: number) => [number, number, number]) => {
    const a = new Uint8ClampedArray(n * 4);
    for (let i = 0; i < n; i++) a.set([...rgb(i), 255], i * 4);
    return a;
  };
  // flat blue-grey bar with a slight gradient: empty
  const empty = toFeature(px((i) => [52 + (i % 7), 58 + (i % 7), 70 + (i % 7)]));
  assert.ok(empty.sat < 92, `empty sat ${empty.sat}`);
  assert.equal(classifySlot(empty, "left", []).kind, "empty");
  // dark purple portrait, similar brightness spread but saturated: unknown, not empty
  const dark = toFeature(px((i) => [70 + (i % 9) * 3, 30 + (i % 5), 95 + (i % 9) * 4]));
  assert.ok(dark.sat > 92, `dark sat ${dark.sat}`);
  assert.equal(classifySlot(dark, "left", []).kind, "unknown");
});
