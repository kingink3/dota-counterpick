// =============================================================================
//  Coach UI (ADR-030): voice (Web Speech, English), chimes (Web Audio) and a
//  small always-on-top window (Document Picture-in-Picture) over the game.
//  No injection into Dota: the overlay is an ordinary browser window that stays
//  on top of a borderless-windowed game. Settings stay in this browser.
// =============================================================================

import { Coach, CUE_CATS, defaultModes, overlayLines, type CoachInput, type Cue, type CueCat, type CueMode } from "../coach.js";

const KEY = "dotaapp.coach.v1";

interface CoachSettings {
  voice: boolean;
  volume: number;
  /** a system voice by name; empty = the best English one. */
  voiceName?: string;
  /** speech rate, 0.8..1.5. */
  rate?: number;
  /** per-category overrides of the role defaults. */
  modes: Partial<Record<CueCat, CueMode>>;
}

function load(): CoachSettings {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) ?? "{}") as Partial<CoachSettings>;
    return { voice: s.voice ?? false, volume: s.volume ?? 0.8, modes: s.modes ?? {}, ...(s.voiceName ? { voiceName: s.voiceName } : {}), ...(s.rate ? { rate: s.rate } : {}) };
  } catch {
    return { voice: false, volume: 0.8, modes: {} };
  }
}
function save(s: CoachSettings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* private mode: settings for this page only */
  }
}

// ---------------------------------------------------------------- sound ----

class Speaker {
  private queue: Array<{ text: string; until: number }> = [];
  private busy = false;
  private audio?: AudioContext;
  private voice?: SpeechSynthesisVoice;
  volume = 0.8;
  rate = 1.1;
  /** the voice asked for by name ("" = auto). */
  wanted = "";
  /** called when the system's voice list arrives / changes. */
  onVoices?: () => void;

  constructor() {
    if (typeof speechSynthesis !== "undefined") {
      const pick = () => {
        this.pick();
        this.onVoices?.();
      };
      this.pick();
      speechSynthesis.addEventListener?.("voiceschanged", pick);
    }
    // Web Audio needs a user gesture once per page
    const unlock = () => void this.ctx()?.resume();
    window.addEventListener("pointerdown", unlock, { passive: true });
  }

  get voiceName(): string {
    return this.voice?.name ?? "default voice";
  }

  /** English voices of this system (Windows: Microsoft ..., Edge: ... Online (Natural), Chrome: Google ...). */
  voices(): SpeechSynthesisVoice[] {
    if (typeof speechSynthesis === "undefined") return [];
    return speechSynthesis
      .getVoices()
      .filter((v) => /^en(-|_|$)/i.test(v.lang))
      .sort((a, b) => Number(/natural/i.test(b.name)) - Number(/natural/i.test(a.name)) || a.lang.localeCompare(b.lang) || a.name.localeCompare(b.name));
  }

  pick(): void {
    if (typeof speechSynthesis === "undefined") return;
    const all = speechSynthesis.getVoices();
    this.voice = (this.wanted && all.find((v) => v.name === this.wanted)) || pickVoice(all);
  }

  private ctx(): AudioContext | undefined {
    try {
      this.audio ??= new AudioContext();
    } catch {
      return undefined;
    }
    return this.audio;
  }

  chime(): void {
    const ctx = this.ctx();
    if (!ctx) return;
    const t0 = ctx.currentTime;
    for (const [i, f] of [880, 1320].entries()) {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = "sine";
      o.frequency.value = f;
      const s = t0 + i * 0.13;
      g.gain.setValueAtTime(0, s);
      g.gain.linearRampToValueAtTime(0.25 * this.volume, s + 0.01);
      g.gain.exponentialRampToValueAtTime(0.001, s + 0.12);
      o.connect(g).connect(ctx.destination);
      o.start(s);
      o.stop(s + 0.13);
    }
  }

  say(text: string, ttlSec = 3): void {
    if (typeof speechSynthesis === "undefined") return;
    this.queue.push({ text, until: performance.now() + ttlSec * 1000 });
    this.next();
  }

