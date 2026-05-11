/**
 * The public `ColoniiClient` for app integration.
 *
 * Two modes, identical surface:
 *
 *   - `mock`  — In-memory state machine. No network. Demo-day default.
 *   - `live`  — Real Solana program calls via Anchor.
 *
 * Apps import from this file and do not need to touch Anchor/web3.js directly.
 */

import {
  AnchorProvider,
  BN,
  Idl,
  Program,
  Wallet as AnchorWallet,
} from '@coral-xyz/anchor';
import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import { COLONII_IDL } from './idl';
import { DEFAULT_PROGRAM_ID } from './program-id';
import {
  MockBackend,
  mockCredentialToRecord,
  mockIdentityToRecord,
  mockIssuerToRecord,
  mockMemoryToRecord,
} from './mock';

export { DEFAULT_PROGRAM_ID };
import {
  deriveCredentialPda,
  deriveIdentityPda,
  deriveIssuerPda,
  deriveMemoryAnchorPda,
} from './pda';
import {
  AVATAR_CODE,
  AVATAR_FROM_CODE,
  AccessCheckResult,
  AnchorMemoryResult,
  AvatarName,
  CreateIdentityResult,
  CreateIssuerResult,
  CredentialRecord,
  DidHandle,
  IdentityRecord,
  IssuerRecord,
  IssueCredentialResult,
  MemoryRecord,
} from './types';
import {
  bytesToHex,
  didFromPubkey,
  hashMemoryPayload,
  pubkeyFromDid,
  sha256Bytes,
  truncateHashHex,
  truncateWallet,
} from './format';

// `DEFAULT_PROGRAM_ID` is defined in `./program-id` and re-exported above so
// browser bundles can import it without pulling Anchor in.

export interface ColoniiClientMockConfig {
  mode: 'mock';
  /** Optional override of the program ID (only affects PDA derivation). */
  programId?: PublicKey;
  /**
   * Wallet for the active user. In mock mode you can pass a freshly
   * generated Keypair; nothing is signed.
   */
  wallet: Keypair;
  /** Share an existing backend across multiple clients (rare). */
  backend?: MockBackend;
}

export interface ColoniiClientLiveConfig {
  mode: 'live';
  programId?: PublicKey;
  connection: Connection;
  wallet: AnchorWallet;
}

export type ColoniiClientConfig = ColoniiClientMockConfig | ColoniiClientLiveConfig;

/**
 * High-level client. Construct one per logged-in user (the wallet
 * matters; everything else is shared).
 */
export class ColoniiClient {
  readonly programId: PublicKey;
  readonly mode: 'mock' | 'live';

  private readonly mock?: { backend: MockBackend; ownerWallet: PublicKey; ownerKeypair: Keypair };
  private readonly live?: {
    program: Program<Idl>;
    provider: AnchorProvider;
    ownerWallet: PublicKey;
  };

  constructor(config: ColoniiClientConfig) {
    this.programId = config.programId ?? DEFAULT_PROGRAM_ID;
    this.mode = config.mode;

    if (config.mode === 'mock') {
      const backend = config.backend ?? new MockBackend(this.programId);
      this.mock = {
        backend,
        ownerWallet: config.wallet.publicKey,
        ownerKeypair: config.wallet,
      };
    } else {
      const provider = new AnchorProvider(config.connection, config.wallet, {
        commitment: 'confirmed',
      });
      // Anchor reads the program ID from `idl.address`. We patch it in here
      // so the hand-written IDL works with the current constructor signature.
      const idlWithAddress = {
        ...(COLONII_IDL as unknown as Record<string, unknown>),
        address: this.programId.toBase58(),
      };
      const program = new (Program as unknown as new (
        idl: unknown,
        provider: AnchorProvider,
      ) => Program<Idl>)(idlWithAddress, provider);
      this.live = {
        program,
        provider,
        ownerWallet: config.wallet.publicKey,
      };
    }
  }

  // ----- Identity -------------------------------------------------------

