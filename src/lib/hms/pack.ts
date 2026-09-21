import { deflate, inflate } from "pako";
import type { HmsState } from "./types";

const MAGIC_PLAIN = "KEG1";
const MAGIC_ENC = "KEGE";

function strToBytes(s: string) {
  return new TextEncoder().encode(s);
}

async function deriveKey(passphrase: string, salt: Uint8Array) {
  const base = await crypto.subtle.importKey("raw", strToBytes(passphrase), "PBKDF2", false, [
    "deriveKey",
  ]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: salt as BufferSource, iterations: 150_000, hash: "SHA-256" },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

/** Serialize state -> gzip -> optional AES-256-GCM. Returns bytes for a .keg file. */
export async function packState(state: HmsState, passphrase?: string): Promise<Uint8Array> {
  const compressed = deflate(JSON.stringify(state), { level: 9 });
  if (!passphrase) {
    const out = new Uint8Array(4 + compressed.length);
    out.set(strToBytes(MAGIC_PLAIN), 0);
    out.set(compressed, 4);
    return out;
  }
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(passphrase, salt);
  const cipher = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, compressed as BufferSource),
  );
  const out = new Uint8Array(4 + 16 + 12 + cipher.length);
  out.set(strToBytes(MAGIC_ENC), 0);
  out.set(salt, 4);
  out.set(iv, 20);
  out.set(cipher, 32);
  return out;
}

export async function unpackState(bytes: Uint8Array, passphrase?: string): Promise<HmsState> {
  const magic = new TextDecoder().decode(bytes.slice(0, 4));
  if (magic === MAGIC_PLAIN) {
    return JSON.parse(inflate(bytes.slice(4), { to: "string" })) as HmsState;
  }
  if (magic === MAGIC_ENC) {
    if (!passphrase) throw new Error("This file is encrypted — enter the passphrase in Settings.");
    const salt = bytes.slice(4, 20);
    const iv = bytes.slice(20, 32);
    const cipher = bytes.slice(32);
    const key = await deriveKey(passphrase, salt);
    const plain = new Uint8Array(
      await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: iv as BufferSource },
        key,
        cipher as BufferSource,
      ),
    );
    return JSON.parse(inflate(plain, { to: "string" })) as HmsState;
  }
  // fall back to raw JSON
  return JSON.parse(new TextDecoder().decode(bytes)) as HmsState;
}
