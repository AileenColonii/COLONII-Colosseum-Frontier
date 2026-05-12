/**
 * Browser-only thin wrapper around MockBackend, mirroring the mock-mode
 * methods of @colonii/identity-sdk's ColoniiClient.
 *
 * Why this exists: the upstream ColoniiClient hard-imports
 * `@coral-xyz/anchor` (~150 KB) even when the consumer only uses mock
 * mode. For our Colosseum demo we want real cryptographic primitives
 * (PDA derivation, hashing, deterministic identifiers) without paying
 * the Anchor bundle cost. When the team flips on live devnet mode,
 * swap this for the real ColoniiClient.
 *
 * API surface deliberately matches ColoniiClient so the code that uses
 * it doesn't change between mock and live modes.*/

import { Keypair, PublicKey } from "@solana/web3.js";
import { DEFAULT_PROGRAM_ID } from "./program-id";
import {
  MockBackend,
  mockCredentialToRecord,
  mockIdentityToRecord,
  mockIssuerToRecord,
  mockMemoryToRecord,
} from "./mock";
import type {
  AccessCheckResult,
  AnchorMemoryResult,
  AvatarName,
  CreateIdentityResult,
  CreateIssuerResult,
  CredentialRecord,
  DidHandle,
  IdentityRecord,
  IssueCredentialResult,
  MemoryRecord,
} from "./types";
import {
  didFromPubkey,
  hashMemoryPayload,
  pubkeyFromDid,
  truncateWallet,
} from "./format";
import { deriveCredentialPda, deriveIdentityPda } from "./pda";

/**
 * Wallet input — accepts either:
 * - A full Keypair (mock mode default — generated in-browser)
 * - A pubkey-only adapter (when a real wallet is connected via
 * @solana/wallet-adapter-react; mock mode never signs so we don't
 * need the secret half).
 *
 * Live mode will swap this for an `AnchorWallet` from
 * `@solana/wallet-adapter-react` which carries the full sign methods.*/
export type BrowserMockWallet = Keypair | { publicKey: PublicKey };

export interface BrowserMockClientConfig {
  /** Wallet for the active user. Keep secret keys in memory only.*/
  wallet: BrowserMockWallet;
  /** Optional shared backend for sharing state across multiple clients.*/
  backend?: MockBackend;
  /** Optional program ID override (matters only for PDA derivation).*/
  programId?: PublicKey;
}

/**
 * Browser-only mock client for the Colonii on-chain identity layer.
 * Uses real PDA derivation + hashing (deterministic identifiers) but
 * holds state in memory — no network, no validator, no wallet popups.*/
export class BrowserMockColoniiClient {
  readonly programId: PublicKey;
  readonly mode = "mock" as const;

  private readonly backend: MockBackend;
  private readonly ownerWallet: PublicKey;

  constructor(config: BrowserMockClientConfig) {
    this.programId = config.programId ?? DEFAULT_PROGRAM_ID;
    this.backend = config.backend ?? new MockBackend(this.programId);
    this.ownerWallet = config.wallet.publicKey;
  }

  /** The wallet pubkey behind this client.*/
  get walletAddress(): PublicKey {
    return this.ownerWallet;
  }

  /** Truncated wallet for UI surfaces.*/
  get walletShort(): string {
    return truncateWallet(this.ownerWallet);
  }

  /** Stable DID handle for this client (computed lazily, no I/O).*/
  didHandle(): DidHandle {
    const [address] = deriveIdentityPda(this.programId, this.ownerWallet);
    return { address, did: didFromPubkey(address) };
  }

  // ── DID lifecycle ──────────────────────────────────────────────────────

  async createIdentity(args: {
    avatar: AvatarName;
  }): Promise<CreateIdentityResult> {
    const { identity, receipt } = this.backend.initializeDid(
      this.ownerWallet,
      args.avatar
    );
    return { identity: mockIdentityToRecord(identity), receipt };
  }