  /**
   * Create a fresh identity for the active user, bound to one avatar.
   *
   * UX-equivalent of "Secure your identity" / "Create" in the demo script.
   * Returns a populated `IdentityRecord` — apps can pipe it straight into
   * the right-hand identity panel.
   */
  async createIdentity(args: { avatar: AvatarName }): Promise<CreateIdentityResult> {
    const code = AVATAR_CODE[args.avatar];

    if (this.mock) {
      const { identity, receipt } = this.mock.backend.initializeDid(
        this.mock.ownerWallet,
        args.avatar,
      );
      return { identity: mockIdentityToRecord(identity), receipt };
    }

    const { program, ownerWallet } = this.live!;
    const [identityPda] = deriveIdentityPda(this.programId, ownerWallet);
    const sig = await program.methods
      .initializeDid(code)
      .accounts({
        owner: ownerWallet,
        identity: identityPda,
      })
      .rpc();
    const record = await this.getIdentity(this.didHandle().did);
    return { identity: record!, receipt: sig };
  }

  /** Switch the bound avatar on the active user's identity. */
  async updateAvatar(args: { avatar: AvatarName }): Promise<IdentityRecord> {
    const code = AVATAR_CODE[args.avatar];

    if (this.mock) {
      const { identity } = this.mock.backend.updateAvatar(
        this.mock.ownerWallet,
        args.avatar,
      );
      return mockIdentityToRecord(identity);
    }

    const { program, ownerWallet } = this.live!;
    const [identityPda] = deriveIdentityPda(this.programId, ownerWallet);
    await program.methods
      .updateAvatarBinding(code)
      .accounts({ owner: ownerWallet, identity: identityPda })
      .rpc();
    const record = await this.getIdentity(this.didHandle().did);
    return record!;
  }

  /** Update DID profile/reference hashes and metadata URI. */
  async updateDid(args: {
    traitsHash: Uint8Array;
    cultureTagsHash: Uint8Array;
    emotionalHash: Uint8Array;
    metadataUri: string;
  }): Promise<IdentityRecord> {
    if (args.traitsHash.length !== 32) throw new Error('traitsHash must be 32 bytes');
    if (args.cultureTagsHash.length !== 32) throw new Error('cultureTagsHash must be 32 bytes');
    if (args.emotionalHash.length !== 32) throw new Error('emotionalHash must be 32 bytes');

    if (this.mock) {
      const { identity } = this.mock.backend.updateDid(this.mock.ownerWallet, args);
      return mockIdentityToRecord(identity);
    }

    const { program, ownerWallet } = this.live!;
    const [identityPda] = deriveIdentityPda(this.programId, ownerWallet);
    await program.methods
      .updateDid(
        Array.from(args.traitsHash),
        Array.from(args.cultureTagsHash),
        Array.from(args.emotionalHash),
        args.metadataUri,
      )
      .accounts({ owner: ownerWallet, identity: identityPda })
      .rpc();
    const record = await this.getIdentity(this.didHandle().did);
    return record!;
  }

  /** Mark the active user's DID inactive. */
  async deactivateDid(): Promise<IdentityRecord> {
    if (this.mock) {
      const { identity } = this.mock.backend.deactivateDid(this.mock.ownerWallet);
      return mockIdentityToRecord(identity);
    }

    const { program, ownerWallet } = this.live!;
    const [identityPda] = deriveIdentityPda(this.programId, ownerWallet);
    await program.methods
      .deactivateDid()
      .accounts({ owner: ownerWallet, identity: identityPda })
      .rpc();
    const record = await this.getIdentity(this.didHandle().did);
    return record!;
  }

  /** Bind a Supabase UUID/app avatar record to the active user's DID. */
  async bindAvatar(args: { supabaseUuid: string }): Promise<IdentityRecord> {
    if (this.mock) {
      const { identity } = this.mock.backend.bindAvatar(
        this.mock.ownerWallet,
        args.supabaseUuid,
      );
      return mockIdentityToRecord(identity);
    }

    const { program, ownerWallet } = this.live!;
    const [identityPda] = deriveIdentityPda(this.programId, ownerWallet);
    await program.methods
      .bindAvatar(args.supabaseUuid)
      .accounts({ owner: ownerWallet, identity: identityPda })
      .rpc();
    const record = await this.getIdentity(this.didHandle().did);
    return record!;
  }

