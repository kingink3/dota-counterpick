// =============================================================================
//  Recommendation cards and reason texts (ADR-012 §4), damage and team reads.
//  Split out of main.ts (ADR-040).
// =============================================================================

import { type Archetype, type AttackType, type DamageRead, type Reason, type Recommendation, type TeamRead } from "../types.js";
import { byEngineId, collapse, esc, kb, labelFor, matchupSource, state } from "./app.js";
import { heroImageUrlByValve, heroValveName } from "./hero-art.js";

export function damageRead(d: DamageRead): HTMLElement {
  const p = document.createElement("p");
  p.className = "damage-read";
  const build =
    d.defenseLean === "physical" ? "armor" : d.defenseLean === "magic" ? "magic resistance" : "mixed defense";
  const school = (l: string) => (l === "mixed" ? "mixed" : `<b class="${leanClass(l)}">${l}</b>`);
  p.innerHTML =
    `They deal ${school(d.defenseLean)} damage (physical ${d.physThreat}, magic ${d.magicThreat}), so build ${build}. ` +
    (d.offenseLean === "mixed"
      ? "Neither damage type has an edge against them."
      : `They are softer to ${school(d.offenseLean)} damage.`);
  return p;
}
/** Your lineup (ADR-023): which team needs are covered, damage mix, lane opponents. */
export function teamRead(t: TeamRead): HTMLElement {
  const p = document.createElement("p");
  p.className = "damage-read team-read";
  const parts: string[] = [];
  for (const n of t.needs) {
    const state = n.have >= n.want ? "ok" : n.have > 0 ? "part" : "miss";
    const mark = state === "ok" ? "✓" : state === "part" ? "½" : "✗";
    parts.push(`<span class="need ${state}" title="${esc(`${n.label}: ${n.have} of ${n.want}`)}">${esc(n.label)} ${mark}</span>`);
  }
  const total = t.physical + t.magic;
  if (t.needs.length && total > 0) {
    const phys = Math.round((100 * t.physical) / total);
    const lean = phys >= 70 ? "physical" : phys <= 30 ? "magic" : "";
    parts.push(`damage <b class="${lean || "muted"}">${phys}% physical</b>`);
  }
  if (t.laneOpponents?.length) parts.push(`lane vs ${t.laneOpponents.map((c) => esc(labelFor(c))).join(", ")}`);
  p.innerHTML = `Your team: ${parts.join(" · ")}`;
  return p;
}
export const needLabel = (code?: string) =>
  code === "damage_mix" ? "Damage mix" : kb.taxonomy.team_needs?.find((n) => n.code === code)?.label ?? code ?? "";

export function leanClass(l: string): string {
  return l === "physical" ? "physical" : l === "magic" ? "magic" : "muted";
}

/**
 * Standalone combos panel - team synergy, independent of the enemy draft.
 * Curated duos show by default; the ~750 scraped wiki synergies are searchable
 * (rendering all at once would be far too heavy).
 */

/** win rate line under the score, coloured by side of 50, sample size in the tooltip. */
export function winrateBadge(rec: Recommendation): string {
  if (rec.winrate === undefined) return "";
  const pct = Math.round(rec.winrate * 100);
  const cls = pct >= 52 ? "wr good" : pct <= 48 ? "wr bad" : "wr";
  const st = rec.stat;
  const pp = st ? Math.round(st.advantage * 1000) / 10 : undefined;
  const tip = [
    `${pct}% win rate vs their team across ${rec.winrateGames} matches (${matchupSource})`,
    st?.base !== undefined ? `hero's own win rate ${Math.round(st.base * 1000) / 10}%` : "",
    st ? `vs expected from both heroes' base rates: ${pp! >= 0 ? "+" : ""}${pp} pp -> score x${st.factor.toFixed(3)} (${st.delta >= 0 ? "+" : ""}${st.delta.toFixed(2)} of ${rec.score.toFixed(1)}; KB ${st.kbScore.toFixed(2)})` : "",
  ].filter(Boolean).join("\n");
  const gapTxt = pp !== undefined && Math.abs(pp) >= 0.5 ? ` <small>${pp >= 0 ? "+" : ""}${pp} pp</small>` : "";
  return `<span class="${cls}" title="${esc(tip)}">${pct}% WR${gapTxt}</span>`;
}

