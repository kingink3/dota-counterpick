// =============================================================================
//  Browser entry - standalone web UI (ADR-001: deploy by URL, no install).
//
//  Full Dota roster picker laid out like the in-game draft screen: four attribute
//  columns (Str / Agi / Int / Universal), searchable, with portraits. Heroes that
//  exist in the KB (hero_tags) drive the real counter logic; the rest are still
//  selectable but honestly produce "no known counters" (ADR-004, ADR-011).
//
//  Runs the EXACT engine core (resolve) the CLI/tests use against a fetched
//  kb.json (ADR-006). Reactive per ADR-002. Framework-free on purpose.
// =============================================================================

import { indexKB, type KnowledgeBase, type RawKB } from "../knowledge.js";
import { archetypeOf, resolve as resolveDraft } from "../resolver.js";
import { genericCombos, roleFit, type RoleFit } from "../combos.js";
import { heroLabel } from "../explain.js";
import { heroImageUrlByValve, heroValveName } from "./hero-art.js";
import { AutoInputAdapter, defaultBridgeUrl, type AutoStatus, type DraftPatch } from "./auto-input.js";
import type { GamePhase, GsiSnapshot } from "../gsi.js";
import { buildItemTemplates, buildTemplates, ScreenReader, type ScreenStatus } from "./screen-reader.js";
import { identifyPlate, type HudRead, type LearnedPlate } from "../item-match.js";
import type { Frame, ScreenChange, Side } from "../screen-match.js";
import type { Archetype, AttackType, Combo, DamageRead, DraftState, Reason, Recommendation, TeamRead } from "../types.js";

type Attr = "str" | "agi" | "int" | "all";
interface RosterHero {
  valve: string;
  label: string;
  attr: Attr;
}
interface GridHero extends RosterHero {
  /** id passed to the engine: KB code if tagged, else the valve name (→ honest gap). */
  engineId: string;
  inKB: boolean;
}

type TabId = "heroes" | "items" | "defense";

interface UIState {
  enemies: Set<string>; // engineIds
  allies: Set<string>; // engineIds (your own team)
  myHero?: string; // which ally is the hero you are playing (tailors item builds)
  addTarget: "enemy" | "ally"; // which side a grid click adds to
  role?: number;
  showFactors: boolean;
  search: string;
  activeTab: TabId;
  /** items seen on enemy heroes (manual or Tab scoreboard), our item ids (ADR-024). */
  enemyItems: Map<string, string[]>;
}

const ATTR_ORDER: Attr[] = ["str", "agi", "int", "all"];
const ATTR_NAME: Record<Attr, string> = {
  str: "Strength",
  agi: "Agility",
  int: "Intelligence",
  all: "Universal",
};

const state: UIState = {
  enemies: new Set(),
  allies: new Set(),
  addTarget: "enemy",
  showFactors: false,
  search: "",
  activeTab: "heroes",
  enemyItems: new Map(),
};
let kb: KnowledgeBase;
let grid: GridHero[] = [];
const byEngineId = new Map<string, GridHero>();
/** roster valve (== GSI npc name minus prefix) -> engineId, for the auto-input adapter. */
const byValve = new Map<string, string>();

/** Pages build (scripts/build-pages.ts): data arrives decrypted in memory, not by fetch. */
interface PagesBundle {
  kb: RawKB;
  roster: { heroes: RosterHero[] };
  matchups: { heroes?: Record<string, Record<string, [number, number]>> } | null;
  pages: true;
}
const BUNDLE = (window as unknown as { __DOTA_BUNDLE?: PagesBundle }).__DOTA_BUNDLE;

async function boot(): Promise<void> {
  const [rawKb, roster, matchups] = BUNDLE ? [BUNDLE.kb, BUNDLE.roster, BUNDLE.matchups] : await Promise.all([
    fetch("./kb.json").then((r) => r.json()) as Promise<RawKB>,
    fetch("./roster.json").then((r) => r.json()) as Promise<{ heroes: RosterHero[] }>,
    // optional stat layer; tolerate its absence
    fetch("./matchups.json").then((r) => (r.ok ? r.json() : null)).catch(() => null) as Promise<{
      heroes?: Record<string, Record<string, [number, number]>>;
    } | null>,
  ]);
  kb = indexKB(rawKb);
  if (matchups?.heroes) kb.matchups = matchups.heroes;
  buildItemLabels();

  // link roster -> KB by valve name (KB code's portrait name == roster valve)
  const valveToCode = new Map<string, string>();
  for (const code of Object.keys(kb.taxonomy.hero_tags)) {
    valveToCode.set(heroValveName(code), code);
  }
  grid = roster.heroes.map((h) => {
    const code = valveToCode.get(h.valve);
    const engineId = code ?? h.valve;
    const gh: GridHero = { ...h, engineId, inKB: Boolean(code) };
    byEngineId.set(engineId, gh);
    byValve.set(h.valve, engineId);
    return gh;
  });

  buildRoster("#roster", toggleHero);
  buildRoster("#combo-roster", onComboTile);
  buildSearch();
  buildRoleBar();
  buildCombos();
  buildModeNav();
  buildAutoInput();
  buildScreenInput();
  render();
}

/** Top-level split: enemy-driven "Counter picks" vs independent "Combos". */
function buildModeNav(): void {
  for (const btn of document.querySelectorAll<HTMLElement>(".mode-btn")) {
    btn.addEventListener("click", () => setMode(btn.dataset.mode as "counter" | "combo"));
  }
}
function setMode(mode: "counter" | "combo"): void {
  (el("#counter-view") as HTMLElement).hidden = mode !== "counter";
  (el("#combo-view") as HTMLElement).hidden = mode !== "combo";
  for (const b of document.querySelectorAll<HTMLElement>(".mode-btn")) {
    b.classList.toggle("active", b.dataset.mode === mode);
  }
}

// ---------------------------------------------------------------------------
//  Static controls
// ---------------------------------------------------------------------------

function buildRoster(rootSel: string, onClick: (code: string) => void): void {
  const root = el(rootSel);
  root.innerHTML = "";
  for (const attr of ATTR_ORDER) {
    const col = document.createElement("div");
    col.className = `attr-col attr-${attr}`;
    col.dataset.attr = attr;

    const h = document.createElement("h3");
    h.className = "attr-head";
    const heroesOfAttr = grid.filter((g) => g.attr === attr);
    h.innerHTML = `<span class="dot"></span>${ATTR_NAME[attr]} <span class="count">${heroesOfAttr.length}</span>`;
    col.appendChild(h);

    const cells = document.createElement("div");
    cells.className = "col-grid";
    for (const hero of heroesOfAttr) cells.appendChild(heroTile(hero, onClick));
    col.appendChild(cells);
    root.appendChild(col);
  }
}

