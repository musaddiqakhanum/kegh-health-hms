/**
 * Password hashing for staff login accounts.
 *
 * Web Crypto PBKDF2-SHA-256 with 100,000 iterations and a per-user random
 * 16-byte salt — the same key-derivation precedent as the .keg backup
 * encryption in pack.ts. Only the hex digest and the salt are ever stored;
 * the plaintext password is discarded after hashing.
 */

const ITERATIONS = 100_000;
const enc = new TextEncoder();

function bytesToHex(bytes: Uint8Array): string {
  let out = "";
  for (const b of bytes) out += b.toString(16).padStart(2, "0");
  return out;
}

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length >> 1);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16) || 0;
  }
  return out;
}

/** Fresh random 16-byte salt, hex-encoded (32 chars). */
export function newSaltHex(): string {
  return bytesToHex(crypto.getRandomValues(new Uint8Array(16)));
}

/** PBKDF2-SHA-256 digest of `password` with `saltHex`, hex-encoded. */
export async function hashPassword(password: string, saltHex: string): Promise<string> {
  const base = await crypto.subtle.importKey(
    "raw",
    enc.encode(password) as BufferSource,
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: hexToBytes(saltHex) as BufferSource,
      iterations: ITERATIONS,
      hash: "SHA-256",
    },
    base,
    256,
  );
  return bytesToHex(new Uint8Array(bits));
}

/** Constant-time compare of the freshly derived hash against the stored one. */
export async function verifyPassword(
  password: string,
  saltHex: string,
  expectedHex: string,
): Promise<boolean> {
  const actual = (await hashPassword(password, saltHex)).toLowerCase();
  const expected = (expectedHex || "").toLowerCase();
  const a = enc.encode(actual);
  const b = enc.encode(expected);
  if (a.length === 0 || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return diff === 0;
}
