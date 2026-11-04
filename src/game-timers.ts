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

/** Is this a running game clock? The shown value must move +1 s per second (game
 *  time) or -1 s per second under the moon (pre-horn countdown) for 3 s in a row.
 *  A draft pick timer counts down without the moon icon; a paused clock stalls. */
export class ClockConfirm {
  private first?: { shown: number; at: number };

  /** `shown` = the displayed m:ss in seconds; returns true once confirmed. */
  push(shown: number, night: boolean, paused: boolean, at: number): boolean {
    if (!this.first) {
      this.first = { shown, at };
      return false;
    }
    const dt = (at - this.first.at) / 1000;
    const moved = shown - this.first.shown;
    const ok = Math.abs(moved - dt) <= 1.5 || (night && Math.abs(-moved - dt) <= 1.5);
    if (!ok || paused) {
      this.first = { shown, at };
      return false;
    }
    return at - this.first.at >= CONFIRM_SPAN_MS;
  }
}

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
