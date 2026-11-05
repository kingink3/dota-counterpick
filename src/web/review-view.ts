// =============================================================================
//  Review tab (ADR-029): your recent matches from STRATZ (or any match by ID) ->
//  pick any player, allies or opponents -> plan vs fact, farm
//  vs Crusader-Ancient, deaths, battles, map & role, execution, the top growth
//  areas; trends over your reviewed matches. Token + history stay local.
// =============================================================================

import { mmss } from "../item-plan.js";
import { reviewMatch, trends, type Finding, type MatchReview, type ReviewContext } from "../review.js";
import type { BattleReport, UseStat } from "../review-battles.js";
import { adviceText, GRADE_LABEL, matchOverview, type MatchOverview, type OverviewRow } from "../review-match.js";
import {
  accountFromToken,
  loadHistory,
  loadSettings,
  openPlayer,
  saveReview,
  saveSettings,
  StratzClient,
  StratzError,
  type MatchBase,
  type RecentMatch,
  type StratzSettings,
} from "./stratz-client.js";

const posOf = (p?: string | null) => Number(/(\d)/.exec(p ?? "")?.[1] ?? 0);

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
  battles: "Battles",
  map: "Map & role",
  execution: "Execution",
};

export class ReviewView {
  private root: HTMLElement;
  private settings: StratzSettings = loadSettings();
  private recent: RecentMatch[] = [];
  private history: MatchReview[] = loadHistory();
  private current?: MatchReview;
  /** the match open in the player switcher: shared data + every player's review so far. */
  private open?: { id: number; base: MatchBase; reviews: Map<number, MatchReview>; loading: Set<number>; failed: Map<number, string> };
  private matchInput = "";
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

  /** your trends: only your own reviews. */
  private mine(): MatchReview[] {
    return this.history.filter((r) => r.account === undefined || r.account === this.settings.account);
  }

  /** from the list: open the match and review you in it. */
  private async analyse(id: number): Promise<void> {
    await this.openMatch(id, this.settings.account);
  }

  /** load what all players share (3 requests), then the player asked for. */
  private async openMatch(id: number, account?: number, known?: MatchReview): Promise<void> {
    if (!this.d.ctx() || !this.settings.token) {
      this.status = "Save your STRATZ token first.";
      this.render();
      return;
    }
    this.busy = true;
    this.status = `Reading match ${id} from STRATZ…`;
    this.render();
    try {
      const base = await this.client().base(id);
      this.open = { id, base, reviews: new Map(), loading: new Set(), failed: new Map() };
      if (known?.account) this.open.reviews.set(known.account, known);
      this.status = "";
      this.busy = false;
      if (known) this.current = known;
      else if (account && base.summary.players.some((p) => p.steamAccountId === account)) await this.selectPlayer(account);
      else this.current = undefined;
    } catch (e) {
      this.status = errText(e);
    }
    this.busy = false;
    this.render();
  }

  /** review one player of the open match (4 requests the first time). */
  private async selectPlayer(account: number, show = true): Promise<void> {
    const o = this.open;
    const ctx = this.d.ctx();
    if (!o || !ctx) return;
    const done = o.reviews.get(account);
    if (done) {
      if (show) this.current = done;
      this.render();
      return;
    }
    if (o.loading.has(account)) return;
    o.loading.add(account);
    o.failed.delete(account);
    this.render();
    try {
      const me = await this.client().player(o.id, account);
      const r = reviewMatch({ ...o.base, me }, account, ctx);
      o.reviews.set(account, r);
      if (account === this.settings.account) this.history = saveReview(r);
      if (show) this.current = r;
    } catch (e) {
      o.failed.set(account, errText(e));
    }
    o.loading.delete(account);
    this.render();
  }

  /** every open player, one after another (4 requests each). */
  private async analyseAll(): Promise<void> {
    const o = this.open;
    if (!o) return;
    for (const p of o.base.summary.players) {
      if (this.open !== o) return; // another match was opened meanwhile
      if (p.steamAccountId && openPlayer(p) && !o.reviews.has(p.steamAccountId)) await this.selectPlayer(p.steamAccountId, false);
    }
  }

  // ------------------------------------------------------------- render ----