function heroTile(hero: GridHero, onClick: (code: string) => void): HTMLElement {
  const tile = document.createElement("button");
  tile.className = "hero-tile" + (hero.inKB ? "" : " untagged");
  tile.dataset.engineId = hero.engineId;
  tile.dataset.search = hero.label.toLowerCase();
  tile.title = hero.inKB
    ? hero.label
    : `${hero.label}: not in the knowledge base yet - counters come only from the wiki, never suggested as a pick`;

  const img = document.createElement("img");
  img.loading = "lazy";
  img.alt = hero.label;
  img.src = heroImageUrlByValve(hero.valve);
  img.addEventListener("error", () => tile.classList.add("no-art"));
  img.addEventListener("load", () => tile.classList.remove("no-art"));

  const nm = document.createElement("span");
  nm.className = "nm";
  nm.textContent = hero.label;

  tile.append(img, nm);
  tile.addEventListener("click", () => onClick(hero.engineId));
  return tile;
}

function buildSearch(): void {
  const input = el("#hero-search") as HTMLInputElement;
  input.addEventListener("input", () => {
    state.search = input.value.trim().toLowerCase();
    applySearch();
  });
}

function applySearch(): void {
  const q = state.search;
  for (const col of document.querySelectorAll<HTMLElement>("#roster .attr-col")) {
    let visible = 0;
    for (const tile of col.querySelectorAll<HTMLElement>(".hero-tile")) {
      const hit = q === "" || (tile.dataset.search ?? "").includes(q);
      tile.style.display = hit ? "" : "none";
      if (hit) visible++;
    }
    col.style.display = visible === 0 && q !== "" ? "none" : "";
  }
  const anyVisible = [...document.querySelectorAll<HTMLElement>("#roster .attr-col")].some(
    (c) => c.style.display !== "none",
  );
  el("#no-match").style.display = anyVisible ? "none" : "";
}

/** Combo-view grid click: focus that hero's synergies (same as typing its name). */
function onComboTile(code: string): void {
  const label = labelFor(code);
  comboSearch = comboSearch === label.toLowerCase() ? "" : label.toLowerCase();
  const input = el("#combos-search") as HTMLInputElement;
  input.value = comboSearch ? label : "";
  for (const t of document.querySelectorAll<HTMLElement>("#combo-roster .hero-tile")) {
    t.classList.toggle("picked-ally", comboSearch !== "" && t.dataset.engineId === code);
  }
  renderCombos();
}

function buildRoleBar(): void {
  const bar = el("#role-bar");
  for (const role of [1, 2, 3, 4, 5]) {
    const b = document.createElement("button");
    b.className = "role-btn";
    b.textContent = String(role);
    b.title = `I play position ${role} (click again for any position)`;
    b.dataset.role = String(role);
    b.addEventListener("click", () => {
      state.role = state.role === role ? undefined : role;
      render();
    });
    bar.appendChild(b);
  }
  el("#clear-btn").addEventListener("click", () => {
    state.enemies.clear();
    state.allies.clear();
    state.myHero = undefined;
    render();
  });
  // which team a grid click adds to
  for (const btn of document.querySelectorAll<HTMLElement>(".tgl")) {
    btn.addEventListener("click", () => {
      state.addTarget = btn.dataset.target as "enemy" | "ally";
      render();
    });
  }
}

/** a full Dota team is 5 heroes - never let either side grow past that. */
const MAX_TEAM = 5;

/** Clicking a hero: remove it if already picked (either side), else add to the active side. */
function toggleHero(engineId: string): void {
  if (assignSlot && assignHero(engineId)) return;
  if (state.enemies.has(engineId)) state.enemies.delete(engineId);
  else if (state.allies.has(engineId)) {
    state.allies.delete(engineId);
    if (state.myHero === engineId) state.myHero = undefined;
  } else {
    const side = state.addTarget === "enemy" ? state.enemies : state.allies;
    if (side.size >= MAX_TEAM) return; // at the 5-hero cap for this side
    side.add(engineId);
  }
  render();
}

/** Mark / unmark one ally as the hero you are playing (tailors the item builds). */
function setMyHero(engineId: string): void {
  state.myHero = state.myHero === engineId ? undefined : engineId;
  render();
}

/** display name for an engineId (roster label preferred; falls back to prettified code). */
function labelFor(id: string): string {
  return byEngineId.get(id)?.label ?? heroLabel(id);
}

// ---------------------------------------------------------------------------
//  Reactive render
// ---------------------------------------------------------------------------

function render(): void {
  const t0 = performance.now();
  renderInner();
  perf.renderMs = performance.now() - t0;
}

function renderInner(): void {
  const activeFull = (state.addTarget === "enemy" ? state.enemies : state.allies).size >= MAX_TEAM;
  for (const tile of document.querySelectorAll<HTMLElement>("#roster .hero-tile")) {
    const id = tile.dataset.engineId!;
    const isEnemy = state.enemies.has(id);
    const isAlly = state.allies.has(id);
    tile.classList.toggle("picked-enemy", isEnemy);
    tile.classList.toggle("picked-ally", isAlly);
    tile.classList.toggle("locked", activeFull && !isEnemy && !isAlly);
  }
  syncCount("#enemy-count", state.enemies.size);
  syncCount("#ally-count", state.allies.size);
  for (const b of document.querySelectorAll<HTMLElement>(".role-btn")) {
    b.classList.toggle("active", state.role === Number(b.dataset.role));
  }
  for (const t of document.querySelectorAll<HTMLElement>(".tgl")) {
    t.classList.toggle("active", t.dataset.target === state.addTarget);
  }
  renderSideBar();
  const hint = document.querySelector<HTMLElement>("#pos-hint");
  if (hint) {
    hint.textContent = assignSlot
      ? "Pick the hero for the ? slot"
      : state.myHero
      ? `Playing ${labelFor(state.myHero)}: items only`
      : state.role !== undefined
        ? `Picks for pos ${state.role}`
        : "Any position";
  }
  renderStrip("#enemy-strip", state.enemies, "enemy");
  renderEnemyItems();
  renderStrip("#ally-strip", state.allies, "ally");

  const draft: DraftState = {
    enemyHeroes: [...state.enemies],
    ...(state.allies.size ? { allyHeroes: [...state.allies] } : {}),
    ...(state.myHero ? { myHero: state.myHero } : {}),
    ...(state.role !== undefined ? { myRole: state.role } : {}),
    ...(state.enemyItems.size ? { enemyItems: Object.fromEntries(state.enemyItems) } : {}),
  };

  const out = el("#results");
  out.innerHTML = "";
  const prompt = hudPrompt();
  if (prompt) out.appendChild(prompt);
  if (state.enemies.size === 0 && state.allies.size === 0) {
    out.appendChild(note("Add the enemy heroes as they are picked. Recommendations appear here and update with every pick."));
    return;
  }

  if (state.myHero) {
    const arch = archetypeOf(kb, state.myHero, state.role);
    const attack = kb.heroAttack?.[state.myHero];
    const banner = document.createElement("div");
    banner.className = "build-banner";
    banner.innerHTML =
      `Item builds for <b>${esc(labelFor(state.myHero))}</b>` +
      (arch
        ? ` as a ${archetypeLabel(arch, attack)}`
        : ` <span class="muted">(role unknown: pick your position to tailor items)</span>`) +
      `. <span class="muted">Click ★ again to pick a hero instead.</span>`;
    out.appendChild(banner);
  }

  const result = resolveDraft(kb, draft);

  const tabs: Array<{ id: TabId; label: string; count: number }> = [
    { id: "heroes", label: "Hero picks", count: result.heroes.length },
    { id: "items", label: "Counter items", count: result.items.length },
    { id: "defense", label: "Defensive", count: result.defense.length },
  ];

  // keep a non-empty tab active where possible (e.g. when a hero is locked)
  if (!tabs.some((t) => t.id === state.activeTab && t.count > 0)) {
    state.activeTab = tabs.find((t) => t.count > 0)?.id ?? "heroes";
  }

  const bar = document.createElement("div");
  bar.className = "tabs";
  for (const t of tabs) {
    const b = document.createElement("button");
    b.className =
      "tab" + (t.id === state.activeTab ? " active" : "") + (t.count === 0 ? " disabled" : "");
    b.innerHTML = `${t.label} <span class="tab-count">${t.count}</span>`;
    b.addEventListener("click", () => {
      state.activeTab = t.id;
      render();
    });
    bar.appendChild(b);
  }
  out.appendChild(bar);
  if (state.enemies.size) out.appendChild(damageRead(result.damage));
  if (result.team) out.appendChild(teamRead(result.team));

  const panel = document.createElement("div");
  panel.className = "tab-panel";
  const recs =
    state.activeTab === "heroes" ? result.heroes
    : state.activeTab === "items" ? result.items
    : result.defense;
  if (recs.length === 0) panel.appendChild(note("Nothing here for this enemy team."));
  else for (const rec of recs.slice(0, 12)) panel.appendChild(recCard(rec));
  out.appendChild(panel);

  if (result.uncovered.length > 0) {
    const gap = document.createElement("div");
    gap.className = "gaps";
    gap.innerHTML =
      `No known counter yet for ${result.uncovered.map((c) => esc(labelFor(c))).join(", ")}. ` +
      `<span class="muted">The knowledge base has nothing on them, so treat these picks as open (ADR-004/011).</span>`;
    out.appendChild(gap);
  }
}

