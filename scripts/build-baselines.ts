// Rebuilds data/baselines.json from the KB (src/baseline.ts, ADR-061).
// Run after any change to taxonomy.yaml, the edge files or the scoring parameters:
//   npm run build:baselines
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { computeBaselines } from "../src/baseline.js";
import { loadKB } from "../src/kb.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const kb = loadKB(ROOT);
const baselines = computeBaselines({ ...kb, baselines: undefined, matchups: undefined } as typeof kb);
const lines = Object.entries(baselines).map(([role, byHero]) => `  ${JSON.stringify(role)}: {\n${Object.entries(byHero).map(([h, v]) => `    ${JSON.stringify(h)}: ${JSON.stringify(v)}`).join(",\n")}\n  }`);
writeFileSync(join(ROOT, "data", "baselines.json"), `{\n${lines.join(",\n")}\n}\n`, "utf8");
console.log(`baselines.json: ${Object.keys(baselines).length} roles, ${Object.keys(baselines["0"] ?? {}).length} heroes`);
