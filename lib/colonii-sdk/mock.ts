/**
 * In-memory mock backend.
 *
 * This is the default `ColoniiClient` mode and the one the demo runs against.
 * It mimics the on-chain program's state transitions exactly:
 *
 * - Identity PDA derivation (real, deterministic)
 * - Credential PDA derivation (real, deterministic)
 * - Memory anchor sequencing (real, deterministic)
 * - Status enum transitions (matching Rust handler logic)
 *
 * Apps can build the UI against this mock, then flip to `live` mode
 * by changing one constructor argument once the program is deployed.*/

import { Keypair, PublicKey } from '@solana/web3.js';
import {
  AVATAR_CODE,
  AVATAR_FROM_CODE,
  AvatarName,
  CredentialRecord,
  IdentityRecord,
  IssuerRecord,
  MemoryRecord,
} from './types';
import {
  bytesToHex,
  didFromPubkey,
  truncateHashHex,
  truncateWallet,
} from './format';
import {
  deriveCredentialPda,
  deriveIdentityPda,
  deriveIssuerPda,
  deriveMemoryAnchorPda,
} from './pda';

interface MockIdentity {
  address: PublicKey;
  owner: PublicKey;
  avatar: AvatarName;
  status: 'secured' | 'active' | 'inactive';
  createdAt: Date;
  lastAnchorAt: Date | null;
  credentialCount: number;
  memoryCount: number;
  traitsHash: Uint8Array;
  cultureTagsHash: Uint8Array;
  emotionalHash: Uint8Array;
  metadataUri: string;
  supabaseUuid: string;
}

interface MockIssuer {
  address: PublicKey;
  authority: PublicKey;
  active: boolean;
  metadataUri: string;
  createdAt: Date;
}

interface MockCredential {
  address: PublicKey;
  subject: PublicKey;
  issuer: PublicKey;
  credentialType: string;
  status: 'active' | 'revoked';
  issuedAt: Date;
  revokedAt: Date | null;
  expiresAt: Date | null;
  metadataUri: string;
}

interface MockMemory {
  address: PublicKey;
  identity: PublicKey;
  sequence: number;
  memoryHash: Uint8Array;
  timestamp: Date;
}

/**
 * Standalone state container so multiple ColoniiClients can share or
 * isolate state. Useful for tests where you want a fresh world per case.*/
export class MockBackend {
  private identities = new Map<string, MockIdentity>();
  private issuers = new Map<string, MockIssuer>();
  private credentials = new Map<string, MockCredential>();
  private memories = new Map<string, MockMemory>();
  private receiptCounter = 0;

  constructor(public readonly programId: PublicKey) {}

  private nextReceipt(prefix: string): string {
    this.receiptCounter += 1;
    // Mock receipts that look-ish like Solana signatures so logs feel real.
    return `mock_${prefix}_${this.receiptCounter
      .toString(16)
      .padStart(8, '0')}…${Keypair.generate().publicKey.toBase58().slice(-4)}`;
  }

  initializeDid(owner: PublicKey, avatar: AvatarName): { identity: MockIdentity; receipt: string } {
    const [address] = deriveIdentityPda(this.programId, owner);
    const key = address.toBase58();
    if (this.identities.has(key)) {
      throw new Error(`Identity already exists for owner ${owner.toBase58()}`);
    }

    const record: MockIdentity = {
      address,
      owner,
      avatar,
      status: 'secured',
      createdAt: new Date(),
      lastAnchorAt: null,
      credentialCount: 0,
      memoryCount: 0,
      traitsHash: new Uint8Array(32),
      cultureTagsHash: new Uint8Array(32),
      emotionalHash: new Uint8Array(32),
      metadataUri: '',
      supabaseUuid: '',
    };
    this.identities.set(key, record);
    return { identity: record, receipt: this.nextReceipt('init') };
  }

  updateAvatar(owner: PublicKey, avatar: AvatarName): { identity: MockIdentity; receipt: string } {
    const id = this.requireIdentityByOwner(owner);
    if (id.status === 'inactive') {
      throw new Error('IdentityInactive');
    }
    id.avatar = avatar;
    return { identity: id, receipt: this.nextReceipt('avatar') };
  }

