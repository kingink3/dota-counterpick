// Item icon matcher (ADR-025): synthetic checks; real-screenshot fixtures come with the Tab layout.
import assert from "node:assert/strict";
import { test } from "node:test";
import { classifyItem, ITEM_H, ITEM_W, toItemFeature, type ItemTemplate } from "../src/item-match.js";

function pattern(seed: number): Uint8ClampedArray {
  const px = new Uint8ClampedArray(ITEM_W * ITEM_H * 4);
  let s = seed;
  for (let i = 0; i < ITEM_W * ITEM_H; i++) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    px[i * 4] = s % 256;
    px[i * 4 + 1] = (s >> 8) % 256;
    px[i * 4 + 2] = (s >> 16) % 256;
    px[i * 4 + 3] = 255;
  }
  return px;
}
const tpl = (key: string, seed: number): ItemTemplate => ({ key, vec: toItemFeature(pattern(seed)).vec });

test("an icon matches its own template; brightness changes do not matter (NCC)", () => {
  const templates = [tpl("black_king_bar", 1), tpl("butterfly", 2), tpl("sphere", 3)];
  const px = pattern(2);
  for (let i = 0; i < px.length; i += 4) for (let c = 0; c < 3; c++) px[i + c] = Math.min(255, px[i + c]! * 0.9 + 10);
  const r = classifyItem(toItemFeature(px), templates);
  assert.equal(r.kind, "item");
  assert.equal(r.kind === "item" && r.key, "butterfly");
});

test("identical art is folded (Roshan's Shard -> Aghanim's Shard), a flat cell is empty", () => {
  const r = classifyItem(toItemFeature(pattern(7)), [tpl("aghanims_shard", 7), tpl("aghanims_shard_roshan", 7), tpl("sphere", 3)]);
  assert.equal(r.kind === "item" && r.key, "aghanims_shard");
  const flat = new Uint8ClampedArray(ITEM_W * ITEM_H * 4).fill(20);
  assert.equal(classifyItem(toItemFeature(flat), [tpl("sphere", 3)]).kind, "empty");
});

// --- real HUD crops (2560x1440, Muerta + Sand King) -----------------------------
import { readFileSync } from "node:fs";
import { identifyPlate, toPlateFeature } from "../src/item-match.js";

const fx = JSON.parse(readFileSync(new URL("./fixtures/hud-items.json", import.meta.url), "utf8")) as {
  slots: Array<{ shot: string; slot: number; expect: string | null; rgba: string }>;
  plates: Record<string, string>;
  templates: Record<string, string>;
};
const px = (b64: string) => new Uint8ClampedArray(Buffer.from(b64, "base64"));
const realTemplates: ItemTemplate[] = Object.entries(fx.templates).map(([key, b]) => ({ key, vec: toItemFeature(px(b)).vec }));

test("real HUD: every inventory slot reads as its item (incl. 2 on cooldown) or empty", () => {
  for (const s of fx.slots) {
    const r = classifyItem(toItemFeature(px(s.rgba)), realTemplates);
    if (s.expect) assert.equal(r.kind === "item" && r.key, s.expect, `${s.shot} slot ${s.slot}: ${JSON.stringify(r)}`);
    else assert.equal(r.kind, "empty", `${s.shot} slot ${s.slot}`);
  }
});

test("real HUD: a learned name plate identifies its hero and not the other one", () => {
  const sk = toPlateFeature(px(fx.plates.sand_king!));
  const mu = toPlateFeature(px(fx.plates.muerta!));
  assert.equal(identifyPlate(sk, [{ hero: "sand_king", vec: sk }]), "sand_king");
  assert.equal(identifyPlate(mu, [{ hero: "sand_king", vec: sk }]), undefined);
  assert.equal(identifyPlate(mu, [{ hero: "sand_king", vec: sk }, { hero: "muerta", vec: mu }]), "muerta");
});
