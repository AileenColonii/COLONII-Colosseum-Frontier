/**
 * Singleton Colonii identity session for the colosseum demo.
 *
 * One MockBackend + two clients (user + service issuer) live for the
 * duration of the page. All scenes share this state so PDA addresses,
 * memory sequences, and credential statuses stay consistent.
 *
 * Why singleton? Scene transitions remount components; we don't want to
 * lose the identity record or re-derive different PDAs on every mount.*/

import { Keypair, PublicKey } from "@solana/web3.js";
import {
  BrowserMockColoniiClient,
  createDemoClient,
} from "../../lib/colonii-sdk/client-browser";
import { MockBackend } from "../../lib/colonii-sdk/mock";
import { DEFAULT_PROGRAM_ID } from "../../lib/colonii-sdk/program-id";
import type {
  AvatarName,
  IdentityRecord,
  MemoryRecord,
} from "../../lib/colonii-sdk/types";

let backend: MockBackend | null = null;
let userClient: BrowserMockColoniiClient | null = null;
let serviceClient: BrowserMockColoniiClient | null = null;
let issuerCreated = false;
let walletOwnerPubkey: string | null = null;

/**
 * Guards the session against wallet-adapter events that fire after the
 * identity has been minted (e.g., Phantom emitting a pubkey change when
 * the user connects DURING the "securing" beat). Once the identity is
 * on-chain (mock or live) we must never wipe backend/userClient/serviceClient
 * — the proof drawer and dashboard would go empty.
 *
 * Set to `true` inside `ensureIdentity` after a successful createIdentity
 * call. Reset only on full page reload (module scope).*/
let identityMinted = false;

/**
 * Adopt an external wallet adapter pubkey as the identity owner.
 *
 * Called by the WalletStatus React hook when the user connects via
 * Phantom/Solflare. Resets the session so the next ensureIdentity
 * call binds to the connected wallet's pubkey, not a generated one.
 *
 * Idempotent: passing the same pubkey twice is a no-op. Passing null
 * disconnects and resets to the generated-keypair fallback.
 *
 * C3 guard: if the identity has already been minted (handleStart ran
 * successfully), ignore this call entirely — wallet-adapter connection
 * events after mint must not wipe the in-progress session.*/
export function adoptWalletOwner(pubkey: PublicKey | null): void {
  if (identityMinted) {
    console.warn(
      "[colonii] adoptWalletOwner called after identity minted — ignoring to preserve session"
    );
    return;
  }
  const next = pubkey ? pubkey.toBase58() : null;
  if (next === walletOwnerPubkey) return;
  walletOwnerPubkey = next;
  // Hard-reset so the next getColoniiSession rebuilds with the new owner.
  backend = null;
  userClient = null;
  serviceClient = null;
  issuerCreated = false;
}

export function getColoniiSession() {
  if (typeof window === "undefined") {
    // SSR safety: never instantiate on the server. Callers must check
    // for `null` and treat as "not yet ready" until first effect runs.
    return null;
  }
  if (!backend) backend = new MockBackend(DEFAULT_PROGRAM_ID);
  if (!userClient) {
    if (walletOwnerPubkey) {
      // Real wallet connected: pass a pubkey-only shim. Mock mode never
      // touches the secret key, so this is sufficient. When live mode
      // lands, swap this for an AnchorWallet from wallet-adapter-react.
      userClient = new BrowserMockColoniiClient({
        wallet: { publicKey: new PublicKey(walletOwnerPubkey) },
        backend,
      });
    } else {
      userClient = createDemoClient({ backend });
    }
  }
  if (!serviceClient) {
    serviceClient = new BrowserMockColoniiClient({
      wallet: Keypair.generate(),
      backend,
    });
  }
  return { backend, userClient, serviceClient };
}


/**
 * Idempotent: ensure the service wallet is registered as an active
 * issuer before we try to issue any credentials. Safe to call
 * multiple times.*/
export async function ensureIssuer(): Promise<void> {
  const session = getColoniiSession();
  if (!session) return;
  if (issuerCreated) return;
  await session.serviceClient.createIssuer({
    metadataUri: "https://colonii.app/issuers/colosseum-demo.json",
  });
  issuerCreated = true;
}

/** Create the user's identity bound to the chosen avatar. Idempotent.*/
export async function ensureIdentity(
  avatar: AvatarName
): Promise<IdentityRecord | null> {
  const session = getColoniiSession();
  if (!session) return null;
  const existing = await session.userClient.getIdentity();
  if (existing) {
    // Already minted in a prior call — lock the wallet choice.
    identityMinted = true;
    return existing;
  }
  const { identity } = await session.userClient.createIdentity({ avatar });
  // Lock the wallet choice: no more adoptWalletOwner resets after this point.
  identityMinted = true;
  return identity;
}

/**
 * Issue the demo credential ("Frontier Hackathon Participant") so the
 * identity status flips from `secured` → `active`. UI renders this as
 * the "Verified" pill.*/
export async function grantDemoCredential(
  subjectDid: string
): Promise<void> {
  const session = getColoniiSession();
  if (!session) return;
  await ensureIssuer();
  // Issuing a credential will fail if one of the same type already exists
  // for this subject — swallow the error so the call is idempotent in the
  // demo flow (e.g. user replays the scene).
  try {
    await session.serviceClient.issueCredential({
      subjectDid,
      credentialType: "Frontier Hackathon Participant",
      metadataUri: "https://colonii.app/credentials/frontier-hackathon.json",
    });
  } catch {
    /* already issued — fine for demo*/
  }
}

/** Anchor a memory + return both the new memory and the refreshed list.*/
export async function anchorMemoryAndList(memory: {
  sessionId: string;
  topic: string;
  notes?: string;
}): Promise<{ anchored: MemoryRecord; all: MemoryRecord[] } | null> {
  const session = getColoniiSession();
  if (!session) return null;
  try {
    const { memory: anchored } = await session.userClient.anchorMemory({
      memory,
    });
    const all = await session.userClient.listMemories();
    return { anchored, all };
  } catch {
    return null;
  }
}

/** For the optional "View on-chain" reveal panel.*/
export async function getCurrentIdentity(): Promise<IdentityRecord | null> {
  const session = getColoniiSession();
  if (!session) return null;
  return session.userClient.getIdentity();
}

/** All memories anchored against the current identity.*/
export async function getCurrentMemories(): Promise<MemoryRecord[]> {
  const session = getColoniiSession();
  if (!session) return [];
  return session.userClient.listMemories();
}

/**
 * Compose a single proof snapshot for the on-chain reveal panel — wraps
 * three reads in one call so the UI doesn't need to manage them.*/
export async function getProofSnapshot(): Promise<{
  identity: IdentityRecord | null;
  memories: MemoryRecord[];
} | null> {
  const session = getColoniiSession();
  if (!session) return null;
  const identity = await session.userClient.getIdentity();
  const memories = identity ? await session.userClient.listMemories() : [];
  return { identity, memories };
}
