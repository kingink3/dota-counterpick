// =============================================================================
//  Item icon matching for the Tab scoreboard (ADR-025). Pure functions, no DOM.
//
//  An inventory slot is sampled to ITEM_W x ITEM_H RGB, mean-removed and normalised;
//  the best template by dot product (NCC) wins if it clears `accept` and beats the
//  runner-up by `margin`. Measured on all 258 Valve icons rendered at 32-40 px with
//  noise, +-10% brightness and 1 px misalignment: 255-258/258 top-1, margin p5 0.17;
//  the only confusions are icons with IDENTICAL art (Roshan's Shard/Scepter copies),
//  which are folded into their base item here.
//  Layout (where the slots are on the scoreboard) lives with the reader, measured
//  from real screenshots.
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

/** PROVISIONAL until measured on real scoreboard screenshots. */
export const ITEM_THRESHOLDS = {
  accept: 0.7,
  margin: 0.08,
  /** an empty inventory slot is a flat dark cell. */
  emptyStd: 16,
  emptyMaxSat: 70,
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