  render(): void {
    const root = this.root;
    root.replaceChildren();
    const wrap = el("section", "rv");
    const left = el("aside", "rv-side");
    const main = el("main", "rv-main");
    left.append(this.settingsCard(), this.byIdCard(), this.matchList());
    if (this.status) main.append(el("p", "rv-status", this.status));
    if (this.open) main.append(this.switcher(this.open), this.overviewCard(this.open));
    else if (this.current) main.append(this.otherPlayersButton(this.current));
    if (this.current) main.append(this.report(this.current));
    else if (this.open) main.append(el("p", "muted", "Pick a player above."));
    else main.append(this.trendsCard() ?? el("p", "muted", "Pick a match on the left and press Analyse, or open any match by its ID."));
    if (this.current && (this.current.account === undefined || this.current.account === this.settings.account) && this.mine().length >= 3) main.append(this.trendsCard()!);
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

  private byIdCard(): HTMLElement {
    const c = card("Match by ID");
    const inp = document.createElement("input");
    inp.type = "text";
    inp.inputMode = "numeric";
    inp.placeholder = "e.g. 8123456789";
    inp.className = "rv-in";
    inp.value = this.matchInput;
    const go = el("button", "g-btn", "Open") as HTMLButtonElement;
    go.type = "button";
    go.disabled = this.busy;
    const run = () => {
      const id = Number(inp.value.trim().replace(/\D/g, ""));
      this.matchInput = inp.value;
      if (id > 0) void this.openMatch(id, this.settings.account);
    };
    go.addEventListener("click", run);
    inp.addEventListener("keydown", (e) => {
      if (e.key === "Enter") run();
    });
    c.append(inp, go, el("p", "rv-note", "Any parsed match: pick any player, allies and opponents."));
    return c;
  }

  /** a review from the history, without the match loaded: offer the others. */
  private otherPlayersButton(r: MatchReview): HTMLElement {
    const b = el("button", "g-btn rv-others", "Other players in this match…") as HTMLButtonElement;
    b.type = "button";
    b.disabled = this.busy;
    b.addEventListener("click", () => void this.openMatch(r.matchId, r.account, r));
    return b;
  }

  /** Radiant / Dire rows: a chip per player; private profiles are disabled. */
  private switcher(o: NonNullable<ReviewView["open"]>): HTMLElement {
    const box = el("div", "rv-sw");
    const s = o.base.summary;
    const me = this.settings.account;
    const meP = s.players.find((p) => p.steamAccountId === me);
    for (const radiant of [true, false]) {
      const row = el("div", "rv-sw-row");
      const won = s.didRadiantWin === radiant;
      row.append(el("span", "rv-sw-side", `${radiant ? "Radiant" : "Dire"}${won ? " · won" : ""}${meP ? (meP.isRadiant === radiant ? " · your team" : " · opponents") : ""}`));
      const ps = s.players.filter((p) => p.isRadiant === radiant).sort((a, b) => posOf(a.position) - posOf(b.position));
      for (const p of ps) {
        const acc = p.steamAccountId ?? undefined;
        const ok = openPlayer(p);
        const hero = this.d.heroOf(p.heroId);
        const state = acc && o.loading.has(acc) ? " loading" : acc && o.reviews.has(acc) ? " done" : acc && o.failed.has(acc) ? " failed" : "";
        const b = el("button", `rv-sw-p${ok ? "" : " private"}${this.current?.matchId === o.id && this.current.account === acc ? " on" : ""}${state}`) as HTMLButtonElement;
        b.type = "button";
        b.disabled = !ok || !acc;
        b.title = !ok ? "No Steam id for this player in the match" : (acc && o.failed.get(acc)) || (p.steamAccount?.isAnonymous ? "Private profile - its events are still in the match" : "");
        const img = document.createElement("img");
        img.src = this.d.heroImg(hero);
        img.alt = "";
        const t = el("span", "rv-sw-t", "");
        t.append(el("b", "", this.d.heroLabel(hero)), el("span", "muted", ` ${posOf(p.position) || "?"} · ${p.kills}/${p.deaths}/${p.assists}`));
        const name = acc === me && me ? "you" : !ok ? "no id" : p.steamAccount?.isAnonymous ? "private profile" : p.steamAccount?.name ?? "player";
        t.append(el("span", "rv-sw-n", `${name}${state === " loading" ? " · loading…" : state === " done" ? " · ✓" : state === " failed" ? " · failed" : ""}`));
        b.append(img, t);
        if (ok && acc) b.addEventListener("click", () => void this.selectPlayer(acc));
        row.append(b);
      }
      box.append(row);
    }
    const open = s.players.filter((p) => openPlayer(p) && p.steamAccountId);
    const left = open.filter((p) => !o.reviews.has(p.steamAccountId!)).length;
    const all = el("button", "g-btn", left ? `Analyse all (${left} left · ${left * 4} requests)` : `All ${open.length} players analysed`) as HTMLButtonElement;
    all.type = "button";
    all.disabled = !left || o.loading.size > 0;
    all.addEventListener("click", () => void this.analyseAll());
    const foot = el("div", "rv-sw-foot", "");
    foot.append(all, el("span", "muted", ` ${open.length} of ${s.players.length} players readable · match ${o.id}`));
    box.append(foot);
    return box;
  }

  private overview(o: NonNullable<ReviewView["open"]>): MatchOverview | undefined {
    const ctx = this.d.ctx();
    if (!ctx) return undefined;
    return matchOverview(o.base.summary, { ...(ctx.bench ? { bench: ctx.bench } : {}), heroOf: this.d.heroOf, ...(o.base.vision ? { vision: o.base.vision } : {}) }, o.reviews);
  }

  /** who played well, who has work to do: all ten, best first within each team. */
  private overviewCard(o: NonNullable<ReviewView["open"]>): HTMLElement {
    const c = card("Match overview · who played well");
    const ov = this.overview(o);
    if (!ov) return c;
    const me = this.settings.account;
    const tb = el("table", "rv-t rv-ov");
    tb.append(rowEl(["", "Player", "Pos", "K/D/A", "IMP", "Networth", "Deaths", "KP", "Vision · stacks", "Battles", "Items", "Overall", "Work on / good at"], true));
    for (const radiant of [true, false]) {
      const rows = ov.rows.filter((x) => x.isRadiant === radiant).sort((a, b) => b.score - a.score);
      const side = rowEl([`${radiant ? "Radiant" : "Dire"}${rows[0]?.won ? " · won" : ""}`], true);
      side.classList.add("rv-ov-side");
      (side.firstChild as HTMLTableCellElement).colSpan = 13;
      tb.append(side);
      for (const x of rows) tb.append(this.overviewRow(o, x, me));
    }
    c.append(tb);
    const missing = ov.rows.filter((x) => !x.reviewed && x.account).length;
    c.append(
      el(
        "p",
        "rv-note",
        `Overall is a heuristic: STRATZ IMP, networth and deaths vs the Crusader-Ancient average for the hero and position, kill participation, vision for supports` +
          `${missing ? `; item timings and battle chances need the player analysed (${missing} not yet - "Analyse all" above)` : ", item timings and battle chances"}. Click a row to open that player.`,
      ),
    );
    return c;
  }

  private overviewRow(o: NonNullable<ReviewView["open"]>, x: OverviewRow, me?: number): HTMLElement {
    const p = o.base.summary.players.find((q) => q.playerSlot === x.slot)!;
    const name = x.account === me && me ? "you" : p.steamAccount?.isAnonymous ? "private" : p.steamAccount?.name ?? "";
    const pc = (r?: number) => (r === undefined ? "-" : `${r >= 1 ? "+" : ""}${Math.round((r - 1) * 100)}%`);
    const v = x.vision;
    const tr = rowEl([
      "",
      `${this.d.heroLabel(x.hero)}${name ? ` · ${name}` : ""}`,
      x.position ? String(x.position) : "?",
      x.kda.join("/"),
      x.imp !== undefined ? `${x.imp > 0 ? "+" : ""}${x.imp}` : "-",
      x.nwRatio !== undefined ? `${pc(x.nwRatio)} @${x.nwMinute}` : "-",
      x.deathsAvg !== undefined ? `${x.deaths} (${x.deathsAvg.toFixed(1)})` : String(x.deaths),
      x.kp !== undefined ? `${Math.round(x.kp * 100)}%` : "-",
      v ? `${v.observers}/${v.sentries} · ${v.dewards} dw · ${v.stacks} st` : "-",
      x.battles ? `${x.battles.used}/${x.battles.windows}` : x.reviewed ? "-" : "…",
      x.timing ? `${x.timing.fast + x.timing.typical} ok · ${x.timing.slow + x.timing.missing} late` : x.reviewed ? "-" : "…",
      GRADE_LABEL[x.grade],
      "",
    ]);
    tr.classList.add("rv-ov-r", `g-${x.grade}`);
    if (this.current?.matchId === o.id && this.current.slot === x.slot) tr.classList.add("on");
    const img = document.createElement("img");
    img.src = this.d.heroImg(x.hero);
    img.alt = "";
    tr.firstElementChild!.append(img);
    const last = tr.lastElementChild as HTMLElement;
    if (x.workOn) last.append(el("span", "rv-ov-bad", x.workOn));
    if (x.goodAt) last.append(el("span", "rv-ov-good", x.goodAt));
    tr.title = x.parts.map((q) => `${q.label}: ${q.text}`).join("\n");
    if (x.account) tr.addEventListener("click", () => void this.selectPlayer(x.account!));
    return tr;
  }

  private matchList(): HTMLElement {
    const c = card("Recent matches");
    if (!this.recent.length) {
      c.append(el("p", "muted", this.settings.token ? (this.busy ? "Loading…" : "No matches loaded.") : "Save your token first."));
      return c;
    }
    const reviewed = new Set(this.mine().map((r) => r.matchId));
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
        const old = this.mine().find((r) => r.matchId === m.id);
        if (old) {
          this.current = old;
          if (this.open?.id !== m.id) this.open = undefined;
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
    const own = r.account === undefined || r.account === this.settings.account;
    const ps = this.open?.id === r.matchId ? this.open.base.summary.players : [];
    const meP = ps.find((p) => p.steamAccountId === this.settings.account);
    const them = ps.find((p) => p.playerSlot === r.slot);
    const rel = own || !meP || !them ? "" : meP.isRadiant === them.isRadiant ? "ally" : "opponent";
    const who = own ? "" : `${[r.player, rel].filter(Boolean).join(", ") || "player"} · `;
    t.append(el("h2", "", `${who}${this.d.heroLabel(r.hero)}${r.position ? ` · position ${r.position}` : ""}`));
    t.append(el("p", "muted", `${r.won ? "Won" : "Lost"} · ${r.kda.join("/")} · ${mmss(r.duration)} · ${r.mode}${r.comparable ? "" : " - timings and averages are from ranked games, not comparable"}`));
    head.append(t);
    const copy = el("button", "g-btn rv-copy", "Copy for Discord / Telegram") as HTMLButtonElement;
    copy.type = "button";
    copy.addEventListener("click", () => {
      const grade = this.open?.id === r.matchId ? this.overview(this.open)?.rows.find((x) => x.slot === r.slot)?.grade : undefined;
      const txt = adviceText(r, this.d.heroLabel, { ...(grade ? { grade } : {}), ...(!own && r.player ? { who: r.player } : {}) });
      void copyText(txt).then((ok) => {
        copy.textContent = ok ? "Copied ✓" : "Copy failed - text selected below";
        if (!ok) {
          const ta = document.createElement("textarea");
          ta.className = "rv-in rv-copy-ta";
          ta.value = txt;
          head.after(ta);
          ta.select();
        }
        setTimeout(() => (copy.textContent = "Copy for Discord / Telegram"), 2500);
      });
    });
    head.append(copy);
    box.append(head);

    const g = card(`Growth areas${r.growth.length > 3 ? ` · top ${r.growth.length}` : ""}`);
    if (!r.growth.length) g.append(el("p", "muted", "Nothing stood out against the checks in this match."));
    r.growth.forEach((f, i) => g.append(findingRow(f, true, i + 1)));
    box.append(g);

    const grid = el("div", "rv-grid");
    grid.append(this.planCard(r), this.farmCard(r));
    box.append(grid);
    box.append(this.deathsCard(r));
    if (r.battles) box.append(this.battlesCard(r.battles));
    const rest = card("All checks");
    const order: Finding["area"][] = ["plan", "farm", "deaths", "battles", "map", "execution"];
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

  private battlesCard(b: BattleReport): HTMLElement {
    const c = card(`Battles (${b.battles.length}) · 2+ heroes a side`);
    const sec = (x: number) => `${Math.round(x)} s`;
    const USE: Record<UseStat["use"], string> = { enemy: "enemy in range", ally: "core in trouble", save: "last 5 s alive" };
    if (b.totals.length) {
      const tb = el("table", "rv-t rv-bt");
      tb.append(rowEl(["Spell / item", "Chance when", "Battles", "Casts", "Chances", "Used", "Missed", "Idle", "Longest", "No mana"], true));
      for (const u of b.totals) {
        const tr = rowEl([
          `${u.name}${u.ult ? " (ult)" : ""}`,
          u.use === "enemy" && u.reach ? `${USE.enemy} (${u.reach})` : USE[u.use],
          String(u.battles),
          String(u.casts),
          String(u.windows),
          String(u.used),
          String(u.missed),
          u.idle ? sec(u.idle) : "-",
          u.longest ? sec(u.longest) : "-",
          u.manaShort ? sec(u.manaShort) : "-",
        ]);
        if (u.missed >= 2 && u.missed / Math.max(1, u.windows) >= 0.4) tr.classList.add("v-slow");
        tb.append(tr);
      }
      c.append(tb);
    }
    const ul = el("ul", "rv-deaths rv-battles");
    for (const f of b.battles) {
      const li = el("li", "", "");
      li.append(el("b", "", `${mmss(f.from + 5)}-${mmss(f.to)}`));
      const chips = el("span", "rv-chips", "");
      if (f.allies !== undefined) chips.append(el("i", f.enemies! > f.allies ? "warn" : "", `${f.allies}v${f.enemies}`));
      if (f.died) chips.append(el("i", "bad", "died"));
      if (f.kills + f.assists) chips.append(el("i", "good", `${f.kills ? `${f.kills} kill${f.kills > 1 ? "s" : ""}` : ""}${f.kills && f.assists ? " + " : ""}${f.assists ? `${f.assists} assist${f.assists > 1 ? "s" : ""}` : ""}`));
      if (f.frontmost) chips.append(el("i", "bad", "front-most"));
      if (f.deep) chips.append(el("i", "warn", "their half"));
      if (f.outnumbered) chips.append(el("i", "bad", `outnumbered ${f.alliesNear! + 1}v${f.enemiesNear}`));
      if (f.silentDeath) chips.append(el("i", "bad", "nothing cast last 10 s"));
      const cast = f.uses.reduce((a, u) => a + u.casts, 0);
      if (!cast) chips.append(el("i", "bad", "no casts"));
      for (const u of f.uses.filter((u) => u.missed > 0).slice(0, 4)) chips.append(el("i", "warn", `${u.name} missed${u.missed > 1 ? ` ×${u.missed}` : ""} · ${sec(u.idle)}`));
      li.append(chips);
      ul.append(li);
    }
    c.append(ul);
    if (b.targets.length) {
      c.append(el("div", "plan-ph", "Targets of your disables"));
      for (const t of b.targets) {
        c.append(el("p", "rv-det", `${t.name}: ${t.casts} in battles · ${t.onCores} on cores, ${t.onSupports} on supports · ${t.converted} of them died within 8 s`));
      }
    }
    c.append(
      el(
        "p",
        "rv-note",
        "A chance = off cooldown at your level, with the mana, alive, and usable: an enemy hero within cast range + radius (+300 you can walk) for spells on enemies; " +
          `an allied core in range losing HP for spells on allies${b.allyHealth ? "" : " (allies' HP not loaded - only your last 5 s)"}; your last 5 s before dying for saves on yourself. ` +
          "Used = cast during it; missed = 2+ s without a cast (1 s to react not counted). Cooldown reduction, stuns on you and vision are not in the data.",
      ),
    );
    return c;
  }

  private trendsCard(): HTMLElement | undefined {
    const mine = this.mine();
    if (mine.length < 3) return undefined;
    const t = trends(mine);
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

function findingRow(f: Finding, area = true, n?: number): HTMLElement {
  const r = el("div", `rv-f${f.good ? " good" : ""}${area ? "" : " flat"}${n ? " num" : ""}`, "");
  if (n) r.append(el("span", "rv-n", String(n)));
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

async function copyText(t: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(t);
    return true;
  } catch {
    return false;
  }
}
