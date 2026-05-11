/**
 * COLONII identity layer — end-to-end demo.
 *
 * This script is what integrators should read before wiring the SDK into
 * the Beta app. It walks the entire on-chain story exactly the way the
 * 3-minute demo video tells it:
 *
 *   1.  Create identity              ("Securing your identity")
 *   2.  Update DID and bind app avatar/profile references
 *   3.  Register issuer
 *   4.  Issue gating credential      ("Frontier Hackathon Participant")
 *   5.  Anchor a memory              ("COLONII is remembering this")
 *   6.  Check access — unlocked      (gate passes)
 *   7.  Anchor a second memory       (sequence 1)
 *   8.  Revoke the credential        (admin operation)
 *   9.  Check access — locked        (gate refuses, with a reason string)
 *   10. Read full state              (identity panel snapshot for the UI)
 *
 * Run it with:    pnpm run demo
 *
 * To target a deployed program instead, run:
 *                npm run demo:live
 *
 * In live mode you need:
 *   - SOLANA_RPC_URL  (defaults to https://api.devnet.solana.com; use
 *                      http://127.0.0.1:8899 for localnet)
 *   - SOLANA_WALLET   (path to a funded keypair JSON, default ~/.config/solana/id.json)
 */

import { Connection, Keypair, clusterApiUrl } from '@solana/web3.js';
import { AnchorProvider, Wallet } from '@coral-xyz/anchor';
import { readFileSync } from 'fs';
import { homedir } from 'os';
import { resolve } from 'path';

import {
  ColoniiClient,
  ColoniiClientConfig,
  DEFAULT_PROGRAM_ID,
  MockBackend,
  hashMemoryPayload,
  truncateHashHex,
} from '@colonii/identity-sdk';

const CREDENTIAL_TYPE = 'Frontier Hackathon Participant';

