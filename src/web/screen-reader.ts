// =============================================================================
//  ScreenReader - third input adapter (ADR-013 P1): reads the draft top bar from
//  a screen share (getDisplayMedia). Nothing touches the game: the browser only
//  sees pixels, exactly like a Discord/OBS share. No launch options, no files.
//
//  Pipeline per tick (2 Hz): video frame -> 10 slot crops -> 24x17 RGB features ->
//  NCC vs all portraits (src/screen-match.ts) -> ScreenTracker (debounce) ->
//  ScreenChange -> UI. A still screenshot can be fed instead of a live share
//  (readImage) to check calibration without a game running.
// =============================================================================

import {
  FEATURE_LEN,
  classifySlot,
  lumPercentile,
  nameRects,
  GRID_H,
  GRID_W,
  ScreenTracker,
  slotRects,
  TEMPLATE_REGION,
  toFeature,
  type Frame,
  type ScreenChange,
  type SlotRead,
  type Template,
} from "../screen-match.js";

export type ScreenStatus =
  | { kind: "off" }
  | { kind: "starting" }
  /** share running; `seen` = slots with a confident hero in the last frame;
   *  `ms` = cost of reading one frame (moving average). */
  | { kind: "live"; seen: number; width: number; height: number; ms: number }
  | { kind: "error"; message: string };

export interface ScreenHandlers {
  onChange(c: ScreenChange): void;
  onStatus(s: ScreenStatus): void;
  /** raw per-frame reads (for the debug readout). */
  onFrame?(f: Frame): void;
}

/** Read 10x per second; a hero needs 2 identical reads -> it shows up 100-200 ms
 *  after it appears on screen (+ capture latency). One read costs a few ms. */
const TICK_MS = 100;
/** capture rate; must be >= the read rate or reads see stale frames. */
const CAPTURE_FPS = 30;

function canvas(w: number, h: number): CanvasRenderingContext2D {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("2D canvas unavailable");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  return ctx;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((ok, fail) => {
    const img = new Image();
    img.onload = () => ok(img);
    img.onerror = () => fail(new Error(`cannot load ${src}`));
    img.src = src;
  });
}

/** Build NCC templates from the self-hosted portraits (same art the top bar uses). */
export async function buildTemplates(valves: string[], urlOf: (v: string) => string): Promise<Template[]> {
  const ctx = canvas(GRID_W, GRID_H);
  const sample = (img: HTMLImageElement, r: { x0: number; y0: number; x1: number; y1: number }) => {
    const w = img.naturalWidth;
    const h = img.naturalHeight;
    ctx.clearRect(0, 0, GRID_W, GRID_H);
    ctx.drawImage(img, r.x0 * w, r.y0 * h, (r.x1 - r.x0) * w, (r.y1 - r.y0) * h, 0, 0, GRID_W, GRID_H);
    return toFeature(ctx.getImageData(0, 0, GRID_W, GRID_H).data);
  };
  const out: Template[] = [];
  await Promise.all(
    valves.map(async (valve) => {
      try {
        const img = await loadImage(urlOf(valve));
        const l = sample(img, TEMPLATE_REGION.left);
        const r = sample(img, TEMPLATE_REGION.right);
        out.push({ valve, left: l.vec, right: r.vec, leftLum: l.lum, rightLum: r.lum });
      } catch {
        /* missing portrait: that hero simply can't be recognised */
      }
    }),
  );
  return out;
}

/** Read the 10 slots of one frame. All crops go into ONE strip canvas so the GPU
 *  is read back once per frame (getImageData stalls are the dominant cost). */
export function readFrame(
  source: CanvasImageSource,
  width: number,
  height: number,
  templates: Template[],
  ctx: CanvasRenderingContext2D = canvas(GRID_W * 10, GRID_H),
  nameCtx?: CanvasRenderingContext2D,
): Frame {
  const rects = slotRects(width, height);
  ctx.clearRect(0, 0, GRID_W * rects.length, GRID_H);
  rects.forEach((r, k) => ctx.drawImage(source, r.x, r.y, r.w, r.h, k * GRID_W, 0, GRID_W, GRID_H));
  const strip = ctx.getImageData(0, 0, GRID_W * rects.length, GRID_H).data;
  const one = new Uint8ClampedArray(GRID_W * GRID_H * 4);
  const rowBytes = GRID_W * 4;
  const stripRow = GRID_W * rects.length * 4;
  const frame: Frame = { left: [], right: [], feats: { left: [], right: [] } };
  rects.forEach((r, k) => {
    for (let y = 0; y < GRID_H; y++) {
      one.set(strip.subarray(y * stripRow + k * rowBytes, y * stripRow + (k + 1) * rowBytes), y * rowBytes);
    }
    const feat = toFeature(one);
    const read: SlotRead = classifySlot(feat, r.side, templates);
    frame[r.side][r.index] = read;
    frame.feats![r.side][r.index] = feat;
  });
  frame.names = readNames(source, width, height, nameCtx);
  return frame;
}

