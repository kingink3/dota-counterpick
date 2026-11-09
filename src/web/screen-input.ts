// =============================================================================
//  Screen reading (ADR-013 P1): screen share -> top-bar portraits -> draft.
//  Split out of main.ts (ADR-040).
// =============================================================================

import { type Frame, type ScreenChange, type Side } from "../screen-match.js";
import { MAX_TEAM, byEngineId, byValve, grid, render, state } from "./app.js";
import { myItems, onHudInventory, setMyItems } from "./enemy-items.js";
import { heroImageUrlByValve, heroValveName } from "./hero-art.js";
import { type ClockTick, ScreenReader, type ScreenStatus, buildItemTemplates, buildTemplates } from "./screen-reader.js";

// ---------------------------------------------------------------------------
//  Screen reading (ADR-013 P1): screen share -> top-bar portraits -> draft.
//  Radiant is always the LEFT block of the top bar, Dire the RIGHT one; which
//  block is "your team" comes from the side buttons.
// ---------------------------------------------------------------------------

export let screen: ScreenReader | undefined;
export let screenStatus: ScreenStatus = { kind: "off" };
export let screenSide: Side | undefined;
/** where the side came from: the preview ghost (auto) or a click (manual wins). */
export let sideSource: "auto" | "manual" | undefined;
/** your slot from the preview ghost; its hero becomes the ★ once. */
export let mineSlot: { side: Side; index: number } | undefined;
export let mineApplied: string | undefined;
export let lastScreen: ScreenChange | undefined;
/** engineIds the screen reader put into the draft (so a repick can replace them). */
export const screenOwned = new Set<string>();
export let screenUsed = false;
export let lastShot: Frame | undefined;
/** a "?" slot the user clicked: the next grid click names (and teaches) it. */
/** where the in-game clock read goes (the Game tab), set by main.ts. */
export let clockSink: ((c: ClockTick) => void) | undefined;
export function setClockSink(f: typeof clockSink): void {
  clockSink = f;
}
export function setAssignSlot(v: typeof assignSlot): void {
  assignSlot = v;
}
export let assignSlot: { side: Side; index: number } | undefined;
export let unknownSig = "";

/** screen slots that show SOMETHING the recogniser could not name, and that have no
 *  stable hero yet (e.g. your own hero in a cosmetic portrait). */
export function unknownSlots(): Array<{ side: Side; index: number }> {
  if (!lastShot || !screenSide) return [];
  const out: Array<{ side: Side; index: number }> = [];
  for (const side of ["left", "right"] as const) {
    lastShot[side].forEach((r, index) => {
      if (r.kind === "unknown" && !lastScreen?.[side][index]) out.push({ side, index });
    });
  }
  return out;
}

/** unrecognised slots that belong to a band team ("ally" = your side of the top bar). */
export function unknownFor(team: "enemy" | "ally"): Array<{ side: Side; index: number }> {
  if (!screenSide) return [];
  const want: Side = team === "ally" ? screenSide : screenSide === "left" ? "right" : "left";
  return unknownSlots().filter((u) => u.side === want);
}

/** name the clicked "?" slot with this hero, teach the recogniser its look. */
export function assignHero(engineId: string): boolean {
  const slot = assignSlot!;
  assignSlot = undefined;
  if (!screenSide) return false;
  const team = slot.side === screenSide ? state.allies : state.enemies;
  const other = team === state.allies ? state.enemies : state.allies;
  other.delete(engineId);
  if (!team.has(engineId) && team.size >= MAX_TEAM) {
    render();
    return true;
  }
  team.add(engineId);
  screenOwned.add(engineId);
  if (mineSlot && mineSlot.side === slot.side && mineSlot.index === slot.index) state.myHero = engineId;
  const valve = byEngineId.get(engineId)?.valve ?? heroValveName(engineId);
  screen?.learn(valve, slot.side, slot.index);
  render();
  return true;
}

export function buildScreenInput(): void {
  const btn = document.querySelector<HTMLElement>("#screen-btn");
  if (!btn) return;
  let templates: Promise<import("../screen-match.js").Template[]> | undefined;
  const getTemplates = () =>
    (templates ??= buildTemplates(
      grid.map((g) => g.valve),
      (v) => heroImageUrlByValve(v),
    ));
  let itemTpl: Promise<import("../item-match.js").ItemTemplate[]> | undefined;
  const getItemTemplates = () =>
    (itemTpl ??= fetch("./items/index.json")
      .then((r) => r.json() as Promise<Record<string, unknown>>)
      .then((idx) => buildItemTemplates(Object.keys(idx), (k) => `./items/${k}.webp`)));
  screen = new ScreenReader(getTemplates, {
    onInventory: onHudInventory,
    onClock: (c) => clockSink?.(c),
    onChange: applyScreen,
    onStatus: (st) => {
      screenStatus = st;
      renderScreenStatus();
    },
    onFrame: (f) => {
      lastShot = f;
      const sig = JSON.stringify(unknownSlots());
      if (sig !== unknownSig) {
        unknownSig = sig;
        render();
      }
    },
  }, getItemTemplates);
  btn.addEventListener("click", () => {
    if (screen!.running) screen!.stop();
    else {
      screenUsed = true;
      void screen!.start();
      render();
    }
  });
  const file = document.querySelector<HTMLInputElement>("#screen-file");
  document.querySelector<HTMLElement>("#screen-test")?.addEventListener("click", () => file?.click());
  file?.addEventListener("change", async () => {
    const f = file.files?.[0];
    file.value = "";
    if (!f) return;
    screenUsed = true;
    const frame = await screen!.readImage(f);
    const n = [...frame.left, ...frame.right].filter((r) => r.kind === "hero").length;
    screenStatus = { kind: "error", message: `screenshot: ${n}/10 heroes recognised` };
    renderScreenStatus();
    render();
  });
  for (const b of document.querySelectorAll<HTMLElement>(".side-btn")) {
    b.addEventListener("click", () => {
      const side = b.dataset.side as Side;
      screenSide = screenSide === side ? undefined : side;
      sideSource = screenSide ? "manual" : undefined;
      syncScreen(true);
      render();
    });
  }
  renderScreenStatus();
}

