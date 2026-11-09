// =============================================================================
//  Enemy items (ADR-024) and the bottom-HUD inventory reader (ADR-025).
//  Split out of main.ts (ADR-040).
// =============================================================================

import { type HudRead, type LearnedPlate, identifyPlate } from "../item-match.js";
import { MAX_TEAM, byEngineId, esc, kb, labelFor, render, state } from "./app.js";
import { heroImageUrlByValve, heroValveName } from "./hero-art.js";

// ---------------------------------------------------------------------------
//  Enemy items (ADR-024): manual chips under each enemy slot; the Tab-scoreboard
//  reader fills the same state.
// ---------------------------------------------------------------------------

/** our item id <-> display label, for every item the engine knows something about. */
export let itemLabels = new Map<string, string>();
export function buildItemLabels(): void {
  itemLabels = new Map();
  for (const i of kb.items) itemLabels.set(i.code, i.label);
  for (const d of kb.defenseEdges) if (!itemLabels.has(d.item)) itemLabels.set(d.item, d.label);
  for (const [id, t] of Object.entries(kb.itemTraits ?? {})) itemLabels.set(id, t.label);
  const list = document.querySelector<HTMLDataListElement>("#item-list");
  if (list) {
    list.innerHTML = [...itemLabels.values()].sort().map((l) => `<option value="${esc(l)}"></option>`).join("");
  }
}
export const itemIdByLabel = (label: string) => {
  const want = label.trim().toLowerCase();
  for (const [id, l] of itemLabels) if (l.toLowerCase() === want) return id;
  return undefined;
};

export let itemInputFor: string | undefined;
export function renderEnemyItems(): void {
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

export const PLATES_KEY = "dotaapp.hudPlates.v1";
export const PLATES_PER_HERO = 3;
export interface PlateRow { hero: string; vec: number[] }
export let plateRows: PlateRow[] = (() => {
  try {
    return JSON.parse(localStorage.getItem(PLATES_KEY) ?? "[]") as PlateRow[];
  } catch {
    return [];
  }
})();
export const learnedPlates = (): LearnedPlate[] => plateRows.map((r) => ({ hero: r.hero, vec: Float32Array.from(r.vec) }));
/** a HUD read whose hero is not known yet - the UI asks "whose items?". */
export let pendingHud: HudRead | undefined;

export function learnPlate(hero: string, vec: Float32Array): void {
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
export function ourItemId(dcKey: string): string | undefined {
  const inv = Object.entries(kb.itemDcKey ?? {}).find(([, dc]) => dc === dcKey)?.[0];
  const id = inv ?? dcKey;
  return itemLabels.has(id) ? id : undefined;
}

export function onHudInventory(r: HudRead): void {
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

/** your own inventory (dotaconstants keys) as last read from the bottom HUD. */
export let myItems: Set<string> | undefined;
export function setMyItems(v: Set<string> | undefined): void {
  myItems = v;
}

export function applyHud(hero: string, r: HudRead): void {
  if (pendingHud === r) pendingHud = undefined;
  if (hero === state.myHero) myItems = new Set(r.items);
  if (state.enemies.has(hero)) {
    // a fresh look replaces what we knew (items get sold, upgraded, consumed)
    const ids = [...new Set(r.items.map(ourItemId).filter((x): x is string => !!x))];
    if (ids.length) state.enemyItems.set(hero, ids);
    else state.enemyItems.delete(hero);
  }
  render();
}

export function hudPrompt(): HTMLElement | undefined {
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

export function setEnemyItems(hero: string, items: string[]): void {
  if (items.length) state.enemyItems.set(hero, items);
  else state.enemyItems.delete(hero);
  render();
}