  /** DID handle (string + address) for the active user. */
  didHandle(): DidHandle {
    const owner = this.mock ? this.mock.ownerWallet : this.live!.ownerWallet;
    const [address] = deriveIdentityPda(this.programId, owner);
    return { address, did: didFromPubkey(address) };
  }

  /** Fetch an identity by DID string. Returns null if not yet created. */
  async getIdentity(did: string): Promise<IdentityRecord | null> {
    const address = pubkeyFromDid(did);
    if (this.mock) {
      const id = this.mock.backend.getIdentityByDid(address);
      return id ? mockIdentityToRecord(id) : null;
    }
    try {
      const acc = await accountNs(this.live!.program, 'identity').fetch(address);
      return liveIdentityToRecord(address, acc);
    } catch {
      return null;
    }
  }

  // ----- Issuers --------------------------------------------------------

  /** Register the active wallet as a credential issuer. */
  async createIssuer(args: { metadataUri?: string } = {}): Promise<CreateIssuerResult> {
    const metadataUri = args.metadataUri ?? '';

    if (this.mock) {
      const { issuer, receipt } = this.mock.backend.createIssuer(
        this.mock.ownerWallet,
        metadataUri,
      );
      return { issuer: mockIssuerToRecord(issuer), receipt };
    }

    const { program, ownerWallet } = this.live!;
    const [issuerPda] = deriveIssuerPda(this.programId, ownerWallet);
    const sig = await program.methods
      .createIssuer(metadataUri)
      .accounts({
        authority: ownerWallet,
        issuer: issuerPda,
      })
      .rpc();
    const issuer = await this.getIssuer(ownerWallet);
    return { issuer: issuer!, receipt: sig };
  }

  /** Fetch an issuer registry by authority wallet. */
  async getIssuer(authority: PublicKey): Promise<IssuerRecord | null> {
    if (this.mock) {
      const issuer = this.mock.backend.getIssuer(authority);
      return issuer ? mockIssuerToRecord(issuer) : null;
    }
    const [issuerPda] = deriveIssuerPda(this.programId, authority);
    try {
      const acc = await accountNs(this.live!.program, 'issuer').fetch(issuerPda);
      return liveIssuerToRecord(issuerPda, acc);
    } catch {
      return null;
    }
  }

  // ----- Credentials ----------------------------------------------------

  /**
   * Issue a credential to a subject identity.
   *
   * In the demo, the COLONII service wallet calls this to mint
   * "Frontier Hackathon Participant" onto a fresh user.
   */
  async issueCredential(args: {
    subjectDid: string;
    credentialType: string;
    metadataUri?: string;
    expiresAt?: Date | number | null;
  }): Promise<IssueCredentialResult> {
    const subjectAddress = pubkeyFromDid(args.subjectDid);
    const metadataUri = args.metadataUri ?? '';
    const expiresAtSeconds =
      args.expiresAt == null
        ? 0
        : args.expiresAt instanceof Date
          ? Math.floor(args.expiresAt.getTime() / 1000)
          : args.expiresAt;

    if (this.mock) {
      const subject = this.mock.backend.getIdentityByDid(subjectAddress);
      if (!subject) throw new Error('Subject identity not found');
      const { credential, receipt } = this.mock.backend.issueCredential(
        this.mock.ownerWallet,
        subject.owner,
        args.credentialType,
        metadataUri,
        expiresAtSeconds === 0 ? null : new Date(expiresAtSeconds * 1000),
      );
      return { credential: mockCredentialToRecord(credential), receipt };
    }

    const { program, ownerWallet } = this.live!;
    const [issuerPda] = deriveIssuerPda(this.programId, ownerWallet);
    const [credentialPda] = deriveCredentialPda(
      this.programId,
      subjectAddress,
      args.credentialType,
    );
    const credentialTypeHash = Array.from(sha256Bytes(args.credentialType));
    const sig = await program.methods
      .issueCredential(
        credentialTypeHash,
        args.credentialType,
        metadataUri,
        new BN(expiresAtSeconds),
      )
      .accounts({
        issuer: ownerWallet,
        issuerRegistry: issuerPda,
        authority: ownerWallet,
        subjectIdentity: subjectAddress,
        credential: credentialPda,
      })
      .rpc();
    const fetched = await this.fetchCredential(credentialPda);
    return { credential: fetched!, receipt: sig };
  }