function syncCount(sel: string, n: number): void {
  const el = document.querySelector(sel);
  if (!el) return;
  el.textContent = `${n}/${MAX_TEAM}`;
  el.classList.toggle("full", n >= MAX_TEAM);
}

/** Five draft slots per side (match band). Empty slots pick which side the grid adds to. */
function renderStrip(sel: string, set: Set<string>, side: "enemy" | "ally"): void {
  const strip = el(sel);
  strip.innerHTML = "";
  const ids = [...set];
  for (let i = 0; i < MAX_TEAM; i++) {
    const id = ids[i];
    const slot = document.createElement("button");
    slot.type = "button";
    const unk = id === undefined ? unknownFor(side)[i - ids.length] : undefined;
    if (unk) {
      const isMine = mineSlot?.side === unk.side && mineSlot.index === unk.index;
      const active = assignSlot?.side === unk.side && assignSlot.index === unk.index;
      slot.className = "slot open unknown" + (active ? " assigning" : "");
      slot.title = "The screen shows a hero here that was not recognised (cosmetic / arcana portrait?). " +
        "Click, then pick the hero in the grid: it will be recognised automatically next time.";
      slot.innerHTML = `<span class="p"><span class="q">?</span></span><span class="bar"></span>` +
        `<span class="nm">${active ? "Pick it below" : isMine ? "Your hero?" : "Not recognised"}</span>`;
      slot.addEventListener("click", () => {
        assignSlot = active ? undefined : unk;
        state.addTarget = side;
        render();
        (el("#hero-search") as HTMLInputElement).focus();
      });
      strip.appendChild(slot);
      continue;
    }
    if (id === undefined) {
      slot.className = "slot open" + (state.addTarget === side ? " target" : "");
      slot.title = side === "enemy" ? "Add an enemy hero" : "Add a hero to your team";
      slot.innerHTML = `<span class="p"></span><span class="bar"></span><span class="nm">Open slot</span>`;
      slot.addEventListener("click", () => {
        state.addTarget = side;
        render();
        (el("#hero-search") as HTMLInputElement).focus();
      });
      strip.appendChild(slot);
      continue;
    }
    const hero = byEngineId.get(id);
    const isMine = side === "ally" && state.myHero === id;
    slot.className = "slot filled" + (hero && !hero.inKB ? " untagged" : "") + (isMine ? " mine" : "");
    slot.title = `${labelFor(id)}: click to remove`;
    const p = document.createElement("span");
    p.className = "p";
    const img = document.createElement("img");
    img.alt = "";
    img.src = heroImageUrlByValve(hero?.valve ?? heroValveName(id));
    img.addEventListener("error", () => slot.classList.add("no-art"));
    p.appendChild(img);
    const bar = document.createElement("span");
    bar.className = "bar";
    const nm = document.createElement("span");
    nm.className = "nm";
    nm.textContent = labelFor(id);
    const x = document.createElement("span");
    x.className = "rm";
    x.textContent = "×";
    x.setAttribute("aria-hidden", "true");
    slot.append(p, bar, nm, x);
    slot.addEventListener("click", () => toggleHero(id));

    // ally slots get a star: "this is the hero I'm playing"
    if (side === "ally") {
      const star = document.createElement("span");
      star.className = "star" + (isMine ? " on" : "");
      star.title = isMine ? "Your hero (item builds tailored to it)" : "Mark as the hero you play";
      star.textContent = isMine ? "★" : "☆";
      star.addEventListener("click", (e) => {
        e.stopPropagation();
        setMyHero(id);
      });
      slot.appendChild(star);
    }
    strip.appendChild(slot);
  }
}

// ---------------------------------------------------------------------------
//  Enemy items (ADR-024): manual chips under each enemy slot; the Tab-scoreboard
//  reader fills the same state.
// ---------------------------------------------------------------------------

/** our item id <-> display label, for every item the engine knows something about. */
let itemLabels = new Map<string, string>();
function buildItemLabels(): void {
  itemLabels = new Map();
  for (const i of kb.items) itemLabels.set(i.code, i.label);
  for (const d of kb.defenseEdges) if (!itemLabels.has(d.item)) itemLabels.set(d.item, d.label);
  for (const [id, t] of Object.entries(kb.itemTraits ?? {})) itemLabels.set(id, t.label);
  const list = document.querySelector<HTMLDataListElement>("#item-list");
  if (list) {
    list.innerHTML = [...itemLabels.values()].sort().map((l) => `<option value="${esc(l)}"></option>`).join("");
  }
}
const itemIdByLabel = (label: string) => {
  const want = label.trim().toLowerCase();
  for (const [id, l] of itemLabels) if (l.toLowerCase() === want) return id;
  return undefined;
};

