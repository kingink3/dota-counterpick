// =============================================================================
//  Draft tab extras (ADR-065): ban suggestions and "why not X".
//
//  Bans: in ranked All Pick the bans come before the picks, so the input is what
//  your side plans to play (the heroes on your team strip, the ★ hero among them).
//  Each candidate is scored as a pick AGAINST those heroes (heroEdge from the
//  enemy's side) and weighted by how often it is played - a ban on a hero nobody
//  picks is wasted.
//  Why not X: any hero's edge against the current draft, with its place in the
//  full ranking or the reason it is not offered for your position.
// =============================================================================

import { banSuggestions, heroEdge, resolve } from "../resolver.js";
import type { DraftState, Recommendation } from "../types.js";
import { esc, kb, labelFor, note, render, state } from "./app.js";
import { recCard } from "./rec-cards.js";

const pp = (x: number) => `${x >= 0 ? "+" : "−"}${Math.abs(x).toFixed(1)} pp`;

/** "Ban suggestions" (ADR-065/066): All Pick or Captain's Mode, plus the bans marked so far. */
export function banBlock(ours: string[], theirs: string[]): HTMLElement {
  const cm = state.banMode === "cm";
  const banned = [...state.bans];
  const bans = banSuggestions(kb, ours, theirs, cm ? 8 : 5, { mode: state.banMode, banned });
  const box = document.createElement("details");
  box.className = "bans";
  box.open = theirs.length === 0 || cm;
  const sum = document.createElement("summary");
  sum.innerHTML = `Ban suggestions${ours.length ? ` <span class="muted">against ${esc(ours.map(labelFor).join(", "))}</span>` : ""}`;
  box.appendChild(sum);
  const mode = document.createElement("span");
  mode.className = "ban-mode";
  for (const [id, text] of [["ap", "All Pick"], ["cm", "Captain's Mode"]] as const) {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = text;
    b.className = state.banMode === id ? "active" : "";
    b.addEventListener("click", () => {
      state.banMode = id;
      render();
    });
    mode.appendChild(b);
  }
  box.appendChild(mode);
  if (banned.length) {
    const line = document.createElement("p");
    line.append("Banned: ");
    for (const h of banned) {
      const c = document.createElement("span");
      c.className = "chip";
      c.title = "Remove the ban";
      c.textContent = `${labelFor(h)} ×`;
      c.addEventListener("click", () => {
        state.bans.delete(h);
        render();
      });
      line.appendChild(c);
    }
    box.appendChild(line);
  }
  if (!ours.length) {
    box.appendChild(note("Add your team's picks (or the heroes you plan) to get suggestions."));
    return box;
  }
  const list = document.createElement("ol");
  for (const b of bans) {
    const li = document.createElement("li");
    const worst = [...b.vs].sort((x, y) => y.edge - x.edge)[0];
    li.innerHTML =
      `<b>${esc(labelFor(b.hero))}</b> ${pp(b.edge)} as a pick against you` +
      ` <span class="muted">` +
      (cm ? "" : `· played in ${Math.round(b.pickShare * 100)}% of games`) +
      (ours.length > 1 && worst ? ` · hardest on ${esc(labelFor(worst.hero))} (${pp(worst.edge)})` : "") +
      `</span>`;
    list.appendChild(li);
  }
  if (bans.length) box.appendChild(list);
  else box.appendChild(note("No hero left with an edge against your picks."));
  const n = document.createElement("p");
  n.className = "muted plan-src";
  n.textContent = cm
    ? "Captain's Mode: the enemy captain picks on purpose, so ranked by the edge itself - among heroes that fit a position the enemy has not filled yet, with the enemy picks so far counted as their allies. Mark bans with the Ban button above the grid."
    : "Ranked All Pick: bans come before the picks, so this is against the heroes your side plans. Ranked by edge × how often the hero is played (a ban on a rare hero is wasted).";
  box.appendChild(n);
  return box;
}

/** "Why not …?" - type a hero, see its edge against this draft. */
export function whyNotBlock(draft: DraftState): HTMLElement {
  const box = document.createElement("div");
  box.className = "why-not";
  const label = document.createElement("label");
  label.textContent = "Why not… ";
  const input = document.createElement("input");
  input.type = "search";
  input.placeholder = "any hero";
  input.setAttribute("list", "why-not-heroes");
  input.autocomplete = "off";
  const dl = document.createElement("datalist");
  dl.id = "why-not-heroes";
  const byLabel = new Map<string, string>();
  for (const code of Object.keys(kb.taxonomy.hero_tags)) byLabel.set(labelFor(code).toLowerCase(), code);
  for (const l of [...byLabel.keys()].sort()) {
    const o = document.createElement("option");
    o.value = labelFor(byLabel.get(l)!);
    dl.appendChild(o);
  }
  label.append(input, dl);
  const result = document.createElement("div");
  box.append(label, result);
  const show = () => {
    const code = byLabel.get(input.value.trim().toLowerCase());
    result.replaceChildren();
    if (!code) return;
    result.append(...explainHero(draft, code));
  };
  input.addEventListener("change", show);
  input.addEventListener("input", () => {
    if (byLabel.has(input.value.trim().toLowerCase())) show();
  });
  return box;
}

function explainHero(draft: DraftState, code: string): HTMLElement[] {
  const line = document.createElement("p");
  line.className = "why-line";
  const name = `<b>${esc(labelFor(code))}</b>`;
  if (draft.bannedHeroes?.includes(code)) {
    line.innerHTML = `${name} is banned.`;
    return [line];
  }
  if (draft.enemyHeroes.includes(code) || (draft.allyHeroes ?? []).includes(code)) {
    line.innerHTML = `${name} is already picked.`;
    return [line];
  }
  const free: DraftState = { ...draft };
  delete free.myHero;
  const all = resolve(kb, free, { all: true }).heroes;
  const i = all.findIndex((r) => r.code === code);
  let rec: Recommendation | undefined = i >= 0 ? all[i] : undefined;
  if (rec) {
    const shown = all.filter((r) => r.score > 0).length;
    line.innerHTML =
      `${name}: ${pp(rec.score)} against this draft - #${i + 1} of ${all.length}` +
      (rec.score > 0 ? (i < 12 ? " (in the list above)." : ` (the list shows the top 12 of ${shown}).`) : ": at or below its usual, so it is not offered.");
  } else {
    // filtered out before ranking: position, or no evidence at all
    rec = heroEdge(kb, { enemyHeroes: draft.enemyHeroes, ...(draft.allyHeroes ? { allyHeroes: draft.allyHeroes } : {}) }, code);
    const share = draft.myRole !== undefined && kb.posShare?.[code] ? (kb.posShare[code]![String(draft.myRole)] ?? 0) : undefined;
    line.innerHTML =
      draft.myRole !== undefined && share !== undefined
        ? `${name} is not offered for position ${draft.myRole}: played there in ${(share * 100).toFixed(1)}% of its games.` +
          (rec?.edge ? ` Against this draft on its own: ${pp(rec.edge.total)}.` : "")
        : rec?.edge
          ? `${name}: ${pp(rec.edge.total)} against this draft (not in the ranked list for this position).`
          : `${name}: nothing measured or in the knowledge base speaks for or against it here.`;
  }
  return rec ? [line, recCard(rec)] : [line];
}
