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
  const pc = (x: number) => `${Math.round(x * 100)}%`;
  // by phase (ADR-059): the leading school and who deals most of the damage then
  const phaseName = { lane: "lane", mid: "mid game", late: "late" } as const;
  const phases = d.phases
    .map((ph) => {
      const top = ph.physical >= ph.magic && ph.physical >= ph.pure ? "physical" : ph.magic >= ph.pure ? "magic" : "pure";
      const who = ph.by[0] ? ` <span class="muted">(${esc(labelFor(ph.by[0].hero))} ${pc(ph.by[0].share)})</span>` : "";
      return `${phaseName[ph.id]} ${pc(ph[top])} <b class="${leanClass(top)}">${top}</b>${who}`;
    })
    .join(" · ");
  p.innerHTML =
    `They deal ${school(d.defenseLean)} damage: ${pc(d.physThreat)} physical, ${pc(d.magicThreat)} magic` +
    (d.pureThreat >= 0.05 ? `, ${pc(d.pureThreat)} pure` : "") +
    ` - build ${build}. ` +
    (phases ? `By phase: ${phases}. ` : "") +
    (d.offenseLean === "mixed"
      ? "Neither damage type has an edge against them."
      : `They are softer to ${school(d.offenseLean)} damage.`);
  return p;
}
const signed = (x: number, digits = 1) => `${x >= 0 ? "+" : "\u2212"}${Math.abs(x).toFixed(digits)}`;

/** ADR-061: the estimated edge by enemy, best first - measured matchups where there are
 *  games, mechanics where there are none. */
function edgeLine(rec: Recommendation): string {
  const parts = [...rec.edge!.byEnemy]
    .sort((a, b) => b.edge - a.edge)
    .map((x) => {
      const cls = x.edge >= 0.5 ? "good" : x.edge <= -0.5 ? "bad" : "";
      const how = x.games
        ? `measured ${signed(x.gap!)} pp over ${x.games} games (weight ${Math.round(x.dataWeight * 100)}%); mechanics ${signed(x.kb - x.baseline, 2)} above this hero's usual`
        : `no matchup data: mechanics only, ${signed(x.kb - x.baseline, 2)} above this hero's usual`;
      return `<span class="${cls}" title="${esc(how)}">${esc(labelFor(x.enemy))} ${signed(x.edge)}</span>`;
    });
  for (const a of rec.edge!.allies ?? []) {
    if (Math.abs(a.edge) < 0.05) continue;
    const cls = a.edge >= 0.5 ? "good" : a.edge <= -0.5 ? "bad" : "";
    parts.push(`<span class="${cls}" title="${esc(`Together with ${labelFor(a.ally)}: ${signed(a.gap)} pp vs the rate expected from both base rates, ${a.games} games (measured synergy)`)}">with ${esc(labelFor(a.ally))} ${signed(a.edge)}</span>`);
  }
  if (Math.abs(rec.edge!.team) >= 0.05) parts.push(`<span title="What the pick adds to your lineup's needs (KB, small weight: it did not predict outcomes in the backtest)">team ${signed(rec.edge!.team)}</span>`);
  return `<span class="muted">By enemy, pp:</span> ${parts.join(" · ")}`;
}

function edgeTip(rec: Recommendation): string {
  const e = rec.edge!;
  return [
    "Estimated win-rate edge against this draft, percentage points.",
    "Per enemy: the measured matchup (vs the rate expected from both heroes' base rates), shrunk toward the KB mechanics by sample size.",
    `Sum ${signed(e.total, 2)}${rec.roleFit && rec.roleFit.factor < 1 ? ` x role fit ${rec.roleFit.factor} = ${signed(rec.score, 2)}` : ""}.`,
  ].join("\n");
}

/** below this share of games relative to the hero's main position the card says "rare on pos N". */
const ROLE_NOTE_REL = 0.6;

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
  const total = t.physical + t.magic + (t.pure ?? 0);
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
  // measured part of the edge: the games-weighted gap over the enemies with data
  const withData = (rec.edge?.byEnemy ?? []).filter((x) => x.gap !== undefined && x.games);
  const games = withData.reduce((n, x) => n + x.games!, 0);
  const pp = games ? Math.round((withData.reduce((g, x) => g + x.gap! * x.games!, 0) / games) * 10) / 10 : undefined;
  const tip = [
    `${pct}% win rate vs their team across ${rec.winrateGames} matches (${matchupSource})`,
    pp !== undefined ? `vs expected from both heroes' base rates: ${pp >= 0 ? "+" : ""}${pp} pp on average` : "",
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
  // ADR-061: lead with the mechanism against the enemy this pick is best against
  const best = rec.edge ? [...rec.edge.byEnemy].sort((a, b) => b.edge - a.edge)[0] : undefined;
  if (best && best.edge > 0) {
    const vsBest = counters.filter((r) => r.enemy === best.enemy && r.basis !== "team").sort((a, b) => b.contribution - a.contribution)[0];
    if (vsBest) return vsBest;
    // the best matchup is a measured one with no mechanism in the KB: the card says so (measuredLead)
    if (best.games) return undefined;
  }
  return (counters.length ? counters : rec.reasons).slice().sort((a, b) => b.contribution - a.contribution)[0];
}

/** The lead line of a pick whose best matchup is known from data only (ADR-061). */
function measuredLead(rec: Recommendation): string | undefined {
  const best = rec.edge ? [...rec.edge.byEnemy].sort((a, b) => b.edge - a.edge)[0] : undefined;
  if (!best || best.edge <= 0 || !best.games || best.gap === undefined) return undefined;
  const games = best.games >= 1000 ? `${(best.games / 1000).toFixed(1)}k` : String(best.games);
  return `<b>vs ${esc(labelFor(best.enemy))}:</b> wins ${signed(best.gap)} pp more often than both heroes' base win rates predict (${games} games). <span class="muted">Measured; no mechanism for it in the KB yet.</span>`;
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
  // ADR-060: the hero is seldom played on the chosen position - say so, the score is already lowered
  if (isHero && rec.roleFit && rec.roleFit.rel < ROLE_NOTE_REL) {
    const rf = rec.roleFit;
    const how = rf.share !== undefined ? `${Math.round(rf.share * 100)}% of its games` : "not its usual role";
    meta.push(`<span class="off" title="Share of this hero's games on position ${rf.pos} in our bracket - score x${rf.factor}">rare on pos ${rf.pos} (${how})</span>`);
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
  sc.innerHTML = rec.edge
    ? `<b title="${esc(edgeTip(rec))}">${signed(rec.score)}<small> pp</small></b>${winrateBadge(rec)}`
    : `<b title="KB score">${rec.score.toFixed(1)}</b>${winrateBadge(rec)}`;
  card.appendChild(sc);

  const lead = leadReason(rec);
  const measured = lead ? undefined : measuredLead(rec);
  if (lead || measured) {
    const why = document.createElement("p");
    why.className = "why";
    why.innerHTML = lead ? reasonSummary(lead, rec) : measured!;
    card.appendChild(why);
  }
  if (rec.edge?.byEnemy.length) {
    const line = document.createElement("p");
    line.className = "edge-line";
    line.innerHTML = edgeLine(rec);
    card.appendChild(line);
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

