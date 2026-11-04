// =============================================================================
//  Item icon matching for the Tab scoreboard (ADR-025). Pure functions, no DOM.
//
//  An inventory slot is sampled to ITEM_W x ITEM_H RGB, mean-removed and normalised;
//  the best template by dot product (NCC) wins if it clears `accept` and beats the
//  runner-up by `margin`. Measured on all 258 Valve icons rendered at 32-40 px with
//  noise, +-10% brightness and 1 px misalignment: 255-258/258 top-1, margin p5 0.17;
//  the only confusions are icons with IDENTICAL art (Roshan's Shard/Scepter copies),
//  which are folded into their base item here.
//  Where: enemy items are NOT on the Tab scoreboard during a live match (it shows
//  your own team only). They are visible in the bottom HUD when you select an enemy
//  hero - so we read the selected unit's 6 inventory slots and the name plate above
//  its portrait, and learn which plate belongs to which hero (one click, kept).
// =============================================================================

import { HUD_ANCHOR_B64, HUD_ANCHOR_H, HUD_ANCHOR_W } from "./hud-anchor.js";

export const ITEM_W = 22;
export const ITEM_H = 16;

export interface ItemFeature {
  vec: Float32Array;
  lumStd: number;
  sat: number;
}

export interface ItemTemplate {
  /** dotaconstants item key (black_king_bar, sphere, ...). */
  key: string;
  vec: Float32Array;
}

/** same art, different item id -> report the base item. */
export const ICON_ALIAS: Record<string, string> = {
  aghanims_shard_roshan: "aghanims_shard",
  ultimate_scepter_roshan: "ultimate_scepter",
  ultimate_scepter_2: "ultimate_scepter",
};

export function toItemFeature(rgba: ArrayLike<number>): ItemFeature {
  const n = ITEM_W * ITEM_H;
  const vec = new Float32Array(n * 3);
  let sum = 0;
  let lum = 0;
  let lum2 = 0;
  let satSum = 0;
  for (let i = 0; i < n; i++) {
    const r = rgba[i * 4]!;
    const g = rgba[i * 4 + 1]!;
    const b = rgba[i * 4 + 2]!;
    vec[i * 3] = r;
    vec[i * 3 + 1] = g;
    vec[i * 3 + 2] = b;
    sum += r + g + b;
    const l = 0.299 * r + 0.587 * g + 0.114 * b;
    lum += l;
    lum2 += l * l;
    const mx = Math.max(r, g, b);
    if (mx > 0) satSum += ((mx - Math.min(r, g, b)) / mx) * 255;
  }
  const mean = sum / (n * 3);
  let norm = 0;
  for (let i = 0; i < vec.length; i++) {
    vec[i] = vec[i]! - mean;
    norm += vec[i]! * vec[i]!;
  }
  norm = Math.sqrt(norm) || 1;
  for (let i = 0; i < vec.length; i++) vec[i] = vec[i]! / norm;
  const lm = lum / n;
  return { vec, lumStd: Math.sqrt(Math.max(0, lum2 / n - lm * lm)), sat: satSum / n };
}

export type ItemRead =
  | { kind: "item"; key: string; score: number; margin: number }
  | { kind: "empty" }
  | { kind: "unknown"; best?: string; score: number };

/** Measured on two 2560x1440 HUD captures (Muerta, Sand King): ready items 0.80-0.99,
 *  items on cooldown (desaturated + timer) 0.69-0.76 with margin >= 0.14; empty
 *  slots best 0.59-0.66 with margin <= 0.06 and luminance std ~5 (items 34-63). */
export const ITEM_THRESHOLDS = {
  accept: 0.62,
  margin: 0.12,
  /** an empty inventory slot is a flat dark cell. */
  emptyStd: 16,
  emptyMaxSat: 255,
} as const;

