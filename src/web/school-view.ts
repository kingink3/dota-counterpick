// =============================================================================
//  School tab (ADR-046): modules of lessons, each with three separate tracks -
//  Theory (+ Test), Situations, Practice - and a module exam. Progress stays in
//  this browser for now (SchoolProgress below is the seam for a synced store).
// =============================================================================

import type { MatchReview } from "../review.js";
import { checkGoal } from "../school/practice.js";
import { generate, rng, type GenDeps } from "../school/generate.js";
import type { Lesson, Module, Question, Situation } from "../school/types.js";
import { mergeProgress, sameProgress, type ProgressData } from "../school/merge.js";
import { currentUser, pullProgress, pushProgress, resetPassword, signIn, signOut, signUp } from "./cloud.js";

// ---- progress --------------------------------------------------------------------

export type { ProgressData };
/** where progress lives: this browser now; a synced store later (ADR-046). */
export interface SchoolProgress {
  load(): ProgressData;
  save(p: ProgressData): void;
}
const KEY = "dotaapp.school.v1";
export const localProgress: SchoolProgress = {
  load() {
    try {
      const p = JSON.parse(localStorage.getItem(KEY) ?? "{}") as Partial<ProgressData>;
      return { tests: p.tests ?? {}, sits: p.sits ?? {}, exam: p.exam ?? {} };
    } catch {
      return { tests: {}, sits: {}, exam: {} };
    }
  },
  save(p) {
    try {
      localStorage.setItem(KEY, JSON.stringify(p));
    } catch {
      /* private mode: progress lives for this page only */
    }
  },
};

// ---- view ------------------------------------------------------------------------

export interface SchoolDeps {
  modules: Module[];
  gen: () => GenDeps | undefined;
  /** your own reviewed matches, newest first. */
  reviews: () => MatchReview[];
  store?: SchoolProgress;
}

type Tab = "theory" | "test" | "sits" | "practice";
/** a test needs this share right to count as passed; the exam needs EXAM_PASS. */
const PASS = 0.7;
const EXAM_PASS = 0.8;
const EXAM_SIZE = 15;
const GEN_SIZE = 6;

interface Attempt {
  qs: Array<(Question | Situation) & { order: number[] }>;
  picked: Map<string, number>;
  checked: boolean;
}

export class SchoolView {
  private root: HTMLElement;
  private store: SchoolProgress;
  private progress: ProgressData;
  private mod: Module;
  private lesson?: Lesson;
  private tab: Tab = "theory";
  private attempt?: Attempt;
  private exam = false;
  private seed = Math.floor(Math.random() * 1e9);
  /** account (ADR-047): sign-in form state and the last sync message. */
  private acct = { email: "", password: "", busy: false, msg: "", bad: false };

  constructor(private readonly d: SchoolDeps) {
    this.root = document.getElementById("school-view")!;
    this.store = d.store ?? localProgress;
    this.progress = this.store.load();
    this.mod = d.modules[0]!;
  }

  show(): void {
    this.render();
    if (currentUser() && !this.synced) void this.sync();
  }
  private synced = false;

  /** account <-> this browser: the best of both, saved to both (ADR-047). */
  private async sync(): Promise<void> {
    try {
      const remote = await pullProgress();
      const merged = mergeProgress(this.progress, remote);
      this.progress = merged;
      this.store.save(merged);
      if (!remote || !sameProgress(remote, merged)) await pushProgress(merged);
      this.synced = true;
      this.acct.msg = `Synced ${new Date().toLocaleTimeString()}`;
      this.acct.bad = false;
    } catch (e) {
      this.acct.msg = currentUser() ? `Sync failed: ${(e as Error).message}` : "Signed out - sign in again";
      this.acct.bad = true;
    }
    this.render();
  }

