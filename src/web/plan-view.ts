// =============================================================================
//  Game tab, right column: item plan + power spikes (ADR-026 phases 2-3).
//  Pure DOM rendering of an ItemPlan / TeamWindow built by src/item-plan.ts.
// =============================================================================

import { CURVE_LABELS, mmss, type ItemPlan, type PlanItem, type TeamWindow } from "../item-plan.js";
import type { Recommendation } from "../types.js";

export interface PlanView {
  plan?: ItemPlan;
  window?: TeamWindow;
  /** why there is no plan (no hero, no data...). */
  empty?: string;
  heroLabel: (code: string) => string;
  /** one-line reason for a counter item (main.ts reasonSummaryText). */
  reasonText: (rec: Recommendation) => string;
  /** data provenance line. */
  source?: string;
  /** items in your inventory (bottom HUD, your hero selected). */
  have?: Set<string>;
  /** "Whose items?" prompt from the HUD reader, shown on top. */
  prompt?: HTMLElement;
}

export function renderPlan(root: HTMLElement, v: PlanView): void {
  root.replaceChildren();
  const h = document.createElement("h3");
  h.className = "game-h";
  h.textContent = v.plan ? `Item plan - ${v.heroLabel(v.plan.hero)}` : "Item plan";
  root.append(h);
  if (v.prompt) root.append(v.prompt);
  if (!v.plan) {
    root.append(p("muted", v.empty ?? "Mark the hero you play (★) in Draft."));
  } else {
    for (const ph of v.plan.phases) {
      if (!ph.items.length) continue;
      const sec = document.createElement("div");
      sec.className = `plan-phase ph-${ph.id}`;
      const t = document.createElement("div");
      t.className = "plan-ph";
      t.textContent = ph.label;
      if (ph.id === "start") t.textContent += ` · ${ph.items.reduce((s, i) => s + i.cost, 0)} gold`;
      sec.append(t);
      const ul = document.createElement("ul");
      ul.className = "plan-items";
      for (const it of ph.items) ul.append(itemRow(it, ph.id, v));
      sec.append(ul);
      root.append(sec);
    }
  }
  if (v.window) root.append(windowBlock(v.window, v.heroLabel));
  if (v.plan?.spikes.length) {
    const s = document.createElement("div");
    s.className = "plan-phase";
    s.append(div("plan-ph", "Item timings"));
    const ul = document.createElement("ul");
    ul.className = "plan-spikes";
    for (const sp of v.plan.spikes) {
      const li = document.createElement("li");
      li.dataset.at = String(sp.at);
      li.append(span("sp-at", mmss(sp.at)), span("sp-what", sp.label), span("sp-why", sp.why));
      ul.append(li);
    }
    s.append(ul);
    root.append(s);
  }
  if (v.source) root.append(p("muted plan-src", v.source));
}

function itemRow(it: PlanItem, phase: string, v: PlanView): HTMLElement {
  const li = document.createElement("li");
  li.className = `plan-item k-${it.kind}${v.have?.has(it.key) ? " have" : ""}`;
  if (it.at !== undefined && phase !== "start") li.dataset.at = String(it.at);
  const img = document.createElement("img");
  img.src = `./items/${it.key}.webp`;
  img.alt = "";
  img.width = 33;
  img.height = 24;
  img.loading = "lazy";
  img.onerror = () => img.remove();
  const name = span("pi-name", it.label);
  const meta = span("pi-meta", [it.cost ? `${it.cost}` : "", it.at !== undefined && phase !== "start" ? `~${mmss(it.at)}` : ""].filter(Boolean).join(" · "));
  li.append(img, name, meta);
  if (it.kind !== "standard" && it.counter) {
    const why = span("pi-why", `${it.kind === "both" ? "also " : ""}${v.reasonText(it.counter)}`);
    li.append(why);
  }
  if (it.place) li.append(span("pi-place", it.place));
  if (it.timing?.wrFast !== undefined && it.timing.wrSlow !== undefined && phase === "core") {
    li.title = `done by ${mmss(it.timing.fastBy ?? it.timing.p25)}: ${(it.timing.wrFast * 100).toFixed(0)}% wins · after ${mmss(it.timing.slowAfter ?? it.timing.p75)}: ${(it.timing.wrSlow * 100).toFixed(0)}% · ${it.timing.games} games`;
  }
  return li;
}

function windowBlock(w: TeamWindow, heroLabel: (c: string) => string): HTMLElement {
  const box = document.createElement("div");
  box.className = "plan-phase plan-window";
  box.append(div("plan-ph", "Power windows (heuristic)"));
  const bars = document.createElement("div");
  bars.className = "win-bars";
  const max = Math.max(3, ...w.diff.map((d) => Math.abs(d)));
  w.diff.forEach((d, i) => {
    const col = document.createElement("div");
    col.className = `win-col ${d >= 0 ? "ours" : "theirs"}`;
    const bar = document.createElement("div");
    bar.className = "win-bar";
    bar.style.setProperty("--h", `${Math.round((Math.abs(d) / max) * 100)}%`);
    col.append(span("win-v", `${d >= 0 ? "+" : ""}${d.toFixed(1)}`), bar, span("win-l", CURVE_LABELS[i]!));
    const top = w.drivers[i]!.slice(0, 3).map((x) => `${x.side === "ally" ? "" : "enemy "}${heroLabel(x.hero)} ${x.pp >= 0 ? "+" : ""}${x.pp.toFixed(1)}`);
    col.title = `win rate vs own average, pp: ${top.join(", ")}`;
    bars.append(col);
  });
  box.append(bars);
  box.append(p("win-text", windowText(w, heroLabel)));
  return box;
}

/** the sentence under the bars: where we are stronger, where they are, and why. */
export function windowText(w: TeamWindow, heroLabel: (c: string) => string): string {
  const best = w.diff.indexOf(Math.max(...w.diff));
  const worst = w.diff.indexOf(Math.min(...w.diff));
  const who = (i: number, side: "ally" | "enemy", sign: 1 | -1) =>
    w.drivers[i]!
      .filter((x) => x.side === side && x.pp * sign > 0.5)
      .slice(0, 2)
      .map((x) => `${heroLabel(x.hero)} ${x.pp >= 0 ? "+" : ""}${x.pp.toFixed(1)}`)
      .join(", ");
  const parts: string[] = [];
  if (w.diff[best]! > 0.5) {
    const ours = who(best, "ally", 1);
    parts.push(`Your window: ${CURVE_LABELS[best]} (+${w.diff[best]!.toFixed(1)} pp)${ours ? ` - ${ours}` : ""}.`);
  }
  if (w.diff[worst]! < -0.5) {
    const theirs = who(worst, "enemy", 1);
    parts.push(`They are stronger ${CURVE_LABELS[worst]} (${w.diff[worst]!.toFixed(1)} pp)${theirs ? ` - ${theirs}` : ""}.`);
  }
  if (!parts.length) parts.push("No clear timing edge either way.");
  if (w.missing.length) parts.push(`No data: ${w.missing.map(heroLabel).join(", ")}.`);
  return parts.join(" ");
}

function p(cls: string, text: string): HTMLElement {
  const e = document.createElement("p");
  e.className = cls;
  e.textContent = text;
  return e;
}
function div(cls: string, text: string): HTMLElement {
  const e = document.createElement("div");
  e.className = cls;
  e.textContent = text;
  return e;
}
function span(cls: string, text: string): HTMLElement {
  const e = document.createElement("span");
  e.className = cls;
  e.textContent = text;
  return e;
}