export function classifyItem(feat: ItemFeature, templates: ItemTemplate[]): ItemRead {
  if (feat.lumStd < ITEM_THRESHOLDS.emptyStd && feat.sat < ITEM_THRESHOLDS.emptyMaxSat) return { kind: "empty" };
  const per = new Map<string, number>();
  for (const t of templates) {
    const key = ICON_ALIAS[t.key] ?? t.key;
    let s = 0;
    for (let i = 0; i < feat.vec.length; i++) s += feat.vec[i]! * t.vec[i]!;
    if (s > (per.get(key) ?? -2)) per.set(key, s);
  }
  let best = -2;
  let second = -2;
  let key = "";
  for (const [k, s] of per) {
    if (s > best) {
      second = best;
      best = s;
      key = k;
    } else if (s > second) second = s;
  }
  if (best >= ITEM_THRESHOLDS.accept && best - second >= ITEM_THRESHOLDS.margin) {
    return { kind: "item", key, score: best, margin: best - second };
  }
  return { kind: "unknown", ...(key ? { best: key } : {}), score: best };
}

// ---------------------------------------------------------------------------
//  Bottom HUD geometry, in units of screen height measured from the screen centre
//  (the HUD scales with height and stays centred). Measured at 2560x1440 with a
//  4-ability hero selected. The centre panel widens for heroes with more abilities
//  (Rubick, 6: inventory +58 px right, name plate -58 px left) and the whole HUD can
//  sit 16 px lower in some states - `locateHud` finds the offset from the frame.
// ---------------------------------------------------------------------------

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const INV = { x0: 243 / 1440, pitchX: 88 / 1440, w: 80 / 1440, y0: 1260 / 1440, pitchY: 63 / 1440, h: 58 / 1440 } as const;
/** text area of the selected unit's name plate (portrait edges excluded). */
const PLATE = { x0: -540 / 1440, w: 140 / 1440, y0: 1226 / 1440, h: 24 / 1440 } as const;

/** HUD offset in units of screen height (dx: inventory right / plate left; dy: down). */
export interface HudOffset {
  dx: number;
  dy: number;
}
export const NO_OFFSET: HudOffset = { dx: 0, dy: 0 };

/** the 6 main inventory slots of the selected unit (row-major). */
export function hudSlotRects(width: number, height: number, off: HudOffset = NO_OFFSET): Rect[] {
  const cx = width / 2;
  const out: Rect[] = [];
  for (let r = 0; r < 2; r++) {
    for (let c = 0; c < 3; c++) {
      out.push({
        x: cx + (INV.x0 + c * INV.pitchX + off.dx) * height,
        y: (INV.y0 + r * INV.pitchY + off.dy) * height,
        w: INV.w * height,
        h: INV.h * height,
      });
    }
  }
  return out;
}

/** the name plate moves the other way: the centre panel widens symmetrically. */
export function plateRect(width: number, height: number, off: HudOffset = NO_OFFSET): Rect {
  return { x: width / 2 + (PLATE.x0 - off.dx) * height, y: (PLATE.y0 + off.dy) * height, w: PLATE.w * height, h: PLATE.h * height };
}

// --- locating the inventory grid by its frame ---------------------------------
//  Search window at HALF the resolution of a 1440p screen (so any resolution maps
//  to the same pixel grid): dx -20..+240, dy -12..+30 (1440p px) around the base.

const ANCHOR = { ox: 16, oy: 12, slotW: 80, slotH: 58 } as const;
export const HUD_SEARCH = { dx0: -20, dx1: 240, dy0: -12, dy1: 30 } as const;

