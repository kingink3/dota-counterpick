// =============================================================================
//  Combos tab: curated combos, filtered by role and search.
//  Split out of main.ts (ADR-040).
// =============================================================================

import { genericCombos } from "../combos.js";
import { type RoleFit, roleFit } from "../combos.js";
import { type Combo } from "../types.js";
import { collapse, el, esc, grid, kb, labelFor, note } from "./app.js";
import { heroImageUrlByValve, heroValveName } from "./hero-art.js";

export const COMBO_LIMIT = 40;
export let comboSearch = "";
export function setComboSearch(v: string): void {
  comboSearch = v;
}

export function buildCombos(): void {
  genericSet = genericCombos(kb.combos, labelFor);
  const search = el("#combos-search") as HTMLInputElement;
  search.addEventListener("input", () => {
    comboSearch = search.value.trim().toLowerCase();
    // typing is a free-text filter, not a single-hero pick - clear grid highlights
    for (const t of document.querySelectorAll<HTMLElement>("#combo-roster .hero-tile")) {
      t.classList.remove("picked-ally");
    }
    renderCombos();
  });
  renderCombos();
}

export function renderCombos(): void {
  const root = el("#combos-panel");
  root.innerHTML = "";
  const q = comboSearch;

  // nothing selected/typed -> show only the hero grid above, no combos below
  if (q === "") {
    root.appendChild(note("Pick a hero above (or type a name) to see its strongest synergies."));
    return;
  }

  // the hero the user is looking at (exact name) is shown first on every card
  const focus = grid.find((g) => g.label.toLowerCase() === q)?.engineId;
  const posOf = (code: string) => kb.taxonomy.hero_tags[code]?.pos;
  const LANE_RANK: Record<RoleFit["lane"], number> = {
    "safe lane duo": 0, "off lane duo": 0, "support duo": 1, "mid + teammate": 2, "different lanes": 3,
  };
  const rows = kb.combos
    .filter((c) => c.pair.some((code) => labelFor(code).toLowerCase().includes(q)))
    .map((c) => ({ c, fit: roleFit(posOf(c.pair[0]), posOf(c.pair[1])), generic: genericSet.has(c) }));
  const conflicts = rows.filter((r) => r.fit === null);
  const shown = rows
    .filter((r) => r.fit !== null || showConflicts)
    // mutual first, specific before copy-paste lines, main roles before off-roles, lane duos first
    .sort(
      (a, b) =>
        Number(a.fit === null) - Number(b.fit === null) ||
        (b.c.strength ?? 0) - (a.c.strength ?? 0) ||
        Number(a.generic) - Number(b.generic) ||
        (a.fit?.cost ?? 9) - (b.fit?.cost ?? 9) ||
        (a.fit ? LANE_RANK[a.fit.lane] : 9) - (b.fit ? LANE_RANK[b.fit.lane] : 9) ||
        labelFor(a.c.pair[0]).localeCompare(labelFor(b.c.pair[0])),
    );

  if (shown.length === 0 && conflicts.length === 0) {
    root.appendChild(note("No synergies for that hero."));
    return;
  }
  const list = document.createElement("div");
  list.className = "combo-grid";
  for (const r of shown.slice(0, COMBO_LIMIT)) list.appendChild(comboCard(r.c, r.fit, r.generic, focus));
  root.appendChild(list);
  if (shown.length > COMBO_LIMIT) {
    root.appendChild(note(`Showing ${COMBO_LIMIT} of ${shown.length} synergies.`));
  }
  if (conflicts.length) {
    const p = document.createElement("p");
    p.className = "empty";
    const ex = conflicts[0]!.c.pair.map((code) => `${labelFor(code)} ${posOf(code)?.join("/")}`).join(" + ");
    p.innerHTML = showConflicts
      ? `Including ${conflicts.length} pair(s) that cannot share a team: both heroes only play the same position. `
      : `${conflicts.length} pair(s) hidden: both heroes only play the same position (e.g. ${esc(ex)}). `;
    const b = document.createElement("button");
    b.className = "link";
    b.textContent = showConflicts ? "Hide them" : "Show them";
    b.addEventListener("click", () => {
      showConflicts = !showConflicts;
      renderCombos();
    });
    p.appendChild(b);
    root.appendChild(p);
  }
}

export let showConflicts = false;
/** wiki lines copy-pasted across partners (computed once per KB). */
export let genericSet = new Set<Combo>();

export function comboCard(c: Combo, fit: RoleFit | null | undefined, generic: boolean, focus?: string): HTMLElement {
  const card = document.createElement("article");
  card.className = "card combo" + (fit === null ? " conflict" : "") + (generic ? " generic" : "");
  const flip = focus !== undefined && c.pair[1] === focus;
  const order: Array<[string, number | undefined]> = [
    [c.pair[0], fit?.pos[0]],
    [c.pair[1], fit?.pos[1]],
  ];
  if (flip) order.reverse();

  const head = document.createElement("div");
  head.className = "combo-head";
  for (const [code, pos] of order) {
    const cell = document.createElement("span");
    cell.className = "combo-hero";
    const img = document.createElement("img");
    img.loading = "lazy";
    img.alt = labelFor(code);
    img.src = heroImageUrlByValve(heroValveName(code));
    img.addEventListener("error", () => cell.classList.add("no-art"));
    const nm = document.createElement("span");
    nm.textContent = labelFor(code);
    cell.append(img, nm);
    if (pos !== undefined) {
      const p = document.createElement("b");
      p.className = "pos";
      p.title = `plays position ${pos} in this duo`;
      p.textContent = String(pos);
      cell.appendChild(p);
    }
    head.appendChild(cell);
  }
  if ((c.strength ?? 0) >= 2) {
    const tag = document.createElement("span");
    tag.className = "combo-strong";
    tag.title = "Both heroes' pages list this synergy";
    tag.textContent = "mutual";
    head.appendChild(tag);
  }
  card.appendChild(head);

  const roles = document.createElement("div");
  roles.className = "combo-roles";
  if (fit) {
    const offRole = order
      .filter(([code, pos]) => pos !== undefined && kb.taxonomy.hero_tags[code]?.pos[0] !== pos)
      .map(([code]) => labelFor(code));
    roles.innerHTML =
      `Pos ${order.map(([, pos]) => pos).join(" + ")}, ${fit.lane}` +
      (offRole.length ? ` <span class="muted">(${esc(offRole.join(", "))} off the main role)</span>` : "");
  } else if (fit === null) {
    roles.textContent = `Both only play pos ${kb.taxonomy.hero_tags[c.pair[0]]?.pos.join("/")}: not one team`;
  }
  if (generic) {
    const g = document.createElement("span");
    g.className = "combo-generic";
    g.title = "The wiki repeats this line for many partners with only the name changed";
    g.textContent = "generic";
    roles.appendChild(g);
  }
  if (roles.childNodes.length) card.appendChild(roles);

  const mech = document.createElement("div");
  mech.className = "combo-mech";
  mech.textContent = collapse(c.mechanism);
  card.appendChild(mech);
  return card;
}