  private next(): void {
    if (this.busy) return;
    const now = performance.now();
    this.queue = this.queue.filter((q) => q.until >= now); // a stale cue is worse than none
    const q = this.queue.shift();
    if (!q) return;
    const u = new SpeechSynthesisUtterance(q.text);
    if (this.voice) u.voice = this.voice;
    u.lang = this.voice?.lang ?? "en-US";
    u.rate = this.rate;
    u.volume = this.volume;
    this.busy = true;
    const done = () => {
      this.busy = false;
      setTimeout(() => this.next(), 400);
    };
    u.onend = done;
    u.onerror = done;
    speechSynthesis.speak(u);
  }
}

/** a natural English voice when the system has one (Edge / Windows "Natural", Google), else any English. */
function pickVoice(vs: SpeechSynthesisVoice[]): SpeechSynthesisVoice | undefined {
  const en = vs.filter((v) => /^en(-|_|$)/i.test(v.lang));
  return (
    en.find((v) => /natural/i.test(v.name) && /en-US/i.test(v.lang)) ??
    en.find((v) => /natural/i.test(v.name)) ??
    en.find((v) => /google us english/i.test(v.name)) ??
    en.find((v) => /en-US/i.test(v.lang)) ??
    en[0]
  );
}

// ------------------------------------------------------------- overlay ----

interface PipApi {
  requestWindow(o: { width: number; height: number }): Promise<Window>;
}

const OVERLAY_CSS = `
  html, body { margin: 0; height: 100%; background: #10151c; color: #e9e4d8; font: 600 17px/1.25 "Barlow Condensed", "Segoe UI", system-ui, sans-serif; overflow: hidden; }
  .ov { display: grid; grid-template-columns: auto 1fr; gap: 2px 10px; padding: 6px 10px; align-items: center; align-content: center; height: 100%; box-sizing: border-box; }
  .ov-clock { grid-row: span 2; font-size: 24px; color: #d2ae62; font-variant-numeric: tabular-nums; }
  .ov-l1, .ov-l2 { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-variant-numeric: tabular-nums; }
  .ov-l2 { color: #cfc9bc; font-weight: 500; font-size: 15px; }
  .soon { color: #f0c463; } .their { color: #e0735a; } .yours { color: #8fcf5a; }
`;

// ------------------------------------------------------------------ UI ----

export class CoachView {
  private s = load();
  private coach = new Coach();
  private speaker = new Speaker();
  private pip?: Window;
  private lastSaid = "";
  /** the settings block is folded like Clock; remembered while the page is open. */
  private settingsOpen = false;
  private role?: number;

  constructor(private readonly root: HTMLElement) {
    this.speaker.volume = this.s.volume;
    this.speaker.rate = this.s.rate ?? 1.1;
    this.speaker.wanted = this.s.voiceName ?? "";
    this.speaker.pick();
    // the voice list often arrives after the page: refresh the picker then
    this.speaker.onVoices = () => this.build();
    this.build();
  }

  private modes(): Record<CueCat, CueMode> {
    return { ...defaultModes(this.role), ...this.s.modes };
  }

  /** every tick (~4 / s), whatever tab is open. */
  tick(x: Omit<CoachInput, "modes"> & { role?: number; clock: string; running: boolean }): void {
    if (x.role !== this.role) {
      this.role = x.role;
      this.build();
    }
    const modes = this.modes();
    if (x.running) {
      const cues = this.coach.tick({ ...x, modes });
      for (const c of cues) this.play(c);
    }
    this.renderOverlay(x, modes);
  }

  private play(c: Cue): void {
    if (!this.s.voice) return;
    if (c.mode === "chime") this.speaker.chime();
    else this.speaker.say(c.text, c.ttl);
    this.lastSaid = `${c.mode === "chime" ? "♪ " : ""}${c.text}`;
    const st = this.root.querySelector(".cv-last");
    if (st) st.textContent = this.lastSaid;
  }