/** search window in screen px (draw it into a canvas of hudSearchSize()). */
export function hudSearchRect(width: number, height: number): Rect {
  const k = height / 1440;
  const x = width / 2 + (INV.x0 * 1440 - ANCHOR.ox + HUD_SEARCH.dx0) * k;
  const y = (INV.y0 * 1440 - ANCHOR.oy + HUD_SEARCH.dy0) * k;
  return { x, y, w: (HUD_ANCHOR_W * 2 + HUD_SEARCH.dx1 - HUD_SEARCH.dx0) * k, h: (HUD_ANCHOR_H * 2 + HUD_SEARCH.dy1 - HUD_SEARCH.dy0) * k };
}
export function hudSearchSize(): { w: number; h: number } {
  return { w: HUD_ANCHOR_W + (HUD_SEARCH.dx1 - HUD_SEARCH.dx0) / 2, h: HUD_ANCHOR_H + (HUD_SEARCH.dy1 - HUD_SEARCH.dy0) / 2 };
}

let anchorCache: { vals: Float32Array; idx: Int32Array } | undefined;
function anchor(): { vals: Float32Array; idx: Int32Array } {
  if (anchorCache) return anchorCache;
  const raw = typeof atob === "function" ? Uint8Array.from(atob(HUD_ANCHOR_B64), (c) => c.charCodeAt(0)) : new Uint8Array(Buffer.from(HUD_ANCHOR_B64, "base64"));
  // frame pixels only: drop the slot interiors (items differ between captures)
  const keep: number[] = [];
  for (let y = 0; y < HUD_ANCHOR_H; y++) {
    for (let x = 0; x < HUD_ANCHOR_W; x++) {
      const X = x * 2 + 1;
      const Y = y * 2 + 1;
      let inside = false;
      for (let r = 0; r < 2 && !inside; r++) {
        for (let c = 0; c < 3 && !inside; c++) {
          const sx = ANCHOR.ox + c * 88;
          const sy = ANCHOR.oy + r * 63;
          inside = X >= sx + 2 && X < sx + ANCHOR.slotW - 2 && Y >= sy + 2 && Y < sy + ANCHOR.slotH - 2;
        }
      }
      if (!inside) keep.push(y * HUD_ANCHOR_W + x);
    }
  }
  const idx = Int32Array.from(keep);
  const vals = new Float32Array(idx.length);
  let mean = 0;
  for (let i = 0; i < idx.length; i++) mean += raw[idx[i]!]!;
  mean /= idx.length;
  let norm = 0;
  for (let i = 0; i < idx.length; i++) {
    vals[i] = raw[idx[i]!]! - mean;
    norm += vals[i]! * vals[i]!;
  }
  norm = Math.sqrt(norm) || 1;
  for (let i = 0; i < vals.length; i++) vals[i] = vals[i]! / norm;
  anchorCache = { vals, idx };
  return anchorCache;
}

/** Measured on 7 captures: correct peak 0.62-1.0, next-best position <= 0.66 and
 *  always >= 0.15 lower. */
export const HUD_LOCATE = { accept: 0.45, margin: 0.08 } as const;

/** Find the inventory frame in a half-res luminance window (hudSearchSize()).
 *  Returns the offset in units of screen height, or undefined if not confident. */
export function locateHud(lum: ArrayLike<number>, w: number): (HudOffset & { score: number }) | undefined {
  const { vals, idx } = anchor();
  const steps = { x: (HUD_SEARCH.dx1 - HUD_SEARCH.dx0) / 2, y: (HUD_SEARCH.dy1 - HUD_SEARCH.dy0) / 2 };
  // window index of anchor pixel i at offset (ox, oy)
  const ax = new Int32Array(idx.length);
  const ay = new Int32Array(idx.length);
  for (let i = 0; i < idx.length; i++) {
    ax[i] = idx[i]! % HUD_ANCHOR_W;
    ay[i] = Math.floor(idx[i]! / HUD_ANCHOR_W);
  }
  const scores: Array<[number, number, number]> = [];
  for (let oy = 0; oy <= steps.y; oy++) {
    for (let ox = 0; ox <= steps.x; ox++) {
      let sum = 0;
      let sum2 = 0;
      let dotv = 0;
      for (let i = 0; i < idx.length; i++) {
        const v = lum[(oy + ay[i]!) * w + ox + ax[i]!]!;
        sum += v;
        sum2 += v * v;
        dotv += v * vals[i]!;
      }
      const n = idx.length;
      const sd = Math.sqrt(Math.max(1e-6, sum2 - (sum * sum) / n));
      scores.push([dotv / sd, ox, oy]); // vals has zero mean -> dot with raw v == dot with centred v
    }
  }
  scores.sort((a, b) => b[0] - a[0]);
  const best = scores[0]!;
  const second = scores.find((s) => Math.abs(s[1] - best[1]) > 6 || Math.abs(s[2] - best[2]) > 4)!;
  if (best[0] < HUD_LOCATE.accept || best[0] - second[0] < HUD_LOCATE.margin) return undefined;
  return { dx: (HUD_SEARCH.dx0 + best[1] * 2) / 1440, dy: (HUD_SEARCH.dy0 + best[2] * 2) / 1440, score: best[0] };
}

