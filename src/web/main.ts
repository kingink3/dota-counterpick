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

import { FOUNDATIONS } from "../school/foundations.js";
import { ROLES } from "../school/roles.js";
import { DRAFTING } from "../school/drafting.js";
import { SchoolView } from "./school-view.js";
import { loadHistory, loadSettings } from "./review-local.js";
import { indexKB, type KnowledgeBase, type RawKB } from "../knowledge.js";
import { archetypeOf, resolve as resolveDraft } from "../resolver.js";
import { genericCombos, roleFit, type RoleFit } from "../combos.js";
import { heroLabel } from "../explain.js";
import { heroImageUrlByValve, heroValveName } from "./hero-art.js";
import { buildItemTemplates, buildTemplates, ScreenReader, type ScreenStatus } from "./screen-reader.js";
import { GameView } from "./game-view.js";
import { ReviewView } from "./review-view.js";
import type { Benchmarks, Ids } from "../review.js";
import type { PlanView } from "./plan-view.js";
import { buildMatchPlan } from "../game-plan.js";
import { buildPlan, heroBuyFit, teamWindow, type ItemStats } from "../item-plan.js";
import { identifyPlate, type HudRead, type LearnedPlate } from "../item-match.js";
import type { Frame, ScreenChange, Side } from "../screen-match.js";
import type { Archetype, AttackType, Combo, DamageRead, DraftState, Reason, Recommendation, TeamRead } from "../types.js";

const ATTR_ORDER: Attr[] = ["str", "agi", "int", "all"];
const ATTR_NAME: Record<Attr, string> = {
  str: "Strength",
  agi: "Agility",
  int: "Intelligence",
  all: "Universal",
};

/** Pages build (scripts/build-pages.ts): data arrives decrypted in memory, not by fetch. */
interface PagesBundle {
  kb: RawKB;
  roster: { heroes: RosterHero[] };
  matchups: { heroes?: Record<string, Record<string, [number, number]>> } | null;
  itemStats?: ItemStats | null;
  ids?: Ids | null;
  benchmarks?: Benchmarks | null;
  /** ADR-044: token that may start "Review a match" (Actions on this repo only). */
  dispatch?: string;
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
  const kbIndexed = indexKB(rawKb);
  if (matchups?.heroes) kbIndexed.matchups = matchups.heroes;
  const stats: ItemStats | undefined =
    (BUNDLE ? BUNDLE.itemStats : await fetch("./item-stats.json").then((r) => (r.ok ? r.json() : null)).catch(() => null)) ??
    undefined;
  setData({
    kb: kbIndexed,
    grid: [],
    ...(stats ? { itemStats: stats } : {}),
    ...(matchups && "source" in matchups && typeof matchups.source === "string" ? { matchupSource: matchups.source } : {}),
  });
  setRender(renderAll);
  const optJson = <T,>(f: string): Promise<T | undefined> => fetch(f).then((r) => (r.ok ? (r.json() as Promise<T>) : undefined)).catch(() => undefined);
  [reviewIds, reviewBench] = BUNDLE
    ? [BUNDLE.ids ?? undefined, BUNDLE.benchmarks ?? undefined]
    : await Promise.all([optJson<Ids>("./ids.json"), optJson<Benchmarks>("./benchmarks.json")]);
  buildItemLabels();

  // link roster -> KB by valve name (KB code's portrait name == roster valve)
  const valveToCode = new Map<string, string>();
  for (const code of Object.keys(kb.taxonomy.hero_tags)) {
    valveToCode.set(heroValveName(code), code);
  }
  const heroes = roster.heroes.map((h) => {
    const code = valveToCode.get(h.valve);
    const engineId = code ?? h.valve;
    const gh: GridHero = { ...h, engineId, inKB: Boolean(code) };
    byEngineId.set(engineId, gh);
    byValve.set(h.valve, engineId);
    return gh;
  });
  setData({ kb, grid: heroes, ...(itemStats ? { itemStats } : {}), matchupSource });

  buildRoster("#roster", toggleHero);
  buildRoster("#combo-roster", onComboTile);
  buildSearch();
  buildRoleBar();
  buildCombos();
  buildModeNav();
  buildGameView();
  buildReviewView();
  buildSchoolView();
  buildScreenInput();
  render();
}