  /** Revoke a credential the active user previously issued. */
  async revokeCredential(args: { credentialAddress: PublicKey }): Promise<CredentialRecord> {
    if (this.mock) {
      const { credential } = this.mock.backend.revokeCredential(
        this.mock.ownerWallet,
        args.credentialAddress,
      );
      return mockCredentialToRecord(credential);
    }

    const { program, ownerWallet } = this.live!;
    await program.methods
      .revokeCredential()
      .accounts({ issuer: ownerWallet, credential: args.credentialAddress })
      .rpc();
    const fetched = await this.fetchCredential(args.credentialAddress);
    return fetched!;
  }

  /**
   * Decide whether `did` holds an active credential of `credentialType`.
   *
   * This is the *only* function the gate UI should read. It returns an
   * `AccessDecision` ("unlocked" / "locked") plus a human-readable reason.
   *
   * Pure read in both modes — no transaction is sent.
   */
  async checkAccess(args: {
    did: string;
    credentialType: string;
  }): Promise<AccessCheckResult> {
    const subjectAddress = pubkeyFromDid(args.did);

    if (this.mock) {
      const cred = this.mock.backend.findCredential(subjectAddress, args.credentialType);
      if (!cred) {
        return { decision: 'locked', credential: null, reason: 'No credential' };
      }
      const record = mockCredentialToRecord(cred);
      if (record.status === 'active') {
        if (record.expiresAt && record.expiresAt.getTime() <= Date.now()) {
          return { decision: 'locked', credential: record, reason: 'Expired' };
        }
        return { decision: 'unlocked', credential: record, reason: 'Verified' };
      }
      return { decision: 'locked', credential: record, reason: 'Revoked' };
    }

    const [credentialPda] = deriveCredentialPda(
      this.programId,
      subjectAddress,
      args.credentialType,
    );
    const fetched = await this.fetchCredential(credentialPda);
    if (!fetched) return { decision: 'locked', credential: null, reason: 'No credential' };
    if (fetched.status === 'active') {
      if (fetched.expiresAt && fetched.expiresAt.getTime() <= Date.now()) {
        return { decision: 'locked', credential: fetched, reason: 'Expired' };
      }
      const credentialTypeHash = Array.from(sha256Bytes(args.credentialType));
      const sig = await this.live!.program.methods
        .verifyCredential(credentialTypeHash, args.credentialType)
        .accounts({
          identity: subjectAddress,
          credential: credentialPda,
        })
        .rpc();
      return { decision: 'unlocked', credential: fetched, reason: 'Verified', receipt: sig };
    }
    return { decision: 'locked', credential: fetched, reason: 'Revoked' };
  }

  /** List every credential ever issued to a DID. */
  async listCredentials(did: string): Promise<CredentialRecord[]> {
    const subjectAddress = pubkeyFromDid(did);
    if (this.mock) {
      return this.mock.backend.listCredentials(subjectAddress).map(mockCredentialToRecord);
    }
    // Live mode: scan with a memcmp filter on the `subject` field. Field
    // offset = 8 (discriminator).
    const accounts = await accountNs(this.live!.program, 'credential').all([
      {
        memcmp: {
          offset: 8,
          bytes: subjectAddress.toBase58(),
        },
      },
    ]);
    return accounts.map((entry: { publicKey: PublicKey; account: unknown }) =>
      liveCredentialToRecord(entry.publicKey, entry.account),
    );
  }

  // ----- Memory anchoring -----------------------------------------------

