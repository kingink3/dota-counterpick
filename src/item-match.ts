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
//  4-ability hero selected; heroes with more abilities widen the centre panel -
//  NOT verified yet, see ADR-025.
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

/** the 6 main inventory slots of the selected unit (row-major), `dx` in px. */
export function hudSlotRects(width: number, height: number, dx = 0): Rect[] {
  const cx = width / 2;
  const out: Rect[] = [];
  for (let r = 0; r < 2; r++) {
    for (let c = 0; c < 3; c++) {
      out.push({ x: cx + (INV.x0 + c * INV.pitchX) * height + dx, y: (INV.y0 + r * INV.pitchY) * height, w: INV.w * height, h: INV.h * height });
    }
  }
  return out;
}

export function plateRect(width: number, height: number): Rect {
  return { x: width / 2 + PLATE.x0 * height, y: PLATE.y0 * height, w: PLATE.w * height, h: PLATE.h * height };
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
