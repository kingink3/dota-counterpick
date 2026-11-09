// =============================================================================
//  Review tab (ADR-029): matches stored by the "Review a match" workflow (ADR-031) ->
//  pick any player, allies or opponents -> plan vs fact, farm
//  vs Crusader-Ancient, deaths, battles, map & role, execution, the top growth
//  areas. History stays in this browser; no STRATZ token here (ADR-034).
// =============================================================================

import { mmss } from "../item-plan.js";
import { MISSING_LABEL, reviewMatch, type Finding, type MatchReview, type ReviewContext } from "../review.js";
import type { BattleReport, UseStat } from "../review-battles.js";
import { adviceText, GRADE_LABEL, matchOverview, matchStory, type MatchOverview, type OverviewRow } from "../review-match.js";
import { resolve } from "../resolver.js";
import { loadHistory, loadSettings, openPlayer, saveReview, saveSettings, type MatchBase, type ReviewSettings } from "./review-local.js";
import { canDispatch, dispatchReview, loadIndex, loadMatch, loadRecent, reviewRuns, storeAvailable, workflowUrl, type RecentList, type StoreEntry } from "./github-store.js";

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
  private settings: ReviewSettings = loadSettings();
  private history: MatchReview[] = loadHistory();
  private current?: MatchReview;
  /** the match open in the player switcher: shared data + every player's review so far. */
  private open?: { id: number; source?: "replay" | "stratz"; base: MatchBase; reviews: Map<number, MatchReview>; loading: Set<number>; failed: Map<number, string>; expanded: Set<number> };
  /** matches the "Review a match" workflow stored (ADR-031). */
  private store?: StoreEntry[];
  /** your last matches, written by every workflow run (ADR-042). */
  private recent?: RecentList | null;
  private copied?: number;
  /** ADR-044: the run started from this page, followed until it ends. */
  private run?: { label: string; since: number; state: string; failed?: boolean; matchId?: number };
  private runPoll?: number;
  private idInput = "";
  private storeMsg = "";
  private storePoll?: number;
  private status = "";
  private busy = false;

  constructor(private readonly d: ReviewDeps) {
    this.root = document.querySelector<HTMLElement>("#review-view")!;
  }

  show(): void {
    this.render();
  }

  /** your trends: only your own reviews. */
  private mine(): MatchReview[] {
    return this.history.filter((r) => r.account === undefined || r.account === this.settings.account);
  }

  /** show a player of the open match: every review was computed when it opened. */
  private selectPlayer(account: number): void {
    const r = this.open?.reviews.get(account);
    if (r) this.current = r;
    this.render();
  }

  // ------------------------------------------------------------- render ----

  render(): void {
    const root = this.root;
    root.replaceChildren();
    const wrap = el("section", "rv");
    const left = el("aside", "rv-side");
    const main = el("main", "rv-main");
    left.append(this.githubCard());
    const rc = this.recentCard();
    if (rc) left.append(rc);
    if (this.status) main.append(el("p", "rv-status", this.status));
    if (this.open) main.append(this.switcher(this.open), this.storyCard(this.open), this.overviewCard(this.open));
    if (this.current) main.append(this.report(this.current));
    else if (this.open) main.append(el("p", "muted", "Pick a player above."));
    // trends are off (the user plays several roles: cross-match trends said little, 2026-11-05)
    else main.append(el("p", "muted", "Run the workflow on GitHub with a Match ID, then open the match on the left."));
    wrap.append(left, main);
    root.append(wrap);
  }

  /** matches fetched on GitHub: run the workflow, then open them here. */
  /** start the workflow from the page (ADR-044) and follow it: queued -> running -> stored. */
  private async start(label: string, opts: { matchId?: number; listOnly?: boolean }): Promise<void> {
    this.run = { label, since: Date.now() / 1000 - 5, state: "Starting…", ...(opts.matchId ? { matchId: opts.matchId } : {}) };
    this.render();
    try {
      await dispatchReview(opts);
    } catch (e) {
      this.run = { ...this.run, state: String((e as Error).message ?? e), failed: true };
      this.render();
      return;
    }
    this.run.state = "Queued…";
    this.render();
    window.clearInterval(this.runPoll);
    const t0 = Date.now();
    this.runPoll = window.setInterval(async () => {
      const run = this.run;
      if (!run) return window.clearInterval(this.runPoll);
      try {
        const mine = (await reviewRuns(5)).filter((x) => x.created >= run.since).at(-1);
        if (mine?.status === "completed") {
          window.clearInterval(this.runPoll);
          run.failed = mine.conclusion !== "success";
          run.state = run.failed ? `Failed (${mine.conclusion}) - see the run on GitHub` : "Done ✓";
          await this.loadStore();
          if (!run.failed && run.matchId && !this.store?.some((e) => e.id === run.matchId)) {
            // the run went fine but got nothing: no replay any more and no STRATZ parse
            run.failed = true;
            run.state = "No data for this match: Valve no longer has its replay and STRATZ has not parsed it";
            this.render();
          }
          return;
        }
        const s = Math.round((Date.now() - t0) / 1000);
        run.state = mine?.status === "in_progress" ? `Running… ${s} s (usually ~1 min, longer behind another run)` : `Queued… ${s} s`;
      } catch (e) {
        run.state = String((e as Error).message ?? e);
      }
      if (Date.now() - t0 > 20 * 60_000) window.clearInterval(this.runPoll);
      this.render();
    }, 8000);
  }

  private githubCard(): HTMLElement {
    const c = card("Review a match");
    if (canDispatch() && storeAvailable()) {
      const inp = document.createElement("input");
      inp.type = "text";
      inp.inputMode = "numeric";
      inp.placeholder = "Match ID (empty = your latest)";
      inp.className = "rv-in";
      inp.value = this.idInput;
      inp.addEventListener("input", () => (this.idInput = inp.value));
      const go = el("button", "g-btn", "Review") as HTMLButtonElement;
      go.type = "button";
      const busy = !!this.run && !this.run.failed && this.run.state !== "Done ✓";
      go.disabled = busy;
      const send = () => {
        const id = Number(this.idInput.replace(/\D/g, "")) || undefined;
        void this.start(id ? `match ${id}` : "your latest match", id ? { matchId: id } : {});
      };
      go.addEventListener("click", send);
      inp.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && !busy) send();
      });
      const list = el("button", "g-btn", "Refresh my list") as HTMLButtonElement;
      list.type = "button";
      list.disabled = busy;
      list.addEventListener("click", () => void this.start("your recent matches", { listOnly: true }));
      const row = el("div", "game-row", "");
      row.append(inp, go, list);
      c.append(row);
      if (this.run) c.append(el("p", this.run.failed ? "rv-note bad" : "rv-sub", `${this.run.label}: ${this.run.state}`));
      c.append(el("p", "rv-note", "Your new matches also arrive by themselves: every hour the workflow adds your parsed matches of the last 2 days."));
    }
    const run = document.createElement("a");
    run.className = canDispatch() ? "link" : "g-btn";
    run.href = workflowUrl();
    run.target = "_blank";
    run.rel = "noopener";
    run.textContent = canDispatch() ? "Runs on GitHub ↗" : "Run on GitHub ↗";
    run.title = 'Actions -> "Review a match" -> Run workflow (Match ID, or empty = your latest). Takes ~1-1.5 min.';
    run.addEventListener("click", () => this.pollStore());
    const ref = el("button", "g-btn", "Refresh") as HTMLButtonElement;
    ref.type = "button";
    ref.addEventListener("click", () => void this.loadStore());
    const row = el("div", "game-row", "");
    row.append(run, ref);
    c.append(row);
    if (!storeAvailable()) {
      c.append(el("p", "rv-note", "Works in the published site (it opens the stored matches with the site password)."));
      return c;
    }
    if (this.store === undefined && !this.storeMsg) void this.loadStore();
    if (this.storeMsg) c.append(el("p", "rv-note", this.storeMsg));
    const ul = el("ul", "rv-list");
    for (const e of this.store ?? []) {
      const li = el("li", `rv-m${this.open?.id === e.id ? " on" : ""}`);
      const info = el("span", "rv-mi", "");
      const when = new Date((e.start ?? e.at) * 1000);
      info.append(el("b", "", `${when.toLocaleDateString(undefined, { day: "numeric", month: "short" })} ${when.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}`), el("span", "muted", ` · ${e.duration ? mmss(e.duration) : ""} · ${e.id}`));
      li.append(info);
      const b = el("button", "g-btn", "Open") as HTMLButtonElement;
      b.type = "button";
      b.disabled = this.busy;
      b.addEventListener("click", () => void this.openStored(e));
      li.append(b);
      ul.append(li);
    }
    c.append(ul);
    if (!canDispatch()) c.append(el("p", "rv-note", "Run the workflow with a Match ID (or empty for your latest); it fetches all ten players in ~1-1.5 min and stores them encrypted. To start it from this page, add the DISPATCH_TOKEN secret (README)."));
    return c;
  }

  /** your last 20 matches from the latest workflow run (ADR-042): open a stored one, or
   *  copy the ID and open the workflow page (GitHub cannot prefill the input from a link). */
  private recentCard(): HTMLElement | undefined {
    if (!storeAvailable()) return undefined;
    const c = card("Your recent matches");
    const list = this.recent;
    if (list === undefined) {
      c.append(el("p", "muted", "Loading…"));
      return c;
    }
    if (list === null || !list.matches.length) {
      c.append(el("p", "rv-note", 'No list yet. Run "Review a match" once (any match, or tick "Only refresh the list"): every run refreshes it.'));
      return c;
    }
    const stored = new Map((this.store ?? []).map((e) => [e.id, e]));
    const ago = Math.round((Date.now() / 1000 - list.fetchedAt) / 60);
    c.append(el("p", "rv-sub", `As of ${ago < 90 ? `${ago} min` : `${Math.round(ago / 60)} h`} ago. Every hour up to 3 matches from this list are reviewed by themselves - no need to press anything.`));
    const ul = el("ul", "rv-list");
    for (const m of list.matches) {
      const p = m.players?.[0];
      const hero = p ? this.d.heroOf(p.heroId) : "";
      const li = el("li", `rv-m${p?.isVictory ? " win" : " loss"}${this.open?.id === m.id ? " on" : ""}`);
      const img = document.createElement("img");
      img.src = this.d.heroImg(hero);
      img.alt = "";
      li.append(img);
      const info = el("span", "rv-mi", "");
      const mode = /TURBO/.test(m.gameMode ?? "") ? "turbo" : /UNRANKED/.test(m.lobbyType ?? "") ? "normal" : /RANKED/.test(m.lobbyType ?? "") ? "ranked" : "other";
      info.append(el("b", "", this.d.heroLabel(hero)), el("span", "muted", ` ${p ? `${p.kills}/${p.deaths}/${p.assists}` : ""} · ${mode} · ${m.durationSeconds ? mmss(m.durationSeconds) : ""}`));
      li.append(info);
      const have = stored.get(m.id);
      const direct = canDispatch();
      // any match can be tried: the replay first, then STRATZ (ADR-053); a miss is reported after the run
      const gone = !have && (list.missed ?? []).includes(m.id); // the hourly run found no replay
      const b = el("button", "g-btn", have ? "Open" : this.copied === m.id ? "ID copied ✓" : gone ? (direct ? "Try STRATZ" : "Try STRATZ ↗") : direct ? "Review" : "Review ↗") as HTMLButtonElement;
      b.type = "button";
      b.disabled = this.busy;
      b.title = have ? "Already in the store" : gone ? "Valve no longer has the replay; STRATZ may still have the match" : direct ? "From the replay (or STRATZ), all ten players, ~1 min" : `Copies ${m.id} and opens the workflow: paste it as Match ID, Run.`;
      b.addEventListener("click", () => {
        if (have) return void this.openStored(have);
        if (direct) return void this.start(`match ${m.id}`, { matchId: m.id });
        void copyText(String(m.id)).then(() => {
          this.copied = m.id;
          this.render();
        });
        window.open(workflowUrl(), "_blank", "noopener");
        this.pollStore();
      });
      li.append(b);
      ul.append(li);
    }
    c.append(ul);
    return c;
  }

  private async loadStore(): Promise<void> {
    if (!storeAvailable()) return;
    this.storeMsg = "Loading…";
    this.render();
    try {
      const [idx, recent] = await Promise.all([loadIndex(), loadRecent().catch(() => undefined)]);
      this.store = idx;
      this.recent = recent ?? null;
      this.storeMsg = this.store.length ? "" : "Nothing fetched yet.";
    } catch (e) {
      this.store = [];
      this.recent = await loadRecent().catch(() => null) ?? null;
      this.storeMsg = String((e as Error).message ?? e);
    }
    this.render();
  }

  /** after "Run on GitHub": look for the new match every 20 s for 4 minutes. */
  private pollStore(): void {
    if (!storeAvailable()) return;
    window.clearInterval(this.storePoll);
    const before = new Set((this.store ?? []).map((e) => `${e.id}@${e.at}`));
    let n = 0;
    this.storePoll = window.setInterval(async () => {
      n++;
      try {
        const idx = await loadIndex();
        const fresh = idx.some((e) => !before.has(`${e.id}@${e.at}`));
        this.store = idx;
        this.storeMsg = fresh ? "New match fetched ✓" : `Waiting for the workflow… (${n * 20} s)`;
        if (fresh) this.recent = (await loadRecent().catch(() => undefined)) ?? this.recent;
        if (fresh || n >= 12) window.clearInterval(this.storePoll);
        if (!fresh && n >= 12) this.storeMsg = "No new match yet - check the run on GitHub, then Refresh.";
      } catch {
        this.storeMsg = `Waiting for the workflow… (${n * 20} s)`;
      }
      this.render();
    }, 20_000);
    this.storeMsg = "Waiting for the workflow…";
    this.render();
  }

  /** a stored match: every player is in it, so all ten reviews are computed right away. */
  private async openStored(e: StoreEntry): Promise<void> {
    const ctx = this.d.ctx();
    if (!ctx) return;
    this.busy = true;
    this.status = "Opening the stored match…";
    this.render();
    try {
      const m = await loadMatch(e);
      if (!this.settings.account && m.owner) {
        // the token owner is you: name "you" in the switcher and keep your trends
        this.settings = { ...this.settings, account: m.owner };
        saveSettings(this.settings);
      }
      const base: MatchBase = { summary: m.summary, ...(m.source ? { source: m.source } : {}), ...(m.positions ? { positions: m.positions } : {}), ...(m.health ? { health: m.health } : {}), ...(m.vision ? { vision: m.vision } : {}), ...(m.replay ? { replay: m.replay } : {}) };
      const o = { id: m.id, ...(m.source ? { source: m.source } : {}), base, reviews: new Map<number, MatchReview>(), loading: new Set<number>(), failed: new Map<number, string>(), expanded: new Set<number>() };
      for (const [acc, me] of Object.entries(m.players)) {
        try {
          const r = reviewMatch({ ...base, me }, Number(acc), ctx);
          o.reviews.set(Number(acc), r);
          if (Number(acc) === this.settings.account) this.history = saveReview(r);
        } catch (err) {
          o.failed.set(Number(acc), String(err));
        }
      }
      this.open = o;
      this.current = this.settings.account ? o.reviews.get(this.settings.account) : undefined;
      this.status = "";
    } catch (err) {
      this.status = String((err as Error).message ?? err);
    }
    this.busy = false;
    this.render();
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
        if (ok && acc) b.addEventListener("click", () => this.selectPlayer(acc));
        row.append(b);
      }
      box.append(row);
    }
    const open = s.players.filter((p) => openPlayer(p) && p.steamAccountId);
    const foot = el("div", "rv-sw-foot", "");
    foot.append(el("span", "muted", `${open.length} of ${s.players.length} players readable · match ${o.id}`));
    box.append(foot);
    return box;
  }

  private overview(o: NonNullable<ReviewView["open"]>): MatchOverview | undefined {
    const ctx = this.d.ctx();
    if (!ctx) return undefined;
    return matchOverview(o.base.summary, { ...(ctx.bench ? { bench: ctx.bench } : {}), heroOf: this.d.heroOf, ...(o.base.vision ? { vision: o.base.vision } : {}) }, o.reviews);
  }

  /** who decided the match: each team's carrier, whom they fed on, when, what answers them. */
  private storyCard(o: NonNullable<ReviewView["open"]>): HTMLElement {
    const c = card("Match story");
    const ctx = this.d.ctx();
    const s = o.base.summary;
    if (!ctx) return c;
    const posN = (p?: string | null) => Number(/(\d)/.exec(p ?? "")?.[1] ?? 0);
    const known = (h: string) => !!ctx.kb.taxonomy.hero_tags[h];
    const answers = (enemy: string, team: string[], role: "core" | "support") => {
      const side = s.players.filter((p) => team.includes(this.d.heroOf(p.heroId)));
      const me = role === "core" ? side.find((p) => posN(p.position) === 1) ?? side[0] : side.find((p) => posN(p.position) === 5) ?? side.find((p) => posN(p.position) === 4);
      const myHero = me ? this.d.heroOf(me.heroId) : undefined;
      if (!known(enemy) || !myHero || !known(myHero)) return [];
      const r = resolve(ctx.kb, { enemyHeroes: [enemy], allyHeroes: team.filter(known), myHero, myRole: role === "core" ? 1 : 5 });
      const seen = new Set<string>();
      return [...r.items, ...r.defense]
        .sort((a, b) => b.score - a.score)
        .filter((x) => !seen.has(x.label) && !!seen.add(x.label))
        .map((x) => ({ label: x.label, why: x.reasons[0]?.mechanism ?? "" }));
    };
    const st = matchStory(s, { heroOf: this.d.heroOf, answers }, o.reviews);
    const me = s.players.find((p) => p.steamAccountId === this.settings.account);
    const winners = st.carriers.filter((x) => s.didRadiantWin === x.isRadiant);
    const losers = st.carriers.filter((x) => s.didRadiantWin !== x.isRadiant);
    for (const x of [...winners, ...losers]) {
      const won = s.didRadiantWin === x.isRadiant;
      const team = x.isRadiant ? "Radiant" : "Dire";
      const ours = me ? me.isRadiant === x.isRadiant : undefined;
      const row = el("div", `rv-story${won ? " won" : ""}`, "");
      const img = document.createElement("img");
      img.src = this.d.heroImg(x.hero);
      img.alt = "";
      row.append(img);
      const t = el("div", "", "");
      const who = ours === undefined ? team : ours ? "Your team" : "Their team";
      t.append(el("b", "", `${who} ${won ? "was carried by" : "- best"}: ${this.d.heroLabel(x.hero)} ${x.kda.join("/")}${x.imp !== undefined ? `, IMP ${x.imp > 0 ? "+" : ""}${x.imp}` : ""}`));
      const otherAttr = x.isRadiant ? st.attributed.dire : st.attributed.radiant;
      if (otherAttr && x.killsOn) {
        const otherDeaths = s.players.filter((p) => p.isRadiant !== x.isRadiant).reduce((a, p) => a + p.deaths, 0);
        const seen = otherAttr < otherDeaths ? " (in the deaths we can see)" : "";
        const parts = [`killed the other team ${x.killsOn} times${seen}: ${x.victims.slice(0, 3).map((v) => `${this.d.heroLabel(v.hero)} ${v.n}`).join(", ")}`];
        if (x.atNight >= 3 && x.atNight >= 0.6 * x.killsOn) parts.push(`${x.atNight} of them at night`);
        if (x.early >= 3 && x.early >= 0.4 * x.killsOn) parts.push(`${x.early} before 15:00 - a lane / early snowball`);
        t.append(el("p", "rv-det", parts.join(" · ")));
      } else if (!otherAttr) t.append(el("p", "muted", 'Whom they killed needs the other team analysed ("Analyse all").'));
      // what answers them: for a carrier on the other side (or the winners, when you are not in the match)
      if ((ours === false || (ours === undefined && won)) && x.answers.length) {
        const a = el("p", "rv-det", "Against them: ");
        x.answers.forEach((ans, i) => {
          const sp = el("span", "rv-ans", `${ans.label}${ans.for === "support" ? " (support)" : ""}`);
          sp.title = ans.why;
          a.append(...(i ? [", "] : []), sp);
        });
        t.append(a);
      }
      row.append(t);
      c.append(row);
    }
    return c;
  }

  /** who played well, who has work to do: all ten, best first within each team. */
  private overviewCard(o: NonNullable<ReviewView["open"]>): HTMLElement {
    const c = card("Match overview · who played well");
    const ov = this.overview(o);
    if (!ov) return c;
    const me = this.settings.account;
    const tb = el("table", "rv-t rv-ov");
    tb.append(rowEl(["", "Player", "Pos", "K/D/A", "IMP", "Networth", "Deaths", "KP", "Vision · stacks", "Casts", "Items", "Overall"], true));
    for (const radiant of [true, false]) {
      const rows = ov.rows.filter((x) => x.isRadiant === radiant).sort((a, b) => b.score - a.score);
      // the team line: its kills / deaths / assists under the K/D/A column
      const team = o.base.summary.players.filter((p) => p.isRadiant === radiant);
      const sum = (k: "kills" | "deaths" | "assists") => team.reduce((a, p) => a + p[k], 0);
      const side = rowEl([`${radiant ? "Radiant" : "Dire"}${rows[0]?.won ? " · won" : ""}`, `${sum("kills")}/${sum("deaths")}/${sum("assists")}`, ""], true);
      side.classList.add("rv-ov-side");
      (side.children[0] as HTMLTableCellElement).colSpan = 3;
      (side.children[1] as HTMLTableCellElement).title = "Team kills / deaths / assists";
      side.children[1]!.className = "rv-ov-team";
      (side.children[2] as HTMLTableCellElement).colSpan = 8;
      tb.append(side);
      for (const x of rows) {
        tb.append(this.overviewRow(o, x, me));
        if (o.expanded.has(x.slot)) tb.append(this.overviewDetail(o, x));
      }
    }
    c.append(tb);
    const missing = ov.rows.filter((x) => !x.reviewed && x.account).length;
    c.append(
      el(
        "p",
        "rv-note",
        `Casts = share of the chances to cast in battles that were used (the ultimate and control spells / items count double). ` +
          `Overall is a heuristic: STRATZ IMP, networth and deaths vs the Crusader-Ancient average for the hero and position, kill participation, vision for supports` +
          `${missing ? `; item timings and battle chances need the player analysed (${missing} not yet - "Analyse all" above)` : ", item timings and battle chances"}. Click a row for that player's build and main points.`,
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
      x.battles ? `${Math.round(x.battles.rate * 100)}%` : x.reviewed ? "-" : "…",
      x.timing ? `${x.timing.fast + x.timing.typical} ok · ${x.timing.slow + x.timing.missing} late` : x.reviewed ? "-" : "…",
      GRADE_LABEL[x.grade],
    ]);
    tr.classList.add("rv-ov-r", `g-${x.grade}`);
    if (this.current?.matchId === o.id && this.current.slot === x.slot) tr.classList.add("on");
    const img = document.createElement("img");
    img.src = this.d.heroImg(x.hero);
    img.alt = "";
    tr.firstElementChild!.append(img);
    tr.title = x.parts.map((q) => `${q.label}: ${q.text}`).join("\n");
    if (o.expanded.has(x.slot)) tr.classList.add("open");
    tr.addEventListener("click", () => {
      if (o.expanded.has(x.slot)) o.expanded.delete(x.slot);
      else {
        o.expanded.add(x.slot);
      }
      this.render();
    });
    return tr;
  }

  /** under a row: the build in order (fast / typical / late) and the main points. */
  private overviewDetail(o: NonNullable<ReviewView["open"]>, x: OverviewRow): HTMLElement {
    const tr = document.createElement("tr");
    tr.className = "rv-ov-x";
    const td = document.createElement("td");
    td.colSpan = 12;
    tr.append(td);
    const r = x.account ? o.reviews.get(x.account) : undefined;
    if (!r) {
      td.append(el("p", "muted", x.account && o.loading.has(x.account) ? "Loading this player (4 requests)…" : x.account && o.failed.get(x.account) ? `Failed: ${o.failed.get(x.account)}` : "No Steam id for this player."));
      return tr;
    }
    const strip = el("div", "rv-strip", "");
    for (const b of r.build) {
      const it = el("span", `rv-si v-${b.verdict ?? "none"}${b.planned ? "" : " own"}`, "");
      const img = document.createElement("img");
      img.src = `./items/${b.key}.webp`;
      img.alt = "";
      img.onerror = () => img.remove();
      it.append(img, el("span", "", mmss(b.at)));
      it.title = `${b.label}: ${mmss(b.at)}${b.typical !== undefined ? ` (typical ~${mmss(b.typical)})` : ""}${b.verdict ? ` - ${b.verdict === "slow" ? "late" : b.verdict}` : ""}${b.planned ? "" : " - own choice"}`;
      strip.append(it);
    }
    if (!r.build.length) strip.append(el("span", "muted", "No finished items."));
    td.append(strip);
    if (r.buildNote) td.append(el("p", "rv-sub", r.buildNote));
    const pts = el("ul", "rv-xp", "");
    for (const f of (r.fixFirst ?? []).slice(0, 3)) pts.append(el("li", "bad", f.title));
    if (!(r.fixFirst ?? []).length) for (const f of (r.workOn ?? []).slice(0, 2)) pts.append(el("li", "warn", f.title));
    for (const f of (r.strengths ?? []).slice(0, 2)) pts.append(el("li", "good", f.title));
    td.append(pts);
    const open = el("button", "g-btn", "Full review ↓") as HTMLButtonElement;
    open.type = "button";
    open.addEventListener("click", (e) => {
      e.stopPropagation();
      this.current = r;
      this.render();
      document.querySelector(".rv-report")?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    td.append(open);
    return tr;
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
    const src = this.open?.id === r.matchId ? this.open.source : undefined;
    const srcNote = src === "replay" ? " · from the replay (no HP / mana or STRATZ death flags yet)" : src === "stratz" ? " · from STRATZ" : "";
    t.append(el("p", "muted", `${r.won ? "Won" : "Lost"} · ${r.kda.join("/")} · ${mmss(r.duration)} · ${r.mode}${srcNote}${r.comparable ? (r.compat?.length ? ` - ${r.compat.join("; ")}: farm and timing verdicts are "check the replay"` : "") : " - timings and averages are from ranked All Pick games, not compared"}`));
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

    box.append(this.mainCard(r));
    const grid = el("div", "rv-grid");
    grid.append(this.itemsCard(r), this.farmCard(r));
    box.append(grid);
    box.append(this.deathsCard(r));
    if (r.battles) box.append(this.battlesCard(r.battles));
    box.append(this.mapCard(r));
    const rest = document.createElement("details");
    rest.className = "gz-card rv-all";
    rest.append(el("summary", "", `All checks (${r.findings.length})`));
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

  /** fix first (cost deaths / fights) -> work on -> strengths; a click goes to the evidence. */
  private mainCard(r: MatchReview): HTMLElement {
    const c = card("Main points");
    const fix = r.fixFirst ?? r.growth.slice(0, 3);
    const work = r.workOn ?? r.growth.slice(3);
    const good = r.strengths ?? r.findings.filter((f) => f.good).slice(0, 3);
    if (!fix.length && !work.length) c.append(el("p", "muted", "Nothing cost this game in the checks - see the strengths."));
    let n = 0;
    const group = (title: string, fs: Finding[], cls: string) => {
      if (!fs.length) return;
      c.append(el("div", `plan-ph ${cls}`, title));
      for (const f of fs) c.append(pointRow(f, f.good ? undefined : ++n));
    };
    group("Fix first", fix, "rv-ph-fix");
    group("Work on", work, "rv-ph-work");
    group("Strengths", good, "rv-ph-good");
    return c;
  }

  private itemsCard(r: MatchReview): HTMLElement {
    const c = card("Items · plan vs fact");
    c.id = SECTION.plan;
    const build = r.build ?? [];
    if (!r.checks.length && !build.length) {
      c.append(el("p", "muted", "No plan for this hero (no statistics / not in the KB)."));
      return c;
    }
    if (r.buildNote) c.append(el("p", "rv-sum", r.buildNote));
    for (const f of r.findings.filter((x) => x.note && x.area === "plan")) c.append(el("p", "rv-sub", f.title));
    const V: Record<string, string> = { fast: "fast", typical: "typical", slow: "late", missing: "not bought", bought: "bought" };
    const tb = el("table", "rv-t rv-it");
    tb.append(rowEl(["Item", "Typical", "Actual", "", ""], true));
    // bought: plan items and own choices, in the order they came
    const rows = new Map<string, { label: string; planned?: number; actual: number; verdict: string; src: string }>();
    for (const k of r.checks) if (k.actual !== undefined) rows.set(k.key, { label: k.label, ...(k.planned !== undefined ? { planned: k.planned } : {}), actual: k.actual, verdict: k.verdict, src: k.phase === "situational" ? "draft answer" : "plan" });
    for (const b of build) if (!rows.has(b.key)) rows.set(b.key, { label: b.label, ...(b.typical !== undefined ? { planned: b.typical } : {}), actual: b.at, verdict: b.verdict ?? "bought", src: "own" });
    for (const x of [...rows.values()].sort((a, b) => a.actual - b.actual)) {
      const tr = rowEl([x.label, x.planned !== undefined ? `~${mmss(x.planned)}` : "", mmss(x.actual), V[x.verdict] ?? x.verdict, x.src]);
      tr.classList.add(`v-${x.verdict}`);
      tb.append(tr);
    }
    // not bought: last, grey - a problem only when the main points say so
    for (const k of r.checks.filter((x) => x.actual === undefined)) {
      const tr = rowEl([k.label, k.phase === "situational" ? "draft" : k.planned !== undefined ? `~${mmss(k.planned)}` : "", "-", "not bought", k.phase === "situational" ? "draft answer" : "plan"]);
      tr.classList.add("v-skipped");
      tb.append(tr);
    }
    c.append(tb);
    return c;
  }

  private farmCard(r: MatchReview): HTMLElement {
    const c = card("Farm & lane vs Crusader-Ancient average");
    c.id = SECTION.farm;
    const lane = r.findings.find((f) => f.id === "lane_won" || f.id === "lane_lost");
    if (lane) c.append(el("p", `rv-sum${lane.good ? " good" : ""}`, lane.title));
    const tb = el("table", "rv-t");
    tb.append(rowEl(["Min", "Last hits", "Networth", "XP"], true));
    const cell = (v?: number, b?: number) => (v === undefined ? "-" : b ? `${Math.round(v)} (${pctDelta(v, b)})` : String(Math.round(v)));
    for (const f of r.farm) {
      const tr = rowEl([String(f.minute), cell(f.cs, f.csBench), cell(f.nw, f.nwBench), cell(f.xp, f.xpBench)]);
      tb.append(tr);
    }
    c.append(tb);
    // idle time (ADR-041): always shown when measured, a finding only above the threshold
    if (r.idle) {
      const n = r.idle.minutes.length;
      const cost = r.idle.goldLost !== undefined ? `, up to ~${r.idle.goldLost} gold at ${r.idle.pace}/min` : r.idle.stackChances !== undefined && n ? `, ${n} stack / ward chance${n > 1 ? "s" : ""}` : "";
      const p = el("p", "rv-sub", `Idle: ${n} of ${r.idle.checked} minutes out of base${cost}.`);
      p.title = "Alive, out of base, and in that minute: no last hit or deny, stack, ward, rune, cast, hero damage, enemy hero within ~960 units, or lane XP. Per-minute data: a walk between camps can look idle - check the replay.";
      c.append(p);
    }
    if (!r.comparable) c.append(el("p", "rv-note", `${r.mode === "turbo" ? "Turbo" : "This mode"}: averages are from ranked All Pick games, not compared.`));
    else if (r.compat?.length) c.append(el("p", "rv-note", `${r.compat.join("; ")}.`));
    return c;
  }

  private deathsCard(r: MatchReview): HTMLElement {
    const c = card(`Deaths & positioning (${r.deaths.length})`);
    c.id = SECTION.deaths;
    if (!r.deaths.length) {
      c.append(el("p", "muted", "No deaths."));
      return c;
    }
    // what each death had, from the death checks and the battle it ended
    const bAt = (t: number) => r.battles?.battles.find((b) => b.died && Math.abs(b.to - t) <= 1);
    const saves = (t: number) => (r.battles?.battles.find((b) => b.died && Math.abs(b.to - t) <= 1)?.uses ?? []).filter((u) => u.use !== "enemy" && u.missed > 0).map((u) => u.name);
    const count = new Map<string, number>();
    const inc = (k: string) => count.set(k, (count.get(k) ?? 0) + 1);
    const rows = [...r.deaths].sort((a, b) => a.time - b.time).map((d) => {
      const b = bAt(d.time);
      const tags: Array<[string, string]> = [];
      if (d.killer) tags.push(["who", `by ${this.d.heroLabel(d.killer)}`]);
      if (d.flags.includes("walked into enemy vision")) tags.push(["bad", "after walking into vision"]);
      if (d.alone) tags.push(["bad", "alone"]);
      if (b?.frontmost) tags.push(["bad", "front-most"]);
      if (b?.outnumbered) tags.push(["bad", `outnumbered ${(b.alliesNear ?? 0) + 1}v${b.enemiesNear}`]);
      if (b?.deep) tags.push(["warn", "their half"]);
      const unused = r.battles ? saves(d.time) : [...d.unused.map((k) => k.replace(/_/g, " ")), ...(d.flags.includes("heal available") ? ["heal"] : []), ...(d.flags.includes("ultimate not used") ? ["ultimate"] : [])];
      if (unused.length) tags.push(["bad", `${unused.join(", ")} ready`]);
      if (d.inEnemyWindow) tags.push(["warn", "their game-length stretch"]);
      if (d.unspent >= 1500) tags.push(["warn", `${d.unspent} gold unspent`]);
      if (d.flags.includes("burst")) tags.push(["", "burst"]);
      for (const [, t] of tags) inc(t.replace(/ \d+v\d+$/, "").replace(/^\d+ gold unspent$/, "gold unspent").replace(/^.+ ready$/, "with a save ready"));
      return { d, tags };
    });
    const top = [...count.entries()].filter(([k]) => k !== "burst" && !k.startsWith("by ")).sort((a, b) => b[1] - a[1]).slice(0, 4);
    const by = [...count.entries()].filter(([k]) => k.startsWith("by ")).sort((a, b) => b[1] - a[1]);
    if (by.length) top.unshift([`to ${by[0]![0].slice(3)}`, by[0]![1]] as [string, number]);
    if (top.length) c.append(el("p", "rv-sum", `${r.deaths.length} deaths: ${top.map(([k, n]) => `${n} ${k}`).join(", ")}`));
    const ul = el("ul", "rv-deaths");
    for (const { d, tags } of rows) {
      const li = el("li", "", "");
      li.append(el("b", "", mmss(d.time)));
      const chips = el("span", "rv-chips", "");
      for (const [cls, t] of tags) chips.append(el("i", cls, t));
      li.append(chips);
      ul.append(li);
    }
    c.append(ul);
    return c;
  }

  private mapCard(r: MatchReview): HTMLElement {
    const c = card("Map & role");
    c.id = SECTION.map;
    const per10 = (n: number) => (n / Math.max(1, r.duration / 600)).toFixed(1);
    const sup = (r.position ?? 0) >= 4;
    const v = r.vision;
    const parts: string[] = [];
    if (v) {
      parts.push(`${v.observers} observers (${per10(v.observers)} / 10 min${sup ? ", norm 2+" : ""})`, `${v.sentries} sentries`, `${v.dewards} enemy wards destroyed${sup ? " (norm ~1 / 10 min)" : ""}`, `${v.stacks} stacks${sup ? " (norm 1+ / 10 min)" : ""}`);
    }
    if (r.runes) parts.push(`${r.runes.power} power runes`, `${r.runes.bounty} bounties`);
    c.append(el("p", "rv-sum", parts.join(" · ") || "No map data."));
    // ADR-051: objectives from the replay
    const m = r.macro;
    if (m) {
      const boss = (n: string, b: { team: number; mine: number; enemy: number }) => (b.team || b.enemy ? `${n}: your team ${b.team} (you in ${b.mine}), enemy ${b.enemy}` : "");
      const line = [
        `Enemy buildings: present at ${m.buildingsWith} of ${m.enemyBuildings}`,
        m.towerDamage !== undefined ? `building damage ${m.towerDamage}${m.towerShare !== undefined ? ` (${Math.round(m.towerShare * 100)}% of team)` : ""}` : "",
        `own buildings lost ${m.ownLost}`,
        boss("Roshan", m.roshan),
        boss("Tormentor", m.tormentor),
      ].filter(Boolean).join(" · ");
      const p = el("p", "rv-sub", `Objectives (replay): ${line}.`);
      p.title = "Present = your hero or its summons damaged the building in its last 20 s (Roshan / Tormentor: last 60 s).";
      c.append(p);
    }
    for (const f of r.findings.filter((x) => x.area === "map" && !x.note)) c.append(findingRow(f, false));
    return c;
  }

  private battlesCard(b: BattleReport): HTMLElement {
    const c = card(`Battles (${b.battles.length}) · 2v3 or bigger`);
    c.id = SECTION.battles;
    const sec = (x: number) => `${Math.round(x)} s`;
    const USE: Record<UseStat["use"], string> = { enemy: "enemy in range", ally: "core in trouble", save: "last 5 s alive" };
    if (b.totals.length) {
      const tb = el("table", "rv-t rv-bt");
      tb.append(rowEl(["Spell / item", "Chance when", "Battles", "Casts", "Chances", "Used", "Missed", "Idle", "Longest", "No mana"], true));
      for (const u of b.totals) {
        const tr = rowEl([
          `${u.name}${u.ult ? " (ult)" : ""}${u.weight === 2 ? " ×2" : ""}`,
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


}

/** where each area's evidence is. */
const SECTION: Record<Finding["area"], string> = { plan: "rv-sec-items", farm: "rv-sec-farm", deaths: "rv-sec-deaths", execution: "rv-sec-deaths", battles: "rv-sec-battles", map: "rv-sec-map" };

/** one line: the point, its first sentence, a link to the evidence. */
function pointRow(f: Finding, n?: number): HTMLElement {
  const r = el("div", `rv-p${f.good ? " good" : ""}`, "");
  r.append(el("span", "rv-n", n ? String(n) : "+"));
  const t = el("span", "rv-pt", "");
  t.append(el("b", "", f.title));
  const tag = confTag(f);
  if (tag) t.append(tag);
  const first = /^(.+?[.!?])(\s|$)/.exec(f.detail)?.[1] ?? f.detail;
  if (!f.good) t.append(el("span", "rv-det", ` - ${first}`));
  r.append(t);
  const go = el("button", "rv-go", "details ↓") as HTMLButtonElement;
  go.type = "button";
  go.title = AREA_LABEL[f.area];
  go.addEventListener("click", () => {
    const sec = document.getElementById(SECTION[f.area]);
    sec?.scrollIntoView({ behavior: "smooth", block: "start" });
    sec?.classList.add("flash");
    setTimeout(() => sec?.classList.remove("flash"), 1200);
  });
  r.append(go);
  return r;
}

function findingRow(f: Finding, area = true, n?: number): HTMLElement {
  const r = el("div", `rv-f${f.good ? " good" : ""}${area ? "" : " flat"}${n ? " num" : ""}`, "");
  if (n) r.append(el("span", "rv-n", String(n)));
  if (area) r.append(el("span", "rv-area", AREA_LABEL[f.area]));
  const head = el("b", "", f.title);
  const tag = confTag(f);
  if (tag) head.append(tag);
  r.append(head);
  const det = el("span", "rv-det", f.detail);
  if (f.times?.length) det.append(el("span", "muted", ` (${f.times.map(mmss).join(", ")})`));
  r.append(det);
  return r;
}

/** likely / possible badge with what the data could not see (ADR-036); confirmed has none. */
function confTag(f: Finding): HTMLElement | undefined {
  if (f.good || !f.confidence || f.confidence === "confirmed") return undefined;
  const t = el("span", `rv-conf ${f.confidence}`, f.confidence === "likely" ? "likely" : "check the replay");
  const miss = (f.missingContext ?? []).map((m) => MISSING_LABEL[m]);
  t.title = (f.confidence === "likely" ? "Strong indirect evidence." : "A heuristic: look at the moment before acting on it.") + (miss.length ? `\nNot in the data: ${miss.join("; ")}.` : "");
  return t;
}

function pctDelta(v: number, b: number): string {
  const d = Math.round((v / b - 1) * 100);
  return `${d >= 0 ? "+" : ""}${d}%`;
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
