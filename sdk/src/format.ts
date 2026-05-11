/**
 * Formatting helpers. Pure, side-effect-free, isomorphic (Node + browser).
 *
 * No `Buffer` and no Node `crypto` here — the UI bundles this module
 * directly via Vite, so we use `@noble/hashes` (sync, audited, already a
 * transitive dep of `@solana/web3.js`) and native `Uint8Array` methods.
 */

import { sha256 } from '@noble/hashes/sha256';
import { PublicKey } from '@solana/web3.js';

/** Build the canonical DID string from a PublicKey. */
export function didFromPubkey(address: PublicKey): string {
  return `did:colonii:sol:${address.toBase58()}`;
}

/** Parse a `did:colonii:sol:...` string back into a PublicKey. */
export function pubkeyFromDid(did: string): PublicKey {
  const prefix = 'did:colonii:sol:';
  if (!did.startsWith(prefix)) {
    throw new Error(`Not a COLONII DID: ${did}`);
  }
  return new PublicKey(did.slice(prefix.length));
}

/**
 * Truncate a base58 wallet address to the `8xA3…k9L2` style used in the
 * wireframes (4 leading + 4 trailing characters, ellipsis in middle).
 */
export function truncateWallet(address: PublicKey | string, head = 4, tail = 4): string {
  const s = typeof address === 'string' ? address : address.toBase58();
  if (s.length <= head + tail + 1) return s;
  return `${s.slice(0, head)}…${s.slice(-tail)}`;
}

/**
 * Truncate a hex hash to the `0xA81F…92BC` style.
 * Accepts either `0x`-prefixed hex or raw bytes.
 */
export function truncateHashHex(hash: string | Uint8Array, head = 4, tail = 4): string {
  const hex = typeof hash === 'string' ? normalizeHex(hash) : bytesToHex(hash);
  const stripped = hex.replace(/^0x/, '');
  if (stripped.length <= head + tail + 1) return `0x${stripped}`;
  return `0x${stripped.slice(0, head)}…${stripped.slice(-tail)}`;
}

const HEX_CHARS = '0123456789abcdef';

/** Hex-encode a byte array with a `0x` prefix. */
export function bytesToHex(bytes: Uint8Array): string {
  let out = '0x';
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i];
    out += HEX_CHARS[(b >> 4) & 0xf];
    out += HEX_CHARS[b & 0xf];
  }
  return out;
}

/** Hex-decode a `0x`-prefixed (or bare) string into bytes. */
export function hexToBytes(hex: string): Uint8Array {
  const stripped = hex.replace(/^0x/, '');
  if (stripped.length % 2 !== 0) {
    throw new Error('Hex string must have an even length');
  }
  const out = new Uint8Array(stripped.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(stripped.substr(i * 2, 2), 16);
  }
  return out;
}

function normalizeHex(s: string): string {
  return s.startsWith('0x') ? s : `0x${s}`;
}

/**
 * Canonical memory-hash routine. Whatever the Beta app stores in Supabase
 * for a given memory record, run it through this before anchoring.
 *
 * Default: SHA-256 of the JSON-serialized payload with sorted keys, so two
 * objects that are structurally equal hash to the same value regardless of
 * key insertion order.
 */
export function hashMemoryPayload(payload: unknown): Uint8Array {
  const serialized = stableStringify(payload);
  return sha256(utf8Encode(serialized));
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }
  const keys = Object.keys(value as Record<string, unknown>).sort();
  const parts = keys.map(
    (k) => `${JSON.stringify(k)}:${stableStringify((value as Record<string, unknown>)[k])}`,
  );
  return `{${parts.join(',')}}`;
}

/** SHA-256 of a UTF-8 string or byte array, returned as a 32-byte Uint8Array. */
export function sha256Bytes(input: string | Uint8Array): Uint8Array {
  const bytes = typeof input === 'string' ? utf8Encode(input) : input;
  return sha256(bytes);
}

const TEXT_ENCODER = typeof TextEncoder !== 'undefined' ? new TextEncoder() : null;

function utf8Encode(s: string): Uint8Array {
  if (TEXT_ENCODER) return TEXT_ENCODER.encode(s);
  // Fallback for environments without TextEncoder (very old Node). Should
  // never trigger in practice — Node 12+ has TextEncoder globally.
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xff;
  return out;
}