  private renderOverlay(x: Omit<CoachInput, "modes"> & { clock: string }, modes: Record<CueCat, CueMode>): void {
    const w = this.pip;
    if (!w || w.closed) return;
    const [l1, l2] = overlayLines({ ...x, modes });
    const d = w.document;
    const set = (sel: string, txt: string, cls = "") => {
      const n = d.querySelector<HTMLElement>(sel);
      if (n && n.textContent !== txt) n.textContent = txt;
      if (n) n.className = `${sel.slice(1)}${cls ? ` ${cls}` : ""}`;
    };
    set(".ov-clock", x.clock);
    const soon = x.events.some((e) => e.state === "soon");
    set(".ov-l1", l1, soon ? "soon" : "");
    set(".ov-l2", l2, /favours them/.test(l2) ? "their" : /favours you/.test(l2) ? "yours" : "");
  }

  private async openOverlay(): Promise<void> {
    const api = (window as unknown as { documentPictureInPicture?: PipApi }).documentPictureInPicture;
    const st = this.root.querySelector(".cv-note")!;
    if (!api) {
      st.textContent = "The overlay needs Chrome or Edge 116+ (Document Picture-in-Picture).";
      return;
    }
    if (this.pip && !this.pip.closed) {
      this.pip.close();
      this.pip = undefined;
      this.build();
      return;
    }
    try {
      const w = await api.requestWindow({ width: 380, height: 70 });
      const style = w.document.createElement("style");
      style.textContent = OVERLAY_CSS;
      w.document.head.append(style);
      w.document.title = "Counter-Pick";
      w.document.body.innerHTML = `<div class="ov"><div class="ov-clock">-:--</div><div class="ov-l1">-</div><div class="ov-l2">-</div></div>`;
      w.addEventListener("pagehide", () => {
        this.pip = undefined;
        this.build();
      });
      this.pip = w;
      this.build();
    } catch (e) {
      st.textContent = `Could not open the overlay: ${String(e).slice(0, 120)}`;
    }
  }