let itemInputFor: string | undefined;
function renderEnemyItems(): void {
  const row = document.querySelector<HTMLElement>("#enemy-items");
  if (!row) return;
  for (const id of [...state.enemyItems.keys()]) if (!state.enemies.has(id)) state.enemyItems.delete(id);
  row.innerHTML = "";
  const ids = [...state.enemies];
  row.hidden = ids.length === 0;
  for (let i = 0; i < MAX_TEAM; i++) {
    const col = document.createElement("div");
    col.className = "item-col";
    const hero = ids[i];
    if (hero) {
      for (const it of state.enemyItems.get(hero) ?? []) {
        const chip = document.createElement("button");
        chip.type = "button";
        chip.className = "item-chip";
        const name = itemLabels.get(it) ?? it;
        const icon = document.createElement("img");
        icon.alt = "";
        icon.src = `./items/${kb.itemDcKey?.[it] ?? it}.webp`;
        icon.addEventListener("error", () => icon.remove());
        chip.append(icon, document.createTextNode(name));
        chip.title = `${labelFor(hero)} has ${name} - click to remove`;
        chip.addEventListener("click", () => setEnemyItems(hero, (state.enemyItems.get(hero) ?? []).filter((x) => x !== it)));
        col.appendChild(chip);
      }
      if (itemInputFor === hero) {
        const input = document.createElement("input");
        input.className = "item-input";
        input.setAttribute("list", "item-list");
        input.placeholder = "Item…";
        input.setAttribute("aria-label", `Add an item to ${labelFor(hero)}`);
        const commit = () => {
          const id = itemIdByLabel(input.value);
          itemInputFor = undefined;
          if (id) setEnemyItems(hero, [...new Set([...(state.enemyItems.get(hero) ?? []), id])]);
          else render();
        };
        input.addEventListener("change", commit);
        input.addEventListener("keydown", (e) => {
          if (e.key === "Escape") {
            itemInputFor = undefined;
            render();
          }
        });
        col.appendChild(input);
        queueMicrotask(() => input.focus());
      } else if ((state.enemyItems.get(hero) ?? []).length < 7) {
        const add = document.createElement("button");
        add.type = "button";
        add.className = "item-add";
        add.textContent = "+ item";
        add.title = `Add an item ${labelFor(hero)} has (BKB, Butterfly, Blink…) - recommendations adapt`;
        add.addEventListener("click", () => {
          itemInputFor = hero;
          render();
        });
        col.appendChild(add);
      }
    }
    row.appendChild(col);
  }
}

// ---------------------------------------------------------------------------
//  Bottom-HUD inventory (ADR-025): click an enemy in the game -> its items land here.
//  Which hero? The name plate above the portrait, learned once per hero (kept).
// ---------------------------------------------------------------------------

const PLATES_KEY = "dotaapp.hudPlates.v1";
const PLATES_PER_HERO = 3;
interface PlateRow { hero: string; vec: number[] }
let plateRows: PlateRow[] = (() => {
  try {
    return JSON.parse(localStorage.getItem(PLATES_KEY) ?? "[]") as PlateRow[];
  } catch {
    return [];
  }
})();
const learnedPlates = (): LearnedPlate[] => plateRows.map((r) => ({ hero: r.hero, vec: Float32Array.from(r.vec) }));
/** a HUD read whose hero is not known yet - the UI asks "whose items?". */
let pendingHud: HudRead | undefined;

function learnPlate(hero: string, vec: Float32Array): void {
  const same = plateRows.filter((r) => r.hero === hero);
  let rows = plateRows;
  if (same.length >= PLATES_PER_HERO) rows = rows.filter((r) => r !== same[0]);
  plateRows = [...rows, { hero, vec: Array.from(vec, (x) => Math.round(x * 1e4) / 1e4) }].slice(-200);
  try {
    localStorage.setItem(PLATES_KEY, JSON.stringify(plateRows));
  } catch {
    /* storage unavailable: learned for this session only */
  }
}

/** dotaconstants item key -> our item id (only items the engine knows). */
function ourItemId(dcKey: string): string | undefined {
  const inv = Object.entries(kb.itemDcKey ?? {}).find(([, dc]) => dc === dcKey)?.[0];
  const id = inv ?? dcKey;
  return itemLabels.has(id) ? id : undefined;
}

function onHudInventory(r: HudRead): void {
  const hero = identifyPlate(r.plate, learnedPlates());
  if (!hero) {
    // only bother the user when there is something to attribute
    if (r.items.length && (state.enemies.size || state.allies.size)) {
      pendingHud = r;
      render();
    }
    return;
  }
  applyHud(hero, r);
}

function applyHud(hero: string, r: HudRead): void {
  if (pendingHud === r) pendingHud = undefined;
  if (state.enemies.has(hero)) {
    // a fresh look replaces what we knew (items get sold, upgraded, consumed)
    const ids = [...new Set(r.items.map(ourItemId).filter((x): x is string => !!x))];
    if (ids.length) state.enemyItems.set(hero, ids);
    else state.enemyItems.delete(hero);
  }
  render();
}

function hudPrompt(): HTMLElement | undefined {
  const r = pendingHud;
  if (!r) return undefined;
  const box = document.createElement("div");
  box.className = "hud-prompt";
  const icons = r.items.map((k) => `<img alt="" title="${esc(k)}" src="./items/${esc(k)}.webp">`).join("");
  box.innerHTML = `<div class="hp-head">Whose items? ${icons}</div><div class="hp-sub">Seen on the selected hero in the game. Click the hero once - I'll recognise it from then on.</div>`;
  const row = document.createElement("div");
  row.className = "hp-heroes";
  for (const [list, cls] of [[state.enemies, "enemy"], [state.allies, "ally"]] as const) {
    for (const id of list) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = `hp-hero ${cls}`;
      b.title = labelFor(id);
      b.innerHTML = `<img alt="" src="${heroImageUrlByValve(byEngineId.get(id)?.valve ?? heroValveName(id))}"><span>${esc(labelFor(id))}</span>`;
      b.addEventListener("click", () => {
        learnPlate(id, r.plate);
        applyHud(id, r);
      });
      row.appendChild(b);
    }
  }
  const skip = document.createElement("button");
  skip.type = "button";
  skip.className = "hp-skip";
  skip.textContent = "Not a hero";
  skip.addEventListener("click", () => {
    pendingHud = undefined;
    render();
  });
  row.appendChild(skip);
  box.appendChild(row);
  return box;
}

function setEnemyItems(hero: string, items: string[]): void {
  if (items.length) state.enemyItems.set(hero, items);
  else state.enemyItems.delete(hero);
  render();
}