export function applyScreen(c: ScreenChange): void {
  if (c.reset) {
    state.enemies.clear();
    state.allies.clear();
    state.myHero = undefined;
    setMyItems(undefined);
    screenOwned.clear();
    lastScreen = undefined;
    mineSlot = c.mine;
    mineApplied = undefined;
    // a new match can put you on the other side: forget a side not set by hand
    {
      screenSide = c.mine?.side;
      sideSource = c.mine ? "auto" : undefined;
    }
    render();
    return;
  }
  const prevSide = screenSide;
  if (c.mine) {
    mineSlot = c.mine;
    if (sideSource !== "manual") {
      screenSide = c.mine.side;
      sideSource = "auto";
    }
  }
  lastScreen = c;
  syncScreen(screenSide !== prevSide);
  applyMine();
  render();
}

/** the hero in your (preview-detected) slot becomes ★ once; a manual ★ change wins after. */
export function applyMine(): void {
  if (!lastScreen || !mineSlot || mineSlot.side !== screenSide) return;
  const valve = lastScreen[mineSlot.side][mineSlot.index];
  if (!valve || valve === mineApplied) return;
  const id = byValve.get(valve);
  if (id && state.allies.has(id)) {
    state.myHero = id;
    mineApplied = valve;
  }
}

/** Put the stable top-bar heroes into the draft. `full` re-applies every slot (after
 *  the side was chosen); otherwise only the slots that just changed - so a manual
 *  removal sticks until the game shows something new in that slot. */
export function syncScreen(full: boolean): void {
  if (!lastScreen || !screenSide) return;
  const other: Side = screenSide === "left" ? "right" : "left";
  const slots: Array<{ side: Side; index: number; from?: string }> = full
    ? [0, 1, 2, 3, 4].flatMap((i) => [
        { side: "left" as Side, index: i },
        { side: "right" as Side, index: i },
      ])
    : lastScreen.changed;
  if (full) {
    // a side flip: everything the screen added goes back through placement
    for (const id of screenOwned) {
      state.allies.delete(id);
      state.enemies.delete(id);
      if (state.myHero === id) state.myHero = undefined;
    }
    screenOwned.clear();
    mineApplied = undefined;
  }
  for (const s of slots) {
    if (s.from) {
      const old = byValve.get(s.from);
      if (old && screenOwned.has(old)) {
        state.allies.delete(old);
        state.enemies.delete(old);
        if (state.myHero === old) state.myHero = undefined;
        screenOwned.delete(old);
      }
    }
    const valve = lastScreen[s.side][s.index];
    const id = valve ? byValve.get(valve) : undefined;
    if (!id) continue;
    const target = s.side === screenSide ? state.allies : state.enemies;
    const otherSet = s.side === other ? state.allies : state.enemies;
    otherSet.delete(id);
    if (!target.has(id) && target.size < MAX_TEAM) {
      target.add(id);
      screenOwned.add(id);
    }
  }
}

export function renderSideBar(): void {
  const bar = document.querySelector<HTMLElement>("#side-bar");
  if (!bar) return;
  bar.hidden = !screenUsed && !screen?.running;
  for (const b of document.querySelectorAll<HTMLElement>(".side-btn")) {
    b.classList.toggle("active", b.dataset.side === screenSide);
  }
  bar.classList.toggle("ask", !screenSide && lastScreen !== undefined);
}

/** perf probe for the latency e2e (read cost, render cost). */
export const perf = { renderMs: 0 };
(window as unknown as { __perf: typeof perf }).__perf = perf;

export function renderScreenStatus(): void {
  const btn = document.querySelector<HTMLElement>("#screen-btn");
  const txt = document.querySelector<HTMLElement>("#screen-status");
  if (!btn || !txt) return;
  const on = screen?.running ?? false;
  btn.classList.toggle("on", on);
  btn.textContent = on ? "Reading screen" : "Read screen";
  const st = screenStatus;
  txt.dataset.kind = st.kind === "live" ? (st.seen > 0 ? "live" : "waiting") : st.kind === "error" ? "note" : st.kind;
  if (st.kind === "off") {
    txt.textContent = "";
    txt.title = "";
  } else if (st.kind === "starting") {
    txt.textContent = "choose the Dota screen";
  } else if (st.kind === "live") {
    txt.textContent = st.seen ? `${st.seen}/10 heroes` : "waiting for the draft";
    txt.title = `${st.width}x${st.height} capture, ${st.ms.toFixed(1)} ms per read`;
  } else {
    txt.textContent = st.message;
  }
  if (lastShot) {
    const fmt = (r: Frame["left"][number]) =>
      r.kind === "hero" ? `${r.valve} ${r.score.toFixed(2)}`
      : r.kind === "unknown" ? `? ${r.best ?? ""} ${r.score.toFixed(2)}`
      : r.kind === "preview" ? `preview ${r.valve} ${r.score.toFixed(2)}`
      : "empty";
    const head = st.kind === "live" ? `${st.width}x${st.height} capture, ${st.ms.toFixed(1)} ms per read\n` : "";
    const names = lastShot.names ? `\nname brightness: ${lastShot.names.join(" ")}` : "";
    txt.title = `${head}left: ${lastShot.left.map(fmt).join(", ")}\nright: ${lastShot.right.map(fmt).join(", ")}${names}`;
  }
}