export const PLATE_W = 56;
export const PLATE_H = 8;

/** name plate -> normalised luminance (text colour differs: gold for your hero). */
export function toPlateFeature(rgba: ArrayLike<number>): Float32Array {
  const n = PLATE_W * PLATE_H;
  const v = new Float32Array(n);
  let sum = 0;
  for (let i = 0; i < n; i++) {
    v[i] = 0.299 * rgba[i * 4]! + 0.587 * rgba[i * 4 + 1]! + 0.114 * rgba[i * 4 + 2]!;
    sum += v[i]!;
  }
  const mean = sum / n;
  let norm = 0;
  for (let i = 0; i < n; i++) {
    v[i] = v[i]! - mean;
    norm += v[i]! * v[i]!;
  }
  norm = Math.sqrt(norm) || 1;
  for (let i = 0; i < n; i++) v[i] = v[i]! / norm;
  return v;
}

export interface LearnedPlate {
  /** engine hero code. */
  hero: string;
  vec: Float32Array;
}

/** Measured: same plate shifted 1 px 0.93-0.95, 2 px ~0.78; two different heroes 0.36. */
export const PLATE_THRESHOLDS = { accept: 0.8, margin: 0.1 } as const;

export function identifyPlate(vec: Float32Array, learned: LearnedPlate[]): string | undefined {
  const per = new Map<string, number>();
  for (const p of learned) {
    let s = 0;
    for (let i = 0; i < vec.length; i++) s += vec[i]! * p.vec[i]!;
    if (s > (per.get(p.hero) ?? -2)) per.set(p.hero, s);
  }
  let best = -2;
  let second = -2;
  let hero: string | undefined;
  for (const [h, s] of per) {
    if (s > best) {
      second = best;
      best = s;
      hero = h;
    } else if (s > second) second = s;
  }
  return best >= PLATE_THRESHOLDS.accept && best - second >= PLATE_THRESHOLDS.margin ? hero : undefined;
}

/** One read of the selected unit: its items (dotaconstants keys, slot order; empty
 *  and unrecognised slots omitted) and the plate feature. */
export interface HudRead {
  items: string[];
  /** slots with something on them that is not a confident item. */
  unknown: number;
  plate: Float32Array;
}

export function plateSimilarity(a: Float32Array, b: Float32Array): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i]! * b[i]!;
  return s;
}

/** Emits a HudRead once it was read the same way twice in a row (same items, same
 *  plate) and differs from the last emitted one. */
export class HudTracker {
  private prev?: HudRead;
  private emitted?: HudRead;
  constructor(private readonly confirm = 2) {}

  push(r: HudRead): HudRead | undefined {
    const same = (a?: HudRead, b?: HudRead) =>
      !!a && !!b && a.items.join() === b.items.join() && plateSimilarity(a.plate, b.plate) > 0.9;
    const stable = this.confirm <= 1 || same(this.prev, r);
    this.prev = r;
    if (!stable || same(this.emitted, r)) return undefined;
    this.emitted = r;
    return r;
  }
}