function damageRead(d: DamageRead): HTMLElement {
  const p = document.createElement("p");
  p.className = "damage-read";
  const build =
    d.defenseLean === "physical" ? "armor" : d.defenseLean === "magic" ? "magic resistance" : "mixed defense";
  const school = (l: string) => (l === "mixed" ? "mixed" : `<b class="${leanClass(l)}">${l}</b>`);
  p.innerHTML =
    `They deal ${school(d.defenseLean)} damage (physical ${d.physThreat}, magic ${d.magicThreat}), so build ${build}. ` +
    (d.offenseLean === "mixed"
      ? "Neither damage type has an edge against them."
      : `They are softer to ${school(d.offenseLean)} damage.`);
  return p;
}
/** Your lineup (ADR-023): which team needs are covered, damage mix, lane opponents. */
function teamRead(t: TeamRead): HTMLElement {
  const p = document.createElement("p");
  p.className = "damage-read team-read";
  const parts: string[] = [];
  for (const n of t.needs) {
    const state = n.have >= n.want ? "ok" : n.have > 0 ? "part" : "miss";
    const mark = state === "ok" ? "✓" : state === "part" ? "½" : "✗";
    parts.push(`<span class="need ${state}" title="${esc(`${n.label}: ${n.have} of ${n.want}`)}">${esc(n.label)} ${mark}</span>`);
  }
  const total = t.physical + t.magic;
  if (t.needs.length && total > 0) {
    const phys = Math.round((100 * t.physical) / total);
    const lean = phys >= 70 ? "physical" : phys <= 30 ? "magic" : "";
    parts.push(`damage <b class="${lean || "muted"}">${phys}% physical</b>`);
  }
  if (t.laneOpponents?.length) parts.push(`lane vs ${t.laneOpponents.map((c) => esc(labelFor(c))).join(", ")}`);
  p.innerHTML = `Your team: ${parts.join(" · ")}`;
  return p;
}
const needLabel = (code?: string) =>
  code === "damage_mix" ? "Damage mix" : kb.taxonomy.team_needs?.find((n) => n.code === code)?.label ?? code ?? "";

function leanClass(l: string): string {
  return l === "physical" ? "physical" : l === "magic" ? "magic" : "muted";
}

/**
 * Standalone combos panel - team synergy, independent of the enemy draft.
 * Curated duos show by default; the ~750 scraped wiki synergies are searchable
 * (rendering all at once would be far too heavy).
 */
const COMBO_LIMIT = 40;
let comboSearch = "";

function buildCombos(): void {
  genericSet = genericCombos(kb.combos, labelFor);
  const search = el("#combos-search") as HTMLInputElement;
  search.addEventListener("input", () => {
    comboSearch = search.value.trim().toLowerCase();
    // typing is a free-text filter, not a single-hero pick - clear grid highlights
    for (const t of document.querySelectorAll<HTMLElement>("#combo-roster .hero-tile")) {
      t.classList.remove("picked-ally");
    }
    renderCombos();
  });
  renderCombos();
}

function renderCombos(): void {
  const root = el("#combos-panel");
  root.innerHTML = "";
  const q = comboSearch;

  // nothing selected/typed -> show only the hero grid above, no combos below
  if (q === "") {
    root.appendChild(note("Pick a hero above (or type a name) to see its strongest synergies."));
    return;
  }

  // the hero the user is looking at (exact name) is shown first on every card
  const focus = grid.find((g) => g.label.toLowerCase() === q)?.engineId;
  const posOf = (code: string) => kb.taxonomy.hero_tags[code]?.pos;
  const LANE_RANK: Record<RoleFit["lane"], number> = {
    "safe lane duo": 0, "off lane duo": 0, "support duo": 1, "mid + teammate": 2, "different lanes": 3,
  };
  const rows = kb.combos
    .filter((c) => c.pair.some((code) => labelFor(code).toLowerCase().includes(q)))
    .map((c) => ({ c, fit: roleFit(posOf(c.pair[0]), posOf(c.pair[1])), generic: genericSet.has(c) }));
  const conflicts = rows.filter((r) => r.fit === null);
  const shown = rows
    .filter((r) => r.fit !== null || showConflicts)
    // mutual first, specific before copy-paste lines, main roles before off-roles, lane duos first
    .sort(
      (a, b) =>
        Number(a.fit === null) - Number(b.fit === null) ||
        (b.c.strength ?? 0) - (a.c.strength ?? 0) ||
        Number(a.generic) - Number(b.generic) ||
        (a.fit?.cost ?? 9) - (b.fit?.cost ?? 9) ||
        (a.fit ? LANE_RANK[a.fit.lane] : 9) - (b.fit ? LANE_RANK[b.fit.lane] : 9) ||
        labelFor(a.c.pair[0]).localeCompare(labelFor(b.c.pair[0])),
    );

  if (shown.length === 0 && conflicts.length === 0) {
    root.appendChild(note("No synergies for that hero."));
    return;
  }
  const list = document.createElement("div");
  list.className = "combo-grid";
  for (const r of shown.slice(0, COMBO_LIMIT)) list.appendChild(comboCard(r.c, r.fit, r.generic, focus));
  root.appendChild(list);
  if (shown.length > COMBO_LIMIT) {
    root.appendChild(note(`Showing ${COMBO_LIMIT} of ${shown.length} synergies.`));
  }
  if (conflicts.length) {
    const p = document.createElement("p");
    p.className = "empty";
    const ex = conflicts[0]!.c.pair.map((code) => `${labelFor(code)} ${posOf(code)?.join("/")}`).join(" + ");
    p.innerHTML = showConflicts
      ? `Including ${conflicts.length} pair(s) that cannot share a team: both heroes only play the same position. `
      : `${conflicts.length} pair(s) hidden: both heroes only play the same position (e.g. ${esc(ex)}). `;
    const b = document.createElement("button");
    b.className = "link";
    b.textContent = showConflicts ? "Hide them" : "Show them";
    b.addEventListener("click", () => {
      showConflicts = !showConflicts;
      renderCombos();
    });
    p.appendChild(b);
    root.appendChild(p);
  }
}

let showConflicts = false;
/** wiki lines copy-pasted across partners (computed once per KB). */
let genericSet = new Set<Combo>();

function comboCard(c: Combo, fit: RoleFit | null | undefined, generic: boolean, focus?: string): HTMLElement {
  const card = document.createElement("article");
  card.className = "card combo" + (fit === null ? " conflict" : "") + (generic ? " generic" : "");
  const flip = focus !== undefined && c.pair[1] === focus;
  const order: Array<[string, number | undefined]> = [
    [c.pair[0], fit?.pos[0]],
    [c.pair[1], fit?.pos[1]],
  ];
  if (flip) order.reverse();

  const head = document.createElement("div");
  head.className = "combo-head";
  for (const [code, pos] of order) {
    const cell = document.createElement("span");
    cell.className = "combo-hero";
    const img = document.createElement("img");
    img.loading = "lazy";
    img.alt = labelFor(code);
    img.src = heroImageUrlByValve(heroValveName(code));
    img.addEventListener("error", () => cell.classList.add("no-art"));
    const nm = document.createElement("span");
    nm.textContent = labelFor(code);
    cell.append(img, nm);
    if (pos !== undefined) {
      const p = document.createElement("b");
      p.className = "pos";
      p.title = `plays position ${pos} in this duo`;
      p.textContent = String(pos);
      cell.appendChild(p);
    }
    head.appendChild(cell);
  }
  if ((c.strength ?? 0) >= 2) {
    const tag = document.createElement("span");
    tag.className = "combo-strong";
    tag.title = "Both heroes' pages list this synergy";
    tag.textContent = "mutual";
    head.appendChild(tag);
  }
  card.appendChild(head);

  const roles = document.createElement("div");
  roles.className = "combo-roles";
  if (fit) {
    const offRole = order
      .filter(([code, pos]) => pos !== undefined && kb.taxonomy.hero_tags[code]?.pos[0] !== pos)
      .map(([code]) => labelFor(code));
    roles.innerHTML =
      `Pos ${order.map(([, pos]) => pos).join(" + ")}, ${fit.lane}` +
      (offRole.length ? ` <span class="muted">(${esc(offRole.join(", "))} off the main role)</span>` : "");
  } else if (fit === null) {
    roles.textContent = `Both only play pos ${kb.taxonomy.hero_tags[c.pair[0]]?.pos.join("/")}: not one team`;
  }
  if (generic) {
    const g = document.createElement("span");
    g.className = "combo-generic";
    g.title = "The wiki repeats this line for many partners with only the name changed";
    g.textContent = "generic";
    roles.appendChild(g);
  }
  if (roles.childNodes.length) card.appendChild(roles);

  const mech = document.createElement("div");
  mech.className = "combo-mech";
  mech.textContent = collapse(c.mechanism);
  card.appendChild(mech);
  return card;
}