/** Top-level split: enemy-driven "Counter picks" vs independent "Combos". */
function buildModeNav(): void {
  for (const btn of document.querySelectorAll<HTMLElement>(".mode-btn")) {
    btn.addEventListener("click", () => setMode(btn.dataset.mode as Mode));
  }
}
import { type Attr, type GridHero, MAX_TEAM, matchupSource, type RosterHero, type TabId, byEngineId, byValve, el, esc, grid, itemStats, kb, labelFor, note, render, setData, setRender, state } from "./app.js";
import { buildCombos, comboSearch, setComboSearch, renderCombos } from "./combos-view.js";
import { buildItemLabels, hudPrompt, itemLabels, myItems, renderEnemyItems } from "./enemy-items.js";
import { archetypeLabel, damageRead, leadReason, reasonSummaryText, recCard, teamRead } from "./rec-cards.js";
import { assignHero, assignSlot, buildScreenInput, setAssignSlot, setClockSink, mineSlot, perf, renderSideBar, unknownFor } from "./screen-input.js";
type Mode = "counter" | "combo" | "game" | "review" | "school";
let mode: Mode = "counter";
function setMode(m: Mode): void {
  mode = m;
  (el("#counter-view") as HTMLElement).hidden = m !== "counter";
  (el("#combo-view") as HTMLElement).hidden = m !== "combo";
  (el("#game-view") as HTMLElement).hidden = m !== "game";
  (el("#review-view") as HTMLElement).hidden = m !== "review";
  (el("#school-view") as HTMLElement).hidden = m !== "school";
  if (m === "review") review?.show();
  if (m === "school") school?.show();
  for (const b of document.querySelectorAll<HTMLElement>(".mode-btn")) {
    b.classList.toggle("active", b.dataset.mode === m);
  }
  // the draft band (both teams, enemy items) is shared by Draft and Game: no tab-hopping in a match
  const band = document.querySelector<HTMLElement>("#counter-view > .band, #game-view > .band");
  if (band) {
    const host = m === "game" ? el("#game-view") : el("#counter-view");
    if (band.parentElement !== host) host.insertBefore(band, host.firstChild);
    band.classList.toggle("in-game", m === "game");
  }
  if (m === "game") game?.start();
}

// ---------------------------------------------------------------------------
//  Game tab (ADR-026): clock + map-event timers
// ---------------------------------------------------------------------------

let game: GameView | undefined;
let review: ReviewView | undefined;
let reviewIds: Ids | undefined;
let reviewBench: Benchmarks | undefined;

let school: SchoolView | undefined;
/** School tab (ADR-046): lessons, tests, situations from the KB, practice on your reviews. */
function buildSchoolView(): void {
  school = new SchoolView({
    modules: [FOUNDATIONS, ROLES, DRAFTING],
    gen: () =>
      kb
        ? {
            resolve: (d) => resolveDraft(kb, d),
            heroes: grid.map((g) => g.engineId).filter((id) => kb.taxonomy.hero_tags[id]),
            items: kb.items.filter((i) => Object.keys(i.tool).length).map((i) => i.code),
            heroLabel: labelFor,
            kb,
            ...(itemStats ? { stats: itemStats } : {}),
            itemLabel: (id) => kb.items.find((i) => i.code === id)?.label || id.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
            why: (rec) => {
              const r = leadReason(rec);
              const div = document.createElement("div");
              div.innerHTML = r ? reasonSummaryText(r, rec) : "";
              return div.textContent || "the strongest answer by the knowledge base";
            },
          }
        : undefined,
    reviews: () => {
      const me = loadSettings().account;
      return loadHistory().filter((r) => !me || r.account === me);
    },
  });
}

function buildReviewView(): void {
  review = new ReviewView({
    ctx: () =>
      reviewIds
        ? { kb, ids: reviewIds, label: labelFor, ...(itemStats ? { stats: itemStats } : {}), ...(reviewBench ? { bench: reviewBench } : {}) }
        : undefined,
    heroLabel: labelFor,
    heroImg: (code) => heroImageUrlByValve(byEngineId.get(code)?.valve ?? heroValveName(code)),
    heroOf: (id) => reviewIds?.heroes[String(id)] ?? `hero_${id}`,
  });
}
/** where the draft win rates come from (data/matchups.json). */

