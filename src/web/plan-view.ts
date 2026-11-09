// =============================================================================
//  Game tab rendering (ADR-028): the "Match plan" zone (right) and the item target /
//  game-length tendency line of the "Now" zone (left). Pure DOM from ItemPlan, TeamWindow and
//  MatchPlan (src/item-plan.ts, src/game-plan.ts).
// =============================================================================

import { CURVE_LABELS, mmss, WINDOW_PP, type ItemPlan, type PlanItem, type TeamWindow } from "../item-plan.js";
import { PHASES, type GamePhase, type MatchPlan } from "../game-plan.js";
import type { Recommendation } from "../types.js";

export interface PlanView {
  plan?: ItemPlan;
  window?: TeamWindow;
  /** why there is no plan (no hero, no data...). */
  empty?: string;
  heroLabel: (code: string) => string;
  /** one-line reason for a counter item (main.ts reasonSummaryText). */
  reasonText: (rec: Recommendation) => string;
  /** the reason of `rec` that concerns one enemy (threat rows). */
  reasonFor?: (rec: Recommendation, enemy: string) => string;
  /** data provenance line. */
  source?: string;
  /** items in your inventory (bottom HUD, your hero selected). */
  have?: Set<string>;
  /** "Whose items?" prompt from the HUD reader, shown on top. */
  prompt?: HTMLElement;
}

export interface ZoneData {
  view: PlanView;
  match?: MatchPlan;
}

export interface PlanZone extends ZoneData {
  phase: GamePhase;
  /** the phase follows the clock (no manual pick). */
  auto: boolean;
  onPhase: (p: GamePhase) => void;
}

/** right column: phase switcher, phase focus, damage, threats, item plan, other phases. */
export function renderPlanZone(root: HTMLElement, z: PlanZone): void {
  const v = z.view;
  root.replaceChildren();
  if (v.prompt) root.append(v.prompt);
  const chips = document.createElement("div");
  chips.className = "gz-phases";
  for (const ph of PHASES) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = `gz-ph${ph.id === z.phase ? " on" : ""}`;
    b.textContent = ph.label + (ph.id === z.phase && z.auto ? " ●" : "");
    b.title = ph.id === z.phase && z.auto ? "Follows the game clock" : "Show this phase (click the current one to follow the clock again)";
    b.addEventListener("click", () => z.onPhase(ph.id));
    chips.append(b);
  }
  root.append(chips);
  const m = z.match;
  if (m) {
    const f = m.focus[z.phase];
    const box = document.createElement("div");
    box.className = "gz-focus";
    box.append(el("h3", "", f.title));
    const ul = document.createElement("ul");
    for (const line of f.lines) ul.append(el("li", "", line));
    if (!f.lines.length) ul.append(el("li", "muted", "Add both teams in Draft for a fuller read."));
    box.append(ul);
    root.append(box);
    const grid = document.createElement("div");
    grid.className = "gz-grid";
    grid.append(damageCard(m, v), threatCard(m, v));
    root.append(grid);
  }
  root.append(itemCard(v));
  if (m) {
    for (const ph of PHASES) {
      if (ph.id === z.phase) continue;
      const f = m.focus[ph.id];
      const b = document.createElement("button");
      b.type = "button";
      b.className = "gz-later";
      b.textContent = `▸ ${ph.label}: ${f.title}${f.lines[0] ? ` - ${f.lines[0]}` : ""}`;
      b.addEventListener("click", () => z.onPhase(ph.id));
      root.append(b);
    }
  }
  if (v.plan?.basis) root.append(p("muted plan-src", `Standard items: ${v.plan.basis}.`));
  if (v.source) root.append(p("muted plan-src", v.source));
}

function damageCard(m: MatchPlan, v: PlanView): HTMLElement {
  const c = card("Damage & defence");
  const bar = document.createElement("div");
  bar.className = "gz-dmg";
  const mag = Math.round(m.damage.magic * 100);
  bar.append(el("i", "mag", ""), el("i", "phy", ""));
  (bar.children[0] as HTMLElement).style.width = `${mag}%`;
  (bar.children[1] as HTMLElement).style.width = `${100 - mag}%`;
  c.append(bar);
  const who = (xs: string[]) => (xs.length ? ` (${xs.map(v.heroLabel).join(", ")})` : "");
  c.append(p("gz-sub", `${mag}% magic${who(m.damage.magicBy)} · ${100 - mag}% physical${who(m.damage.physBy)}`));
  for (const d of m.defence) c.append(row(d.key, d.rec.label, v.reasonText(d.rec)));
  if (!m.defence.length) c.append(p("muted", "No defensive item stands out against this lineup."));
  return c;
}

