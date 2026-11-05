// =============================================================================
//  Review tab (ADR-029): your recent matches from STRATZ -> "Analyse" -> plan vs
//  fact, farm vs Crusader-Ancient, deaths, map & role, execution checks, the top
//  growth areas; trends over the reviewed matches. Token + history stay local.
// =============================================================================

import { mmss } from "../item-plan.js";
import { reviewMatch, trends, type Finding, type MatchReview, type ReviewContext } from "../review.js";
import {
  accountFromToken,
  loadHistory,
  loadSettings,
  saveReview,
  saveSettings,
  StratzClient,
  StratzError,
  type RecentMatch,
  type StratzSettings,
} from "./stratz-client.js";

export interface ReviewDeps {
  ctx: () => ReviewContext | undefined;
  heroLabel: (code: string) => string;
  heroImg: (code: string) => string;
  heroOf: (id: number) => string;
}

const AREA_LABEL: Record<Finding["area"], string> = {
  plan: "Plan",
  farm: "Farm & lane",
  deaths: "Deaths",
  map: "Map & role",
  execution: "Execution",
};

export class ReviewView {
  private root: HTMLElement;
  private settings: StratzSettings = loadSettings();
  private recent: RecentMatch[] = [];
  private history: MatchReview[] = loadHistory();
  private current?: MatchReview;
  private status = "";
  private busy = false;

  constructor(private readonly d: ReviewDeps) {
    this.root = document.querySelector<HTMLElement>("#review-view")!;
  }

  show(): void {
    this.render();
    if (this.settings.token && !this.recent.length && !this.busy) void this.loadRecent();
  }

  private client(): StratzClient {
    return new StratzClient(this.settings);
  }

  private async loadRecent(): Promise<void> {
    if (!this.settings.account) return;
    this.busy = true;
    this.status = "Loading your matches…";
    this.render();
    try {
      this.recent = await this.client().recent(20);
      this.status = this.recent.length ? "" : "No matches found for this account (is \"Expose Public Match Data\" on?).";
    } catch (e) {
      this.status = errText(e);
    }
    this.busy = false;
    this.render();
  }

  private async analyse(id: number): Promise<void> {
    const ctx = this.d.ctx();
    if (!ctx || !this.settings.account) return;
    this.busy = true;
    this.status = `Reading match ${id} from STRATZ (3-4 requests)…`;
    this.render();
    try {
      const data = await this.client().match(id);
      const r = reviewMatch(data, this.settings.account, ctx);
      this.current = r;
      this.history = saveReview(r);
      this.status = "";
    } catch (e) {
      this.status = errText(e);
    }
    this.busy = false;
    this.render();
  }

  // ------------------------------------------------------------- render ----

  render(): void {
    const root = this.root;
    root.replaceChildren();
    const wrap = el("section", "rv");
    const left = el("aside", "rv-side");
    const main = el("main", "rv-main");
    left.append(this.settingsCard(), this.matchList());
    if (this.status) main.append(el("p", "rv-status", this.status));
    if (this.current) main.append(this.report(this.current));
    else main.append(this.trendsCard() ?? el("p", "muted", "Pick a match on the left and press Analyse."));
    if (this.current && this.history.length >= 3) main.append(this.trendsCard()!);
    wrap.append(left, main);
    root.append(wrap);
  }

  private settingsCard(): HTMLElement {
    const c = card("STRATZ");
    const s = this.settings;
    const tok = document.createElement("input");
    tok.type = "password";
    tok.placeholder = "STRATZ API token";
    tok.value = s.token ?? "";
    tok.autocomplete = "off";
    tok.className = "rv-in";
    const acc = document.createElement("input");
    acc.type = "text";
    acc.inputMode = "numeric";
    acc.placeholder = "Steam account id";
    acc.value = s.account ? String(s.account) : "";
    acc.className = "rv-in";
    const save = el("button", "g-btn", "Save & load matches") as HTMLButtonElement;
    save.type = "button";
    save.addEventListener("click", () => {
      const token = tok.value.trim();
      const account = Number(acc.value.trim()) || accountFromToken(token);
      this.settings = { ...(token ? { token } : {}), ...(account ? { account } : {}) };
      saveSettings(this.settings);
      this.recent = [];
      void this.loadRecent();
    });
    tok.addEventListener("change", () => {
      if (!acc.value) {
        const a = accountFromToken(tok.value.trim());
        if (a) acc.value = String(a);
      }
    });
    c.append(tok, acc, save);
    c.append(el("p", "rv-note", "Needs the local companion running (npm run companion): STRATZ does not accept calls from a web page. Token and history stay in this browser; get a token at stratz.com/api."));
    return c;
  }

