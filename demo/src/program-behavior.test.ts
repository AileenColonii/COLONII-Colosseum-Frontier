import {
  AnchorProvider,
  BN,
  Idl,
  Program,
  Wallet,
} from '@coral-xyz/anchor';
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
} from '@solana/web3.js';
import { createHash } from 'crypto';
import {
  COLONII_IDL,
  ColoniiClient,
  DEFAULT_PROGRAM_ID,
  deriveCredentialPda,
  deriveIdentityPda,
  deriveIssuerPda,
  deriveMemoryAnchorPda,
  hashMemoryPayload,
} from '@colonii/identity-sdk';

const RPC_URL = process.env.SOLANA_RPC_URL ?? 'http://127.0.0.1:8899';
const CREDENTIAL_TYPE = 'Frontier Hackathon Participant';

interface NamedCheck {
  name: string;
  run: () => Promise<void>;
}

function walletFromKeypair(keypair: Keypair): Wallet {
  return new Wallet(keypair);
}

function programFor(connection: Connection, keypair: Keypair): Program<Idl> {
  const provider = new AnchorProvider(connection, walletFromKeypair(keypair), {
    commitment: 'confirmed',
  });
  const idlWithAddress = {
    ...(COLONII_IDL as unknown as Record<string, unknown>),
    address: DEFAULT_PROGRAM_ID.toBase58(),
  };
  return new (Program as unknown as new (
    idl: unknown,
    provider: AnchorProvider,
  ) => Program<Idl>)(idlWithAddress, provider);
}

async function fund(connection: Connection, keypair: Keypair) {
  const sig = await connection.requestAirdrop(keypair.publicKey, 5_000_000_000);
  const latest = await connection.getLatestBlockhash();
  await connection.confirmTransaction({ signature: sig, ...latest }, 'confirmed');
}

async function assertRejects(fn: () => Promise<unknown>, name: string) {
  try {
    await fn();
  } catch {
    return;
  }
  throw new Error(`${name} unexpectedly succeeded`);
}

function sha256Bytes(text: string): number[] {
  return [...createHash('sha256').update(text).digest()];
}

function wrongCredentialPda(subjectIdentity: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [
      new TextEncoder().encode('credential'),
      subjectIdentity.toBytes(),
      Uint8Array.from(Array(32).fill(7)),
    ],
    DEFAULT_PROGRAM_ID,
  )[0];
}