/** Name labels at native resolution (thin white text must not be averaged away). */
function readNames(
  source: CanvasImageSource,
  width: number,
  height: number,
  ctx?: CanvasRenderingContext2D,
): number[] {
  const rects = nameRects(width, height);
  const w = Math.max(8, Math.round(rects[0]!.w));
  const h = Math.max(4, Math.round(rects[0]!.h));
  const c = ctx && ctx.canvas.width === w * 10 && ctx.canvas.height === h ? ctx : canvas(w * 10, h);
  c.clearRect(0, 0, w * 10, h);
  rects.forEach((r, k) => c.drawImage(source, r.x, r.y, r.w, r.h, k * w, 0, w, h));
  const data = c.getImageData(0, 0, w * 10, h).data;
  const one = new Uint8ClampedArray(w * h * 4);
  const row = w * 4;
  const stripRow = w * 10 * 4;
  return rects.map((_, k) => {
    for (let y = 0; y < h; y++) one.set(data.subarray(y * stripRow + k * row, y * stripRow + (k + 1) * row), y * row);
    return lumPercentile(one, 0.99);
  });
}

// ---------------------------------------------------------------------------
//  Learned looks: a cosmetic / arcana / persona changes the top-bar portrait, so
//  the stock art does not match (measured: own Faceless Void with a cosmetic 0.31).
//  One correction in the UI stores that slot's feature as an extra template for the
//  hero. Per-browser (localStorage); without storage it still works for the session.
// ---------------------------------------------------------------------------

const LEARNED_KEY = "dotaapp.learnedPortraits.v1";
const LEARNED_MAX = 80; // looks kept in total (oldest dropped)
const LEARNED_PER_HERO_SIDE = 3;

interface LearnedRow { valve: string; side: "left" | "right"; vec: number[]; lum: number[]; at: number }

function toTemplate(r: LearnedRow): Template {
  const zeroV = new Float32Array(FEATURE_LEN);
  const zeroL = new Float32Array(GRID_W * GRID_H);
  const vec = Float32Array.from(r.vec);
  const lum = Float32Array.from(r.lum);
  return {
    valve: r.valve,
    left: r.side === "left" ? vec : zeroV,
    right: r.side === "right" ? vec : zeroV,
    leftLum: r.side === "left" ? lum : zeroL,
    rightLum: r.side === "right" ? lum : zeroL,
    learned: true,
  };
}

function loadLearned(): LearnedRow[] {
  try {
    const raw = localStorage.getItem(LEARNED_KEY);
    return raw ? (JSON.parse(raw) as LearnedRow[]) : [];
  } catch {
    return [];
  }
}

function saveLearned(rows: LearnedRow[]): void {
  try {
    localStorage.setItem(LEARNED_KEY, JSON.stringify(rows));
  } catch {
    /* storage unavailable or full - the look is still used this session */
  }
}

/** how many looks are stored (for the UI). */
export function learnedCount(): number {
  return loadLearned().length;
}

export function forgetLearned(): void {
  try {
    localStorage.removeItem(LEARNED_KEY);
  } catch {
    /* nothing to forget */
  }
}

export class ScreenReader {
  private stream?: MediaStream;
  private video?: HTMLVideoElement;
  private timer?: number;
  private tracker = new ScreenTracker(2);
  private ctx?: CanvasRenderingContext2D;
  private nameCtx?: CanvasRenderingContext2D;
  private avgMs = 0;
  private tpl?: Template[];
  private learnedRows: LearnedRow[] = loadLearned();
  /** last frame read (live or still) - the source of a learned look. */
  private last?: Frame;

  constructor(
    private readonly templates: () => Promise<Template[]>,
    private readonly h: ScreenHandlers,
  ) {}

  get running(): boolean {
    return this.stream !== undefined;
  }

  private async ensureTemplates(): Promise<Template[]> {
    if (!this.tpl) this.tpl = [...(await this.templates()), ...this.learnedRows.map(toTemplate)];
    return this.tpl;
  }