  // ---- attempts ----
  private start(qs: Array<Question | Situation>): void {
    const r = rng(this.seed++);
    this.attempt = {
      qs: qs.map((q) => {
        const order = q.options.map((_, i) => i);
        for (let i = order.length - 1; i > 0; i--) {
          const j = Math.floor(r() * (i + 1));
          [order[i], order[j]] = [order[j]!, order[i]!];
        }
        return { ...q, order };
      }),
      picked: new Map(),
      checked: false,
    };
  }
  private score(): number {
    const a = this.attempt!;
    return a.qs.filter((q) => a.picked.get(q.id) === q.correct).length / a.qs.length;
  }
  private finish(kind: "tests" | "sits" | "exam", id: string): void {
    const a = this.attempt!;
    a.checked = true;
    const s = this.score();
    this.progress[kind][id] = Math.max(this.progress[kind][id] ?? 0, s);
    this.store.save(this.progress);
    this.render();
    if (currentUser()) void this.sync();
  }

  private situations(l: Lesson): Situation[] {
    if (!l.generated) return l.situations;
    const g = this.d.gen();
    return g ? [...l.situations, ...generate(l.generated, GEN_SIZE, this.seed, g)] : l.situations;
  }

  // ---- render ----
  private render(): void {
    const wrap = el("div", "rv sc", "");
    const side = el("aside", "rv-side", "");
    const main = el("section", "rv-main", "");
    side.append(this.moduleCard(), this.accountCard());
    if (this.exam) main.append(this.examView());
    else if (this.lesson) main.append(this.lessonView(this.lesson));
    else main.append(this.intro());
    wrap.append(side, main);
    this.root.replaceChildren(wrap);
  }

  /** sign in / create account / sign out (ADR-047). */
  private accountCard(): HTMLElement {
    const c = card("Account");
    const u = currentUser();
    const msg = () => (this.acct.msg ? el("p", this.acct.bad ? "rv-note bad" : "rv-note", this.acct.msg) : undefined);
    if (u) {
      c.append(el("p", "rv-sub", `Signed in as ${u.email}. Progress syncs across your devices.`));
      const out = el("button", "g-btn", "Sign out") as HTMLButtonElement;
      out.type = "button";
      out.addEventListener("click", () => {
        void signOut().then(() => {
          this.synced = false;
          this.acct = { email: "", password: "", busy: false, msg: "Signed out. Progress stays in this browser.", bad: false };
          this.render();
        });
      });
      c.append(out);
      const m = msg();
      if (m) c.append(m);
      return c;
    }
    c.append(el("p", "rv-note", "Optional: sign in to keep progress on every device. Without it, progress stays in this browser."));
    const email = document.createElement("input");
    email.type = "email";
    email.placeholder = "Email";
    email.autocomplete = "username";
    email.className = "rv-in";
    email.value = this.acct.email;
    email.addEventListener("input", () => (this.acct.email = email.value.trim()));
    const pw = document.createElement("input");
    pw.type = "password";
    pw.placeholder = "Password (8+ characters)";
    pw.autocomplete = "current-password";
    pw.className = "rv-in";
    pw.value = this.acct.password;
    pw.addEventListener("input", () => (this.acct.password = pw.value));
    const run = async (what: "in" | "up" | "reset") => {
      const { email: e, password: p } = this.acct;
      if (!/^\S+@\S+\.\S+$/.test(e)) return this.note("Enter your email.", true);
      if (what !== "reset" && p.length < 8) return this.note("The password needs at least 8 characters.", true);
      this.acct.busy = true;
      this.render();
      try {
        if (what === "in") {
          await signIn(e, p);
          this.acct.password = "";
          this.acct.msg = "Signed in.";
          this.acct.bad = false;
          await this.sync();
        } else if (what === "up") {
          const r = await signUp(e, p);
          this.acct.password = "";
          if (r === "signed-in") await this.sync();
          else this.note("Check your email and open the confirmation link, then sign in here.", false);
        } else {
          await resetPassword(e);
          this.note("If the account exists, a password reset email is on its way.", false);
        }
      } catch (err) {
        const m = String((err as Error).message ?? err);
        this.note(/invalid login/i.test(m) ? "Wrong email or password (or the email is not confirmed yet)." : /not confirmed/i.test(m) ? "Confirm your email first: open the link we sent." : m, true);
      } finally {
        this.acct.busy = false;
        this.render();
      }
    };
    const form = document.createElement("form");
    form.className = "sc-acct";
    form.addEventListener("submit", (ev) => {
      ev.preventDefault();
      void run("in");
    });
    const inB = el("button", "g-btn", "Sign in") as HTMLButtonElement;
    inB.type = "submit";
    const upB = el("button", "g-btn", "Create account") as HTMLButtonElement;
    upB.type = "button";
    upB.addEventListener("click", () => void run("up"));
    const rsB = el("button", "link", "Forgot password") as HTMLButtonElement;
    rsB.type = "button";
    rsB.addEventListener("click", () => void run("reset"));
    for (const b of [inB, upB, rsB]) b.disabled = this.acct.busy;
    const row = el("div", "game-row", "");
    row.append(inB, upB, rsB);
    form.append(email, pw, row);
    c.append(form);
    const m = msg();
    if (m) c.append(m);
    return c;
  }
  private note(msg: string, bad: boolean): void {
    this.acct.msg = msg;
    this.acct.bad = bad;
    this.render();
  }

