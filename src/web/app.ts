// =============================================================================
//  Shared state of the web UI (ADR-040): the draft, the loaded KB and data, the
//  roster lookup, small DOM helpers. Modules read the `let` exports as live
//  bindings; only boot() in main.ts sets them, through the setters below.
// =============================================================================

import { heroLabel } from "../explain.js";
import type { KnowledgeBase } from "../knowledge.js";
import type { ItemStats } from "../item-plan.js";

export type Attr = "str" | "agi" | "int" | "all";
export interface RosterHero {
  valve: string;
  label: string;
  attr: Attr;
}
export interface GridHero extends RosterHero {
  /** id passed to the engine: KB code if tagged, else the valve name (→ honest gap). */
  engineId: string;
  inKB: boolean;
}

export type TabId = "heroes" | "items" | "defense";

export interface UIState {
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


export const state: UIState = {
  enemies: new Set(),
  allies: new Set(),
  addTarget: "enemy",
  showFactors: false,
  search: "",
  activeTab: "heroes",
  enemyItems: new Map(),
};
export let kb: KnowledgeBase;
export let grid: GridHero[] = [];
export const byEngineId = new Map<string, GridHero>();
/** roster valve name -> engineId (screen reading). */
export const byValve = new Map<string, string>();


export let itemStats: ItemStats | undefined;
export let matchupSource = "public matches";
export function setData(d: { kb: KnowledgeBase; grid: GridHero[]; itemStats?: ItemStats; matchupSource?: string }): void {
  kb = d.kb;
  grid = d.grid;
  itemStats = d.itemStats;
  if (d.matchupSource) matchupSource = d.matchupSource;
}

/** a full Dota team is 5 heroes - never let either side grow past that. */
export const MAX_TEAM = 5;

/** display name for an engineId (roster label preferred; falls back to prettified code). */
export function labelFor(id: string): string {
  return byEngineId.get(id)?.label ?? heroLabel(id);
}

/** re-render the whole UI; main.ts installs the real one at boot. */
export let render: () => void = () => {};
export function setRender(f: () => void): void {
  render = f;
}

// ---------------------------------------------------------------------------
//  helpers
// ---------------------------------------------------------------------------

export function el(sel: string): HTMLElement {
  const node = document.querySelector<HTMLElement>(sel);
  if (!node) throw new Error(`missing element ${sel}`);
  return node;
}
export function note(text: string): HTMLElement {
  const d = document.createElement("p");
  d.className = "empty";
  d.textContent = text;
  return d;
}
export function collapse(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}
export function esc(s: string): string {
  return s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]!);
}