async function main() {
  const isLive = process.argv.includes('--live');
  const liveRpcUrl = process.env.SOLANA_RPC_URL ?? clusterApiUrl('devnet');
  const liveLabel = liveRpcUrl.includes('127.0.0.1') || liveRpcUrl.includes('localhost')
    ? 'localnet'
    : 'devnet';
  log.section(isLive ? `COLONII demo — LIVE (${liveLabel})` : 'COLONII demo — MOCK (in-memory)');

  // -------------------------------------------------------------------
  // The Beta app would have one ColoniiClient per logged-in user.
  // For this demo we run two clients side by side:
  //   - `userClient`  : the new user signing up ("Anja owner")
  //   - `issuerClient`: the COLONII service wallet that mints credentials
  //
  // Both share the same backend (mock mode) so they see each other's writes.
  // -------------------------------------------------------------------
  const userKeypair = Keypair.generate();
  const issuerKeypair = Keypair.generate();

  // Mock mode shares one MockBackend so both clients see each other's writes.
  // Live mode ignores the backend argument.
  const sharedBackend = isLive ? undefined : new MockBackend(DEFAULT_PROGRAM_ID);

  const userClient = makeClient({ owner: userKeypair, isLive, sharedBackend });
  const issuerClient = makeClient({ owner: issuerKeypair, isLive, sharedBackend });

  // -------------------------------------------------------------------
  // STEP 1 — Create the user's identity. Storyboard frames 5–7.
  // -------------------------------------------------------------------
  log.section('1. Create identity');
  const created = await userClient.createIdentity({ avatar: 'Anja' });
  log.info('DID', created.identity.did);
  log.info('Wallet (truncated)', created.identity.ownerWalletShort);
  log.info('Identity hash (truncated)', created.identity.identityHashShort);
  log.info('Status', created.identity.status, '— UI shows: "Identity secured"');
  log.receipt(created.receipt);

  // -------------------------------------------------------------------
  // STEP 2 — Update DID metadata references and bind app avatar/user ID.
  // These values are app-owned references/hashes, not dummy chain data.
  // -------------------------------------------------------------------
  log.section('2. Update DID and bind avatar');
  const updated = await userClient.updateDid({
    traitsHash: hashMemoryPayload({ traits: ['curious', 'builder', 'focused'] }),
    cultureTagsHash: hashMemoryPayload({ cultureTags: ['frontier', 'solana', 'ai-memory'] }),
    emotionalHash: hashMemoryPayload({ emotionalProfile: 'calm-intense-maker' }),
    metadataUri: 'ipfs://colonii/demo/anja-profile',
  });
  const bound = await userClient.bindAvatar({
    supabaseUuid: 'user_8f4f8d5e-3f0d-4e64-a09a-colonii-demo',
  });
  log.info('Metadata URI', updated.metadataUri);
  log.info('Supabase UUID', bound.supabaseUuid);
  log.info('Traits hash', updated.traitsHash);

  // -------------------------------------------------------------------
  // STEP 3 — Register the service wallet as a credential issuer.
  // -------------------------------------------------------------------
  log.section('3. Create issuer');
  const issuer = await issuerClient.createIssuer({
    metadataUri: 'https://colonii.app/issuers/frontier-demo.json',
  });
  log.info('Issuer address', issuer.issuer.address.toBase58());
  log.info('Issuer active', issuer.issuer.active);
  log.receipt(issuer.receipt);

  // -------------------------------------------------------------------
  // STEP 4 — Issuer mints the gating credential to the user's DID.
  // In the demo, this is what makes the user a "verified participant".
  // -------------------------------------------------------------------
  log.section('4. Issue credential');
  const issued = await issuerClient.issueCredential({
    subjectDid: created.identity.did,
    credentialType: CREDENTIAL_TYPE,
    metadataUri: 'https://colonii.app/credentials/frontier-hackathon.json',
    expiresAt: null,
  });
  log.info('Credential type', issued.credential.credentialType);
  log.info('Credential address', issued.credential.address.toBase58());
  log.info('Status', issued.credential.status);
  log.receipt(issued.receipt);

  // -------------------------------------------------------------------
  // STEP 5 — Anchor the first memory hash. Storyboard frames 14–16.
  // The Beta app would call this whenever a memory record is written
  // to Supabase ("COLONII is remembering this" UI moment).
  // -------------------------------------------------------------------
  log.section('5. Anchor first memory');
  const memoryPayload1 = {
    sessionId: 'session_001',
    topic: 'identity',
    intent: 'pitch_preparation',
    notes: 'User is preparing a pitch about identity and AI memory.',
  };
  const anchored1 = await userClient.anchorMemory({ memory: memoryPayload1 });
  log.info('Sequence', anchored1.memory.sequence);
  log.info('Hash (truncated)', anchored1.memory.memoryHashShort);
  log.info('Hash (full)', anchored1.memory.memoryHash);
  log.receipt(anchored1.receipt);

  // -------------------------------------------------------------------
  // STEP 6 — Gate UI calls checkAccess() to decide whether to render the
  // "locked" or "unlocked" state. This is the only call the gate UI
  // should ever make from the SDK.
  // -------------------------------------------------------------------
  log.section('6. Check access (should unlock)');
  const access1 = await userClient.checkAccess({
    did: created.identity.did,
    credentialType: CREDENTIAL_TYPE,
  });
  log.info('Decision', access1.decision);
  log.info('Reason', access1.reason);
  if (access1.decision !== 'unlocked') throw new Error('Demo invariant broken: should be unlocked');

  // -------------------------------------------------------------------
  // STEP 7 — Second memory anchor. Demonstrates the sequence chain.
  // -------------------------------------------------------------------
  log.section('7. Anchor second memory');
  const memoryPayload2 = {
    sessionId: 'session_001',
    topic: 'focus',
    intent: 'session_completed',
    notes: 'Focus session completed; behavioural pattern: deep_work.',
  };
  const anchored2 = await userClient.anchorMemory({ memory: memoryPayload2 });
  log.info('Sequence', anchored2.memory.sequence);
  log.info('Hash (truncated)', anchored2.memory.memoryHashShort);
  log.receipt(anchored2.receipt);

  // -------------------------------------------------------------------
  // STEP 8 — Revoke the credential. Same issuer wallet, same address.
  // -------------------------------------------------------------------
  log.section('8. Revoke credential');
  const revoked = await issuerClient.revokeCredential({
    credentialAddress: issued.credential.address,
  });
  log.info('Credential status', revoked.status);
  log.info('Revoked at', revoked.revokedAt?.toISOString() ?? 'n/a');

  // -------------------------------------------------------------------
  // STEP 9 — Gate UI re-checks access. Should now be locked.
  // -------------------------------------------------------------------
  log.section('9. Check access (should lock)');
  const access2 = await userClient.checkAccess({
    did: created.identity.did,
    credentialType: CREDENTIAL_TYPE,
  });
  log.info('Decision', access2.decision);
  log.info('Reason', access2.reason);
  if (access2.decision !== 'locked') throw new Error('Demo invariant broken: should be locked');

  // -------------------------------------------------------------------
  // STEP 10 — What the right-hand identity panel shows after all of this.
  // -------------------------------------------------------------------
  log.section('10. Final identity panel snapshot');
  const finalIdentity = await userClient.getIdentity(created.identity.did);
  if (!finalIdentity) throw new Error('Identity disappeared');
  const credentials = await userClient.listCredentials(finalIdentity.did);
  const memories = await userClient.listMemories(finalIdentity.did);

  console.log(JSON.stringify({
    identity: {
      did: finalIdentity.did,
      avatar: finalIdentity.avatar,
      status: finalIdentity.status,
      ownerWalletShort: finalIdentity.ownerWalletShort,
      identityHashShort: finalIdentity.identityHashShort,
      credentialCount: finalIdentity.credentialCount,
      memoryCount: finalIdentity.memoryCount,
      metadataUri: finalIdentity.metadataUri,
      supabaseUuid: finalIdentity.supabaseUuid,
    },
    credentials: credentials.map(c => ({
      type: c.credentialType,
      status: c.status,
      issuedAt: c.issuedAt.toISOString(),
    })),
    memories: memories.map(m => ({
      sequence: m.sequence,
      hash: truncateHashHex(m.memoryHash),
      timestamp: m.timestamp.toISOString(),
    })),
  }, null, 2));

  log.section('Demo complete.');
  console.log('\nWhat to take from this:');
  console.log('  - Every public method returns a record that maps directly to UI state.');
  console.log('  - No "transaction", "signature", or wallet-address jargon leaks through.');
  console.log('  - `checkAccess()` is the only call the gate UI needs.');
  console.log('  - The `mock` mode is identical in shape to `live`, so flip the flag once');
  console.log('    devnet is ready and nothing else changes.');
}