  /**
   * Anchor a memory record to the active user's identity.
   *
   * Pass either a raw 32-byte hash (`memoryHash`) or an arbitrary payload
   * (`memory`) which the SDK hashes for you with stable JSON serialization.
   *
   * The hash is the only thing that lives on-chain; the underlying memory
   * record stays in the Beta app's database.
   */
  async anchorMemory(args: {
    memory?: unknown;
    memoryHash?: Uint8Array;
  }): Promise<AnchorMemoryResult> {
    const hash =
      args.memoryHash ??
      (args.memory !== undefined ? hashMemoryPayload(args.memory) : undefined);
    if (!hash) throw new Error('Pass either `memory` or `memoryHash`');
    if (hash.length !== 32) throw new Error('memoryHash must be 32 bytes');

    if (this.mock) {
      const { memory, receipt } = this.mock.backend.anchorMemory(
        this.mock.ownerWallet,
        hash,
      );
      return { memory: mockMemoryToRecord(memory), receipt };
    }

    const { program, ownerWallet } = this.live!;
    const [identityPda] = deriveIdentityPda(this.programId, ownerWallet);
    const id = await this.getIdentity(this.didHandle().did);
    if (!id) throw new Error('Create an identity first');
    const sequence = BigInt(id.memoryCount);
    const [anchorPda] = deriveMemoryAnchorPda(this.programId, identityPda, sequence);
    const sig = await program.methods
      .anchorMemory(Array.from(hash), new BN(sequence.toString()))
      .accounts({
        owner: ownerWallet,
        identity: identityPda,
        anchor: anchorPda,
      })
      .rpc();
    const fetched = await this.fetchMemoryAnchor(anchorPda);
    return { memory: fetched!, receipt: sig };
  }

  /** Memory timeline for the right-side panel. */
  async listMemories(did: string): Promise<MemoryRecord[]> {
    const subjectAddress = pubkeyFromDid(did);
    if (this.mock) {
      return this.mock.backend.listMemories(subjectAddress).map(mockMemoryToRecord);
    }
    const accounts = await accountNs(this.live!.program, 'memoryAnchor').all([
      {
        memcmp: { offset: 8, bytes: subjectAddress.toBase58() },
      },
    ]);
    return accounts
      .map((entry: { publicKey: PublicKey; account: unknown }) =>
        liveMemoryToRecord(entry.publicKey, entry.account),
      )
      .sort((a: MemoryRecord, b: MemoryRecord) => a.sequence - b.sequence);
  }

  // ----- Internal -------------------------------------------------------

  private async fetchCredential(address: PublicKey): Promise<CredentialRecord | null> {
    try {
      const acc = await accountNs(this.live!.program, 'credential').fetch(address);
      return liveCredentialToRecord(address, acc);
    } catch {
      return null;
    }
  }

  private async fetchMemoryAnchor(address: PublicKey): Promise<MemoryRecord | null> {
    try {
      const acc = await accountNs(this.live!.program, 'memoryAnchor').fetch(address);
      return liveMemoryToRecord(address, acc);
    } catch {
      return null;
    }
  }
}

/**
 * Anchor's `program.account` namespace is typed against a generic IDL,
 * so indexing by string fails strict typechecking. The cast here is
 * intentional — at runtime the property exists if the IDL is correct.
 */
interface AccountNamespaceLike {
  fetch(address: PublicKey): Promise<unknown>;
  all(filters?: unknown[]): Promise<{ publicKey: PublicKey; account: unknown }[]>;
}

function accountNs(program: Program<Idl>, name: string): AccountNamespaceLike {
  return (program.account as unknown as Record<string, AccountNamespaceLike>)[name];
}

// --- Live-mode account decoders ---------------------------------------

// Anchor returns plain JS objects whose shape mirrors the IDL but isn't
// statically typed. The decoders accept `unknown` and narrow internally.

interface RawIdentityAcc {
  owner: PublicKey;
  avatar: Record<string, unknown>;
  status: Record<string, unknown>;
  createdAt: BN;
  lastAnchorAt: BN;
  credentialCount: number;
  memoryCount: BN;
  traitsHash: number[];
  cultureTagsHash: number[];
  emotionalHash: number[];
  metadataUri: string;
  supabaseUuid: string;
}