/** win rate line under the score, coloured by side of 50, sample size in the tooltip. */
function winrateBadge(rec: Recommendation): string {
  if (rec.winrate === undefined) return "";
  const pct = Math.round(rec.winrate * 100);
  const cls = pct >= 52 ? "wr good" : pct <= 48 ? "wr bad" : "wr";
  const tip = `${pct}% win rate vs their team across ${rec.winrateGames} public matches`;
  return `<span class="${cls}" title="${esc(tip)}">${pct}% WR</span>`;
}

function archetypeLabel(a: Archetype, attack?: AttackType): string {
  const name = { carry: "carry", caster: "caster core", offlane: "offlaner", support: "support" }[a];
  return attack && (a === "carry" || a === "support") ? `${attack} ${name}` : name;
}

/** the single strongest counter reason (synergy shown in meta instead). */
function leadReason(rec: Recommendation): Reason | undefined {
  const counters = rec.reasons.filter((r) => r.basis !== "synergy" && r.contribution > 0);
  return (counters.length ? counters : rec.reasons).slice().sort((a, b) => b.contribution - a.contribution)[0];
}

function recCard(rec: Recommendation): HTMLElement {
  const isHero = rec.kind === "hero";
  const card = document.createElement("article");
  card.className = "card" + (isHero ? "" : " item");
  const name = isHero ? labelFor(rec.code) : rec.label;

  if (isHero) {
    const pt = document.createElement("div");
    pt.className = "pt";
    const img = document.createElement("img");
    img.alt = "";
    img.loading = "lazy";
    img.src = heroImageUrlByValve(byEngineId.get(rec.code)?.valve ?? heroValveName(rec.code));
    pt.appendChild(img);
    card.appendChild(pt);
  }

  const body = document.createElement("div");
  const meta: string[] = [];
  if (isHero && rec.pos) meta.push(`Pos ${rec.pos.join("/")}`);
  if (rec.school && rec.school !== "neutral") meta.push(`<span class="${rec.school}">${rec.school}</span>`);
  if (rec.synergyWith?.length) meta.push(`works with ${rec.synergyWith.map((c) => esc(labelFor(c))).join(", ")}`);
  const fills = [...new Set(rec.reasons.filter((r) => r.basis === "team").map((r) => needLabel(r.need).toLowerCase()))];
  if (fills.length) meta.push(`<span class="fills" title="Covers what your lineup lacks">fills ${esc(fills.join(", "))}</span>`);
  if (rec.risks?.length) {
    const tip = "Their kit hits a weakness of this pick (or blunts its damage) - score already lowered";
    meta.push(`<span class="off" title="${tip}">risky vs ${rec.risks.map((c) => esc(labelFor(c))).join(", ")}</span>`);
  }
  if (rec.fit && rec.fit.mult < 0.5) {
    card.classList.add("off-build");
    meta.push(`<span class="off" title="Counters them, but rarely built by this archetype (score x${rec.fit.mult})">unusual for a ${archetypeLabel(rec.fit.archetype, rec.fit.attack)}</span>`);
  }
  const ans = rec.coverage
    .map((c) => `<img title="answers ${esc(labelFor(c))}" alt="${esc(labelFor(c))}" src="${heroImageUrlByValve(byEngineId.get(c)?.valve ?? heroValveName(c))}">`)
    .join("");
  body.innerHTML =
    `<h3>${esc(name)}</h3>` +
    (meta.length ? `<div class="meta">${meta.join(" · ")}</div>` : "") +
    (ans ? `<div class="ans">${ans}</div>` : "");
  card.appendChild(body);

  const sc = document.createElement("div");
  sc.className = "sc";
  sc.innerHTML = `<b title="KB score">${rec.score.toFixed(1)}</b>${winrateBadge(rec)}`;
  card.appendChild(sc);

  const lead = leadReason(rec);
  if (lead) {
    const why = document.createElement("p");
    why.className = "why";
    why.innerHTML = reasonSummary(lead, rec);
    card.appendChild(why);
  }
  const rest = rec.reasons.filter((r) => r !== lead);
  if (rest.length) {
    const det = document.createElement("details");
    const sum = document.createElement("summary");
    sum.textContent = `${rest.length} more reason${rest.length > 1 ? "s" : ""}`;
    det.appendChild(sum);
    const list = document.createElement("ul");
    list.className = "reasons";
    for (const reason of rest) list.appendChild(reasonItem(reason, rec));
    det.appendChild(list);
    card.appendChild(det);
  }
  return card;
}

/** Wiki item notes are scraped with the item name cut off ("is a cheaper alternative…"). */
function mechanismText(reason: Reason, rec: Recommendation): string {
  const m = collapse(reason.mechanism);
  if (reason.basis === "item_edge" && /^[a-z]/.test(m)) return `${rec.label} ${m}`;
  return m;
}

const toolLabel = (c?: string) => (c ? kb.toolByCode.get(c)?.label ?? c : "");
const relLabel = (c?: string) => (c ? kb.relianceByCode.get(c)?.label ?? c : "");
const resistLabel = (c?: string) => (c ? kb.taxonomy.resistance?.find((r) => r.code === c)?.label ?? c : "");
/** what the enemy throws at the candidate (resist reasons): a tool or a damage source. */
const threatLabel = (r: Reason) => (r.tool ? toolLabel(r.tool) : relLabel(r.reliance));

/** risk reason head: exposure "their tool → my weakness" or blunted "my tool into their resistance". */
function riskHead(r: Reason): string {
  return r.resistance
    ? `${esc(r.tool ? toolLabel(r.tool) : relLabel(r.reliance))} blunted by ${esc(resistLabel(r.resistance))}`
    : `exposed: ${esc(toolLabel(r.tool))} → ${esc(relLabel(r.reliance))}`;
}

const viaText = (r: Reason) => (r.via?.length ? ` <span class="via">(their ${esc(r.via.join(", "))})</span>` : "");

