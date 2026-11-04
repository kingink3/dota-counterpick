// =============================================================================
//  Game tab (ADR-026 phase 1): game clock + map-event timers for your role.
//
//  Clock sources, best first: the top-bar clock read from the screen share
//  (ScreenReader.onClock) -> a manually set clock that runs on its own.
//  Between reads the display runs on performance.now(); a read that changes the
//  shown second re-anchors it, a stalled clock (GameClock) freezes it (pause).
//  Roshan / Tormentor deaths cannot be seen reliably on screen: two buttons mark
//  them at the current game time.
// =============================================================================

import { ClockConfirm, formatClock, isNight, parseClock, upcoming, type Timings, type Upcoming } from "../game-timers.js";
import type { ClockTick } from "./screen-reader.js";

interface Clock {
  /** game seconds at `at` (negative before the horn). */
  base: number;
  at: number;
  running: boolean;
  source: "screen" | "manual";
  pregame: boolean;
  /** last screen read (performance.now()), for the "clock lost" badge. */
  readAt?: number;
}

export interface GameDeps {
  timings: () => Timings | undefined;
  role: () => number | undefined;
  setRole: (r: number | undefined) => void;
  /** "Juggernaut (pos 1)" or undefined. */
  playing: () => string | undefined;
  /** switch the app to the Game tab. */
  show: () => void;
  visible: () => boolean;
}

const LOST_AFTER_MS = 4000;
/** a running clock never runs ahead of the last read by more than this. */
const MAX_AHEAD = 0.999;

export class GameView {
  private clock?: Clock;
  private marks: Record<string, number | undefined> = {};
  private timer?: number;
  private autoSwitched = false;
  private confirmer = new ClockConfirm();
  private root: HTMLElement;

  constructor(private readonly d: GameDeps) {
    this.root = document.querySelector<HTMLElement>("#game-view")!;
    this.build();
  }

  /** current game time (fractional seconds) or undefined if no clock yet. */
  now(): number | undefined {
    const c = this.clock;
    if (!c) return undefined;
    if (!c.running) return c.base;
    const t = c.base + (performance.now() - c.at) / 1000;
    // screen clock: don't outrun the display while reads are fresh
    if (c.source === "screen" && c.readAt !== undefined && performance.now() - c.readAt < LOST_AFTER_MS) {
      // `base` was anchored when the shown second changed, so the true time is
      // inside [base, base + 1) until the next read says otherwise
      return Math.min(t, c.base + MAX_AHEAD);
    }
    return t;
  }

  onClock(c: ClockTick): void {
    const prev = this.clock;
    const changed = !prev || prev.source !== "screen" || prev.base !== c.gameSeconds;
    this.clock = changed
      ? { base: c.gameSeconds, at: c.at, running: !c.paused, source: "screen", pregame: c.pregame, readAt: c.at }
      : { ...prev, running: !c.paused, pregame: c.pregame, readAt: c.at };
    this.maybeAutoSwitch(c);
    if (this.d.visible()) this.render();
  }

  /** start ticking the display (called when the tab is shown). */
  start(): void {
    if (this.timer === undefined) this.timer = window.setInterval(() => this.d.visible() && this.render(), 250);
    this.render();
  }

  private maybeAutoSwitch(c: ClockTick): void {
    if (this.autoSwitched) return;
    if (this.confirmer.push(c.pregame ? -c.gameSeconds : c.gameSeconds, c.night, c.paused, c.at)) {
      this.autoSwitched = true;
      if (!this.d.visible()) this.d.show();
    }
  }

  // --------------------------------------------------------------- DOM ----

  private build(): void {
    this.root.innerHTML = `
      <section class="game">
        <div class="game-head">
          <div class="game-clock-box">
            <div id="game-clock" class="game-clock" aria-live="off">-:--</div>
            <div class="game-badges"><span id="game-badge"></span><span id="game-cycle"></span></div>
          </div>
          <div class="game-ctl">
            <div class="game-row">
              <span class="pos-l">Your position</span>
              <div id="game-roles" class="pos" role="group" aria-label="Your position"></div>
              <span id="game-playing" class="muted"></span>
            </div>
            <div class="game-row">
              <label class="muted" for="game-set">Clock</label>
              <input id="game-set" type="text" inputmode="numeric" placeholder="m:ss" size="6" autocomplete="off" />
              <button id="game-set-btn" type="button" class="g-btn">Set</button>
              <button id="game-run-btn" type="button" class="g-btn">Pause</button>
              <span id="game-src" class="muted"></span>
            </div>
            <div class="game-row">
              <button id="mark-rosh" type="button" class="g-btn mark" data-mark="roshan_killed">Roshan killed</button>
              <button id="mark-torm" type="button" class="g-btn mark" data-mark="tormentor_killed">Tormentor killed</button>
            </div>
          </div>
        </div>
        <ol id="game-events" class="game-events" aria-label="Next map events"></ol>
        <p id="game-foot" class="muted game-foot"></p>
      </section>`;
    const roles = this.root.querySelector<HTMLElement>("#game-roles")!;
    for (const r of [undefined, 1, 2, 3, 4, 5]) {
      const b = document.createElement("button");
      b.className = "role-btn";
      b.textContent = r === undefined ? "All" : String(r);
      b.dataset.role = r === undefined ? "" : String(r);
      b.addEventListener("click", () => {
        this.d.setRole(r);
        this.render();
      });
      roles.appendChild(b);
    }
    const input = this.root.querySelector<HTMLInputElement>("#game-set")!;
    const set = () => {
      const t = parseClock(input.value);
      if (t === undefined) {
        input.setCustomValidity("m:ss, e.g. 12:30 or -0:45 before the horn");
        input.reportValidity();
        return;
      }
      input.setCustomValidity("");
      input.value = "";
      this.clock = { base: t, at: performance.now(), running: true, source: "manual", pregame: t < 0 };
      this.start();
    };
    this.root.querySelector("#game-set-btn")!.addEventListener("click", set);
    input.addEventListener("keydown", (e) => e.key === "Enter" && set());
    this.root.querySelector("#game-run-btn")!.addEventListener("click", () => {
      const c = this.clock;
      if (!c) return;
      const t = this.now()!;
      this.clock = { ...c, base: t, at: performance.now(), running: !c.running, source: "manual" };
      this.render();
    });
    for (const b of this.root.querySelectorAll<HTMLElement>(".mark")) {
      b.addEventListener("click", () => {
        const id = b.dataset.mark!;
        const t = this.now();
        if (this.marks[id] !== undefined) this.marks[id] = undefined;
        else if (t !== undefined) this.marks[id] = Math.floor(t);
        this.render();
      });
    }
  }

