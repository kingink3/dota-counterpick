// =============================================================================
//  STRATZ GraphQL fetcher (ADR-027): runs in GitHub Actions with the STRATZ_TOKEN
//  secret (never in the repo - it is public). Writes raw responses to --out.
//
//    --mode schema   one call: the schema (introspection), to write the queries
//    --mode fetch    the batches of --spec (scripts/stratz/<dataset>.json)
//
//  Rate limits of a free token (shown on stratz.com/api): about 20/s, 250/min,
//  2000/h, 15000/day. We stay far below: <= 1 call / 0.8 s, and a hard cap per run.
// =============================================================================

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { leaderboardQuery, matchMeQuery, matchPositionsQuery, matchHealthQuery, matchSummaryQuery, matchVisionQuery, ME_PARTS, recentMatchesQuery } from "../src/stratz-queries.js";

const API = "https://api.stratz.com/graphql";
const MIN_GAP_MS = 800;
const MAX_CALLS = 600;

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
}

let calls = 0;
let last = 0;
async function gql<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
  const token = process.env.STRATZ_TOKEN;
  if (!token) throw new Error("STRATZ_TOKEN is not set (repository secret)");
  if (++calls > MAX_CALLS) throw new Error(`call cap ${MAX_CALLS} reached`);
  for (let attempt = 1; ; attempt++) {
    const wait = last + MIN_GAP_MS - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    last = Date.now();
    const res = await fetch(API, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
        // STRATZ rejects requests without this agent
        "user-agent": "STRATZ_API",
      },
      body: JSON.stringify({ query, variables }),
    });
    const text = await res.text();
    if (res.status === 429 && attempt < 5) {
      console.log(`429, waiting ${attempt * 20}s`);
      await new Promise((r) => setTimeout(r, attempt * 20_000));
      continue;
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 400)}`);
    const body = JSON.parse(text) as { data?: T; errors?: Array<{ message: string }> };
    if (body.errors?.length && !body.data) throw new Error(body.errors.map((e) => e.message).join("; "));
    if (body.errors?.length) console.log("partial errors:", body.errors.slice(0, 3).map((e) => e.message).join("; "));
    return body.data as T;
  }
}

/** the "SteamId" claim of a STRATZ token. */
function ownerOf(token: string): number | undefined {
  try {
    const json = JSON.parse(Buffer.from(token.split(".")[1] ?? "", "base64url").toString("utf8")) as { SteamId?: string };
    const n = Number(json.SteamId);
    return n > 0 ? n : undefined;
  } catch {
    return undefined;
  }
}

/** players -> 1..10 (the owner -> 1), match id -> 1, no start time. */
function anonymise(d: { account: number; summary: unknown; me: unknown; positions: unknown; health?: unknown; vision?: unknown; others?: Record<string, unknown> }): void {
  const map = new Map<number, number>([[d.account, 1]]);
  const walk = (x: unknown): void => {
    if (Array.isArray(x)) x.forEach(walk);
    else if (x && typeof x === "object") {
      const o = x as Record<string, unknown>;
      for (const [k, v] of Object.entries(o)) {
        if (k === "steamAccount" && v && typeof v === "object") delete (v as Record<string, unknown>).name;
        else if (k === "steamAccountId" && typeof v === "number") {
          if (!map.has(v)) map.set(v, map.size + 1);
          o[k] = map.get(v);
        } else if ((k === "id" || k === "matchId") && typeof v === "number" && v > 1e8) o[k] = 1;
        else if (k === "startDateTime" || k === "parsedDateTime" || k === "endDateTime") delete o[k];
        else walk(v);
      }
    }
  };
  walk(d.summary);
  walk(d.me);
  walk(d.positions);
  walk(d.health);
  walk(d.vision);
  if (d.others) {
    const o: Record<string, unknown> = {};
    for (const [acc, me] of Object.entries(d.others)) {
      walk(me);
      const n = Number(acc);
      if (!map.has(n)) map.set(n, map.size + 1);
      o[String(map.get(n))] = me;
    }
    d.others = o;
  }
  d.account = 1;
}

const INTROSPECTION = `
query {
  __schema {
    queryType { name }
    types {
      kind name
      fields(includeDeprecated: false) {
        name
        args { name type { kind name ofType { kind name ofType { kind name ofType { kind name } } } } }
        type { kind name ofType { kind name ofType { kind name ofType { kind name } } } }
      }
      enumValues(includeDeprecated: false) { name }
    }
  }
}`;

async function main(): Promise<void> {
  const out = arg("out") ?? "/tmp/stratz";
  mkdirSync(out, { recursive: true });
  const mode = arg("mode") ?? "schema";
  if (mode === "schema") {
    const s = await gql<{ __schema: { types: Array<{ name: string; kind: string }> } }>(INTROSPECTION);
    writeFileSync(join(out, "schema.json"), JSON.stringify(s));
    console.log(`schema: ${s.__schema.types.length} types`);
  } else if (mode === "fetch") {
    const spec = JSON.parse(readFileSync(arg("spec") ?? "scripts/stratz/items.json", "utf8")) as {
      batches: Array<{ name: string; query: string; variables?: Record<string, unknown> }>;
    };
    // one failing batch must not lose the rest of the run (calls are budgeted)
    let failed = 0;
    for (const b of spec.batches) {
      try {
        const d = await gql<unknown>(b.query, b.variables ?? {});
        writeFileSync(join(out, `${b.name}.json`), JSON.stringify(d));
      } catch (e) {
        failed++;
        console.log(`batch ${b.name} failed: ${String(e).slice(0, 300)}`);
        writeFileSync(join(out, `${b.name}.error.txt`), String(e));
        if (/HTTP 403|HTTP 401|call cap/.test(String(e))) throw e; // auth / IP / budget: stop
      }
    }
    console.log(`${spec.batches.length - failed}/${spec.batches.length} batches ok`);
  } else if (mode === "sample" || mode === "own") {
    // "sample": a fresh parsed ranked match of a public leaderboard player;
    // "own": the token owner's latest parsed match (id read from the token, never
    // logged), anonymised before it is written - the raw branch is public
    let found: { acc: number; id: number } | undefined;
    const owner = mode === "own" ? ownerOf(process.env.STRATZ_TOKEN ?? "") : undefined;
    if (mode === "own") {
      if (!owner) throw new Error("no SteamId in the token");
      const r = await gql<{ player: { matches: Array<{ id: number; parsedDateTime?: number | null; gameMode?: string; lobbyType?: string }> } | null }>(
        recentMatchesQuery(owner, 20),
      );
      const ms = r.player?.matches ?? [];
      if (!ms.length) {
        // why no matches: counts and flags only (no ids / names in the public log)
        const why = await gql<{ player: { matchCount?: number; lastMatchDate?: number; steamAccount?: { isAnonymous?: boolean; isStratzPublic?: boolean; communityVisibleState?: number; lastMatchDateTime?: number; seasonRank?: number } } | null }>(
          `{ player(steamAccountId: ${owner}) { matchCount lastMatchDate steamAccount { isAnonymous isStratzPublic communityVisibleState lastMatchDateTime seasonRank } } }`,
        );
        const pl = why.player;
        const last = pl?.lastMatchDate ?? pl?.steamAccount?.lastMatchDateTime;
        console.log(
          `own: matchCount ${pl?.matchCount ?? "?"}, isAnonymous ${pl?.steamAccount?.isAnonymous}, isStratzPublic ${pl?.steamAccount?.isStratzPublic}, ` +
            `profile visibility ${pl?.steamAccount?.communityVisibleState}, last match ${last ? `${Math.round((Date.now() / 1000 - last) / 86400)} days ago` : "unknown"}, rank ${pl?.steamAccount?.seasonRank ?? "?"}`,
        );
      }
      // diagnostics without ids: how many, how many parsed, which modes
      console.log(`own: player ${r.player ? "found" : "NOT found"}, ${ms.length} matches, ${ms.filter((x) => x.parsedDateTime).length} parsed; modes: ${[...new Set(ms.map((x) => `${x.lobbyType}/${x.gameMode}`))].join(", ")}`);
      const m = ms.find((x) => x.parsedDateTime) ?? ms[0];
      if (m) found = { acc: owner, id: m.id };
      if (!found) throw new Error("own: no matches returned for the token owner");
    }
    const lb = mode === "sample" ? await gql<{ leaderboard: { season: { players: Array<{ steamAccountId: number }> } } }>(leaderboardQuery(10)) : undefined;
    for (const p of lb?.leaderboard?.season?.players ?? []) {
      const r = await gql<{ player: { matches: Array<{ id: number; lobbyType?: string; parsedDateTime?: number | null }> } }>(recentMatchesQuery(p.steamAccountId, 3));
      const m = (r.player?.matches ?? []).find((x) => x.parsedDateTime && /RANKED/.test(x.lobbyType ?? ""));
      if (m) {
        found = { acc: p.steamAccountId, id: m.id };
        break;
      }
    }
    if (!found) throw new Error("no parsed ranked match among the leaderboard players");
    const summary = await gql<{ match: { players?: Array<{ steamAccountId?: number | null; steamAccount?: { isAnonymous?: boolean | null } | null }> } }>(matchSummaryQuery(found.id));
    const playerOf = async (acc: number) => {
      const me: Record<string, unknown> = { playbackData: {} };
      for (const part of Object.keys(ME_PARTS) as Array<keyof typeof ME_PARTS>) {
        const r = await gql<{ match: { players: Array<Record<string, unknown>> } }>(matchMeQuery(found!.id, acc, part));
        const pl = r.match?.players?.[0] ?? {};
        const { playbackData, ...rest } = pl as { playbackData?: Record<string, unknown> };
        Object.assign(me, rest);
        Object.assign(me.playbackData as Record<string, unknown>, playbackData ?? {});
      }
      return me;
    };
    const me = await playerOf(found.acc);
    // "own": the other players with open data too (the multi-player review); counts only in the log
    const others: Record<string, unknown> = {};
    if (mode === "own") {
      const ps = summary.match?.players ?? [];
      console.log(`own: ${ps.filter((p) => p.steamAccountId && !p.steamAccount?.isAnonymous).length} of ${ps.length} players open, ${ps.filter((p) => !p.steamAccountId).length} without an id`);
      for (const p of ps) {
        if (!p.steamAccountId || p.steamAccountId === found.acc) continue;
        try {
          const o = await playerOf(p.steamAccountId);
          const has = !!((o.playbackData as Record<string, unknown[] | null>)?.deathEvents || (o.playbackData as Record<string, unknown[] | null>)?.inventoryEvents);
          if (has) others[String(p.steamAccountId)] = o; // private profiles too (anonymised like everyone)
        } catch (e) {
          console.log(`a player failed: ${String(e).slice(0, 120)}`);
        }
      }
      console.log(`own: ${Object.keys(others).length} other players with event data`);
    }
    let positions: unknown;
    try {
      positions = (await gql<{ match: unknown }>(matchPositionsQuery(found.id))).match;
    } catch (e) {
      console.log(`positions failed: ${String(e).slice(0, 200)}`);
    }
    let health: unknown;
    try {
      health = (await gql<{ match: unknown }>(matchHealthQuery(found.id))).match;
    } catch (e) {
      console.log(`health failed: ${String(e).slice(0, 200)}`);
    }
    let vision: unknown;
    try {
      vision = (await gql<{ match: unknown }>(matchVisionQuery(found.id))).match;
    } catch (e) {
      console.log(`vision failed: ${String(e).slice(0, 200)}`);
    }
    const data = { account: found.acc, summary: summary.match, me, positions, health, vision, ...(mode === "own" ? { others } : {}) };
    if (mode === "own") anonymise(data);
    writeFileSync(join(out, "match.json"), JSON.stringify(data));
    console.log(mode === "own" ? "own latest match fetched (anonymised)" : `sample match ${found.id}`);
  } else if (mode === "match") {
    // one match, every player (ADR-031): --match <id>, or the token owner's latest parsed match.
    // Written in the clear to --out; the store step encrypts it before anything is pushed.
    // The log shows counts only (the repository and its Actions logs are public).
    let id = Number(arg("match") || 0);
    const owner = ownerOf(process.env.STRATZ_TOKEN ?? "");
    if (!id) {
      if (!owner) throw new Error("no match id and no SteamId in the token");
      const r = await gql<{ player: { matches: Array<{ id: number; parsedDateTime?: number | null }> | null } | null }>(recentMatchesQuery(owner, 10));
      const m = (r.player?.matches ?? []).find((x) => x.parsedDateTime);
      if (!m) throw new Error("STRATZ returned no parsed match for the token owner (its match list may be down - pass a match id)");
      id = m.id;
    }
    const summary = await gql<{ match: { players?: Array<{ steamAccountId?: number | null }>; parsedDateTime?: number | null } | null }>(matchSummaryQuery(id));
    if (!summary.match) throw new Error("match not found");
    const shared = async <T>(q: string, what: string): Promise<T | undefined> => {
      try {
        return (await gql<{ match: T }>(q)).match;
      } catch (e) {
        console.log(`${what} failed: ${String(e).slice(0, 160)}`);
        return undefined;
      }
    };
    const positions = await shared(matchPositionsQuery(id), "positions");
    const health = await shared(matchHealthQuery(id), "health");
    const vision = await shared(matchVisionQuery(id), "vision");
    const players: Record<string, unknown> = {};
    for (const p of summary.match.players ?? []) {
      if (!p.steamAccountId) continue;
      try {
        const me: Record<string, unknown> = { playbackData: {} };
        for (const part of Object.keys(ME_PARTS) as Array<keyof typeof ME_PARTS>) {
          const r = await gql<{ match: { players: Array<Record<string, unknown>> } }>(matchMeQuery(id, p.steamAccountId, part));
          const { playbackData, ...rest } = (r.match?.players?.[0] ?? {}) as { playbackData?: Record<string, unknown> };
          Object.assign(me, rest);
          Object.assign(me.playbackData as Record<string, unknown>, playbackData ?? {});
        }
        players[String(p.steamAccountId)] = me;
      } catch (e) {
        console.log(`a player failed: ${String(e).slice(0, 120)}`);
      }
    }
    const data = { id, owner: owner ?? null, fetchedAt: Math.floor(Date.now() / 1000), summary: summary.match, positions, health, vision, players };
    writeFileSync(join(out, "match.json"), JSON.stringify(data));
    console.log(`match: ${Object.keys(players).length} of ${summary.match.players?.length ?? 0} players with events, parsed ${summary.match.parsedDateTime ? "yes" : "no"}`);
  } else {
    throw new Error(`unknown mode ${mode}`);
  }
  console.log(`${calls} calls`);
}

void main().catch((e) => {
  console.error(String(e));
  process.exit(1);
});