  updateDid(
    owner: PublicKey,
    args: {
      traitsHash: Uint8Array;
      cultureTagsHash: Uint8Array;
      emotionalHash: Uint8Array;
      metadataUri: string;
    },
  ): { identity: MockIdentity; receipt: string } {
    const id = this.requireIdentityByOwner(owner);
    if (id.status === 'inactive') throw new Error('IdentityInactive');
    if (args.traitsHash.length !== 32) throw new Error('traitsHash must be 32 bytes');
    if (args.cultureTagsHash.length !== 32) throw new Error('cultureTagsHash must be 32 bytes');
    if (args.emotionalHash.length !== 32) throw new Error('emotionalHash must be 32 bytes');
    id.traitsHash = args.traitsHash;
    id.cultureTagsHash = args.cultureTagsHash;
    id.emotionalHash = args.emotionalHash;
    id.metadataUri = args.metadataUri;
    return { identity: id, receipt: this.nextReceipt('update_did') };
  }

  deactivateDid(owner: PublicKey): { identity: MockIdentity; receipt: string } {
    const id = this.requireIdentityByOwner(owner);
    id.status = 'inactive';
    return { identity: id, receipt: this.nextReceipt('deactivate') };
  }

  bindAvatar(owner: PublicKey, supabaseUuid: string): { identity: MockIdentity; receipt: string } {
    const id = this.requireIdentityByOwner(owner);
    if (id.status === 'inactive') throw new Error('IdentityInactive');
    id.supabaseUuid = supabaseUuid;
    return { identity: id, receipt: this.nextReceipt('bind_avatar') };
  }

  createIssuer(authority: PublicKey, metadataUri: string): { issuer: MockIssuer; receipt: string } {
    const [address] = deriveIssuerPda(this.programId, authority);
    const key = address.toBase58();
    if (this.issuers.has(key)) {
      throw new Error(`Issuer already exists for authority ${authority.toBase58()}`);
    }
    const record: MockIssuer = {
      address,
      authority,
      active: true,
      metadataUri,
      createdAt: new Date(),
    };
    this.issuers.set(key, record);
    return { issuer: record, receipt: this.nextReceipt('issuer') };
  }

  getIssuer(authority: PublicKey): MockIssuer | null {
    const [address] = deriveIssuerPda(this.programId, authority);
    return this.issuers.get(address.toBase58()) ?? null;
  }

  issueCredential(
    issuer: PublicKey,
    subjectOwner: PublicKey,
    credentialType: string,
    metadataUri: string,
    expiresAt: Date | null = null,
  ): { credential: MockCredential; identity: MockIdentity; receipt: string } {
    const issuerRecord = this.getIssuer(issuer);
    if (!issuerRecord?.active) throw new Error('IssuerInactive');
    const id = this.requireIdentityByOwner(subjectOwner);
    if (id.status === 'inactive') {
      throw new Error('IdentityInactive');
    }
    if (expiresAt && expiresAt.getTime() <= Date.now()) throw new Error('CredentialExpired');

    const [address] = deriveCredentialPda(this.programId, id.address, credentialType);
    const key = address.toBase58();
    if (this.credentials.has(key)) {
      throw new Error('Credential already exists for this (subject, type)');
    }

    const record: MockCredential = {
      address,
      subject: id.address,
      issuer,
      credentialType,
      status: 'active',
      issuedAt: new Date(),
      revokedAt: null,
      expiresAt,
      metadataUri,
    };
    this.credentials.set(key, record);
    if (id.status === 'secured') id.status = 'active';
    id.credentialCount += 1;
    return { credential: record, identity: id, receipt: this.nextReceipt('issue') };
  }

  revokeCredential(
    issuer: PublicKey,
    credentialAddress: PublicKey,
  ): { credential: MockCredential; receipt: string } {
    const cred = this.credentials.get(credentialAddress.toBase58());
    if (!cred) throw new Error('Credential not found');
    if (!cred.issuer.equals(issuer)) throw new Error('UnauthorizedIssuer');
    if (cred.status === 'revoked') throw new Error('CredentialAlreadyRevoked');
    cred.status = 'revoked';
    cred.revokedAt = new Date();
    return { credential: cred, receipt: this.nextReceipt('revoke') };
  }

  findCredential(
    subjectIdentity: PublicKey,
    credentialType: string,
  ): MockCredential | null {
    const [address] = deriveCredentialPda(this.programId, subjectIdentity, credentialType);
    return this.credentials.get(address.toBase58()) ?? null;
  }

