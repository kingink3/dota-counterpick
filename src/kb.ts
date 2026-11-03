// =============================================================================
//  Knowledge-base loader (Node/fs side): read taxonomy.yaml (+ items.yaml,
//  hero_edges.yaml) from disk and hand the raw objects to the pure indexer.
//  KB-only MVP - no DB, no stat ingest (ADR-004, ADR-006).
// =============================================================================

import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import { indexKB, type KnowledgeBase, type Matchups, type RawKB } from "./knowledge.js";
import type {
  Archetype,
  AttackType,
  Combo,
  DefenseEdge,
  HeroEdge,
  ItemDef,
  ItemEdge,
  ItemFitTable,
  Taxonomy,
} from "./types.js";
import { heroValveName } from "./web/hero-art.js";

export type { KnowledgeBase } from "./knowledge.js";

const HERE = dirname(fileURLToPath(import.meta.url));
/** repo root = parent of src/. Keeps the loader runnable from anywhere. */
export const REPO_ROOT = resolve(HERE, "..");

function readYaml<T>(path: string): T {
  return parseYaml(readFileSync(path, "utf8")) as T;
}

/** Read + parse the KB files into the fs-free RawKB shape (also what kb.json holds). */
export function readRawKB(root: string = REPO_ROOT): RawKB {
  const taxonomy = readYaml<Taxonomy>(join(root, "taxonomy.yaml"));
  const itemsDoc = readYaml<{ items: Record<string, Omit<ItemDef, "code">> }>(
    join(root, "data", "items.yaml"),
  );
  const heroEdgesDoc = readYaml<{ hero_edges?: HeroEdge[] }>(
    join(root, "data", "hero_edges.yaml"),
  );
  const defenseDoc = readYaml<{ defense?: DefenseEdge[] }>(
    join(root, "data", "defense.yaml"),
  );
  const itemEdgesDoc = readYaml<{ item_edges?: ItemEdge[] }>(
    join(root, "data", "item_edges.yaml"),
  );

  const items: ItemDef[] = Object.entries(itemsDoc.items ?? {}).map(
    ([code, def]) => ({ code, ...def }),
  );

  const curated: HeroEdge[] = (heroEdgesDoc.hero_edges ?? []).map((he) => ({
    ...he,
    source: "curated" as const,
  }));
  const curatedItems: ItemEdge[] = (itemEdgesDoc.item_edges ?? []).map((ie) => ({
    ...ie,
    source: "curated" as const,
  }));

  // Combos come entirely from the wiki "Works well with" sections (no curated list).
  const wiki = loadWiki(root, taxonomy.hero_tags, curated, curatedItems);

  const itemFit = loadItemFit(root);
  const canon = (id: string) => itemFit?.alias[id] ?? id;
  // items that left the shop (patch:check -> item_fit.yaml `unavailable`) never reach the engine
  const gone = new Set(itemFit?.unavailable ?? []);
  // one id per item: wiki slugs like "orchid_malevolence" merge into "orchid"; a
  // duplicate (same item -> same target) after merging keeps the first (curated) one
  const seen = new Set<string>();
  const itemEdges = [...curatedItems, ...wiki.itemEdges]
    .map((e) => ({ ...e, item: canon(e.item) }))
    .filter((e) => {
      if (gone.has(e.item)) return false;
      const k = `${e.item}>${e.target}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });

  return {
    taxonomy,
    items: items.filter((i) => !gone.has(i.code)),
    heroEdges: [...curated, ...wiki.heroEdges],
    itemEdges,
    defenseEdges: (defenseDoc.defense ?? []).map((d) => ({ ...d, item: canon(d.item) })).filter((d) => !gone.has(d.item)),
    combos: wiki.combos,
    ...(itemFit ? { itemFit } : {}),
    heroAttack: loadHeroAttack(root, Object.keys(taxonomy.hero_tags)),
  };
}

/** data/item_fit.yaml -> ItemFitTable (optional layer, ADR-018). */
function loadItemFit(root: string): ItemFitTable | undefined {
  let doc: {
    wrong_attack?: number;
    archetype_override?: Record<string, Archetype>;
    alias?: Record<string, string>;
    fit?: Record<string, [number, number, number, number]>;
    melee_only?: string[];
    ranged_only?: string[];
    unavailable?: string[];
  };
  try {
    doc = readYaml(join(root, "data", "item_fit.yaml"));
  } catch {
    return undefined;
  }
  return {
    wrongAttack: doc.wrong_attack ?? 0.25,
    override: doc.archetype_override ?? {},
    alias: doc.alias ?? {},
    fit: doc.fit ?? {},
    meleeOnly: doc.melee_only ?? [],
    rangedOnly: doc.ranged_only ?? [],
    unavailable: doc.unavailable ?? [],
  };
}

/** roster.json `attack` -> map keyed by roster valve AND by KB code (they differ for
 *  ~16 legacy names, e.g. sniper == sniper but shadow_fiend -> nevermore). */
function loadHeroAttack(root: string, kbCodes: string[]): Record<string, AttackType> {
  const out: Record<string, AttackType> = {};
  try {
    const roster = JSON.parse(readFileSync(join(root, "data", "roster.json"), "utf8")) as {
      heroes: Array<{ valve: string; attack?: AttackType }>;
    };
    const byValve = new Map(roster.heroes.map((h) => [h.valve, h.attack]));
    for (const [valve, a] of byValve) if (a) out[valve] = a;
    for (const code of kbCodes) {
      const a = byValve.get(heroValveName(code));
      if (a) out[code] = a;
    }
  } catch {
    /* roster optional for the engine */
  }
  return out;
}

/**
 * Convert scraped wiki data (data/wiki-counters.json) into the engine's enrichment
 * layers. For each hero page P:
 *   - "Bad against" heroes H  -> hero_edge  H counters P
 *   - "Items" that beat P     -> item_edge  item counters P
 *   - "Works well with" H     -> combo      P + H synergy
 * Honest (ADR-004): everything is source "wiki", low weight (0.5), capped per
 * target to bound size, and curated entries for the same pair win. Targets may be
 * ANY roster hero (not just hero_tags), so untagged enemies get coverage too.
 */
interface WikiPage {
  badAgainst: Array<{ code: string | null; name: string; notes: string[] }>;
  items: Array<{ slug: string; name: string; note: string }>;
  synergy: Array<{ code: string | null; name: string; notes: string[] }>;
}

const WIKI_HERO_CAP = 14; // max wiki hero counters per enemy
const WIKI_ITEM_CAP = 8; // max wiki item counters per enemy

/** fold wiki item slugs onto our canonical ids so they merge instead of duplicating. */
const WIKI_ITEM_ALIAS: Record<string, string> = {
  heaven_s_halberd: "heavens_halberd",
  eul_s_scepter_of_divinity: "euls_scepter",
  linken_s_sphere: "linkens_sphere",
  monkey_king_bar: "monkey_king_bar",
  eye_of_skadi: "eye_of_skadi",
};

function loadWiki(
  root: string,
  heroTags: Record<string, unknown>,
  curatedHero: HeroEdge[],
  curatedItem: ItemEdge[],
): { heroEdges: HeroEdge[]; itemEdges: ItemEdge[]; combos: Combo[] } {
  let doc: { pages?: Record<string, WikiPage> };
  try {
    doc = readYaml(join(root, "data", "wiki-counters.json"));
  } catch {
    return { heroEdges: [], itemEdges: [], combos: [] }; // optional layer
  }
  const pages = doc.pages ?? {};

  const heroKeys = new Set(curatedHero.map((e) => `${e.subject}>${e.target}`));
  const itemKeys = new Set(curatedItem.map((e) => `${e.item}>${e.target}`));
  // unordered pair -> combo + how many of the two hero pages mention it (strength)
  const comboMap = new Map<string, { pair: [string, string]; mechanism: string; strength: number }>();

  const heroEdges: HeroEdge[] = [];
  const itemEdges: ItemEdge[] = [];

  for (const [target, page] of Object.entries(pages)) {
    let nHero = 0;
    for (const e of page.badAgainst ?? []) {
      if (nHero >= WIKI_HERO_CAP) break;
      const subject = e.code;
      if (!subject || subject.includes("=") || !heroTags[subject]) continue;
      if (!e.notes.length) continue;
      const key = `${subject}>${target}`;
      if (heroKeys.has(key)) continue;
      heroKeys.add(key);
      nHero++;
      heroEdges.push({ subject, target, mechanism: e.notes[0]!.slice(0, 180), weight: 0.5, source: "wiki" });
    }

    let nItem = 0;
    for (const it of page.items ?? []) {
      if (nItem >= WIKI_ITEM_CAP) break;
      if (!it.slug || !it.note) continue;
      const slug = WIKI_ITEM_ALIAS[it.slug] ?? it.slug;
      const key = `${slug}>${target}`;
      if (itemKeys.has(key)) continue;
      itemKeys.add(key);
      nItem++;
      itemEdges.push({ item: slug, label: it.name, target, mechanism: it.note.slice(0, 180), weight: 0.5, source: "wiki" });
    }

    for (const s of page.synergy ?? []) {
      const partner = s.code;
      if (!partner || partner.includes("=") || partner === target) continue;
      if (!s.notes.length) continue;
      const pair: [string, string] = [target, partner];
      const key = pairKey(pair);
      const existing = comboMap.get(key);
      if (existing) existing.strength++; // mentioned on both heroes' pages -> mutual
      else comboMap.set(key, { pair, mechanism: s.notes[0]!.slice(0, 200), strength: 1 });
    }
  }

  const combos: Combo[] = [...comboMap.values()].map((c) => ({
    pair: c.pair,
    lane: "synergy",
    mechanism: c.mechanism,
    source: "wiki",
    strength: c.strength,
  }));
  return { heroEdges, itemEdges, combos };
}

/** order-independent key for a hero pair. */
function pairKey(pair: readonly string[]): string {
  return [...pair].sort().join("+");
}

export function loadKB(root: string = REPO_ROOT): KnowledgeBase {
  const kb = indexKB(readRawKB(root));
  try {
    const doc = readYaml<{ heroes?: Matchups }>(join(root, "data", "matchups.json"));
    if (doc.heroes) kb.matchups = doc.heroes;
  } catch {
    /* optional stat layer; absent is fine */
  }
  return kb;
}
