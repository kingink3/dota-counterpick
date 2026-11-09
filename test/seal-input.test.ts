// ADR-058: a match id the page seals (github-store.ts sealInput) opens in the workflow.
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { test } from "node:test";
import { openInput, siteKey } from "../scripts/seal.js";

test("sealed workflow input: page format -> openInput", async () => {
  const key = await siteKey("correct horse battery staple");
  const iv = webcrypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await webcrypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode("9081380063")));
  const b64 = Buffer.concat([iv, ct]).toString("base64");
  assert.equal(await openInput(key, b64), "9081380063");
  await assert.rejects(openInput(await siteKey("another password, long enough"), b64));
});