  anchorMemory(
    owner: PublicKey,
    memoryHash: Uint8Array,
  ): { memory: MockMemory; identity: MockIdentity; receipt: string } {
    const id = this.requireIdentityByOwner(owner);
    if (id.status === 'inactive') {
      throw new Error('IdentityInactive');
    }
    if (memoryHash.length !== 32) throw new Error('InvalidMemoryHash');

    const sequence = id.memoryCount;
    const [address] = deriveMemoryAnchorPda(this.programId, id.address, sequence);
    const record: MockMemory = {
      address,
      identity: id.address,
      sequence,
      memoryHash,
      timestamp: new Date(),
    };
    this.memories.set(address.toBase58(), record);

    id.memoryCount += 1;
    id.lastAnchorAt = record.timestamp;
    if (id.status === 'secured') id.status = 'active';
    return { memory: record, identity: id, receipt: this.nextReceipt('anchor') };
  }

  getIdentityByOwner(owner: PublicKey): MockIdentity | null {
    const [address] = deriveIdentityPda(this.programId, owner);
    return this.identities.get(address.toBase58()) ?? null;
  }

  getIdentityByDid(address: PublicKey): MockIdentity | null {
    return this.identities.get(address.toBase58()) ?? null;
  }

  listCredentials(subjectIdentity: PublicKey): MockCredential[] {
    return [...this.credentials.values()].filter((c) =>
      c.subject.equals(subjectIdentity),
    );
  }

  listMemories(subjectIdentity: PublicKey): MockMemory[] {
    return [...this.memories.values()]
      .filter((m) => m.identity.equals(subjectIdentity))
      .sort((a, b) => a.sequence - b.sequence);
  }

  private requireIdentityByOwner(owner: PublicKey): MockIdentity {
    const id = this.getIdentityByOwner(owner);
    if (!id) throw new Error(`No identity for owner ${owner.toBase58()}`);
    return id;
  }
}

// --- Conversion helpers from mock records → public SDK records ----------

export function mockIdentityToRecord(m: MockIdentity): IdentityRecord {
  // Use the identity PDA address as the "identity hash" surface — it's
  // deterministic, 32 bytes, and reads as a hex string after base58 decode.
  // For UI we just truncate the base58 because that's what users see.
  return {
    did: didFromPubkey(m.address),
    address: m.address,
    ownerWallet: m.owner,
    ownerWalletShort: truncateWallet(m.owner),
    avatar: m.avatar,
    status: m.status,
    createdAt: m.createdAt,
    lastAnchorAt: m.lastAnchorAt,
    credentialCount: m.credentialCount,
    memoryCount: m.memoryCount,
    traitsHash: bytesToHex(m.traitsHash),
    cultureTagsHash: bytesToHex(m.cultureTagsHash),
    emotionalHash: bytesToHex(m.emotionalHash),
    metadataUri: m.metadataUri.length === 0 ? null : m.metadataUri,
    supabaseUuid: m.supabaseUuid.length === 0 ? null : m.supabaseUuid,
    identityHashShort: truncateHashHex(m.address.toBytes()),
  };
}

export function mockIssuerToRecord(i: MockIssuer): IssuerRecord {
  return {
    address: i.address,
    authority: i.authority,
    active: i.active,
    metadataUri: i.metadataUri.length === 0 ? null : i.metadataUri,
    createdAt: i.createdAt,
  };
}

export function mockCredentialToRecord(c: MockCredential): CredentialRecord {
  return {
    address: c.address,
    subjectDid: didFromPubkey(c.subject),
    issuerWallet: c.issuer,
    credentialType: c.credentialType,
    status: c.status,
    issuedAt: c.issuedAt,
    revokedAt: c.revokedAt,
    expiresAt: c.expiresAt,
    metadataUri: c.metadataUri.length === 0 ? null : c.metadataUri,
  };
}

export function mockMemoryToRecord(m: MockMemory): MemoryRecord {
  const hex = bytesToHex(m.memoryHash);
  return {
    address: m.address,
    did: didFromPubkey(m.identity),
    sequence: m.sequence,
    memoryHash: hex,
    memoryHashShort: truncateHashHex(hex),
    timestamp: m.timestamp,
  };
}

export type MockIdentityState = MockIdentity;
export type MockCredentialState = MockCredential;
export type MockMemoryState = MockMemory;
