/**
 * PDA derivation. Mirror of the constants in
 * `programs/colonii-identity/src/state/mod.rs`. If those change, change
 * here in lockstep.
 *
 * Isomorphic — uses `Uint8Array` rather than `Buffer` so the SDK works
 * unmodified in browser bundlers.*/

import { PublicKey } from '@solana/web3.js';
import { sha256Bytes } from './format';

const TEXT_ENCODER = new TextEncoder();

export const SEED_IDENTITY = TEXT_ENCODER.encode('identity');
export const SEED_ISSUER = TEXT_ENCODER.encode('issuer');
export const SEED_CREDENTIAL = TEXT_ENCODER.encode('credential');
export const SEED_MEMORY = TEXT_ENCODER.encode('memory');

/** Derive the Identity PDA for a given owner wallet.*/
export function deriveIdentityPda(programId: PublicKey, owner: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [SEED_IDENTITY, owner.toBytes()],
    programId,
  );
}

/** Derive the Issuer PDA for a registered issuer authority wallet.*/
export function deriveIssuerPda(programId: PublicKey, authority: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [SEED_ISSUER, authority.toBytes()],
    programId,
  );
}

/** Derive the Credential PDA for a (subject, type) pair.*/
export function deriveCredentialPda(
  programId: PublicKey,
  subjectIdentity: PublicKey,
  credentialType: string,
): [PublicKey, number] {
  const typeHash = sha256Bytes(credentialType);
  return PublicKey.findProgramAddressSync(
    [SEED_CREDENTIAL, subjectIdentity.toBytes(), typeHash],
    programId,
  );
}

/** Derive the MemoryAnchor PDA for a given identity and sequence number.*/
export function deriveMemoryAnchorPda(
  programId: PublicKey,
  identity: PublicKey,
  sequence: bigint | number,
): [PublicKey, number] {
  const seqBytes = u64LeBytes(BigInt(sequence));
  return PublicKey.findProgramAddressSync(
    [SEED_MEMORY, identity.toBytes(), seqBytes],
    programId,
  );
}

/** Encode a u64 as 8 little-endian bytes.*/
function u64LeBytes(value: bigint): Uint8Array {
  const out = new Uint8Array(8);
  let v = value;
  for (let i = 0; i < 8; i++) {
    out[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return out;
}