  private matchList(): HTMLElement {
    const c = card("Recent matches");
    if (!this.recent.length) {
      c.append(el("p", "muted", this.settings.token ? (this.busy ? "Loading…" : "No matches loaded.") : "Save your token first."));
      return c;
    }
    const reviewed = new Set(this.history.map((r) => r.matchId));
    const ul = el("ul", "rv-list");
    for (const m of this.recent) {
      const p = m.players?.[0];
      const hero = p ? this.d.heroOf(p.heroId) : "";
      const li = el("li", `rv-m${p?.isVictory ? " win" : " loss"}${this.current?.matchId === m.id ? " on" : ""}`);
      const img = document.createElement("img");
      img.src = this.d.heroImg(hero);
      img.alt = "";
      li.append(img);
      const info = el("span", "rv-mi", "");
      info.append(el("b", "", this.d.heroLabel(hero)), el("span", "muted", ` ${p ? `${p.kills}/${p.deaths}/${p.assists}` : ""} · ${modeLabel(m)} · ${m.durationSeconds ? mmss(m.durationSeconds) : ""}`));
      li.append(info);
      const b = el("button", "g-btn", reviewed.has(m.id) ? "Open" : "Analyse") as HTMLButtonElement;
      b.type = "button";
      b.disabled = this.busy || !m.parsedDateTime;
      if (!m.parsedDateTime) b.title = "STRATZ has not parsed this match yet - try again in a few minutes";
      b.addEventListener("click", () => {
        const old = this.history.find((r) => r.matchId === m.id);
        if (old) {
          this.current = old;
          this.render();
        } else void this.analyse(m.id);
      });
      li.append(b);
      ul.append(li);
    }
    c.append(ul);
    return c;
  }

  private report(r: MatchReview): HTMLElement {
    const box = el("div", "rv-report");
    const head = el("div", "rv-head");
    const img = document.createElement("img");
    img.src = this.d.heroImg(r.hero);
    img.alt = "";
    head.append(img);
    const t = el("div", "", "");
    t.append(el("h2", "", `${this.d.heroLabel(r.hero)}${r.position ? ` · position ${r.position}` : ""}`));
    t.append(el("p", "muted", `${r.won ? "Won" : "Lost"} · ${r.kda.join("/")} · ${mmss(r.duration)} · ${r.mode}${r.comparable ? "" : " - timings and averages are from ranked games, not comparable"}`));
    head.append(t);
    box.append(head);

    const g = card("Growth areas");
    if (!r.growth.length) g.append(el("p", "muted", "Nothing stood out against the checks in this match."));
    for (const f of r.growth) g.append(findingRow(f));
    box.append(g);

    const grid = el("div", "rv-grid");
    grid.append(this.planCard(r), this.farmCard(r));
    box.append(grid);
    box.append(this.deathsCard(r));
    const rest = card("All checks");
    const order: Finding["area"][] = ["plan", "farm", "deaths", "map", "execution"];
    for (const a of order) {
      const fs = r.findings.filter((f) => f.area === a);
      if (!fs.length) continue;
      rest.append(el("div", "plan-ph", AREA_LABEL[a]));
      for (const f of fs) rest.append(findingRow(f, false));
    }
    box.append(rest);
    return box;
  }

  private planCard(r: MatchReview): HTMLElement {
    const c = card("Plan vs fact");
    if (!r.checks.length) {
      c.append(el("p", "muted", "No plan for this hero (no statistics / not in the KB)."));
      return c;
    }
    const tb = el("table", "rv-t");
    tb.append(rowEl(["Item", "Plan", "Actual", ""], true));
    for (const k of r.checks) {
      const v = { fast: "fast", typical: "typical", slow: "late", missing: "not bought", bought: "bought" }[k.verdict];
      const tr = rowEl([k.label, k.phase === "situational" ? "draft" : k.planned !== undefined ? `~${mmss(k.planned)}` : "", k.actual !== undefined ? mmss(k.actual) : "-", v]);
      tr.classList.add(`v-${k.verdict}`);
      tb.append(tr);
    }
    c.append(tb);
    return c;
  }