  render(): void {
    const t = this.now();
    const c = this.clock;
    const $ = <T extends HTMLElement>(s: string) => this.root.querySelector<T>(s)!;
    $("#game-clock").textContent = t === undefined ? "-:--" : formatClock(Math.floor(t));
    const lost = c?.source === "screen" && c.readAt !== undefined && performance.now() - c.readAt > LOST_AFTER_MS;
    const badge = $("#game-badge");
    const kind = !c ? "none" : !c.running ? "paused" : t! < 0 ? "pregame" : lost ? "lost" : "live";
    badge.dataset.kind = kind;
    badge.textContent = { none: "no clock", paused: "PAUSED", pregame: "PRE-GAME", lost: "clock not visible", live: "" }[kind];
    $("#game-cycle").textContent = t === undefined ? "" : isNight(t) ? "☾ Night" : "☀ Day";
    $("#game-src").textContent = !c
      ? "Read screen to follow the in-game clock, or set it here."
      : c.source === "screen"
        ? "from the screen"
        : "manual clock";
    $("#game-run-btn").textContent = c && !c.running ? "Resume" : "Pause";
    ($("#game-run-btn") as HTMLButtonElement).disabled = !c;
    for (const b of this.root.querySelectorAll<HTMLElement>("#game-roles .role-btn")) {
      b.classList.toggle("active", b.dataset.role === String(this.d.role() ?? ""));
    }
    $("#game-playing").textContent = this.d.playing() ?? "";
    for (const b of this.root.querySelectorAll<HTMLButtonElement>(".mark")) {
      const at = this.marks[b.dataset.mark!];
      const name = b.dataset.mark === "roshan_killed" ? "Roshan" : "Tormentor";
      b.classList.toggle("on", at !== undefined);
      b.textContent = at === undefined ? `${name} killed` : `${name} killed ${formatClock(at)} ✕`;
      b.title = at === undefined ? `Mark ${name}'s death at the current game time` : "Click to clear";
      b.disabled = t === undefined && at === undefined;
    }
    const list = $("#game-events");
    const tm = this.d.timings();
    if (!tm || t === undefined) {
      list.replaceChildren();
      $("#game-foot").textContent = tm ? "" : "No timings data in this build.";
      return;
    }
    list.replaceChildren(...upcoming(tm, t, this.d.role(), this.marks).map((u) => eventRow(u)));
    $("#game-foot").textContent =
      `Timings for patch ${tm.patch}${tm.reviewed ? `, reviewed ${tm.reviewed}` : ""}. ` +
      "~ = approximate (depends on the camp / lane).";
  }
}

function eventRow(u: Upcoming): HTMLElement {
  const li = document.createElement("li");
  li.className = `ev ${u.state}`;
  li.dataset.id = u.id;
  const when = document.createElement("span");
  when.className = "ev-in";
  if (u.state === "now") {
    when.textContent = u.window && u.window + u.in > 0 ? `${formatClock(Math.ceil(u.window + u.in))} left` : "now";
  } else {
    when.textContent = formatClock(Math.ceil(u.in));
  }
  const what = document.createElement("span");
  what.className = "ev-what";
  what.textContent = (u.confidence === "approx" ? "~ " : "") + u.label;
  const at = document.createElement("span");
  at.className = "ev-at";
  at.textContent = u.window ? `${formatClock(u.at)}-${formatClock(u.at + u.window)}` : formatClock(u.at);
  li.append(when, what, at);
  if (u.note) {
    li.title = u.note;
    if (u.state !== "later") {
      const n = document.createElement("span");
      n.className = "ev-note";
      n.textContent = u.note;
      li.append(n);
    }
  }
  return li;
}