  /** Remember what `valve` looks like in a slot of the last frame (user correction). */
  learn(valve: string, side: "left" | "right", index: number): boolean {
    const feat = this.last?.feats?.[side][index];
    if (!feat) return false;
    const row: LearnedRow = {
      valve,
      side,
      vec: Array.from(feat.vec, (x) => Math.round(x * 1e4) / 1e4),
      lum: Array.from(feat.lum, (x) => Math.round(x * 1e4) / 1e4),
      at: Date.now(),
    };
    // keep the newest few looks per hero+side, and a global cap
    const same = this.learnedRows.filter((r) => r.valve === valve && r.side === side);
    let rows = this.learnedRows;
    if (same.length >= LEARNED_PER_HERO_SIDE) rows = rows.filter((r) => r !== same[0]);
    rows = [...rows, row].slice(-LEARNED_MAX);
    this.learnedRows = rows;
    saveLearned(rows);
    this.tpl?.push(toTemplate(row));
    return true;
  }

  async start(): Promise<void> {
    if (this.stream) return;
    if (!navigator.mediaDevices?.getDisplayMedia) {
      this.h.onStatus({ kind: "error", message: "screen capture is not supported in this browser" });
      return;
    }
    this.h.onStatus({ kind: "starting" });
    let tpl: Template[];
    try {
      [tpl, this.stream] = await Promise.all([
        this.ensureTemplates(),
        navigator.mediaDevices.getDisplayMedia({ video: { frameRate: CAPTURE_FPS }, audio: false }),
      ]);
    } catch (e) {
      this.stream = undefined;
      const msg = (e as Error).name === "NotAllowedError" ? "screen share was cancelled" : (e as Error).message;
      this.h.onStatus({ kind: "error", message: msg });
      return;
    }
    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.srcObject = this.stream;
    await video.play().catch(() => undefined);
    this.video = video;
    this.ctx = canvas(GRID_W * 10, GRID_H);
    this.tracker = new ScreenTracker(2);
    // the user can end the share from the browser's own "Stop sharing" bar
    this.nameCtx = undefined; // sized from the first frame
    for (const t of this.stream.getVideoTracks()) t.addEventListener("ended", () => this.stop());
    this.timer = window.setInterval(() => this.tick(tpl), TICK_MS);
  }

  private tick(tpl: Template[]): void {
    const v = this.video;
    if (!v || v.videoWidth === 0) return;
    const t0 = performance.now();
    if (!this.nameCtx) {
      const r = nameRects(v.videoWidth, v.videoHeight)[0]!;
      this.nameCtx = canvas(Math.max(8, Math.round(r.w)) * 10, Math.max(4, Math.round(r.h)));
    }
    const f = readFrame(v, v.videoWidth, v.videoHeight, tpl, this.ctx, this.nameCtx);
    const dt = performance.now() - t0;
    this.avgMs = this.avgMs ? this.avgMs * 0.9 + dt * 0.1 : dt;
    this.last = f;
    this.h.onFrame?.(f);
    const seen = [...f.left, ...f.right].filter((r) => r.kind === "hero").length;
    this.h.onStatus({ kind: "live", seen, width: v.videoWidth, height: v.videoHeight, ms: this.avgMs });
    const c = this.tracker.push(f);
    if (c) this.h.onChange(c);
  }

  /** Calibration check without a game: run a still screenshot through the same path. */
  async readImage(file: Blob): Promise<Frame> {
    const tpl = await this.ensureTemplates();
    const url = URL.createObjectURL(file);
    try {
      const img = await loadImage(url);
      const f = readFrame(img, img.naturalWidth, img.naturalHeight, tpl);
      this.last = f;
      // a still is confirmed immediately (tracker with confirm = 1)
      const t = new ScreenTracker(1);
      // a still: the 1st push confirms the heroes, the 2nd the preview ghost
      const first = t.push(f);
      const second = t.push(f);
      const base = first ?? second;
      if (base) {
        const mine = second?.mine ?? first?.mine;
        this.h.onChange({ ...base, ...(mine ? { mine } : {}) });
      }
      this.h.onFrame?.(f);
      return f;
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  stop(): void {
    if (this.timer !== undefined) window.clearInterval(this.timer);
    this.timer = undefined;
    for (const t of this.stream?.getTracks() ?? []) t.stop();
    this.stream = undefined;
    this.video = undefined;
    this.h.onStatus({ kind: "off" });
  }
}