/** Game tab, right column: the plan for the hero you play vs this draft. */
function renderGamePlan(result: ReturnType<typeof resolveDraft>): void {
  if (!game) return;
  const hero = state.myHero;
  const archetype = hero ? archetypeOf(kb, hero, state.role) : undefined;
  const counters = [...result.items, ...result.defense].sort((a, b) => b.score - a.score);
  const plan =
    hero && itemStats
      ? buildPlan({
          hero,
          ...(archetype ? { archetype } : {}),
          ...(state.role ? { role: state.role } : {}),
          stats: itemStats,
          counters,
          dcKey: (id) => kb.itemDcKey?.[id],
          allies: [...state.allies].filter((h) => h !== hero),
        })
      : undefined;
  const window = itemStats && state.allies.size && state.enemies.size ? teamWindow(itemStats, [...state.allies], [...state.enemies]) : undefined;
  const prompt = hudPrompt();
  const plainReason = (rec: Recommendation, r: Reason | undefined) => {
    if (!r) return "";
    // reasonSummaryText is markup for the cards; the plan wants plain text, one sentence
    const tmp = document.createElement("div");
    tmp.innerHTML = reasonSummaryText(r, rec);
    return firstSentence(tmp.textContent ?? "");
  };
  const view: PlanView = {
    ...(prompt ? { prompt } : {}),
    ...(myItems ? { have: myItems } : {}),
    ...(plan ? { plan } : {}),
    ...(window ? { window } : {}),
    empty: !itemStats
      ? "No item statistics in this build."
      : !hero
        ? "Mark the hero you play (★ on your team in Draft) to get an item plan."
        : `No statistics for ${labelFor(hero)} yet.`,
    heroLabel: labelFor,
    reasonText: (rec) => plainReason(rec, leadReason(rec)),
    reasonFor: (rec, enemy) =>
      plainReason(
        rec,
        rec.reasons.filter((x) => x.enemy === enemy && x.contribution > 0).sort((a, b) => b.contribution - a.contribution)[0],
      ),
    ...(itemStats ? { source: planSource(itemStats) } : {}),
  };
  const match = state.enemies.size
    ? buildMatchPlan({
        kb,
        result,
        enemies: [...state.enemies],
        allies: [...state.allies],
        ...(hero ? { myHero: hero } : {}),
        ...(plan ? { plan } : {}),
        ...(window ? { window } : {}),
        enemyItems: state.enemyItems,
        label: labelFor,
        itemLabel: (id) => itemLabels.get(id) ?? id,
        dcKey: (id) => kb.itemDcKey?.[id],
      })
    : undefined;
  game.setData({ view, ...(match ? { match } : {}) });
}
/** the first sentence, at most ~150 characters (wiki notes run long). */
function firstSentence(s: string): string {
  const cut = s.search(/[.;]\s|\s-\s/);
  const one = cut > 30 ? s.slice(0, cut) : s;
  return one.length > 150 ? `${one.slice(0, 147).replace(/\s+\S*$/, "")}…` : one;
}
function planSource(s: ItemStats): string {
  return [
    !s.posFrom && s.phasesFrom && `Builds: ${s.phasesFrom}.`,
    !s.posFrom && s.timingsFrom && `Timings: ${s.timingsFrom}.`,
    s.curveFrom && `Windows: ${s.curveFrom}; correlation with game length, not a cause.`,
    s.posFetchedAt && `STRATZ, ${s.posFetchedAt.slice(0, 10)}.`,
    s.fetchedAt && `OpenDota, ${s.fetchedAt.slice(0, 10)}.`,
  ]
    .filter(Boolean)
    .join(" ");
}
function buildGameView(): void {
  game = new GameView({
    timings: () => kb.timings,
    role: () => state.role,
    setRole: (r) => {
      state.role = r;
      render();
    },
    playing: () => (state.myHero ? `Playing ${labelFor(state.myHero)}` : undefined),
    show: () => setMode("game"),
    visible: () => mode === "game",
  });
  setClockSink((c) => game?.onClock(c));
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
  setComboSearch(comboSearch === label.toLowerCase() ? "" : label.toLowerCase());
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


// ---------------------------------------------------------------------------
//  Reactive render
// ---------------------------------------------------------------------------

function renderAll(): void {
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
  // the hero you play: items it practically never builds sink (STRATZ purchase shares, ADR-027b)
  if (state.myHero && itemStats?.heroes[state.myHero]?.buy) {
    const buy = itemStats.heroes[state.myHero]!.buy;
    for (const list of [result.items, result.defense]) {
      for (const r of list) {
        const key = kb.itemDcKey?.[r.code] ?? r.code;
        const f = heroBuyFit(buy, key);
        if (f < 1) {
          r.score *= f;
          r.rareOnHero = buy?.[key] ?? 0;
        }
      }
      list.sort((a, b) => b.score - a.score);
    }
  }

  renderGamePlan(result);
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
  if (state.activeTab !== "heroes" && recs.length) {
    // counter items answer the draft; they are not a build order (ADR-026)
    const hint = document.createElement("p");
    hint.className = "plan-hint";
    hint.append("Answers to this draft, not a build order: they come after your standard lane items. ");
    const go = document.createElement("button");
    go.type = "button";
    go.className = "link";
    go.textContent = "Item plan with timings →";
    go.addEventListener("click", () => setMode("game"));
    hint.append(go);
    panel.appendChild(hint);
  }
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
        setAssignSlot(active ? undefined : unk);
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
        if (mode === "game") setMode("counter"); // the hero grid is on Draft
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
    // in a match (Game tab) a click must not drop a hero by accident: removing is on Draft
    slot.addEventListener("click", () => mode !== "game" && toggleHero(id));

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
//  helpers
// ---------------------------------------------------------------------------

void boot();