export function archetypeLabel(a: Archetype, attack?: AttackType): string {
  const name = { carry: "carry", caster: "caster core", offlane: "offlaner", support: "support" }[a];
  return attack && (a === "carry" || a === "support") ? `${attack} ${name}` : name;
}

/** the single strongest counter reason (synergy shown in meta instead). */
export function leadReason(rec: Recommendation): Reason | undefined {
  const counters = rec.reasons.filter((r) => r.basis !== "synergy" && r.contribution > 0);
  return (counters.length ? counters : rec.reasons).slice().sort((a, b) => b.contribution - a.contribution)[0];
}

export function recCard(rec: Recommendation): HTMLElement {
  const isHero = rec.kind === "hero";
  const card = document.createElement("article");
  card.className = "card" + (isHero ? "" : " item");
  const name = isHero ? labelFor(rec.code) : rec.label;

  if (isHero) {
    const pt = document.createElement("div");
    pt.className = "pt";
    const img = document.createElement("img");
    img.alt = "";
    img.loading = "lazy";
    img.src = heroImageUrlByValve(byEngineId.get(rec.code)?.valve ?? heroValveName(rec.code));
    pt.appendChild(img);
    card.appendChild(pt);
  }

  const body = document.createElement("div");
  const meta: string[] = [];
  if (isHero && rec.pos) meta.push(`Pos ${rec.pos.join("/")}`);
  if (rec.school && rec.school !== "neutral") meta.push(`<span class="${rec.school}">${rec.school}</span>`);
  if (rec.synergyWith?.length) meta.push(`works with ${rec.synergyWith.map((c) => esc(labelFor(c))).join(", ")}`);
  const fills = [...new Set(rec.reasons.filter((r) => r.basis === "team").map((r) => needLabel(r.need).toLowerCase()))];
  if (fills.length) meta.push(`<span class="fills" title="Covers what your lineup lacks">fills ${esc(fills.join(", "))}</span>`);
  if (rec.risks?.length) {
    const tip = "Their kit hits a weakness of this pick (or blunts its damage) - score already lowered";
    meta.push(`<span class="off" title="${tip}">risky vs ${rec.risks.map((c) => esc(labelFor(c))).join(", ")}</span>`);
  }
  if (rec.fit && rec.fit.mult < 0.5) {
    card.classList.add("off-build");
    meta.push(`<span class="off" title="Counters them, but rarely built by this archetype (score x${rec.fit.mult})">unusual for a ${archetypeLabel(rec.fit.archetype, rec.fit.attack)}</span>`);
  }
  if (rec.rareOnHero !== undefined && state.myHero) {
    meta.push(`<span class="off" title="STRATZ: share of ${esc(labelFor(state.myHero))} games with this item - score lowered">rare on ${esc(labelFor(state.myHero))} (${Math.round(rec.rareOnHero * 100)}% of games)</span>`);
  }
  const own = rec.reasons.filter((r) => r.selfHas && (r.tool || r.selfGrant)).map((r) => (r.selfGrant ? resistLabel(r.selfGrant) : toolLabel(r.tool!)));
  if (own.length && state.myHero) {
    meta.push(`<span class="off" title="The hero you play already brings this - the item adds little for it">${esc(labelFor(state.myHero))} already has ${esc([...new Set(own)].join(", ").toLowerCase())}</span>`);
  }
  const ans = rec.coverage
    .map((c) => `<img title="answers ${esc(labelFor(c))}" alt="${esc(labelFor(c))}" src="${heroImageUrlByValve(byEngineId.get(c)?.valve ?? heroValveName(c))}">`)
    .join("");
  body.innerHTML =
    `<h3>${esc(name)}</h3>` +
    (meta.length ? `<div class="meta">${meta.join(" · ")}</div>` : "") +
    (ans ? `<div class="ans">${ans}</div>` : "");
  card.appendChild(body);

  const sc = document.createElement("div");
  sc.className = "sc";
  sc.innerHTML = `<b title="${esc(rec.stat ? `KB ${rec.stat.kbScore.toFixed(2)} x stat ${rec.stat.factor.toFixed(3)} = ${rec.score.toFixed(2)}` : "KB score")}">${rec.score.toFixed(1)}</b>${winrateBadge(rec)}`;
  card.appendChild(sc);

  const lead = leadReason(rec);
  if (lead) {
    const why = document.createElement("p");
    why.className = "why";
    why.innerHTML = reasonSummary(lead, rec);
    card.appendChild(why);
  }
  const rest = rec.reasons.filter((r) => r !== lead);
  if (rest.length) {
    const det = document.createElement("details");
    const sum = document.createElement("summary");
    sum.textContent = `${rest.length} more reason${rest.length > 1 ? "s" : ""}`;
    det.appendChild(sum);
    const list = document.createElement("ul");
    list.className = "reasons";
    for (const reason of rest) list.appendChild(reasonItem(reason, rec));
    det.appendChild(list);
    card.appendChild(det);
  }
  return card;
}