  async getIdentity(): Promise<IdentityRecord | null> {
    const mine = this.backend.getIdentityByOwner(this.ownerWallet);
    return mine ? mockIdentityToRecord(mine) : null;
  }

  async deactivateDid(): Promise<{ identity: IdentityRecord; receipt: string }> {
    const { identity, receipt } = this.backend.deactivateDid(this.ownerWallet);
    return { identity: mockIdentityToRecord(identity), receipt };
  }

  // ── Issuer + credential ────────────────────────────────────────────────

  async createIssuer(
    args: { metadataUri?: string } = {}
  ): Promise<CreateIssuerResult> {
    const { issuer, receipt } = this.backend.createIssuer(
      this.ownerWallet,
      args.metadataUri ?? ""
    );
    return { issuer: mockIssuerToRecord(issuer), receipt };
  }

  async issueCredential(args: {
    subjectDid: string;
    credentialType: string;
    metadataUri?: string;
    expiresAt?: Date | null;
  }): Promise<IssueCredentialResult> {
    const subjectAddress = pubkeyFromDid(args.subjectDid);
    const subject = this.backend.getIdentityByDid(subjectAddress);
    if (!subject) throw new Error("Subject identity not found");
    const { credential, receipt } = this.backend.issueCredential(
      this.ownerWallet,
      subject.owner,
      args.credentialType,
      args.metadataUri ?? "",
      args.expiresAt ?? null
    );
    return {
      credential: mockCredentialToRecord(credential),
      receipt,
    };
  }

  async checkAccess(args: {
    did: string;
    credentialType: string;
  }): Promise<AccessCheckResult> {
    const subjectAddress = pubkeyFromDid(args.did);
    const [credAddress] = deriveCredentialPda(
      this.programId,
      subjectAddress,
      args.credentialType
    );
    const cred = this.backend
      .listCredentials(subjectAddress)
      .find((c) => c.address.equals(credAddress));
    if (!cred) {
      return { decision: "locked", credential: null, reason: "No credential" };
    }
    if (cred.status === "revoked") {
      return {
        decision: "locked",
        credential: mockCredentialToRecord(cred),
        reason: "Revoked",
      };
    }
    if (cred.expiresAt && cred.expiresAt.getTime() < Date.now()) {
      return {
        decision: "locked",
        credential: mockCredentialToRecord(cred),
        reason: "Expired",
      };
    }
    return {
      decision: "unlocked",
      credential: mockCredentialToRecord(cred),
      reason: "Verified",
    };
  }

  // ── Memory anchors ─────────────────────────────────────────────────────

  async anchorMemory(args: {
    memory?: unknown;
    memoryHash?: Uint8Array;
  }): Promise<AnchorMemoryResult> {
    const hash =
      args.memoryHash ??
      (args.memory !== undefined ? hashMemoryPayload(args.memory) : undefined);
    if (!hash) throw new Error("Pass either `memory` or `memoryHash`");
    if (hash.length !== 32) throw new Error("memoryHash must be 32 bytes");

    const { memory, receipt } = this.backend.anchorMemory(this.ownerWallet, hash);
    return { memory: mockMemoryToRecord(memory), receipt };
  }

  async listMemories(): Promise<MemoryRecord[]> {
    const id = await this.getIdentity();
    if (!id) return [];
    return this.backend
      .listMemories(id.address)
      .map(mockMemoryToRecord);
  }

  async listCredentials(): Promise<CredentialRecord[]> {
    const id = await this.getIdentity();
    if (!id) return [];
    return this.backend
      .listCredentials(id.address)
      .map(mockCredentialToRecord);
  }
}

/** Convenience: spin up a fresh client + backend with a generated keypair.*/
export function createDemoClient(opts: {
  backend?: MockBackend;
  programId?: PublicKey;
} = {}): BrowserMockColoniiClient {
  const wallet = Keypair.generate();
  return new BrowserMockColoniiClient({
    wallet,
    backend: opts.backend,
    programId: opts.programId,
  });
}
