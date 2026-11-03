// =============================================================================
//  Screen reading of the draft top bar (ADR-013 P1) - pure maths, no DOM.
//
//  Calibrated on a 2560x1440 All Pick draft screenshot: the top bar shows the 10
//  picked heroes as slanted slots (Radiant left, Dire right). Each slot is the SAME
//  art as web/heroes/<valve>.png (Valve dota_react landscape), scaled to ~157 px
//  wide at 1440p and cropped. So matching = sample the slot at a tiny size, sample
//  the corresponding region of every portrait at the same size, compare with
//  normalised cross-correlation (NCC). Measured: correct hero 0.82-0.99, best wrong
//  hero <= 0.54 (also after downscaling the capture to 1080p).
//
//  Geometry is expressed relative to screen HEIGHT and the horizontal CENTRE, so
//  it scales to any 16:9 resolution (1080p / 1440p / 4K). Other aspect ratios are
//  an assumption (Dota's HUD is height-anchored) - verify with a screenshot.
// =============================================================================

/** feature grid (per slot / per template), RGB. */
export const GRID_W = 24;
export const GRID_H = 17;
export const FEATURE_LEN = GRID_W * GRID_H * 3;

/** all numbers in units of screen height, x relative to the screen centre. */
const SLOT = {
  leftStart: -0.694444, // x of slot 0 left edge (radiant)
  rightStart: 0.136111, // x of slot 0 left edge (dire)
  pitch: 0.11455, // distance between slot left edges
  innerDx: 14 / 1440, // inner crop avoids the slanted edges
  innerW: 114 / 1440,
  innerY: 10 / 1440,
  innerH: 82 / 1440,
} as const;

/** Which part of a 256x144 portrait the inner crop shows (fractions of the portrait).
 *  The slant differs per side, so the visible window is shifted on the right. */
export const TEMPLATE_REGION = {
  left: { x0: 0.1019, y0: 0.0226, x1: 0.828, y1: 0.951 },
  right: { x0: 0.1847, y0: 0.0226, x1: 0.9108, y1: 0.951 },
} as const;

export type Side = "left" | "right";