/** Wiki item notes are scraped with the item name cut off ("is a cheaper alternative…"). */
export function mechanismText(reason: Reason, rec: Recommendation): string {
  const m = collapse(reason.mechanism);
  if (reason.basis === "item_edge" && /^[a-z]/.test(m)) return `${rec.label} ${m}`;
  return m;
}

export const toolLabel = (c?: string) => (c ? kb.toolByCode.get(c)?.label ?? c : "");
export const relLabel = (c?: string) => (c ? kb.relianceByCode.get(c)?.label ?? c : "");
export const resistLabel = (c?: string) => (c ? kb.taxonomy.resistance?.find((r) => r.code === c)?.label ?? c : "");
/** what the enemy throws at the candidate (resist reasons): a tool or a damage source. */
export const threatLabel = (r: Reason) => (r.tool ? toolLabel(r.tool) : relLabel(r.reliance));

/** risk reason head: exposure "their tool → my weakness" or blunted "my tool into their resistance". */
export function riskHead(r: Reason): string {
  return r.resistance
    ? `${esc(r.tool ? toolLabel(r.tool) : relLabel(r.reliance))} blunted by ${esc(resistLabel(r.resistance))}`
    : `exposed: ${esc(toolLabel(r.tool))} → ${esc(relLabel(r.reliance))}`;
}

export const viaText = (r: Reason) => (r.via?.length ? ` <span class="via">(their ${esc(r.via.join(", "))})</span>` : "");

/** one-line lead: "<tool → reliance> vs <enemy>: mechanism". */
export function reasonSummary(reason: Reason, rec: Recommendation): string {
  return reasonSummaryText(reason, rec) + viaText(reason);
}
export function reasonSummaryText(reason: Reason, rec: Recommendation): string {
  const who = esc(labelFor(reason.enemy));
  const mech = esc(mechanismText(reason, rec));
  if (reason.basis === "synergy") return `<span class="lead">Combo with ${who}:</span> ${mech}`;
  if (reason.basis === "team") return `<span class="lead">Fills a gap: ${esc(needLabel(reason.need))}</span> - ${mech}`;
  if (reason.basis === "edge") {
    const tool = reason.tool ? kb.toolByCode.get(reason.tool)?.label ?? reason.tool : "";
    const rel = reason.reliance ? kb.relianceByCode.get(reason.reliance)?.label ?? reason.reliance : "";
    return `<span class="lead">${esc(tool)} → ${esc(rel)}</span> vs ${who}: ${mech}`;
  }
  if (reason.basis === "defense") {
    const threat = reason.tool ? kb.toolByCode.get(reason.tool)?.label ?? reason.tool : "";
    return `<span class="lead">Blocks ${esc(threat)}</span> from ${who}: ${mech}`;
  }
  if (reason.basis === "resist") {
    return `<span class="lead">${esc(resistLabel(reason.resistance))} shrugs off ${esc(threatLabel(reason))}</span> from ${who}: ${mech}`;
  }
  return `<span class="lead">vs ${who}:</span> ${mech}`;
}

