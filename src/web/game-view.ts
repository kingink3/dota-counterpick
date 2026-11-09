// =============================================================================
//  Game tab (ADR-026 phase 1): game clock + map-event timers for your role.
//
//  Clock sources, best first: the top-bar clock read from the screen share
//  (ScreenReader.onClock) -> a manually set clock that runs on its own.
//  Between reads the display runs on performance.now(); a read that changes the
//  shown second re-anchors it, a stalled clock (GameClock) freezes it (pause).
//  Roshan / Tormentor kills are not tracked (the game shows them; the user asked to
//  drop the marks): only the first Tormentor spawn is a timer / cue.
// =============================================================================

import { ClockConfirm, formatClock, isNight, parseClock, upcoming, type Timings, type Upcoming } from "../game-timers.js";
import type { ClockTick } from "./screen-reader.js";
import { phaseAt, type GamePhase } from "../game-plan.js";
import { renderPlanZone, renderTarget, renderWindowLine, type ZoneData } from "./plan-view.js";
import { CoachView, workerTicker } from "./coach-view.js";

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
  private data?: ZoneData;
  /** a phase the user picked; undefined = follow the clock. */
  private phaseManual?: GamePhase;
  private shownPhase?: GamePhase;
  private coach: CoachView;

  constructor(private readonly d: GameDeps) {
    this.root = document.querySelector<HTMLElement>("#game-view")!;
    this.build();
    this.coach = new CoachView(this.root.querySelector<HTMLElement>("#game-coach")!);
    // the coach runs whatever tab is open, and when the page is in the background
    workerTicker(250, () => this.coachTick());
  }

  private coachTick(): void {
    const t = this.now();
    const tm = this.d.timings();
    const c = this.clock;
    const v = this.data?.view;
    const lost = c?.source === "screen" && c.readAt !== undefined && performance.now() - c.readAt > LOST_AFTER_MS;
    this.coach.tick({
      t: t ?? 0,
      events: tm && t !== undefined ? upcoming(tm, t, this.d.role(), this.marks) : [],
      ...(v?.plan ? { plan: v.plan } : {}),
      ...(v?.have ? { have: v.have } : {}),
      ...(v?.window ? { window: v.window } : {}),
      role: this.d.role(),
      clock: t === undefined ? "-:--" : formatClock(Math.floor(t)),
      // no cues on a paused / lost / missing clock
      running: t !== undefined && !!c?.running && !lost,
    });
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
      <section class="gz">
        <aside class="gz-now" aria-label="Now">
          <div class="game-clock-box">
            <div id="game-clock" class="game-clock" aria-live="off">-:--</div>
            <div class="game-badges"><span id="game-badge"></span><span id="game-cycle"></span><span id="game-playing" class="muted"></span></div>
          </div>
          <div class="game-row"><div id="game-roles" class="pos" role="group" aria-label="Your position"></div></div>
          <h3 class="game-h">Next events</h3>
          <ol id="game-events" class="game-events" aria-label="Next map events"></ol>
          <h3 class="game-h">Item target</h3>
          <div id="game-target" class="gz-target"></div>
          <h3 class="game-h" title="Win rate of both lineups by match length in past games: a tendency, not this match's strength (ADR-037)">Game-length tendency</h3>
          <div id="game-wline" class="gz-wline"></div>
          <h3 class="game-h">Coach · voice &amp; overlay</h3>
          <div id="game-coach" class="gz-coach"></div>
          <details class="gz-set">
            <summary>Clock</summary>
            <div class="game-row">
              <input id="game-set" type="text" inputmode="numeric" placeholder="m:ss" size="6" autocomplete="off" aria-label="Set the game clock" />
              <button id="game-set-btn" type="button" class="g-btn">Set</button>
              <button id="game-run-btn" type="button" class="g-btn">Pause</button>
            </div>
          </details>
          <p class="muted game-foot"><span id="game-src"></span><br /><span id="game-foot"></span></p>
        </aside>
        <main id="game-plan" class="gz-plan" aria-label="Match plan"></main>
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
  }

  /** the plan data (built by main.ts when the draft / hero / items change). */
  setData(d: ZoneData): void {
    this.data = d;
    this.renderZone();
    this.renderNow(this.now());
  }

  private phaseNow(): GamePhase {
    return this.phaseManual ?? phaseAt(this.now());
  }

  private renderZone(): void {
    if (!this.data) return;
    const phase = this.phaseNow();
    this.shownPhase = phase;
    renderPlanZone(this.root.querySelector<HTMLElement>("#game-plan")!, {
      ...this.data,
      phase,
      auto: this.phaseManual === undefined,
      onPhase: (p) => {
        this.phaseManual = p === phaseAt(this.now()) ? undefined : p;
        this.renderZone();
        this.render();
      },
    });
  }

  private renderNow(t: number | undefined): void {
    const d = this.data;
    renderTarget(this.root.querySelector<HTMLElement>("#game-target")!, d?.view.plan, d?.view.have, t);
    renderWindowLine(this.root.querySelector<HTMLElement>("#game-wline")!, d?.view.window, t, d?.view.heroLabel ?? ((x) => x));
  }

  render(): void {
    const t = this.now();
    if (this.data && this.phaseManual === undefined && phaseAt(t) !== this.shownPhase) this.renderZone();
    this.renderNow(t);
    // plan items due within a minute / already past their typical time
    for (const li of this.root.querySelectorAll<HTMLElement>("#game-plan [data-at]")) {
      const at = Number(li.dataset.at);
      li.classList.toggle("due", t !== undefined && t >= at - 60 && t < at + 120);
      li.classList.toggle("past", t !== undefined && t >= at + 120);
    }
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
      ? "Read screen to follow the in-game clock, or set it under Clock."
      : c.source === "screen"
        ? "from the screen"
        : "manual clock";
    $("#game-run-btn").textContent = c && !c.running ? "Resume" : "Pause";
    ($("#game-run-btn") as HTMLButtonElement).disabled = !c;
    for (const b of this.root.querySelectorAll<HTMLElement>("#game-roles .role-btn")) {
      b.classList.toggle("active", b.dataset.role === String(this.d.role() ?? ""));
    }
    $("#game-playing").textContent = this.d.playing() ?? "";
    const list = $("#game-events");
    const tm = this.d.timings();
    if (!tm || t === undefined) {
      list.replaceChildren();
      $("#game-foot").textContent = tm ? "" : "No timings data in this build.";
      return;
    }
    list.replaceChildren(...upcoming(tm, t, this.d.role(), this.marks).slice(0, 7).map((u) => eventRow(u)));
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