/** one-line lead: "<tool → reliance> vs <enemy>: mechanism". */
function reasonSummary(reason: Reason, rec: Recommendation): string {
  return reasonSummaryText(reason, rec) + viaText(reason);
}
function reasonSummaryText(reason: Reason, rec: Recommendation): string {
  const who = esc(labelFor(reason.enemy));
  const mech = esc(mechanismText(reason, rec));
  if (reason.basis === "synergy") return `<span class="lead">Combo with ${who}:</span> ${mech}`;
  if (reason.basis === "team") return `<span class="lead">Fills a gap: ${esc(needLabel(reason.need))}</span> - ${mech}`;
  if (reason.basis === "edge") {
    const tool = reason.tool ? kb.toolByCode.get(reason.tool)?.label ?? reason.tool : "";
    const rel = reason.reliance ? kb.relianceByCode.get(reason.reliance)?.label ?? reason.reliance : "";
    return `<span class="lead">${esc(tool)} → ${esc(rel)}</span> vs ${who}: ${mech}`;
  }
  if (reason.basis === "defense") {
    const threat = reason.tool ? kb.toolByCode.get(reason.tool)?.label ?? reason.tool : "";
    return `<span class="lead">Blocks ${esc(threat)}</span> from ${who}: ${mech}`;
  }
  if (reason.basis === "resist") {
    return `<span class="lead">${esc(resistLabel(reason.resistance))} shrugs off ${esc(threatLabel(reason))}</span> from ${who}: ${mech}`;
  }
  return `<span class="lead">vs ${who}:</span> ${mech}`;
}

function reasonItem(reason: Reason, rec: Recommendation): HTMLElement {
  const li = document.createElement("li");
  if (reason.basis === "synergy") {
    li.innerHTML =
      `<span class="syn">+ combos with ${esc(labelFor(reason.enemy))}</span> ` +
      esc(mechanismText(reason, rec));
    return li;
  }
  if (reason.basis === "team") {
    li.innerHTML = `<span class="syn">+ team: ${esc(needLabel(reason.need))}</span> ` + esc(mechanismText(reason, rec));
    return li;
  }
  const enemy = `<span class="vs">vs ${esc(labelFor(reason.enemy))}</span> `;
  let body: string;
  if (reason.basis === "hero_edge") {
    // wiki reasons carry no badge (point: declutter); curated keep "hero-specific"
    const badge = reason.source === "wiki" ? "" : `<span class="badge">hero-specific</span> `;
    body = `${badge}${esc(mechanismText(reason, rec))}`;
  } else if (reason.basis === "item_edge") {
    const badge = reason.source === "wiki" ? "" : `<span class="badge">item-specific</span> `;
    body = `${badge}${esc(mechanismText(reason, rec))}`;
  } else if (reason.basis === "defense") {
    const threat = reason.tool ? kb.toolByCode.get(reason.tool)?.label ?? reason.tool : "";
    const head = `<span class="block">blocks ${esc(threat)}</span> `;
    body = head + esc(mechanismText(reason, rec));
  } else if (reason.basis === "resist") {
    const head = `<span class="block">${esc(resistLabel(reason.resistance))} vs ${esc(threatLabel(reason))}</span> `;
    body = head + esc(mechanismText(reason, rec));
  } else if (reason.basis === "risk") {
    li.classList.add("risk");
    body = `<span class="risk">− ${riskHead(reason)}</span> ` + esc(mechanismText(reason, rec));
  } else {
    const tool = reason.tool ? kb.toolByCode.get(reason.tool)?.label : "";
    const rel = reason.reliance ? kb.relianceByCode.get(reason.reliance)?.label : "";
    const head = tool && rel ? `<span class="edge">${esc(tool)} → ${esc(rel)}</span> ` : "";
    body = head + esc(mechanismText(reason, rec));
  }
  li.innerHTML = enemy + body + viaText(reason);

  if (state.showFactors) {
    const f = reason.factors;
    const parts = [
      f.toolWeight !== undefined ? `tool ${f.toolWeight}` : "",
      f.edgeWeight !== undefined ? `edge ${f.edgeWeight}` : "",
      f.relianceWeight !== undefined ? `reliance ${f.relianceWeight}` : "",
      f.threatWeight !== undefined ? `threat ${f.threatWeight}` : "",
      f.defenseWeight !== undefined ? `defense ${f.defenseWeight}` : "",
      f.resistWeight !== undefined ? `resist ${f.resistWeight}` : "",
      f.enemyWeight !== undefined ? `enemy ${f.enemyWeight}` : "",
    ].filter(Boolean);
    const fac = document.createElement("span");
    fac.className = "factors";
    fac.textContent = ` [${parts.join(" × ")} = ${reason.contribution}]`;
    li.appendChild(fac);
  }
  for (const n of reason.notes ?? []) {
    const gn = document.createElement("div");
    gn.className = "guard-note";
    gn.textContent = "· " + n;
    li.appendChild(gn);
  }
  return li;
}

// ---------------------------------------------------------------------------
//  Auto-input (ADR-013): GSI bridge -> DraftPatch -> same UI state as the grid.
//  GSI (player mode) only sees YOUR hero, so it fills "My team" + the ★ myHero;
//  enemies stay manual. Every auto change remains editable by hand.
// ---------------------------------------------------------------------------

const AUTO_KEY = "dotaapp.autoInput";
let auto: AutoInputAdapter | undefined;
let autoStatus: AutoStatus = { kind: "off" };
let lastSnap: GsiSnapshot | undefined;
/** valve name last applied from GSI - re-apply only when the game says something new,
 *  so a manual un-star / removal is not immediately overridden. */
let lastAutoHero: string | undefined;
/** engineId the adapter itself added to allies (removed again on a repick/swap). */
let autoAddedAlly: string | undefined;

const PHASE_LABEL: Record<GamePhase, string> = {
  idle: "in menus",
  loading: "loading",
  hero_selection: "hero pick",
  strategy: "strategy time",
  pre_game: "pre-game",
  in_progress: "in game",
  post_game: "post-game",
  unknown: "in match",
};

function readAutoPref(): boolean | undefined {
  try {
    const v = localStorage.getItem(AUTO_KEY);
    return v === null ? undefined : v === "1";
  } catch {
    return undefined;
  }
}
function writeAutoPref(on: boolean): void {
  try {
    localStorage.setItem(AUTO_KEY, on ? "1" : "0");
  } catch {
    /* storage unavailable - preference just isn't remembered */
  }
}

function buildAutoInput(): void {
  const btn = document.querySelector<HTMLElement>("#auto-btn");
  if (!btn) return; // markup without the auto-input chip
  if (BUNDLE?.pages) {
    // hosted build: no local bridge, and the CSP blocks 127.0.0.1 anyway
    for (const sel of ["#auto-btn", "#auto-status", ".auto-box .sep"]) {
      document.querySelector<HTMLElement>(sel)?.remove();
    }
    return;
  }
  const url = defaultBridgeUrl();
  auto = new AutoInputAdapter(url, {
    onPatch: applyAutoPatch,
    onStatus: (st) => {
      autoStatus = st;
      if (st.kind === "live" && st.snap) lastSnap = st.snap;
      renderAutoStatus();
    },
  });
  btn.addEventListener("click", () => {
    if (auto!.running) auto!.stop();
    else auto!.start();
    writeAutoPref(auto!.running);
    renderAutoStatus();
  });
  // default ON when the page is served by the bridge itself (same origin)
  const pref = readAutoPref();
  const servedByBridge = url === window.location.origin;
  if (pref ?? servedByBridge) auto.start();
  renderAutoStatus();
}