export function reasonItem(reason: Reason, rec: Recommendation): HTMLElement {
  const li = document.createElement("li");
  if (reason.basis === "synergy") {
    li.innerHTML =
      `<span class="syn">+ combos with ${esc(labelFor(reason.enemy))}</span> ` +
      esc(mechanismText(reason, rec));
    return li;
  }
  if (reason.basis === "team") {
    li.innerHTML = `<span class="syn">+ team: ${esc(needLabel(reason.need))}</span> ` + esc(mechanismText(reason, rec));
    return li;
  }
  const enemy = `<span class="vs">vs ${esc(labelFor(reason.enemy))}</span> `;
  let body: string;
  if (reason.basis === "hero_edge") {
    // wiki reasons carry no badge (point: declutter); curated keep "hero-specific"
    const badge = reason.source === "wiki" ? "" : `<span class="badge">hero-specific</span> `;
    body = `${badge}${esc(mechanismText(reason, rec))}`;
  } else if (reason.basis === "item_edge") {
    const badge = reason.source === "wiki" ? "" : `<span class="badge">item-specific</span> `;
    body = `${badge}${esc(mechanismText(reason, rec))}`;
  } else if (reason.basis === "defense") {
    const threat = reason.tool ? kb.toolByCode.get(reason.tool)?.label ?? reason.tool : "";
    const head = `<span class="block">blocks ${esc(threat)}</span> `;
    body = head + esc(mechanismText(reason, rec));
  } else if (reason.basis === "resist") {
    const head = `<span class="block">${esc(resistLabel(reason.resistance))} vs ${esc(threatLabel(reason))}</span> `;
    body = head + esc(mechanismText(reason, rec));
  } else if (reason.basis === "risk") {
    li.classList.add("risk");
    body = `<span class="risk">− ${riskHead(reason)}</span> ` + esc(mechanismText(reason, rec));
  } else {
    const tool = reason.tool ? kb.toolByCode.get(reason.tool)?.label : "";
    const rel = reason.reliance ? kb.relianceByCode.get(reason.reliance)?.label : "";
    const head = tool && rel ? `<span class="edge">${esc(tool)} → ${esc(rel)}</span> ` : "";
    body = head + esc(mechanismText(reason, rec));
  }
  li.innerHTML = enemy + body + viaText(reason);

  if (state.showFactors) {
    const f = reason.factors;
    const parts = [
      f.toolWeight !== undefined ? `tool ${f.toolWeight}` : "",
      f.edgeWeight !== undefined ? `edge ${f.edgeWeight}` : "",
      f.targetWeight !== undefined ? `target ${f.targetWeight}` : "",
      f.stackWeight !== undefined ? `stack ${f.stackWeight}` : "",
      f.relianceWeight !== undefined ? `reliance ${f.relianceWeight}` : "",
      f.threatWeight !== undefined ? `threat ${f.threatWeight}` : "",
      f.defenseWeight !== undefined ? `defense ${f.defenseWeight}` : "",
      f.resistWeight !== undefined ? `resist ${f.resistWeight}` : "",
      f.enemyWeight !== undefined ? `enemy ${f.enemyWeight}` : "",
    ].filter(Boolean);
    const fac = document.createElement("span");
    fac.className = "factors";
    fac.textContent = ` [${parts.join(" × ")} = ${reason.contribution}]`;
    li.appendChild(fac);
  }
  for (const n of reason.notes ?? []) {
    const gn = document.createElement("div");
    gn.className = "guard-note";
    gn.textContent = "· " + n;
    li.appendChild(gn);
  }
  return li;
}