export interface SlotRect {
  side: Side;
  index: number; // 0..4 from the left edge of that side's block
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Pixel rects of the 10 slot crops for a frame of width x height. */
export function slotRects(width: number, height: number): SlotRect[] {
  const cx = width / 2;
  const out: SlotRect[] = [];
  for (const side of ["left", "right"] as const) {
    const start = side === "left" ? SLOT.leftStart : SLOT.rightStart;
    for (let i = 0; i < 5; i++) {
      out.push({
        side,
        index: i,
        x: cx + (start + SLOT.pitch * i + SLOT.innerDx) * height,
        y: SLOT.innerY * height,
        w: SLOT.innerW * height,
        h: SLOT.innerH * height,
      });
    }
  }
  return out;
}

export interface Feature {
  /** zero-mean unit-norm RGB (colour match - picked heroes). */
  vec: Float32Array;
  /** zero-mean unit-norm luminance (shape match - the grey "preview" ghost). */
  lum: Float32Array;
  lumStd: number;
  /** mean HSV saturation 0..255 (empty slots are a flat blue-grey, <= 78 measured). */
  sat: number;
}

function normalise(v: Float32Array): Float32Array {
  let m = 0;
  for (let i = 0; i < v.length; i++) m += v[i]!;
  m /= v.length;
  let norm = 0;
  for (let i = 0; i < v.length; i++) {
    v[i] = v[i]! - m;
    norm += v[i]! * v[i]!;
  }
  norm = Math.sqrt(norm) || 1;
  for (let i = 0; i < v.length; i++) v[i] = v[i]! / norm;
  return v;
}

/** Name label under each slot (units of screen height). YOUR name is drawn in bright
 *  white, everyone else's in grey - measured 99th-percentile luminance 219 vs <= 158
 *  at 1440p (203-205 vs <= 158 after downscaling to 1080p / 720p), before AND after
 *  the pick. That makes it the primary "which slot is me" signal. */
const NAME = { dy: 110 / 1440, h: 30 / 1440, w: 142 / 1440 } as const;

export function nameRects(width: number, height: number): SlotRect[] {
  const cx = width / 2;
  const out: SlotRect[] = [];
  for (const side of ["left", "right"] as const) {
    const start = side === "left" ? SLOT.leftStart : SLOT.rightStart;
    for (let i = 0; i < 5; i++) {
      out.push({ side, index: i, x: cx + (start + SLOT.pitch * i) * height, y: NAME.dy * height, w: NAME.w * height, h: NAME.h * height });
    }
  }
  return out;
}

/** p-th percentile of luminance over RGBA pixels (histogram, O(n)). */
export function lumPercentile(rgba: ArrayLike<number>, p = 0.99): number {
  const hist = new Uint32Array(256);
  const n = rgba.length / 4;
  for (let i = 0; i < n; i++) {
    const l = Math.round(0.299 * rgba[i * 4]! + 0.587 * rgba[i * 4 + 1]! + 0.114 * rgba[i * 4 + 2]!);
    hist[Math.min(255, l)]!++;
  }
  const target = Math.ceil(n * p);
  let acc = 0;
  for (let v = 0; v < 256; v++) {
    acc += hist[v]!;
    if (acc >= target) return v;
  }
  return 255;
}

export const NAME_THRESHOLDS = { minBright: 185, minGap: 30 } as const;

/** index (0..9, left then right) of the one bright name label, if unambiguous. */
export function brightName(p99: number[]): number | undefined {
  let best = -1;
  let bi = -1;
  let second = -1;
  p99.forEach((v, i) => {
    if (v > best) {
      second = best;
      best = v;
      bi = i;
    } else if (v > second) second = v;
  });
  return best >= NAME_THRESHOLDS.minBright && best - second >= NAME_THRESHOLDS.minGap ? bi : undefined;
}

/** RGBA pixels (GRID_W x GRID_H) -> normalised RGB + luminance vectors + luminance std. */
export function toFeature(rgba: ArrayLike<number>): Feature {
  const n = GRID_W * GRID_H;
  const vec = new Float32Array(n * 3);
  const lv = new Float32Array(n);
  let satSum = 0;
  let sum = 0;
  let lum = 0;
  let lum2 = 0;
  for (let i = 0; i < n; i++) {
    const r = rgba[i * 4]!;
    const g = rgba[i * 4 + 1]!;
    const b = rgba[i * 4 + 2]!;
    vec[i * 3] = r;
    vec[i * 3 + 1] = g;
    vec[i * 3 + 2] = b;
    sum += r + g + b;
    const l = 0.299 * r + 0.587 * g + 0.114 * b;
    const mx = Math.max(r, g, b);
    if (mx > 0) satSum += ((mx - Math.min(r, g, b)) / mx) * 255;
    lv[i] = l;
    lum += l;
    lum2 += l * l;
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
  return { vec, lum: normalise(lv), lumStd: Math.sqrt(Math.max(0, lum2 / n - lm * lm)), sat: satSum / n };
}

export function dot(a: Float32Array, b: Float32Array): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i]! * b[i]!;
  return s;
}

export interface Template {
  valve: string;
  left: Float32Array;
  right: Float32Array;
  leftLum: Float32Array;
  rightLum: Float32Array;
  /** learned from a user correction (cosmetic / arcana portrait), not the stock art. */
  learned?: boolean;
}

/** best score per hero (a hero may have several templates: stock + learned looks),
 *  then best and runner-up among DIFFERENT heroes - so a learned look never competes
 *  with the stock art of the same hero for the margin. */
function rank(templates: Template[], score: (t: Template) => number): { best: number; second: number; valve: string } {
  const per = new Map<string, number>();
  for (const t of templates) {
    const s = score(t);
    if (s > (per.get(t.valve) ?? -2)) per.set(t.valve, s);
  }
  let best = -2;
  let second = -2;
  let valve = "";
  for (const [v, s] of per) {
    if (s > best) {
      second = best;
      best = s;
      valve = v;
    } else if (s > second) second = s;
  }
  return { best, second, valve };
}