function threatCard(m: MatchPlan, v: PlanView): HTMLElement {
  const c = card("Threats & answers");
  for (const t of m.threats) {
    const r = document.createElement("div");
    r.className = "gz-row";
    r.append(el("span", "gz-w", v.heroLabel(t.enemy)));
    const a = el("span", "gz-a", t.tools.join(", ").toLowerCase());
    if (t.answer) {
      a.append(" → ");
      a.append(el("b", "", t.answer.rec.label));
      const why = v.reasonFor?.(t.answer.rec, t.enemy);
      if (why) a.append(`: ${why}`);
    }
    r.append(a);
    c.append(r);
  }
  if (!m.threats.length) c.append(p("muted", "Add the enemy heroes in Draft."));
  return c;
}

function itemCard(v: PlanView): HTMLElement {
  const c = card(v.plan ? `Item plan - ${v.heroLabel(v.plan.hero)}` : "Item plan");
  if (!v.plan) {
    c.append(p("muted", v.empty ?? "Mark the hero you play (★) in Draft."));
    return c;
  }
  const cols = document.createElement("div");
  cols.className = "gz-cols";
  const group = (ids: string[]) => {
    const col = document.createElement("div");
    for (const id of ids) {
      const ph = v.plan!.phases.find((x) => x.id === id);
      if (!ph?.items.length) continue;
      const head = ph.id === "start" ? `${ph.label} · ${ph.items.reduce((s, i) => s + i.cost, 0)} gold` : ph.label;
      col.append(el("div", "plan-ph", head));
      const ul = document.createElement("ul");
      ul.className = "plan-items";
      for (const it of ph.items) ul.append(itemRow(it, ph.id, v));
      col.append(ul);
    }
    return col;
  };
  cols.append(group(["start", "lane"]), group(["core", "situational"]), group(["late"]));
  c.append(cols);
  return c;
}

/** left column: the next item to finish, with what its timing is worth. */
export function renderTarget(root: HTMLElement, plan: ItemPlan | undefined, have: Set<string> | undefined, t: number | undefined): void {
  root.replaceChildren();
  if (!plan) {
    root.append(p("muted", "Mark the hero you play (★) in Draft."));
    return;
  }
  const seq = ["lane", "core", "late"].flatMap((id) => plan.phases.find((x) => x.id === id)?.items ?? []);
  const draft = plan.phases.find((x) => x.id === "situational")?.items ?? [];
  // with your inventory: the first item you don't have; without it: by the clock
  const i = have?.size
    ? seq.findIndex((x) => !have.has(x.key))
    : seq.findIndex((x) => t === undefined || x.at === undefined || x.at >= t - 120);
  const cur = seq[i >= 0 ? i : seq.length - 1];
  if (!cur) return;
  const box = document.createElement("div");
  box.className = "gz-tcard";
  const img = document.createElement("img");
  img.src = `./items/${cur.key}.webp`;
  img.alt = "";
  img.onerror = () => img.remove();
  box.append(img, el("span", "gz-tt", `${cur.label}${cur.at !== undefined ? ` · ~${mmss(cur.at)}` : ""}`));
  const tm = cur.timing;
  const k = el("span", "gz-tk", "");
  if (tm?.wrFast !== undefined && tm.wrSlow !== undefined && tm.wrFast > tm.wrSlow) {
    k.append(`done by ${mmss(tm.fastBy ?? tm.p25)}: `, el("b", "good", pct(tm.wrFast)), ` wins · after ${mmss(tm.slowAfter ?? tm.p75)}: `, el("b", "bad", pct(tm.wrSlow)));
    k.title = "Fast buyers are usually also the ones ahead in gold: the gap is a link, not the effect of the item alone (ADR-037).";
  } else if (cur.via?.length) k.append(`via ${cur.via.join(", ")}`);
  box.append(k);
  if (cur.at !== undefined && t !== undefined && t > 0) {
    const bar = el("div", "gz-tbar", "");
    const fill = el("i", "", "");
    fill.style.width = `${Math.min(100, Math.round((t / cur.at) * 100))}%`;
    if (t > cur.at) bar.classList.add("late");
    bar.append(fill);
    box.append(bar);
  }
  root.append(box);
  const nextCore = plan.phases.find((x) => x.id === "core")?.items ?? [];
  const after = [...(cur === nextCore[0] ? draft.slice(0, 1) : []), ...seq.slice((i >= 0 ? i : seq.length) + 1)]
    .filter((x) => !have?.has(x.key))
    .slice(0, 2)
    .map((x) => `${x.label}${x.at !== undefined && x.kind !== "counter" ? ` ~${mmss(x.at)}` : ""}`);
  if (after.length) root.append(p("gz-sub", `then ${after.join(" → ")}`));
}