  private intro(): HTMLElement {
    const c = el("div", "sc-intro", "");
    c.append(
      el("h2", "", "School"),
      el("p", "", "Start from zero and build up: every lesson has the theory and a test on it, situations to decide (map, items, draft), and a practice goal checked on your own reviewed matches."),
      el("p", "rv-note", `Facts checked for patch ${this.mod.patch} (${this.mod.checked}). Progress is kept in this browser, and on your account if you sign in.`),
    );
    const go = el("button", "g-btn", "Start with lesson 1") as HTMLButtonElement;
    go.type = "button";
    go.addEventListener("click", () => this.open(this.mod.lessons[0]!));
    c.append(go);
    return c;
  }

  private open(l: Lesson, tab: Tab = "theory"): void {
    this.lesson = l;
    this.exam = false;
    this.tab = tab;
    this.attempt = undefined;
    this.render();
    window.scrollTo(0, 0);
  }

  private moduleCard(): HTMLElement {
    const c = card(`Module 1 - ${this.mod.title}`);
    const ul = el("ol", "sc-lessons", "");
    for (const l of this.mod.lessons) {
      const li = el("li", this.lesson?.id === l.id && !this.exam ? "on" : "", "");
      const b = el("button", "sc-l", l.title) as HTMLButtonElement;
      b.type = "button";
      b.addEventListener("click", () => this.open(l));
      const t = this.progress.tests[l.id];
      const s = this.progress.sits[l.id];
      const marks = el("span", "sc-marks", "");
      marks.append(mark("T", t), mark("S", s));
      li.append(b, marks);
      ul.append(li);
    }
    c.append(ul);
    const passed = this.mod.lessons.every((l) => (this.progress.tests[l.id] ?? 0) >= PASS);
    const ex = el("button", "g-btn", "Module exam") as HTMLButtonElement;
    ex.type = "button";
    ex.disabled = !passed;
    ex.title = passed ? `${EXAM_SIZE} questions from all lessons; pass at ${EXAM_PASS * 100}%` : `Pass every lesson test (${PASS * 100}%+) first`;
    ex.addEventListener("click", () => {
      this.exam = true;
      this.lesson = undefined;
      const all = this.mod.lessons.flatMap((l) => l.quiz);
      const r = rng(this.seed++);
      this.start([...all].sort(() => r() - 0.5).slice(0, EXAM_SIZE));
      this.render();
    });
    const best = this.progress.exam[this.mod.id];
    c.append(ex, el("p", "rv-note", best !== undefined ? `Exam best: ${Math.round(best * 100)}%${best >= EXAM_PASS ? " - passed ✓" : ""}` : "T = theory test, S = situations (best result)."));
    return c;
  }

