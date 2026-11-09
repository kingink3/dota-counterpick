// Temporary (ADR-054 check): do supports win less after a core item, compared with supports
// in the same game state? OpenDota Explorer (pro / league matches with parsed data).
// Prints aggregates only.
//   npx tsx scripts/explorer-probe.ts [--days 120]
const arg = (n: string) => {
  const i = process.argv.indexOf(`--${n}`);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const EX = "https://api.opendota.com/api/explorer?sql=";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function q<T>(sql: string): Promise<T[]> {
  for (let i = 0; i < 4; i++) {
    const r = await fetch(EX + encodeURIComponent(sql)).catch((e) => ({ ok: false, status: String(e), json: async () => ({}) }) as never);
    if (r.ok) {
      const b = (await r.json()) as { rows?: T[]; err?: string };
      if (b.err) throw new Error(b.err);
      return b.rows ?? [];
    }
    console.log(`explorer HTTP ${r.status}, retry`);
    await sleep(5000 * (i + 1));
  }
  throw new Error("explorer unavailable");
}

const CORE = new Set(["black_king_bar", "bfury", "radiance", "desolator", "greater_crit", "butterfly", "satanic", "monkey_king_bar", "skadi", "manta", "bloodthorn", "abyssal_blade", "heart", "assault", "sange_and_yasha", "mjollnir", "silver_edge", "basher", "diffusal_blade", "maelstrom", "echo_sabre", "harpoon", "disperser", "kaya_and_sange", "yasha_and_kaya", "octarine_core", "shivas_guard", "refresher", "nullifier", "skadi", "sphere", "bloodstone", "overwhelming_blink", "swift_blink", "arcane_blink", "rapier", "mage_slayer", "orchid", "invis_sword", "armlet", "battle_fury", "dragon_lance", "hurricane_pike", "witch_blade", "parasma", "revenants_brooch", "khanda", "angels_demise"]);
const SUPPORT = new Set(["glimmer_cape", "force_staff", "lotus_orb", "pipe", "guardian_greaves", "solar_crest", "spirit_vessel", "cyclone", "ghost", "aeon_disk", "boots_of_bearing", "holy_locket", "pavise", "mekansm", "vladmir", "aether_lens", "ethereal_blade", "sheepstick", "wind_waker", "veil_of_discord", "rod_of_atos", "blink", "tranquil_boots", "arcane_boots"]);

interface Row { match_id: number; player_slot: number; radiant_win: boolean; gold_t: number[] | null; purchase_log: Array<{ time: number; key: string }> | null }

async function main() {
  const days = Number(arg("days") ?? 120);
  const head = await q<{ n: number; parsed: number }>(`SELECT count(*) n, count(*) FILTER (WHERE version IS NOT NULL) parsed FROM matches WHERE start_time > extract(epoch from now()) - ${days}*86400`);
  console.log(`matches in ${days} days: ${head[0]?.n}, parsed: ${head[0]?.parsed}`);
  const rows: Row[] = [];
  const PAGE = 4000;
  for (let off = 0; off < 200000; off += PAGE) {
    const page = await q<Row>(`SELECT pm.match_id, pm.player_slot, m.radiant_win, pm.gold_t, pm.purchase_log FROM player_matches pm JOIN matches m USING (match_id) WHERE m.start_time > extract(epoch from now()) - ${days}*86400 AND m.version IS NOT NULL AND pm.gold_t IS NOT NULL AND m.duration > 1500 ORDER BY pm.match_id, pm.player_slot LIMIT ${PAGE} OFFSET ${off}`);
    rows.push(...page);
    if (page.length < PAGE) break;
    await sleep(1500);
  }
  const byMatch = new Map<number, Row[]>();
  for (const r of rows) (byMatch.get(r.match_id) ?? byMatch.set(r.match_id, []).get(r.match_id)!).push(r);
  console.log(`rows ${rows.length}, matches with 10 players: ${[...byMatch.values()].filter((x) => x.length === 10).length}`);

  // support = the 2 lowest gold earned at 10:00 on their team
  type Sup = { win: boolean; gold: number[]; lead: number[]; first: Map<string, number> };
  const sups: Sup[] = [];
  for (const ps of byMatch.values()) {
    if (ps.length !== 10 || ps.some((p) => !p.gold_t || p.gold_t.length < 25)) continue;
    const team = (rad: boolean) => ps.filter((p) => p.player_slot < 128 === rad);
    const sum = (t: Row[], m: number) => t.reduce((a, p) => a + (p.gold_t![Math.min(m, p.gold_t!.length - 1)] ?? 0), 0);
    for (const rad of [true, false]) {
      const t = team(rad);
      const o = team(!rad);
      const sorted = [...t].sort((a, b) => a.gold_t![10]! - b.gold_t![10]!);
      for (const p of sorted.slice(0, 2)) {
        const n = p.gold_t!.length;
        const first = new Map<string, number>();
        for (const e of p.purchase_log ?? []) if (!first.has(e.key)) first.set(e.key, e.time);
        sups.push({ win: p.radiant_win === rad, gold: p.gold_t!, lead: Array.from({ length: n }, (_, m) => sum(t, m) - sum(o, m)), first });
      }
    }
  }
  console.log(`supports: ${sups.length}`);

  // treated: first item of the set finished in minute t (15..40); controls: supports at minute t
  // with no item of the set yet and none in the next 5 min; strata: minute, team lead (2k), own gold (1k)
  const study = (set: Set<string>, label: string) => {
    const firstOf = (s: Sup) => Math.min(...[...s.first].filter(([k]) => set.has(k)).map(([, t]) => t), Infinity);
    const key = (s: Sup, m: number) => `${m}|${Math.round((s.lead[m] ?? 0) / 2000)}|${Math.round((s.gold[m] ?? 0) / 1000)}`;
    const ctrl = new Map<string, { n: number; w: number }>();
    const treated: Array<{ k: string; win: boolean }> = [];
    for (const s of sups) {
      const f = firstOf(s);
      for (let m = 15; m <= 40 && m < s.gold.length; m++) {
        if (f >= (m + 5) * 60) {
          const c = ctrl.get(key(s, m)) ?? ctrl.set(key(s, m), { n: 0, w: 0 }).get(key(s, m))!;
          c.n++;
          if (s.win) c.w++;
        }
      }
      if (f !== Infinity) {
        const m = Math.ceil(f / 60);
        if (m >= 15 && m <= 40 && m < s.gold.length) treated.push({ k: key(s, m), win: s.win });
      }
    }
    let n = 0, w = 0, exp = 0, varSum = 0;
    for (const t of treated) {
      const c = ctrl.get(t.k);
      if (!c || c.n < 5) continue;
      n++;
      if (t.win) w++;
      const p = c.w / c.n;
      exp += p;
      varSum += p * (1 - p);
    }
    const diff = n ? (w - exp) / n : 0;
    const se = n ? Math.sqrt(varSum) / n : 0;
    console.log(`${label}: treated ${treated.length}, matched ${n}; win ${n ? ((100 * w) / n).toFixed(1) : "-"}% vs matched controls ${n ? ((100 * exp) / n).toFixed(1) : "-"}%; diff ${(100 * diff).toFixed(1)} pp ± ${(196 * se).toFixed(1)} (95%)`);
  };
  study(CORE, "support finishes a core item");
  study(SUPPORT, "support finishes a support item (reference)");
  for (const k of ["black_king_bar", "desolator", "maelstrom", "manta", "echo_sabre", "orchid", "dragon_lance", "diffusal_blade", "blink"]) study(new Set([k]), `  ${k}`);
}
void main().catch((e) => {
  console.error(String(e));
  process.exit(1);
});
