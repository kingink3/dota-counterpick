// =============================================================================
//  Game clock from the top bar (ADR-026). Pure functions, no DOM.
//
//  The clock is white text (12 px tall at 1440p) under a sun / moon icon, centred
//  on the screen. Per read: white low-saturation pixels -> column segments ->
//  colon (narrow + short) or digit (bbox resampled to 8x12, NCC vs glyph
//  templates learned from real captures, src/clock-glyphs.ts).
//  Before the horn the same clock counts DOWN (shown without a minus, with the
//  night icon): the caller tells pre-game from game time by the direction.
// =============================================================================

import { GLYPHS } from "./clock-glyphs.js";

export const GLYPH_W = 8;
export const GLYPH_H = 12;

/** region read per tick, in units of screen height (x from the screen centre). */
export const CLOCK_REGION = { halfW: 64 / 1440, y0: 6 / 1440, h: 42 / 1440 } as const;
/** inside the region (fractions of its height): text band and icon band. */
const TEXT_BAND = { y0: (33 - 6) / 42, y1: (47 - 6) / 42 } as const;
const ICON_BAND = { y0: (8 - 6) / 42, y1: (30 - 6) / 42, halfW: 22 / 128 } as const;

export function clockRect(width: number, height: number): { x: number; y: number; w: number; h: number } {
  const w = 2 * CLOCK_REGION.halfW * height;
  return { x: width / 2 - w / 2, y: CLOCK_REGION.y0 * height, w, h: CLOCK_REGION.h * height };
}

export interface ClockRead {
  /** displayed time in seconds (pre-horn countdown is positive here too). */
  seconds: number;
  text: string;
  /** moon icon (night, also shown before the horn). */
  night: boolean;
  /** weakest digit match - for diagnostics. */
  minScore: number;
}

export const CLOCK_THRESHOLDS = { accept: 0.6, margin: 0.08, white: 150, maxSat: 0.3 } as const;

/** one glyph: bbox luminance -> GLYPH_W x GLYPH_H, bilinear, mean-removed, unit norm. */
export function glyphVector(lum: Float32Array, stride: number, x0: number, y0: number, w: number, h: number): Float32Array {
  const out = new Float32Array(GLYPH_W * GLYPH_H);
  for (let gy = 0; gy < GLYPH_H; gy++) {
    const sy = Math.min(h - 1, Math.max(0, ((gy + 0.5) * h) / GLYPH_H - 0.5));
    const y = Math.floor(sy);
    const fy = sy - y;
    const y2 = Math.min(h - 1, y + 1);
    for (let gx = 0; gx < GLYPH_W; gx++) {
      const sx = Math.min(w - 1, Math.max(0, ((gx + 0.5) * w) / GLYPH_W - 0.5));
      const x = Math.floor(sx);
      const fx = sx - x;
      const x2 = Math.min(w - 1, x + 1);
      const at = (xx: number, yy: number) => lum[(y0 + yy) * stride + x0 + xx]!;
      out[gy * GLYPH_W + gx] =
        (at(x, y) * (1 - fx) + at(x2, y) * fx) * (1 - fy) + (at(x, y2) * (1 - fx) + at(x2, y2) * fx) * fy;
    }
  }
  let mean = 0;
  for (const v of out) mean += v;
  mean /= out.length;
  let norm = 0;
  for (let i = 0; i < out.length; i++) {
    out[i] = out[i]! - mean;
    norm += out[i]! * out[i]!;
  }
  norm = Math.sqrt(norm) || 1;
  for (let i = 0; i < out.length; i++) out[i] = out[i]! / norm;
  return out;
}

export interface Segment {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

/** column segments of white text inside the text band (region coordinates). */
export function segments(rgba: ArrayLike<number>, width: number, height: number): { segs: Segment[]; lum: Float32Array } {
  const lum = new Float32Array(width * height);
  const white = new Uint8Array(width * height);
  const ty0 = Math.floor(TEXT_BAND.y0 * height);
  const ty1 = Math.ceil(TEXT_BAND.y1 * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const r = rgba[i]!;
      const g = rgba[i + 1]!;
      const b = rgba[i + 2]!;
      const l = 0.299 * r + 0.587 * g + 0.114 * b;
      lum[y * width + x] = l;
      const mx = Math.max(r, g, b);
      const sat = mx > 0 ? (mx - Math.min(r, g, b)) / mx : 0;
      if (y >= ty0 && y < ty1 && l > CLOCK_THRESHOLDS.white && sat < CLOCK_THRESHOLDS.maxSat) white[y * width + x] = 1;
    }
  }
  const segs: Segment[] = [];
  let start = -1;
  for (let x = 0; x <= width; x++) {
    let on = false;
    if (x < width) for (let y = ty0; y < ty1 && !on; y++) on = white[y * width + x] === 1;
    if (on && start < 0) start = x;
    if (!on && start >= 0) {
      let y0 = ty1;
      let y1 = ty0;
      for (let y = ty0; y < ty1; y++) {
        for (let xx = start; xx < x; xx++) {
          if (white[y * width + xx]) {
            y0 = Math.min(y0, y);
            y1 = Math.max(y1, y + 1);
          }
        }
      }
      segs.push({ x0: start, x1: x, y0, y1 });
      start = -1;
    }
  }
  return { segs, lum };
}

