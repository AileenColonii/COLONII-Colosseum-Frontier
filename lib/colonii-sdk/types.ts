/**
 * Public type surface for the COLONII SDK.
 *
 * The shapes here are deliberately *product* vocabulary, not Solana
 * vocabulary. These can be wired directly into UI copy without needing a
 * translation layer. If you find yourself adding `pendingTx`, `mintAddress`,
 * or `signature` to the public surface — push it back behind the SDK.*/

import type { PublicKey } from '@solana/web3.js';

/** Avatars supported by the COLONII Beta. Keep in sync with the on-chain enum.*/
export type AvatarName = 'Anja' | 'Hung' | 'Grace' | 'Leon';

/** UX-facing identity lifecycle. Maps 1:1 to the on-chain `IdentityStatus` enum.*/
export type IdentityStatus = 'secured' | 'active' | 'inactive';

/** UX-facing credential lifecycle.*/
export type CredentialStatus = 'active' | 'revoked';

/** UX-facing access decision.*/
export type AccessDecision = 'unlocked' | 'locked';

/**
 * The DID, in two forms.
 *
 * - `address`: the on-chain PublicKey (used for transactions).
 * - `did`: the canonical string form, `did:colonii:sol:<base58(pda)>`.
 *
 * UI should display `did`. Backend code should use `address`.*/
export interface DidHandle {
  /** PublicKey of the on-chain Identity PDA.*/
  address: PublicKey;
  /** Canonical DID string.*/
  did: string;
}

/** Snapshot of an identity, suitable for the right-hand identity dashboard.*/
export interface IdentityRecord {
  did: string;
  address: PublicKey;
  ownerWallet: PublicKey;
  /** Truncated wallet for "Owned by you" surfaces (`8xA3…k9L2`).*/
  ownerWalletShort: string;
  avatar: AvatarName;
  status: IdentityStatus;
  createdAt: Date;
  lastAnchorAt: Date | null;
  credentialCount: number;
  memoryCount: number;
  /** 0x-prefixed hash of off-chain traits/profile data.*/
  traitsHash: string;
  /** 0x-prefixed hash of off-chain culture tags.*/
  cultureTagsHash: string;
  /** 0x-prefixed hash of off-chain emotional profile data.*/
  emotionalHash: string;
  /** Optional off-chain metadata/lore/profile pointer.*/
  metadataUri: string | null;
  /** Optional app-level Supabase UUID/user identifier bound to this DID.*/
  supabaseUuid: string | null;
  /** Truncated identity hash for the "Verified" pill (`0xA81F…92BC`).*/
  identityHashShort: string;
}

/** Registered credential issuer.*/
export interface IssuerRecord {
  address: PublicKey;
  authority: PublicKey;
  active: boolean;
  metadataUri: string | null;
  createdAt: Date;
}

/** Snapshot of a single credential.*/
export interface CredentialRecord {
  /** PublicKey of the credential PDA.*/
  address: PublicKey;
  subjectDid: string;
  issuerWallet: PublicKey;
  credentialType: string;
  status: CredentialStatus;
  issuedAt: Date;
  revokedAt: Date | null;
  /** Expiration time. Null means no expiration.*/
  expiresAt: Date | null;
  metadataUri: string | null;
}

/** A single memory anchor in the timeline.*/
export interface MemoryRecord {
  address: PublicKey;
  did: string;
  sequence: number;
  /** Hex-encoded 32-byte hash (`0x...`).*/
  memoryHash: string;
  /** `0x...` truncated for UI.*/
  memoryHashShort: string;
  timestamp: Date;
}

/** Result type for `createIdentity`.*/
export interface CreateIdentityResult {
  identity: IdentityRecord;
  /** Tx signature in live mode, deterministic mock id in mock mode.*/
  receipt: string;
}

/** Result type for `issueCredential`.*/
export interface IssueCredentialResult {
  credential: CredentialRecord;
  receipt: string;
}

export interface CreateIssuerResult {
  issuer: IssuerRecord;
  receipt: string;
}

/** Result type for `anchorMemory`.*/
export interface AnchorMemoryResult {
  memory: MemoryRecord;
  receipt: string;
}

/** Result type for `checkAccess` — the only function the gate UI reads from.*/
export interface AccessCheckResult {
  decision: AccessDecision;
  /** The credential that granted (or would grant) access, if it exists.*/
  credential: CredentialRecord | null;
  /** Reason string suitable for surfacing in UI ("Verified", "No credential", "Revoked").*/
  reason: string;
  /** Live mode only: transaction signature from the on-chain verify instruction.*/
  receipt?: string;
}

/** Internal: numeric avatar code as the on-chain program understands it.*/
export const AVATAR_CODE: Record<AvatarName, number> = {
  Anja: 0,
  Hung: 1,
  Grace: 2,
  Leon: 3,
};

/** Internal: reverse lookup.*/
export const AVATAR_FROM_CODE: Record<number, AvatarName> = {
  0: 'Anja',
  1: 'Hung',
  2: 'Grace',
  3: 'Leon',
};