// -------- Mode-aware client construction -----------------------------------

function makeClient(args: {
  owner: Keypair;
  isLive: boolean;
  sharedBackend?: MockBackend;
}): ColoniiClient {
  if (args.isLive) {
    const rpcUrl = process.env.SOLANA_RPC_URL ?? clusterApiUrl('devnet');
    const walletPath =
      process.env.SOLANA_WALLET ?? resolve(homedir(), '.config/solana/id.json');
    const secret = JSON.parse(readFileSync(walletPath, 'utf8')) as number[];
    const keypair = Keypair.fromSecretKey(Uint8Array.from(secret));
    const connection = new Connection(rpcUrl, 'confirmed');
    const config: ColoniiClientConfig = {
      mode: 'live',
      connection,
      wallet: new Wallet(keypair),
    };
    return new ColoniiClient(config);
  }

  const config: ColoniiClientConfig = {
    mode: 'mock',
    wallet: args.owner,
    backend: args.sharedBackend,
  };
  return new ColoniiClient(config);
}

// -------- Tiny console formatter -------------------------------------------

const log = {
  section(title: string) {
    console.log('\n' + '─'.repeat(70));
    console.log(' ' + title);
    console.log('─'.repeat(70));
  },
  info(label: string, ...rest: unknown[]) {
    console.log(`  ${label}:`, ...rest);
  },
  receipt(receipt: string) {
    console.log(`  receipt: ${receipt}`);
  },
};

main().catch((err) => {
  console.error('Demo failed:', err);
  process.exit(1);
});