  private lessonView(l: Lesson): HTMLElement {
    const box = el("div", "sc-lesson", "");
    const i = this.mod.lessons.indexOf(l);
    box.append(el("h2", "", `${i + 1}. ${l.title}`), el("p", "rv-sub", l.lead));
    const tabs = el("div", "rv-tabs", "");
    const names: Array<[Tab, string]> = [
      ["theory", "Theory"],
      ["test", "Test"],
      ["sits", "Situations"],
      ["practice", "Practice"],
    ];
    for (const [t, n] of names) {
      const b = el("button", `rv-tab${this.tab === t ? " on" : ""}`, n) as HTMLButtonElement;
      b.type = "button";
      b.addEventListener("click", () => {
        this.tab = t;
        this.attempt = undefined;
        this.render();
      });
      tabs.append(b);
    }
    box.append(tabs);
    if (this.tab === "theory") {
      for (const blk of l.theory) {
        const s = el("section", "sc-th", "");
        s.append(el("h3", "", blk.h));
        appendText(s, blk.p);
        box.append(s);
      }
      const next = el("button", "g-btn", "Take the test →") as HTMLButtonElement;
      next.type = "button";
      next.addEventListener("click", () => {
        this.tab = "test";
        this.render();
      });
      box.append(next);
    } else if (this.tab === "test") {
      if (!this.attempt) this.start(l.quiz);
      box.append(this.quiz("tests", l.id, l.quiz.length));
    } else if (this.tab === "sits") {
      const sits = this.situations(l);
      if (!sits.length) box.append(el("p", "muted", "No situations for this lesson yet."));
      else {
        if (!this.attempt) this.start(sits);
        if (l.generated) box.append(el("p", "rv-note", `Part of these come from the knowledge base for random ${l.generated === "items" ? "enemy lineups" : "drafts"}: the engine's best answer against options it scores far lower.`));
        box.append(this.quiz("sits", l.id, sits.length, l.generated ? () => this.start(this.situations(l)) : undefined));
      }
    } else {
      box.append(this.practice(l));
    }
    if (i + 1 < this.mod.lessons.length) {
      const nx = el("button", "link sc-next", `Next lesson: ${this.mod.lessons[i + 1]!.title} →`) as HTMLButtonElement;
      nx.type = "button";
      nx.addEventListener("click", () => this.open(this.mod.lessons[i + 1]!));
      box.append(nx);
    }
    return box;
  }

  private examView(): HTMLElement {
    const box = el("div", "sc-lesson", "");
    box.append(el("h2", "", `${this.mod.title}: exam`), el("p", "rv-sub", `${EXAM_SIZE} questions from every lesson. Pass at ${EXAM_PASS * 100}%.`));
    box.append(this.quiz("exam", this.mod.id, EXAM_SIZE, () => {
      const all = this.mod.lessons.flatMap((l) => l.quiz);
      const r = rng(this.seed++);
      this.start([...all].sort(() => r() - 0.5).slice(0, EXAM_SIZE));
    }));
    return box;
  }