function applyAutoPatch(p: DraftPatch): void {
  lastSnap = p.snap;
  let changed = false;
  if (p.team && sideSource !== "manual") {
    const side: Side = p.team === "radiant" ? "left" : "right";
    sideSource = "gsi";
    if (screenSide !== side) {
      screenSide = side;
      syncScreen(true);
      changed = true;
    }
  }
  if (p.newMatch) {
    state.enemies.clear();
    state.allies.clear();
    state.myHero = undefined;
    lastAutoHero = undefined;
    autoAddedAlly = undefined;
    changed = true;
  }
  if (p.myHeroValve && p.myHeroValve !== lastAutoHero) {
    const id = byValve.get(p.myHeroValve);
    if (id) {
      lastAutoHero = p.myHeroValve;
      // repick / swap: drop the hero we auto-added before
      if (autoAddedAlly && autoAddedAlly !== id) {
        state.allies.delete(autoAddedAlly);
        if (state.myHero === autoAddedAlly) state.myHero = undefined;
        autoAddedAlly = undefined;
      }
      state.enemies.delete(id); // can't be on both sides
      if (!state.allies.has(id) && state.allies.size < MAX_TEAM) {
        state.allies.add(id);
        autoAddedAlly = id;
      }
      if (state.allies.has(id)) state.myHero = id;
      changed = true;
    }
  }
  if (changed) render();
  renderAutoStatus();
}

function renderAutoStatus(): void {
  const btn = document.querySelector<HTMLElement>("#auto-btn");
  const txt = document.querySelector<HTMLElement>("#auto-status");
  if (!btn || !txt) return;
  const on = auto?.running ?? false;
  btn.classList.toggle("on", on);
  btn.textContent = on ? "GSI: on" : "GSI: off";
  const st = on ? autoStatus : ({ kind: "off" } as AutoStatus);
  txt.dataset.kind = st.kind;
  if (st.kind === "off") {
    txt.textContent = "manual input";
    txt.title = "Turn on to read your hero from Dota (GSI) via the local bridge";
  } else if (st.kind === "connecting") {
    txt.textContent = "bridge offline - run npm run gsi";
    txt.title = `Connecting to ${st.url}`;
  } else if (st.kind === "waiting") {
    txt.textContent = "bridge up - waiting for Dota";
    txt.title = "No GSI data yet: is -gamestateintegration set and the cfg installed (npm run gsi -- --install)?";
  } else {
    const s = lastSnap;
    const hero = s?.myHeroValve ? labelFor(byValve.get(s.myHeroValve) ?? s.myHeroValve) : "no hero yet";
    const bits = [hero, s ? PHASE_LABEL[s.phase] : "", s?.team ?? ""].filter(Boolean);
    txt.textContent = "live - " + bits.join(" - ");
    txt.title = s?.matchId ? `match ${s.matchId}` : "GSI connected";
  }
}

// ---------------------------------------------------------------------------
//  Screen reading (ADR-013 P1): screen share -> top-bar portraits -> draft.
//  Radiant is always the LEFT block of the top bar, Dire the RIGHT one; which
//  block is "your team" comes from the side buttons (or GSI team, if on).
// ---------------------------------------------------------------------------

let screen: ScreenReader | undefined;
let screenStatus: ScreenStatus = { kind: "off" };
let screenSide: Side | undefined;
/** where the side came from: the preview ghost (auto), GSI, or a click (manual wins). */
let sideSource: "auto" | "gsi" | "manual" | undefined;
/** your slot from the preview ghost; its hero becomes the ★ once. */
let mineSlot: { side: Side; index: number } | undefined;
let mineApplied: string | undefined;
let lastScreen: ScreenChange | undefined;
/** engineIds the screen reader put into the draft (so a repick can replace them). */
const screenOwned = new Set<string>();
let screenUsed = false;
let lastShot: Frame | undefined;
/** a "?" slot the user clicked: the next grid click names (and teaches) it. */
let assignSlot: { side: Side; index: number } | undefined;
let unknownSig = "";

/** screen slots that show SOMETHING the recogniser could not name, and that have no
 *  stable hero yet (e.g. your own hero in a cosmetic portrait). */
function unknownSlots(): Array<{ side: Side; index: number }> {
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
function unknownFor(team: "enemy" | "ally"): Array<{ side: Side; index: number }> {
  if (!screenSide) return [];
  const want: Side = team === "ally" ? screenSide : screenSide === "left" ? "right" : "left";
  return unknownSlots().filter((u) => u.side === want);
}

/** name the clicked "?" slot with this hero, teach the recogniser its look. */
function assignHero(engineId: string): boolean {
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

function buildScreenInput(): void {
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

function applyScreen(c: ScreenChange): void {
  if (c.reset) {
    state.enemies.clear();
    state.allies.clear();
    state.myHero = undefined;
    screenOwned.clear();
    lastAutoHero = undefined;
    autoAddedAlly = undefined;
    lastScreen = undefined;
    mineSlot = c.mine;
    mineApplied = undefined;
    // a new match can put you on the other side: forget a side not given by GSI
    if (sideSource !== "gsi") {
      screenSide = c.mine?.side;
      sideSource = c.mine ? "auto" : undefined;
    }
    render();
    return;
  }
  const prevSide = screenSide;
  if (c.mine) {
    mineSlot = c.mine;
    if (sideSource !== "manual" && sideSource !== "gsi") {
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
function applyMine(): void {
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
function syncScreen(full: boolean): void {
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

function renderSideBar(): void {
  const bar = document.querySelector<HTMLElement>("#side-bar");
  if (!bar) return;
  bar.hidden = !screenUsed && !screen?.running;
  for (const b of document.querySelectorAll<HTMLElement>(".side-btn")) {
    b.classList.toggle("active", b.dataset.side === screenSide);
  }
  bar.classList.toggle("ask", !screenSide && lastScreen !== undefined);
}

/** perf probe for the latency e2e (read cost, render cost). */
const perf = { renderMs: 0 };
(window as unknown as { __perf: typeof perf }).__perf = perf;

function renderScreenStatus(): void {
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

// ---------------------------------------------------------------------------
//  helpers
// ---------------------------------------------------------------------------

function el(sel: string): HTMLElement {
  const node = document.querySelector<HTMLElement>(sel);
  if (!node) throw new Error(`missing element ${sel}`);
  return node;
}
function note(text: string): HTMLElement {
  const d = document.createElement("p");
  d.className = "empty";
  d.textContent = text;
  return d;
}
function collapse(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}
function esc(s: string): string {
  return s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]!);
}

void boot();
