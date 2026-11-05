// =============================================================================
//  The site's encryption (ADR-019), shared by the Pages build and the match store
//  (ADR-031): AES-256-GCM with a PBKDF2-SHA256(APP_PASSWORD, 600k) key, gzip inside.
//  Format: iv (12 bytes) + ciphertext. The browser opens it with the key it already
//  derived when the site was unlocked.
// =============================================================================

import { webcrypto } from "node:crypto";
import { gunzipSync, gzipSync } from "node:zlib";

type Key = webcrypto.CryptoKey;

/** constant per-site salt: lets "remember on this device" survive redeploys. */
export const SALT = "dota-counterpick/pages/v1";
export const ITERATIONS = 600_000;
export const MIN_PASSWORD = 12;

export async function siteKey(password: string, usage: webcrypto.KeyUsage[] = ["encrypt", "decrypt"]): Promise<Key> {
  const subtle = webcrypto.subtle;
  const base = await subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveKey"]);
  return subtle.deriveKey({ name: "PBKDF2", salt: new TextEncoder().encode(SALT), iterations: ITERATIONS, hash: "SHA-256" }, base, { name: "AES-GCM", length: 256 }, false, usage);
}

export async function seal(key: Key, data: Uint8Array | string): Promise<Uint8Array> {
  const plain = gzipSync(typeof data === "string" ? Buffer.from(data, "utf8") : Buffer.from(data), { level: 9 });
  const iv = webcrypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await webcrypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plain));
  const out = new Uint8Array(iv.length + ct.length);
  out.set(iv, 0);
  out.set(ct, iv.length);
  return out;
}

export async function unseal(key: Key, bin: Uint8Array): Promise<string> {
  const plain = await webcrypto.subtle.decrypt({ name: "AES-GCM", iv: bin.slice(0, 12) }, key, bin.slice(12));
  return gunzipSync(Buffer.from(plain)).toString("utf8");
}
