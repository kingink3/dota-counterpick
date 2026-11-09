// Opens a workflow input the page sealed (ADR-058): prints nothing; writes NAME=value to
// $GITHUB_ENV and masks the value in the logs.
//   APP_PASSWORD=... SEALED=... npx tsx scripts/open-input.ts MATCH_ID
import { appendFileSync } from "node:fs";
import { openInput, siteKey } from "./seal.js";

const name = process.argv[2] ?? "MATCH_ID";
const sealed = process.env.SEALED ?? "";
if (sealed) {
  const value = (await openInput(await siteKey(process.env.APP_PASSWORD ?? ""), sealed)).trim();
  if (!/^\d{1,20}$/.test(value)) throw new Error("the sealed input is not a match id");
  console.log(`::add-mask::${value}`);
  if (process.env.GITHUB_ENV) appendFileSync(process.env.GITHUB_ENV, `${name}=${value}\n`);
}
