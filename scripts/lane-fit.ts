// Temporary (ADR-057): what STRATZ's lane outcome is, fitted on public ranked matches.
// OpenDota /publicMatches -> ids; STRATZ matches(ids) -> lane outcomes + per-minute
// networth / XP of the lane players. Prints aggregates only.
const OD = "https://api.opendota.com/api";
const API = "https://api.stratz.com/graphql";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function gql<T>(query: string): Promise<T> {
  for (let a = 1; ; a++) {
    const res = await fetch(API, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${process.env.STRATZ_TOKEN}`, "user-agent": "STRATZ_API" }, body: JSON.stringify({ query }) });
    const text = await res.text();
    const ip = res.status === 403 ? /at (\d{4}-\d\d-\d\d \d\d:\d\d:\d\d) UTC/.exec(text) : null;
    if (ip && a < 3) { const ms = Math.min(16 * 60_000, Date.parse(`${ip[1]!.replace(" ", "T")}Z`) + 10_000 - Date.now()); console.log(`waiting ${Math.round(ms / 1000)} s for a STRATZ slot`); await sleep(Math.max(5000, ms)); continue; }
    if ((res.status === 429 || res.status >= 500) && a < 5) { await sleep(a * 15_000); continue; }
    if (!res.ok) throw new Error(`HTTP ${res.status} ${text.slice(0, 200)}`);
    const b = JSON.parse(text) as { data?: T; errors?: Array<{ message: string }> };
    if (!b.data) throw new Error(b.errors?.map((e) => e.message).join("; ") ?? "no data");
    return b.data;
  }
}
interface P { isRadiant: boolean; lane?: string | null; stats?: { networthPerMinute?: number[] | null; experiencePerMinute?: number[] | null } | null }
interface M { id: number; bottomLaneOutcome?: string | null; midLaneOutcome?: string | null; topLaneOutcome?: string | null; players?: P[] }
const CLS: Record<string, number> = { RADIANT_STOMP: 2, RADIANT_VICTORY: 1, TIE: 0, DIRE_VICTORY: -1, DIRE_STOMP: -2 };

async function main() {
  const want = Number(process.argv[2] ?? 600);
  const ids: number[] = [];
  let lt: number | undefined;
  while (ids.length < want) {
    const r = await fetch(`${OD}/publicMatches${lt ? `?less_than_match_id=${lt}` : ""}`).catch(() => undefined);
    if (!r?.ok) { await sleep(5000); continue; }
    const list = (await r.json()) as Array<{ match_id: number; lobby_type: number; game_mode: number; duration: number }>;
    if (!list.length) break;
    lt = Math.min(...list.map((m) => m.match_id));
    ids.push(...list.filter((m) => m.lobby_type === 7 && m.game_mode === 22 && m.duration > 1500).map((m) => m.match_id));
    await sleep(1100);
  }
  // public matches are parsed by STRATZ some hours after: take ones ~1 day old
  console.log(`ids: ${ids.length}`);
  const ms: M[] = [];
  for (let i = 0; i < ids.length; i += 10) {
    try {
      const d = await gql<{ matches: M[] }>(`{ matches(ids: [${ids.slice(i, i + 10).join(",")}]) { id bottomLaneOutcome midLaneOutcome topLaneOutcome players { isRadiant lane stats { networthPerMinute experiencePerMinute } } } }`);
      ms.push(...(d.matches ?? []).filter((m) => m && m.bottomLaneOutcome && m.players?.every((p) => (p.stats?.networthPerMinute?.length ?? 0) > 12)));
    } catch (e) { console.log(`batch failed: ${String(e).slice(0, 160)}`); }
    await sleep(400);
  }
  console.log(`matches with outcomes and stats: ${ms.length}`);
  type Row = { cls: number; lane: string; f: Record<string, number> };
  const rows: Row[] = [];
  for (const m of ms) {
    const side = (rad: boolean, lane: string) => (m.players ?? []).filter((p) => p.isRadiant === rad && p.lane === lane);
    for (const [name, rl, dl, key] of [["bottom", "SAFE_LANE", "OFF_LANE", "bottomLaneOutcome"], ["mid", "MID_LANE", "MID_LANE", "midLaneOutcome"], ["top", "OFF_LANE", "SAFE_LANE", "topLaneOutcome"]] as const) {
      const lab = (m as unknown as Record<string, string>)[key];
      if (!(lab in CLS)) continue;
      const R = side(true, rl), D = side(false, dl);
      if (!R.length || !D.length) continue;
      const f: Record<string, number> = { nR: R.length, nD: D.length };
      for (let t = 6; t <= 12; t++) {
        const nw = (ps: P[]) => ps.reduce((a, p) => a + (p.stats!.networthPerMinute![t] ?? 0), 0);
        const xp = (ps: P[]) => ps.reduce((a, p) => a + (p.stats!.experiencePerMinute ?? []).slice(0, t).reduce((x, y) => x + y, 0), 0);
        const rel = (a: number, b: number) => (a - b) / Math.max(1, (a + b) / 2);
        f[`nwRel${t}`] = rel(nw(R), nw(D));
        f[`nwAbs${t}`] = nw(R) - nw(D);
        f[`nwPer${t}`] = nw(R) / R.length - nw(D) / D.length;
        f[`xpRel${t}`] = rel(xp(R), xp(D));
        f[`sumRel${t}`] = rel(nw(R) + xp(R), nw(D) + xp(D));
      }
      rows.push({ cls: CLS[lab]!, lane: name, f });
    }
  }
  const dist: Record<number, number> = {};
  for (const r of rows) dist[r.cls] = (dist[r.cls] ?? 0) + 1;
  console.log(`lanes: ${rows.length}; classes -2..2: ${[-2, -1, 0, 1, 2].map((c) => dist[c] ?? 0).join(" / ")}`);
  const classify = (x: number, a: number, b: number) => (x >= b ? 2 : x >= a ? 1 : x > -a ? 0 : x > -b ? -1 : -2);
  const results: Array<{ feat: string; a: number; b: number; acc: number; acc3: number }> = [];
  for (const feat of Object.keys(rows[0]?.f ?? {}).filter((k) => !/^n[RD]$/.test(k))) {
    const xs = rows.map((r) => r.f[feat]!);
    const scale = Math.max(...xs.map(Math.abs));
    const grid = Array.from({ length: 80 }, (_, i) => (scale * (i + 1)) / 120);
    let best = { a: 0, b: 0, acc: 0, acc3: 0 };
    for (const a of grid) for (const b of grid) {
      if (b <= a) continue;
      let ok = 0, ok3 = 0;
      for (const r of rows) { const c = classify(r.f[feat]!, a, b); if (c === r.cls) ok++; if (Math.sign(c) === Math.sign(r.cls)) ok3++; }
      if (ok > best.acc) best = { a, b, acc: ok, acc3: ok3 };
    }
    results.push({ feat, ...best, acc: best.acc / rows.length, acc3: best.acc3 / rows.length });
  }
  results.sort((x, y) => y.acc - x.acc);
  for (const r of results.slice(0, 12)) console.log(`${r.feat.padEnd(10)} tie<${r.a.toFixed(3)} stomp>=${r.b.toFixed(3)}  exact ${(100 * r.acc).toFixed(1)}%  win/tie/loss ${(100 * r.acc3).toFixed(1)}%`);
  // per lane, the best feature again
  const top = results[0]!;
  for (const lane of ["bottom", "mid", "top"]) {
    const rs = rows.filter((r) => r.lane === lane);
    const ok = rs.filter((r) => classify(r.f[top.feat]!, top.a, top.b) === r.cls).length;
    console.log(`  ${lane}: ${rs.length} lanes, exact ${(100 * ok / Math.max(1, rs.length)).toFixed(1)}%`);
  }
}
void main().catch((e) => { console.error(String(e)); process.exit(1); });