/** left column: the four game-length bins on a 0-50 min line, a marker at now. */
export function renderWindowLine(root: HTMLElement, w: TeamWindow | undefined, t: number | undefined, heroLabel: (c: string) => string): void {
  root.replaceChildren();
  if (!w) {
    root.append(p("muted", "Add both teams in Draft."));
    return;
  }
  const line = el("div", "gz-line", "");
  const edges = [0, 25, 35, 45, 50];
  w.diff.forEach((d, i) => {
    const seg = el("i", d > WINDOW_PP ? "ours" : d < -WINDOW_PP ? "theirs" : "even", "");
    seg.style.left = `${(edges[i]! / 50) * 100}%`;
    seg.style.width = `${((edges[i + 1]! - edges[i]!) / 50) * 100}%`;
    seg.title = `${CURVE_LABELS[i]}: ${d >= 0 ? "+" : ""}${d.toFixed(1)} pp`;
    // how big the gap is: stronger colour for a bigger gap, the number on the segment
    if (Math.abs(d) > WINDOW_PP) seg.style.opacity = String(Math.min(1, 0.4 + Math.abs(d) / 10));
    seg.textContent = `${d >= 0 ? "+" : ""}${d.toFixed(1)}`;
    line.append(seg);
  });
  for (const m of [25, 35, 45]) {
    const lab = el("span", "gz-lab", String(m));
    lab.style.left = `${(m / 50) * 100}%`;
    line.append(lab);
  }
  if (t !== undefined && t >= 0) {
    const mk = el("b", "gz-mark", "");
    mk.style.left = `${Math.min(100, (t / 60 / 50) * 100)}%`;
    line.append(mk);
  }
  root.append(line);
  const min = (t ?? 0) / 60;
  const bin = min < 25 ? 0 : min < 35 ? 1 : min < 45 ? 2 : 3;
  const d = w.diff[bin]!;
  const until = ["25:00", "35:00", "45:00", ""][bin];
  root.append(
    p(
      "gz-sub",
      d > WINDOW_PP
        ? `Games this long tend to go your way (+${d.toFixed(1)} pp${until ? ` until ${until}` : ""})`
        : d < -WINDOW_PP
          ? `Games this long tend to go their way (${d.toFixed(1)} pp${until ? ` until ${until}` : ""})`
          : `No lean by game length${until ? ` (until ${until})` : ""}`,
    ),
  );
  root.title = windowText(w, heroLabel);
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
  const name = span("pi-name", it.qty ? `${it.label} ×${it.qty}` : it.label);
  const meta = span("pi-meta", [it.cost ? `${it.cost}` : "", it.at !== undefined && phase !== "start" ? `~${mmss(it.at)}` : ""].filter(Boolean).join(" · "));
  li.append(img, name, meta);
  if (it.kind !== "standard" && it.counter) {
    const why = span("pi-why", `${it.kind === "both" ? "also " : ""}${v.reasonText(it.counter)}`);
    li.append(why);
  }
  if (it.via?.length) li.append(span("pi-place", `via ${it.via.join(", ")}${it.viaAt !== undefined ? ` (~${mmss(it.viaAt)})` : ""}`));
  if (it.place) li.append(span("pi-place", it.place));
  if (it.coveredBy) li.append(span("pi-place", `${v.heroLabel(it.coveredBy)} usually builds it - agree who buys`));
  if (it.heroShare !== undefined && it.heroShare < 0.05) li.append(span("pi-place", `rare on this hero (${Math.round(it.heroShare * 100)}% of games)`));
  if (it.timing?.wrFast !== undefined && it.timing.wrSlow !== undefined && phase === "core") {
    li.title = `done by ${mmss(it.timing.fastBy ?? it.timing.p25)}: ${(it.timing.wrFast * 100).toFixed(0)}% wins · after ${mmss(it.timing.slowAfter ?? it.timing.p75)}: ${(it.timing.wrSlow * 100).toFixed(0)}% · ${it.timing.games} games`;
  }
  return li;
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
  if (w.diff[best]! > WINDOW_PP) {
    const ours = who(best, "ally", 1);
    parts.push(`Your window: ${CURVE_LABELS[best]} (+${w.diff[best]!.toFixed(1)} pp)${ours ? ` - ${ours}` : ""}.`);
  }
  if (w.diff[worst]! < -WINDOW_PP) {
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

function el(tag: string, cls: string, text: string): HTMLElement {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
}
function card(title: string): HTMLElement {
  const c = el("div", "gz-card", "");
  c.append(el("h4", "", title));
  return c;
}
function row(key: string, label: string, why: string): HTMLElement {
  const r = el("div", "gz-row", "");
  const name = el("span", "gz-i", "");
  const img = document.createElement("img");
  img.src = `./items/${key}.webp`;
  img.alt = "";
  img.onerror = () => img.remove();
  name.append(img, el("b", "", label));
  r.append(name, el("span", "gz-a", why));
  return r;
}
function pct(x: number): string {
  return `${Math.round(x * 100)}%`;
}