  private build(): void {
    const r = this.root;
    r.replaceChildren();
    const row = document.createElement("div");
    row.className = "game-row";
    const voice = btn(this.s.voice ? "Voice on" : "Voice off", `g-btn${this.s.voice ? " on" : ""}`);
    voice.title = "English voice cues and chimes. Turn it on with a click (browsers need one before they speak).";
    voice.addEventListener("click", () => {
      this.s.voice = !this.s.voice;
      save(this.s);
      if (this.s.voice) this.speaker.say("Voice on", 5);
      this.build();
    });
    const ov = btn(this.pip && !this.pip.closed ? "Close overlay" : "Overlay", `g-btn${this.pip && !this.pip.closed ? " on" : ""}`);
    ov.title = "A small always-on-top window: next events, item target, game-length tendency. Run Dota in borderless window mode.";
    ov.addEventListener("click", () => void this.openOverlay());
    const test = btn("Test", "g-btn");
    test.addEventListener("click", () => {
      this.speaker.chime();
      setTimeout(() => this.speaker.say("Power rune in 15", 5), 400);
    });
    row.append(voice, ov, test);
    r.append(row);
    r.append(span(this.lastSaid, "cv-last muted"));
    // everything else folds away: in a match only the three buttons matter
    const det = document.createElement("details");
    det.className = "gz-set cv-set";
    det.open = this.settingsOpen;
    det.addEventListener("toggle", () => (this.settingsOpen = det.open));
    const sum = document.createElement("summary");
    sum.textContent = "Coach settings";
    det.append(sum);
    r.append(det);
    const box = det;

    const vol = document.createElement("input");
    vol.type = "range";
    vol.min = "0";
    vol.max = "1";
    vol.step = "0.05";
    vol.value = String(this.s.volume);
    vol.className = "cv-vol";
    vol.setAttribute("aria-label", "Volume");
    vol.addEventListener("input", () => {
      this.s.volume = Number(vol.value);
      this.speaker.volume = this.s.volume;
      save(this.s);
    });
    const vr = document.createElement("label");
    vr.className = "cv-row";
    vr.append(span("Volume"), vol);
    box.append(vr);

    // voice: any English voice of this system; "Auto" = a natural one when there is one
    const vs = this.speaker.voices();
    const vsel = document.createElement("select");
    vsel.className = "cv-voice";
    vsel.setAttribute("aria-label", "Voice");
    const auto = document.createElement("option");
    auto.value = "";
    auto.textContent = "Auto (best English)";
    vsel.append(auto);
    for (const v of vs) {
      const o = document.createElement("option");
      o.value = v.name;
      o.textContent = `${v.name.replace(/^Microsoft /, "").replace(/ - English.*$/, "")} · ${v.lang}${v.localService ? "" : " · online"}`;
      vsel.append(o);
    }
    vsel.value = this.s.voiceName && vs.some((v) => v.name === this.s.voiceName) ? this.s.voiceName : "";
    vsel.addEventListener("change", () => {
      if (vsel.value) this.s.voiceName = vsel.value;
      else delete this.s.voiceName;
      save(this.s);
      this.speaker.wanted = vsel.value;
      this.speaker.pick();
      this.speaker.say("Power rune in 15", 5);
    });
    const vrow = document.createElement("label");
    vrow.className = "cv-row";
    vrow.append(span("Voice"), vsel);
    box.append(vrow);

    const rate = document.createElement("input");
    rate.type = "range";
    rate.min = "0.8";
    rate.max = "1.5";
    rate.step = "0.05";
    rate.value = String(this.s.rate ?? 1.1);
    rate.className = "cv-vol";
    rate.setAttribute("aria-label", "Speed");
    rate.addEventListener("change", () => {
      this.s.rate = Number(rate.value);
      this.speaker.rate = this.s.rate;
      save(this.s);
      this.speaker.say("Stack", 4);
    });
    const rrow = document.createElement("label");
    rrow.className = "cv-row";
    rrow.append(span("Speed"), rate);
    box.append(rrow);

    const modes = this.modes();
    const def = defaultModes(this.role);
    const tb = document.createElement("div");
    tb.className = "cv-cats";
    for (const c of CUE_CATS) {
      const l = document.createElement("label");
      l.className = "cv-row";
      l.title = c.hint;
      const sel = document.createElement("select");
      for (const m of ["voice", "chime", "off"] as const) {
        const o = document.createElement("option");
        o.value = m;
        o.textContent = m === def[c.id] ? `${m} (default)` : m;
        sel.append(o);
      }
      sel.value = modes[c.id];
      sel.addEventListener("change", () => {
        const v = sel.value as CueMode;
        if (v === def[c.id]) delete this.s.modes[c.id];
        else this.s.modes[c.id] = v;
        save(this.s);
      });
      l.append(span(c.label), sel);
      tb.append(l);
    }
    box.append(tb);
    const reset = btn("Role defaults", "g-btn cv-reset");
    reset.title = "Back to the defaults for your position";
    reset.addEventListener("click", () => {
      this.s.modes = {};
      save(this.s);
      this.build();
    });
    box.append(reset);
    const note = span(
      `Voice: ${this.speaker.voiceName}${this.speaker.voices().length ? "" : " (no English voice found - Windows: Settings - Time & language - Speech - Add voices)"}. Overlay = a small always-on-top window; Dota must run in "borderless window" mode (Settings - Video). Nothing is injected into the game.`,
      "cv-note muted",
    );
    box.append(note);
  }
}

function btn(text: string, cls: string): HTMLButtonElement {
  const b = document.createElement("button");
  b.type = "button";
  b.className = cls;
  b.textContent = text;
  return b;
}
function span(text: string, cls = ""): HTMLElement {
  const s = document.createElement("span");
  if (cls) s.className = cls;
  s.textContent = text;
  return s;
}

/** ticks that keep coming when the tab is hidden (a worker is not throttled like page timers). */
export function workerTicker(ms: number, fn: () => void): void {
  try {
    const src = `setInterval(() => postMessage(0), ${ms});`;
    const w = new Worker(URL.createObjectURL(new Blob([src], { type: "text/javascript" })));
    w.onmessage = fn;
  } catch {
    window.setInterval(fn, ms);
  }
}
