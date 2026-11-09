// =============================================================================
//  Idle time (ADR-041): minutes alive, out of base, with nothing that pays -
//  no last hit or deny, no stack, no ward, no rune, no spell or item cast, no
//  hero damage dealt or taken, no enemy hero nearby, almost no XP. Moving or
//  standing - both count.
//
//  The farm data is per minute, so a minute is the unit: a minute with one last
//  hit is not idle. That makes this an UNDER-count of idle seconds and an
//  over-count of "lost" farm (some idle minutes are the walk between camps or to
//  a fight). The finding is therefore "possible" (check the replay).
//
//  What it costs:
//    cores (pos 1-3): idle minutes x your own farming pace (median networth gain
//      in minutes you were farming: 3+ last hits, no hero damage) = gold not made;
//    supports (pos 4-5): every minute has one stack window (x:53-x:55) and a ward
//      or a smoke could have gone in - "minutes in which a stack / ward was possible".
//  Pure: no DOM.
// =============================================================================

export interface IdleInput {
  /** per-minute arrays from STRATZ stats (index = minute). */
  lastHits?: number[] | null;
  denies?: number[] | null;
  networth?: number[] | null;
  xp?: number[] | null;
  heroDamage?: number[] | null;
  /** cumulative per minute. */
  damageReceived?: number[] | null;
  /** cumulative per minute. */
  campStack?: number[] | null;
  /** seconds of: spell / item casts, wards placed, runes taken. */
  actions: number[];
  /** your positions (map cells), time-sorted. */
  me: Array<{ time: number; x: number; y: number }>;
  /** enemy heroes' positions (map cells), each time-sorted. */
  enemies: Array<Array<{ time: number; x: number; y: number }>>;
  /** [from, to) seconds dead. */
  dead: Array<[number, number]>;
  duration: number;
  position?: number;
}

export interface IdleReport {
  /** minutes judged idle (minute index). */
  minutes: number[];
  /** minutes that were checked (alive whole minute, after START). */
  checked: number;
  /** cores: your farming pace (networth per farming minute) and the gold it implies. */
  pace?: number;
  goldLost?: number;
  /** supports: minutes in which a stack / ward was possible. */
  stackChances?: number;
}

/** before this minute the lane is on (idle there means something else). */
export const IDLE_START = 4;
/** XP per minute below this: not soaking a lane or a fight. */
export const IDLE_XP = 120;
/** an enemy hero within this many map cells (~960 world units, about engagement range)
 *  for 2+ samples (10 s) = pressure, zoning or a fight. 30 cells flagged every minute of
 *  the sample match as "near" (lane-wide), so it was too wide. */
export const IDLE_NEAR = 15;
const NEAR_SAMPLES = 2;
/** within this many cells of your own fountain = in base (heal, shop). */
export const IDLE_BASE = 30;
/** a minute counts only if you were out of base most of it. */
const BASE_SHARE = 0.5;

function at(evs: Array<{ time: number; x: number; y: number }>, t: number): { time: number; x: number; y: number } | undefined {
  let lo = 0;
  let hi = evs.length - 1;
  if (hi < 0 || evs[0]!.time > t) return evs[0];
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (evs[mid]!.time <= t) lo = mid;
    else hi = mid - 1;
  }
  return evs[lo];
}

export function idleTime(d: IdleInput): IdleReport | undefined {
  const lh = d.lastHits ?? [];
  if (!lh.length || !d.me.length) return undefined;
  const fountain = d.me.find((p) => p.time <= 0) ?? d.me[0]!;
  const end = Math.min(lh.length, Math.floor(d.duration / 60));
  const val = (xs: number[] | null | undefined, m: number) => xs?.[m] ?? 0;
  const diff = (xs: number[] | null | undefined, m: number) => (xs?.length ? (xs[m] ?? xs.at(-1)!) - (m > 0 ? xs[m - 1] ?? 0 : 0) : 0);
  const deadIn = (a: number, b: number) => d.dead.some(([x, y]) => x < b && y > a);
  const acts = [...d.actions].sort((a, b) => a - b);
  const actIn = (a: number, b: number) => acts.some((t) => t >= a && t < b);

  const minutes: number[] = [];
  const farming: number[] = [];
  let checked = 0;
  for (let m = IDLE_START; m < end; m++) {
    const a = m * 60;
    const b = a + 60;
    if (deadIn(a, b)) continue;
    // out of base most of the minute, and is an enemy hero ever near?
    let inBase = 0;
    let samples = 0;
    let nearN = 0;
    for (let t = a; t < b; t += 5) {
      const p = at(d.me, t);
      if (!p) continue;
      samples++;
      if (Math.hypot(p.x - fountain.x, p.y - fountain.y) <= IDLE_BASE) inBase++;
      if (d.enemies.some((e) => {
        const q = at(e, t);
        return !!q && Math.hypot(q.x - p.x, q.y - p.y) <= IDLE_NEAR;
      })) nearN++;
    }
    if (!samples || inBase / samples >= BASE_SHARE) continue;
    const near = nearN >= NEAR_SAMPLES;
    checked++;
    const lastHits = val(lh, m) + val(d.denies, m);
    const fought = val(d.heroDamage, m) > 0 || diff(d.damageReceived, m) > 0;
    if (lastHits >= 3 && !fought) {
      const g = diff(d.networth, m + 1);
      if (g > 0) farming.push(g);
    }
    const busy =
      lastHits > 0 || diff(d.campStack, m) > 0 || fought || near || actIn(a, b) || val(d.xp, m) >= IDLE_XP;
    if (!busy) minutes.push(m);
  }
  const out: IdleReport = { minutes, checked };
  const core = d.position !== undefined && d.position <= 3;
  if (core && farming.length >= 3) {
    const s = [...farming].sort((x, y) => x - y);
    const pace = s[Math.floor(s.length / 2)]!;
    out.pace = Math.round(pace);
    out.goldLost = Math.round(pace * minutes.length);
  }
  if (d.position !== undefined && d.position >= 4) out.stackChances = minutes.length;
  return out;
}

/** runs of consecutive minutes, for the times shown on a finding. */
export function idleRuns(minutes: number[]): Array<[number, number]> {
  const runs: Array<[number, number]> = [];
  for (const m of minutes) {
    const last = runs.at(-1);
    if (last && last[1] === m - 1) last[1] = m;
    else runs.push([m, m]);
  }
  return runs;
}