interface RawIssuerAcc {
  authority: PublicKey;
  active: boolean;
  metadataUri: string;
  createdAt: BN;
}

interface RawCredentialAcc {
  subject: PublicKey;
  issuer: PublicKey;
  status: Record<string, unknown>;
  issuedAt: BN;
  revokedAt: BN;
  expiresAt: BN;
  credentialType: string;
  metadataUri: string;
}

interface RawMemoryAcc {
  identity: PublicKey;
  sequence: BN;
  memoryHash: number[];
  timestamp: BN;
}

function liveIdentityToRecord(address: PublicKey, raw: unknown): IdentityRecord {
  const acc = raw as RawIdentityAcc;
  const avatarVariant = Object.keys(acc.avatar)[0]; // {anja: {}} -> "anja"
  const statusVariant = Object.keys(acc.status)[0];
  const lastAnchorRaw = acc.lastAnchorAt;
  return {
    did: didFromPubkey(address),
    address,
    ownerWallet: acc.owner,
    ownerWalletShort: truncateWallet(acc.owner),
    avatar: capitalize(avatarVariant) as AvatarName,
    status: statusVariant.toLowerCase() as IdentityRecord['status'],
    createdAt: new Date(Number(acc.createdAt.toString()) * 1000),
    lastAnchorAt: lastAnchorRaw.isZero()
      ? null
      : new Date(Number(lastAnchorRaw.toString()) * 1000),
    credentialCount: Number(acc.credentialCount),
    memoryCount: Number(acc.memoryCount.toString()),
    traitsHash: bytesToHex(Uint8Array.from(acc.traitsHash)),
    cultureTagsHash: bytesToHex(Uint8Array.from(acc.cultureTagsHash)),
    emotionalHash: bytesToHex(Uint8Array.from(acc.emotionalHash)),
    metadataUri: acc.metadataUri.length === 0 ? null : acc.metadataUri,
    supabaseUuid: acc.supabaseUuid.length === 0 ? null : acc.supabaseUuid,
    identityHashShort: truncateHashHex(address.toBytes()),
  };
}

function liveIssuerToRecord(address: PublicKey, raw: unknown): IssuerRecord {
  const acc = raw as RawIssuerAcc;
  return {
    address,
    authority: acc.authority,
    active: acc.active,
    metadataUri: acc.metadataUri.length === 0 ? null : acc.metadataUri,
    createdAt: new Date(Number(acc.createdAt.toString()) * 1000),
  };
}

function liveCredentialToRecord(address: PublicKey, raw: unknown): CredentialRecord {
  const acc = raw as RawCredentialAcc;
  const statusVariant = Object.keys(acc.status)[0];
  return {
    address,
    subjectDid: didFromPubkey(acc.subject),
    issuerWallet: acc.issuer,
    credentialType: acc.credentialType,
    status: statusVariant.toLowerCase() as CredentialRecord['status'],
    issuedAt: new Date(Number(acc.issuedAt.toString()) * 1000),
    revokedAt: acc.revokedAt.isZero()
      ? null
      : new Date(Number(acc.revokedAt.toString()) * 1000),
    expiresAt: acc.expiresAt.isZero()
      ? null
      : new Date(Number(acc.expiresAt.toString()) * 1000),
    metadataUri: acc.metadataUri.length === 0 ? null : acc.metadataUri,
  };
}

function liveMemoryToRecord(address: PublicKey, raw: unknown): MemoryRecord {
  const acc = raw as RawMemoryAcc;
  const hash = Uint8Array.from(acc.memoryHash);
  const hex = bytesToHex(hash);
  return {
    address,
    did: didFromPubkey(acc.identity),
    sequence: Number(acc.sequence.toString()),
    memoryHash: hex,
    memoryHashShort: truncateHashHex(hex),
    timestamp: new Date(Number(acc.timestamp.toString()) * 1000),
  };
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