  /** one attempt: every question on the page, Check shows right / wrong and why. */
  private quiz(kind: "tests" | "sits" | "exam", id: string, n: number, regenerate?: () => void): HTMLElement {
    const a = this.attempt!;
    const box = el("div", "sc-quiz", "");
    a.qs.forEach((q, qi) => {
      const f = el("fieldset", "sc-q", "");
      if ("scene" in q) f.append(el("p", "sc-scene", q.scene));
      f.append(el("legend", "", `${qi + 1}. ${q.q}`));
      for (const oi of q.order) {
        const lab = document.createElement("label");
        const picked = a.picked.get(q.id) === oi;
        lab.className = `sc-o${a.checked ? (oi === q.correct ? " right" : picked ? " wrong" : "") : ""}`;
        const inp = document.createElement("input");
        inp.type = "radio";
        inp.name = q.id;
        inp.checked = picked;
        inp.disabled = a.checked;
        inp.addEventListener("change", () => {
          a.picked.set(q.id, oi);
          this.renderButtonsOnly(box, kind, id, n, regenerate);
        });
        lab.append(inp, document.createTextNode(` ${q.options[oi]}`));
        f.append(lab);
      }
      if (a.checked) f.append(el("p", a.picked.get(q.id) === q.correct ? "sc-why ok" : "sc-why", q.why));
      box.append(f);
    });
    this.renderButtonsOnly(box, kind, id, n, regenerate);
    return box;
  }
  private renderButtonsOnly(box: HTMLElement, kind: "tests" | "sits" | "exam", id: string, n: number, regenerate?: () => void): void {
    box.querySelector(".sc-foot")?.remove();
    const a = this.attempt!;
    const foot = el("div", "sc-foot", "");
    if (!a.checked) {
      const all = a.picked.size === a.qs.length;
      const b = el("button", "g-btn", all ? "Check" : `Answer all (${a.picked.size}/${a.qs.length})`) as HTMLButtonElement;
      b.type = "button";
      b.disabled = !all;
      b.addEventListener("click", () => this.finish(kind, id));
      foot.append(b);
    } else {
      const s = this.score();
      const pass = kind === "exam" ? EXAM_PASS : PASS;
      foot.append(el("b", s >= pass ? "good" : "bad", `${Math.round(s * 100)}% - ${s >= pass ? "passed" : `${Math.round(pass * 100)}% needed`}`));
      const again = el("button", "g-btn", regenerate ? "New set" : "Try again") as HTMLButtonElement;
      again.type = "button";
      again.addEventListener("click", () => {
        if (regenerate) regenerate();
        else this.start(a.qs);
        this.render();
      });
      foot.append(again);
    }
    void n;
    box.append(foot);
  }

  private practice(l: Lesson): HTMLElement {
    const box = el("div", "sc-practice", "");
    if (!l.practice.length) {
      box.append(el("p", "muted", "This lesson has no practice goal: its ideas are checked in the tests and situations."));
      return box;
    }
    const reviews = this.d.reviews();
    box.append(el("p", "rv-note", "Goals are checked on your reviewed matches (Review tab): play, let the match be reviewed, come back."));
    for (const g of l.practice) {
      const c = checkGoal(g, reviews);
      const row = el("div", `sc-goal${c.done ? " done" : ""}`, "");
      row.append(el("b", "", `${c.done ? "✓ " : ""}${g.text}`));
      row.append(el("p", "rv-sub", c.counted ? `${c.met} of your last ${c.counted} fitting matches (goal: ${g.need} of ${g.of}).` : "No fitting reviewed match yet."));
      if (c.per.length) {
        const ul = el("ul", "sc-per", "");
        for (const p of c.per) ul.append(el("li", p.ok ? "good" : "bad", p.value));
        row.append(ul);
      }
      box.append(row);
    }
    return box;
  }
}

// ---- helpers ---------------------------------------------------------------------

function mark(letter: string, v: number | undefined): HTMLElement {
  const m = el("span", `sc-m${v === undefined ? "" : v >= PASS ? " ok" : " low"}`, letter);
  m.title = v === undefined ? "not taken" : `best ${Math.round(v * 100)}%`;
  return m;
}

/** paragraphs with **bold** and "- " list lines. */
function appendText(host: HTMLElement, ps: string[]): void {
  let list: HTMLElement | undefined;
  for (const p of ps) {
    const isItem = p.startsWith("- ");
    if (isItem && !list) {
      list = el("ul", "", "");
      host.append(list);
    }
    if (!isItem) list = undefined;
    const node = el(isItem ? "li" : "p", "", "");
    const text = isItem ? p.slice(2) : p;
    text.split(/(\*\*[^*]+\*\*)/).forEach((part) => {
      if (part.startsWith("**") && part.endsWith("**")) node.append(el("b", "", part.slice(2, -2)));
      else if (part) node.append(document.createTextNode(part));
    });
    (isItem ? list! : host).append(node);
  }
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