async function main() {
  const connection = new Connection(RPC_URL, 'confirmed');
  const user = Keypair.generate();
  const issuer = Keypair.generate();
  const wrongIssuer = Keypair.generate();
  const invalidOwner = Keypair.generate();
  const inactiveOwner = Keypair.generate();
  await Promise.all([
    fund(connection, user),
    fund(connection, issuer),
    fund(connection, wrongIssuer),
    fund(connection, invalidOwner),
    fund(connection, inactiveOwner),
  ]);

  const userClient = new ColoniiClient({
    mode: 'live',
    connection,
    wallet: walletFromKeypair(user),
    programId: DEFAULT_PROGRAM_ID,
  });
  const issuerClient = new ColoniiClient({
    mode: 'live',
    connection,
    wallet: walletFromKeypair(issuer),
    programId: DEFAULT_PROGRAM_ID,
  });
  const wrongIssuerClient = new ColoniiClient({
    mode: 'live',
    connection,
    wallet: walletFromKeypair(wrongIssuer),
    programId: DEFAULT_PROGRAM_ID,
  });

  const program = programFor(connection, user);
  const checks: NamedCheck[] = [];

  checks.push({
    name: 'invalid avatar code is rejected',
    run: async () => {
      const [identity] = deriveIdentityPda(DEFAULT_PROGRAM_ID, invalidOwner.publicKey);
      await assertRejects(
        () =>
          program.methods
            .initializeDid(99)
            .accounts({
              owner: invalidOwner.publicKey,
              identity,
              systemProgram: SystemProgram.programId,
            })
            .signers([invalidOwner])
            .rpc(),
        'invalid avatar initialization',
      );
    },
  });

  const created = await userClient.createIdentity({ avatar: 'Anja' });
  const issuerRecord = await issuerClient.createIssuer({
    metadataUri: 'https://colonii.app/issuers/frontier-demo.json',
  });
  if (!issuerRecord.issuer.active) throw new Error('issuer registration failed');

  checks.push({
    name: 'update DID and bind avatar store real references',
    run: async () => {
      const updated = await userClient.updateDid({
        traitsHash: hashMemoryPayload({ traits: ['curious', 'builder'] }),
        cultureTagsHash: hashMemoryPayload({ cultureTags: ['frontier', 'solana'] }),
        emotionalHash: hashMemoryPayload({ emotionalProfile: 'focused' }),
        metadataUri: 'ipfs://colonii/program-behavior-profile',
      });
      if (updated.metadataUri !== 'ipfs://colonii/program-behavior-profile') {
        throw new Error('metadata URI was not stored');
      }

      const bound = await userClient.bindAvatar({
        supabaseUuid: 'user_program_behavior_001',
      });
      if (bound.supabaseUuid !== 'user_program_behavior_001') {
        throw new Error('Supabase UUID was not stored');
      }
    },
  });

  checks.push({
    name: 'duplicate identity is rejected',
    run: async () => {
      await assertRejects(
        () => userClient.createIdentity({ avatar: 'Anja' }),
        'duplicate identity creation',
      );
    },
  });

  checks.push({
    name: 'memory sequence mismatch is rejected',
    run: async () => {
      const [anchor] = deriveMemoryAnchorPda(
        DEFAULT_PROGRAM_ID,
        created.identity.address,
        1,
      );
      await assertRejects(
        () =>
          program.methods
            .anchorMemory(Array(32).fill(1), new BN(1))
            .accounts({
              owner: user.publicKey,
              identity: created.identity.address,
              anchor,
              systemProgram: SystemProgram.programId,
            })
            .rpc(),
        'memory sequence mismatch',
      );
    },
  });

  checks.push({
    name: 'credential type hash mismatch is rejected',
    run: async () => {
      const credential = wrongCredentialPda(created.identity.address);
      const [issuerPda] = deriveIssuerPda(DEFAULT_PROGRAM_ID, issuer.publicKey);
      await assertRejects(
        () =>
          programFor(connection, issuer).methods
            .issueCredential(Array(32).fill(7), CREDENTIAL_TYPE, '', new BN(0))
            .accounts({
              issuer: issuer.publicKey,
              issuerRegistry: issuerPda,
              authority: issuer.publicKey,
              subjectIdentity: created.identity.address,
              credential,
              systemProgram: SystemProgram.programId,
            })
            .rpc(),
        'credential type hash mismatch',
      );
    },
  });

  const issued = await issuerClient.issueCredential({
    subjectDid: created.identity.did,
    credentialType: CREDENTIAL_TYPE,
    metadataUri: 'https://colonii.app/credentials/frontier-hackathon.json',
  });

  checks.push({
    name: 'inactive identity rejects future writes',
    run: async () => {
      const inactiveClient = new ColoniiClient({
        mode: 'live',
        connection,
        wallet: walletFromKeypair(inactiveOwner),
        programId: DEFAULT_PROGRAM_ID,
      });
      const inactive = await inactiveClient.createIdentity({ avatar: 'Grace' });
      await inactiveClient.deactivateDid();
      await assertRejects(
        () =>
          issuerClient.issueCredential({
            subjectDid: inactive.identity.did,
            credentialType: 'Inactive Identity Test',
          }),
        'issue credential to inactive identity',
      );
      await assertRejects(
        () => inactiveClient.anchorMemory({ memory: { should: 'fail' } }),
        'anchor memory to inactive identity',
      );
    },
  });

  checks.push({
    name: 'wrong issuer cannot revoke',
    run: async () => {
      await assertRejects(
        () =>
          wrongIssuerClient.revokeCredential({
            credentialAddress: issued.credential.address,
          }),
        'wrong issuer revoke',
      );
    },
  });

  checks.push({
    name: 'verify revoked credential fails',
    run: async () => {
      await issuerClient.revokeCredential({
        credentialAddress: issued.credential.address,
      });
      const [credential] = deriveCredentialPda(
        DEFAULT_PROGRAM_ID,
        created.identity.address,
        CREDENTIAL_TYPE,
      );
      await assertRejects(
        () =>
          program.methods
            .verifyCredential(sha256Bytes(CREDENTIAL_TYPE), CREDENTIAL_TYPE)
            .accounts({
              identity: created.identity.address,
              credential,
            })
            .rpc(),
        'verify revoked credential',
      );
    },
  });

  for (const check of checks) {
    await check.run();
    console.log(`PASS: ${check.name}`);
  }

  console.log('PASS: program behavior checks completed on localnet');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