export type SlotRead =
  | { kind: "hero"; valve: string; score: number; margin: number }
  | { kind: "empty" }
  /** empty slot showing the grey ghost of the hero being hovered - only YOUR slot does that. */
  | { kind: "preview"; valve: string; score: number }
  /** something is there but it is not a confident hero (HUD changed, overlay, preview ghost). */
  | { kind: "unknown"; best?: string; score: number };

export const THRESHOLDS = {
  /** NCC of the best template to accept a hero (measured correct >= 0.82). */
  accept: 0.75,
  /** best minus second best (measured >= 0.29). */
  margin: 0.15,
  /** luminance std on the 24x17 grid below which a slot is "empty" (measured empty <= 30, heroes >= 39). */
  emptyStd: 34,
  /** an empty slot must also not resemble any hero. */
  emptyMaxScore: 0.6,
  /** ...and be the flat blue-grey of the empty bar: empty <= 78, a dark cosmetic portrait
   *  with a low brightness spread (own Faceless Void, std 31) still has saturation 109. */
  emptyMaxSat: 92,
  /** preview ghost, luminance NCC (PROVISIONAL, one sample: ghost 0.60 / margin 0.38;
   *  empty slots <= 0.55 / margin <= 0.11). */
  previewAccept: 0.55,
  previewMargin: 0.25,
} as const;

export function classifySlot(
  feat: Feature,
  side: Side,
  templates: Template[],
): SlotRead {
  const { best, second, valve: bestValve } = rank(templates, (t) => dot(feat.vec, side === "left" ? t.left : t.right));
  if (feat.lumStd < THRESHOLDS.emptyStd && best < THRESHOLDS.emptyMaxScore && feat.sat < THRESHOLDS.emptyMaxSat) {
    const stock = templates.filter((t) => !t.learned); // the grey ghost is always the stock art
    const { best: lb, second: l2, valve: lv } = rank(stock, (t) => dot(feat.lum, side === "left" ? t.leftLum : t.rightLum));
    if (lb >= THRESHOLDS.previewAccept && lb - l2 >= THRESHOLDS.previewMargin) {
      return { kind: "preview", valve: lv, score: lb };
    }
    return { kind: "empty" };
  }
  if (best >= THRESHOLDS.accept && best - second >= THRESHOLDS.margin) {
    return { kind: "hero", valve: bestValve, score: best, margin: best - second };
  }
  return { kind: "unknown", ...(bestValve ? { best: bestValve } : {}), score: best };
}

/** A frame = 5 + 5 slot reads. A hero can be picked once per match: if two slots
 *  claim the same hero, keep the higher score and mark the other unknown. */
export interface Frame {
  left: SlotRead[];
  right: SlotRead[];
  /** raw slot features (kept so a user correction can be learned as a new look). */
  feats?: { left: Feature[]; right: Feature[] };
  /** 99th-percentile luminance of the 10 name labels (left 0-4, right 0-4). */
  names?: number[];
}

export function dedupeFrame(f: Frame): Frame {
  const all = [...f.left, ...f.right];
  const bestFor = new Map<string, number>();
  for (const r of all) {
    if (r.kind === "hero") bestFor.set(r.valve, Math.max(bestFor.get(r.valve) ?? -2, r.score));
  }
  const fix = (r: SlotRead): SlotRead =>
    r.kind === "hero" && r.score < bestFor.get(r.valve)! ? { kind: "unknown", best: r.valve, score: r.score } : r;
  return { left: f.left.map(fix), right: f.right.map(fix), ...(f.names ? { names: f.names } : {}), ...(f.feats ? { feats: f.feats } : {}) };
}

// ---------------------------------------------------------------------------
//  Tracker: debounced frames -> change events (what the UI applies).
// ---------------------------------------------------------------------------

export interface ScreenChange {
  /** all 10 slots empty after a draft was seen -> a new draft begins. */
  reset: boolean;
  /** stable hero per slot (undefined = nothing confident there yet). */
  left: Array<string | undefined>;
  right: Array<string | undefined>;
  /** slots whose stable hero changed in this update. */
  changed: Array<{ side: Side; index: number; from?: string; to?: string }>;
  /** YOUR slot, inferred from the preview ghost (only your own slot shows one). */
  mine?: { side: Side; index: number };
}