  private farmCard(r: MatchReview): HTMLElement {
    const c = card("Farm vs Crusader-Ancient average");
    const tb = el("table", "rv-t");
    tb.append(rowEl(["Min", "Last hits", "Networth", "XP"], true));
    const cell = (v?: number, b?: number) => (v === undefined ? "-" : b ? `${Math.round(v)} (${pctDelta(v, b)})` : String(Math.round(v)));
    for (const f of r.farm) {
      const tr = rowEl([String(f.minute), cell(f.cs, f.csBench), cell(f.nw, f.nwBench), cell(f.xp, f.xpBench)]);
      tb.append(tr);
    }
    c.append(tb);
    if (!r.comparable) c.append(el("p", "rv-note", "Turbo: averages are from ranked games."));
    return c;
  }

  private deathsCard(r: MatchReview): HTMLElement {
    const c = card(`Deaths (${r.deaths.length})`);
    if (!r.deaths.length) {
      c.append(el("p", "muted", "No deaths."));
      return c;
    }
    const ul = el("ul", "rv-deaths");
    for (const d of [...r.deaths].sort((a, b) => a.time - b.time)) {
      const li = el("li", "", "");
      li.append(el("b", "", mmss(d.time)));
      const chips = el("span", "rv-chips", "");
      if (d.inEnemyWindow) chips.append(el("i", "bad", "their window"));
      if (d.alone) chips.append(el("i", "bad", "alone"));
      for (const k of d.unused) chips.append(el("i", "bad", `${k.replace(/_/g, " ")} ready`));
      for (const f of d.flags) chips.append(el("i", f === "burst" ? "" : "warn", f));
      if (d.unspent >= 1500) chips.append(el("i", "warn", `${d.unspent} gold unspent`));
      li.append(chips);
      ul.append(li);
    }
    c.append(ul);
    return c;
  }

  private trendsCard(): HTMLElement | undefined {
    if (this.history.length < 3) return undefined;
    const t = trends(this.history);
    const c = card(`Trends · last ${t.n} reviewed matches`);
    if (!t.recurring.length) c.append(el("p", "muted", "No problem recurs in 30%+ of the reviewed matches."));
    for (const x of t.recurring) {
      const row = el("div", "rv-trend", "");
      const bar = el("span", "rv-bar", "");
      const fill = el("i", "", "");
      fill.style.width = `${Math.round(x.share * 100)}%`;
      bar.append(fill);
      row.append(el("b", "", x.title), bar, el("span", "muted", `${x.matches} of ${t.n} · e.g. ${x.example}`));
      c.append(row);
    }
    if (t.strengths.length) {
      c.append(el("div", "plan-ph", "Strengths"));
      for (const x of t.strengths) c.append(el("p", "rv-good", `${x.title} - ${x.matches} of ${t.n}`));
    }
    return c;
  }
}

function findingRow(f: Finding, area = true): HTMLElement {
  const r = el("div", `rv-f${f.good ? " good" : ""}${area ? "" : " flat"}`, "");
  if (area) r.append(el("span", "rv-area", AREA_LABEL[f.area]));
  r.append(el("b", "", f.title));
  const det = el("span", "rv-det", f.detail);
  if (f.times?.length) det.append(el("span", "muted", ` (${f.times.map(mmss).join(", ")})`));
  r.append(det);
  return r;
}

function modeLabel(m: RecentMatch): string {
  const g = (m.gameMode ?? "").toUpperCase();
  const l = (m.lobbyType ?? "").toUpperCase();
  if (g.includes("TURBO")) return "turbo";
  if (l.includes("UNRANKED")) return "normal"; // contains "RANKED"
  return l.includes("RANKED") ? "ranked" : "normal";
}
function pctDelta(v: number, b: number): string {
  const d = Math.round((v / b - 1) * 100);
  return `${d >= 0 ? "+" : ""}${d}%`;
}
function errText(e: unknown): string {
  if (e instanceof StratzError) {
    if (e.kind === "network") return `${e.message}. Start it in the app folder: npm run companion`;
    return e.message;
  }
  return String(e);
}
function el(tag: string, cls: string, text = ""): HTMLElement {
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
function rowEl(cells: string[], head = false): HTMLElement {
  const tr = document.createElement("tr");
  for (const c of cells) tr.append(el(head ? "th" : "td", "", c));
  return tr;
}