/** Read the clock region (RGBA, region pixels). undefined = no clean m:ss here. */
export function readClock(rgba: ArrayLike<number>, width: number, height: number): ClockRead | undefined {
  const { segs, lum } = segments(rgba, width, height);
  if (segs.length < 3 || segs.length > 6) return undefined;
  const textH = Math.max(...segs.map((s) => s.y1 - s.y0));
  if (textH < 6) return undefined;
  let text = "";
  let minScore = 1;
  for (const s of segs) {
    const w = s.x1 - s.x0;
    const h = s.y1 - s.y0;
    if (w <= Math.max(2, 0.3 * textH) && h < 0.85 * textH) {
      text += ":";
      continue;
    }
    const v = glyphVector(lum, width, s.x0, s.y0, w, h);
    let best = -2;
    let second = -2;
    let digit = "";
    for (const [d, t] of Object.entries(GLYPHS)) {
      let sc = 0;
      for (let i = 0; i < v.length; i++) sc += v[i]! * t[i]!;
      if (sc > best) {
        second = best;
        best = sc;
        digit = d;
      } else if (sc > second) second = sc;
    }
    if (best < CLOCK_THRESHOLDS.accept || best - second < CLOCK_THRESHOLDS.margin) return undefined;
    minScore = Math.min(minScore, best);
    text += digit;
  }
  const m = /^(\d{1,3}):(\d\d)$/.exec(text);
  if (!m || Number(m[2]) > 59) return undefined;
  return { seconds: Number(m[1]) * 60 + Number(m[2]), text, night: isNight(rgba, width, height), minScore };
}

/** sun = warm yellow, moon = cool blue-white: compare red vs blue of bright icon pixels. */
function isNight(rgba: ArrayLike<number>, width: number, height: number): boolean {
  const y0 = Math.floor(ICON_BAND.y0 * height);
  const y1 = Math.ceil(ICON_BAND.y1 * height);
  const x0 = Math.floor(width / 2 - ICON_BAND.halfW * width);
  const x1 = Math.ceil(width / 2 + ICON_BAND.halfW * width);
  let rb = 0;
  let n = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y * width + x) * 4;
      const l = 0.299 * rgba[i]! + 0.587 * rgba[i + 1]! + 0.114 * rgba[i + 2]!;
      if (l < 120) continue;
      rb += rgba[i]! - rgba[i + 2]!;
      n++;
    }
  }
  return n > 0 && rb / n < 0;
}

/** Turns successive reads into game time: a clock counting DOWN is the pre-horn
 *  countdown (negative game time); a stalled clock is a pause. */
export class GameClock {
  private last?: { shown: number; at: number };
  private dir = 0; // +1 counting up, -1 counting down
  private lastChangeAt = 0;

  /** returns game seconds (negative before the horn) or undefined if unknown. */
  push(r: ClockRead, now: number): { gameSeconds: number; paused: boolean; pregame: boolean } {
    if (this.last && r.seconds !== this.last.shown) {
      this.dir = r.seconds > this.last.shown ? 1 : -1;
      this.lastChangeAt = now;
    } else if (!this.last) {
      // first read: the moon before 5:00 is the pre-horn countdown (day starts at 0:00)
      this.dir = r.night && r.seconds < 300 ? -1 : 1;
      this.lastChangeAt = now;
    }
    this.last = { shown: r.seconds, at: now };
    const pregame = this.dir < 0;
    return { gameSeconds: pregame ? -r.seconds : r.seconds, paused: now - this.lastChangeAt > 2500, pregame };
  }

  reset(): void {
    this.last = undefined;
    this.dir = 0;
  }
}
