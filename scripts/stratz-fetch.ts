// =============================================================================
//  STRATZ GraphQL fetcher (ADR-027): runs in GitHub Actions with the STRATZ_TOKEN
//  secret (never in the repo - it is public). Writes raw responses to --out.
//
//    --mode schema   one call: the schema (introspection), to write the queries
//    --mode fetch    per hero x position, Crusader-Archon + Legend-Ancient brackets
//
//  Rate limits of a free token (shown on stratz.com/api): about 20/s, 250/min,
//  2000/h, 15000/day. We stay far below: <= 1 call / 0.8 s, and a hard cap per run.
// =============================================================================

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

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
    const spec = JSON.parse(readFileSync(arg("spec") ?? "scripts/stratz-queries.json", "utf8")) as {
      batches: Array<{ name: string; query: string; variables?: Record<string, unknown> }>;
    };
    for (const b of spec.batches) {
      const d = await gql<unknown>(b.query, b.variables ?? {});
      writeFileSync(join(out, `${b.name}.json`), JSON.stringify(d));
    }
  } else {
    throw new Error(`unknown mode ${mode}`);
  }
  console.log(`${calls} calls`);
}

void main().catch((e) => {
  console.error(String(e));
  process.exit(1);
});
