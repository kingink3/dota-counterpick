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

// mean RGB of the 10 player-colour bars, measured on real 2560x1440 captures
const BARS = {
  empty_draft: [[51, 116, 251], [101, 251, 189], [189, 0, 189], [239, 236, 12], [251, 106, 0], [250, 133, 192], [159, 178, 71], [100, 214, 243], [0, 130, 33], [162, 104, 0]],
  demo_game: [[42, 69, 74], [69, 106, 104], [77, 96, 89], [167, 45, 4], [147, 147, 93], [90, 102, 96], [73, 91, 91], [54, 77, 83], [58, 81, 86], [89, 126, 133]],
  live_game: [[62, 67, 78], [65, 72, 83], [80, 90, 101], [71, 79, 90], [83, 85, 91], [41, 60, 86], [52, 67, 91], [56, 78, 111], [64, 89, 125], [65, 82, 109]],
  pre_horn: [[45, 51, 64], [57, 63, 81], [106, 105, 144], [81, 93, 114], [95, 109, 121], [134, 137, 174], [136, 144, 164], [106, 113, 135], [94, 108, 120], [112, 128, 155]],
  tab: [[83, 57, 107], [86, 78, 80], [39, 75, 40], [65, 56, 53], [43, 47, 66], [27, 8, 3], [175, 178, 183], [69, 74, 77], [9, 36, 31], [83, 15, 22]],
  this_app: Array.from({ length: 10 }, () => [21, 27, 36]),
  black: Array.from({ length: 10 }, () => [0, 0, 0]),
} as const satisfies Record<string, ReadonlyArray<readonly [number, number, number]>>;

test("player-colour bars: only the draft screen shows them", async () => {
  const { countPlayerBars, BAR_THRESHOLDS } = await import("../src/screen-match.js");
  assert.equal(countPlayerBars(BARS.empty_draft), 10);
  for (const k of ["demo_game", "live_game", "pre_horn", "tab", "this_app", "black"] as const) {
    assert.ok(countPlayerBars(BARS[k]) < BAR_THRESHOLDS.minBars, `${k}: ${countPlayerBars(BARS[k])}`);
  }
});

test("tracker: 10 'empty' slots without the draft bars (loading, black frame, menu) keep the draft", async () => {
  const { countPlayerBars } = await import("../src/screen-match.js");
  const H = (valve: string): SlotRead => ({ kind: "hero", valve, score: 0.9, margin: 0.3 });
  const E: SlotRead = { kind: "empty" };
  const t = new ScreenTracker(2);
  const picked: Frame = { left: [H("viper"), H("sniper"), E, E, E], right: [H("lion"), E, E, E, E], bars: 10 };
  t.push(picked);
  t.push(picked);
  const black: Frame = { left: [E, E, E, E, E], right: [E, E, E, E, E], bars: countPlayerBars(BARS.black) };
  for (let i = 0; i < 6; i++) assert.notEqual(t.push(black)?.reset, true, "a black frame is not a new draft");
  const newDraft: Frame = { ...black, bars: countPlayerBars(BARS.empty_draft) };
  t.push(newDraft);
  assert.equal(t.push(newDraft)?.reset, true, "the real empty draft still resets");
});

// e54ba88 dropped a closing brace of a @media block: every rule after it (the unlock
// screen's styles and its "hide after unlock") stopped applying on wide screens.
test("web/index.html: the stylesheet's braces balance and no @media is nested by accident", async () => {
  const { readFileSync } = await import("node:fs");
  const html = readFileSync("web/index.html", "utf8");
  const css = html.slice(html.indexOf("<style>"), html.indexOf("</style>")).replace(/\/\*[\s\S]*?\*\//g, "").replace(/"[^"]*"/g, '""');
  let depth = 0;
  let mediaOpen = false;
  for (const line of css.split("\n")) {
    if (/@media/.test(line)) {
      assert.equal(depth, 0, `@media inside another block: ${line.trim()}`);
      mediaOpen = true;
    }
    for (const ch of line) {
      if (ch === "{") depth++;
      else if (ch === "}") depth--;
      assert.ok(depth >= 0, `extra } near: ${line.trim()}`);
    }
    if (mediaOpen && depth === 0) mediaOpen = false;
  }
  assert.equal(depth, 0, "unclosed { in the stylesheet");
});
