// =============================================================================
//  Map-event timers for the Game tab (ADR-026). Pure: game time + role + manual
//  marks (Roshan / Tormentor killed) -> the next occurrence of every event.
//  The schedule lives in data/timings.yaml (each line with its patch-note source).
// =============================================================================

export interface TimingEvent {
  id: string;
  label: string;
  /** periodic: first + n * every (optionally until `until`). */
  first?: number;
  every?: number;
  until?: number;
  /** fixed times (with optional per-time names). */
  at?: number[];
  names?: string[];
  /** relative to a manual mark ("roshan_killed" / "tormentor_killed"). */
  after?: string;
  delay?: number;
  /** the event stays "on" this long after it starts (stack window, Roshan 8-11 min). */
  window?: number;
  roles: number[];
  /** seconds of warning before it starts. */
  lead: number;
  note?: string;
  source: string;
  confidence?: "rule" | "approx";
}

export interface Timings {
  patch: string;
  reviewed?: string;
  events: TimingEvent[];
}

export interface Upcoming {
  id: string;
  label: string;
  /** game second the event starts. */
  at: number;
  /** seconds until it starts (negative while its window is open). */
  in: number;
  /** "soon" = within its lead time, "now" = window open / just happened. */
  state: "later" | "soon" | "now";
  window?: number;
  note?: string;
  confidence?: "rule" | "approx";
}

/** how long a point event (no window) is shown as "now" after it happened. */
const JUST_HAPPENED = 10;

/** next occurrence of each event relevant to `role` (all roles when undefined). */
export function upcoming(
  timings: Timings,
  t: number,
  role: number | undefined,
  marks: Record<string, number | undefined> = {},
): Upcoming[] {
  const out: Upcoming[] = [];
  for (const e of timings.events) {
    if (role !== undefined && !e.roles.includes(role)) continue;
    const hold = e.window ?? JUST_HAPPENED;
    let at: number | undefined;
    let label = e.label;
    if (e.every !== undefined) {
      const first = e.first ?? 0;
      const k = Math.max(0, Math.ceil((t - hold - first) / e.every));
      at = first + k * e.every;
      if (e.until !== undefined && at > e.until) at = undefined;
    } else if (e.at) {
      const i = e.at.findIndex((x) => x + hold >= t);
      if (i >= 0) {
        at = e.at[i]!;
        if (e.names?.[i]) label = e.names[i]!;
      }
    } else if (e.after) {
      const m = marks[e.after];
      if (m !== undefined) {
        const start = m + (e.delay ?? 0);
        if (start + hold >= t) at = start;
      }
    }
    if (at === undefined) continue;
    const dt = at - t;
    const state = dt <= 0 ? "now" : dt <= e.lead ? "soon" : "later";
    out.push({
      id: e.id,
      label,
      at,
      in: dt,
      state,
      ...(e.window ? { window: e.window } : {}),
      ...(e.note ? { note: e.note } : {}),
      ...(e.confidence ? { confidence: e.confidence } : {}),
    });
  }
  return out.sort((a, b) => a.at - b.at || a.label.localeCompare(b.label));
}

/** m:ss (negative = before the horn). */
export function formatClock(sec: number): string {
  const s = Math.round(Math.abs(sec));
  return `${sec < 0 ? "-" : ""}${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** A clock read must track the wall clock for this long before the app trusts it
 *  enough to switch to the Game tab on its own. */
export const CONFIRM_SPAN_MS = 3000;

/** Is this a running game clock? Over the last few seconds most reads must sit on
 *  one line of slope +1 (game time) or -1 under the moon (pre-horn countdown), and
 *  the value must actually move. A draft pick timer counts down without the moon;
 *  a paused clock or a still frame does not move. Occasional misreads are outvoted. */
export class ClockConfirm {
  private reads: Array<{ shown: number; night: boolean; at: number }> = [];

  /** `shown` = the displayed m:ss in seconds, `at` in ms; true once confirmed. */
  push(shown: number, night: boolean, paused: boolean, at: number): boolean {
    if (paused) {
      this.reads = [];
      return false;
    }
    this.reads.push({ shown, night, at });
    this.reads = this.reads.filter((r) => at - r.at <= CONFIRM_WINDOW_MS);
    const span = at - this.reads[0]!.at;
    if (span < CONFIRM_SPAN_MS || this.reads.length < 6) return false;
    for (const dir of [1, -1] as const) {
      const off = this.reads.map((r) => r.shown - (dir * r.at) / 1000);
      const m = [...off].sort((x, y) => x - y)[Math.floor(off.length / 2)]!;
      const inl = this.reads.filter((_, i) => Math.abs(off[i]! - m) <= 1.2);
      if (inl.length < 0.75 * this.reads.length) continue;
      const vals = inl.map((r) => r.shown);
      if (Math.max(...vals) - Math.min(...vals) < 2) continue;
      if (dir === -1 && inl.filter((r) => r.night).length < 0.75 * inl.length) continue;
      return true;
    }
    return false;
  }
}
/** reads older than this are forgotten. */
export const CONFIRM_WINDOW_MS = 6000;

/** day 0:00-5:00, night 5:00-10:00, ...; the pre-horn countdown shows the moon. */
export function isNight(t: number): boolean {
  return t < 0 || Math.floor(t / 300) % 2 === 1;
}

/** "12:30", "-0:45", "1230", "90" (seconds) -> game seconds. */
export function parseClock(s: string): number | undefined {
  const m = /^\s*(-?)\s*(\d{1,4})(?::(\d{1,2}))?\s*$/.exec(s);
  if (!m) return undefined;
  const sign = m[1] ? -1 : 1;
  if (m[3] !== undefined) {
    const sec = Number(m[3]);
    if (sec > 59) return undefined;
    return sign * (Number(m[2]) * 60 + sec);
  }
  const n = Number(m[2]);
  // a bare number of 3+ digits is mmss ("1230" = 12:30), otherwise minutes
  if (m[2]!.length >= 3) {
    const sec = n % 100;
    return sec > 59 ? undefined : sign * (Math.floor(n / 100) * 60 + sec);
  }
  return sign * n * 60;
}