/**
 * Debounce: a slot's value becomes stable after `confirm` identical consecutive
 * reads. Only confident hero reads change a slot; "unknown" never clears one (the
 * in-game HUD looks nothing like the draft bar - we must not wipe the draft when
 * the game starts). Clearing happens only through a full reset: all 10 slots
 * read "empty" for `confirm` frames after at least one hero was seen.
 */
export class ScreenTracker {
  private stable: Record<Side, Array<string | undefined>> = { left: [], right: [] };
  private pending: Record<Side, Array<{ v: string; n: number } | undefined>> = { left: [], right: [] };
  private emptyRun = 0;
  private sawHero = false;
  private mine?: { side: Side; index: number };
  private previewRun?: { side: Side; index: number; n: number };

  constructor(private readonly confirm = 2) {}

  push(frame: Frame): ScreenChange | undefined {
    const f = dedupeFrame(frame);
    const mineFound = this.trackPreview(f);
    const allEmpty = [...f.left, ...f.right].every((r) => r.kind === "empty" || r.kind === "preview");
    if (allEmpty) {
      this.emptyRun++;
      if (this.emptyRun === this.confirm && this.sawHero) {
        this.stable = { left: [], right: [] };
        this.pending = { left: [], right: [] };
        this.sawHero = false;
        this.mine = undefined;
        this.previewRun = undefined;
        // the ghost may already be visible in the very frame that resets
        this.trackPreview(f);
        return { reset: true, left: [], right: [], changed: [], ...(this.mine ? { mine: this.mine } : {}) };
      }
      return mineFound ? this.snapshot([]) : undefined;
    }
    this.emptyRun = 0;

    const changed: ScreenChange["changed"] = [];
    for (const side of ["left", "right"] as const) {
      f[side].forEach((r, i) => {
        if (r.kind !== "hero") {
          this.pending[side][i] = undefined;
          return;
        }
        if (this.stable[side][i] === r.valve) {
          this.pending[side][i] = undefined;
          return;
        }
        const p = this.pending[side][i];
        const n = p && p.v === r.valve ? p.n + 1 : 1;
        this.pending[side][i] = { v: r.valve, n };
        if (n >= this.confirm) {
          const from = this.stable[side][i];
          this.stable[side][i] = r.valve;
          this.pending[side][i] = undefined;
          this.sawHero = true;
          changed.push({ side, index: i, ...(from ? { from } : {}), to: r.valve });
        }
      });
    }
    if (!changed.length && !mineFound) return undefined;
    return this.snapshot(changed);
  }

  private snapshot(changed: ScreenChange["changed"]): ScreenChange {
    return {
      reset: false,
      left: [...this.stable.left],
      right: [...this.stable.right],
      changed,
      ...(this.mine ? { mine: this.mine } : {}),
    };
  }

  /** your slot: the bright name label (primary) or the preview ghost (fallback),
   *  seen in the same slot for `confirm` (name) / `confirm`+1 (ghost) frames. Only on
   *  frames that look like the draft bar (<= 2 unknown slots), so starting the share
   *  mid-game can't pick a random HUD element. */
  private trackPreview(f: Frame): boolean {
    if (this.mine) return false;
    const reads = [...f.left, ...f.right];
    if (reads.filter((r) => r.kind === "unknown").length > 2) {
      this.previewRun = undefined;
      return false;
    }
    let hit: { side: Side; index: number } | undefined;
    let need = this.confirm + 1;
    const bi = f.names ? brightName(f.names) : undefined;
    if (bi !== undefined) {
      hit = { side: bi < 5 ? "left" : "right", index: bi % 5 };
      need = this.confirm;
    } else {
      for (const side of ["left", "right"] as const) {
        f[side].forEach((r, index) => {
          if (r.kind === "preview" && !hit) hit = { side, index };
        });
      }
    }
    if (!hit) {
      this.previewRun = undefined;
      return false;
    }
    const p = this.previewRun;
    const n = p && p.side === hit.side && p.index === hit.index ? p.n + 1 : 1;
    this.previewRun = { ...hit, n };
    if (n >= need) {
      this.mine = hit;
      return true;
    }
    return false;
  }
}
