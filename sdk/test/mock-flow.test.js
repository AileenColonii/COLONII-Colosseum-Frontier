const assert = require('node:assert/strict');
const test = require('node:test');
const { Keypair } = require('@solana/web3.js');
const {
  ColoniiClient,
  DEFAULT_PROGRAM_ID,
  MockBackend,
  hashMemoryPayload,
} = require('../dist');

const CREDENTIAL_TYPE = 'Frontier Hackathon Participant';

function makeClients() {
  const backend = new MockBackend(DEFAULT_PROGRAM_ID);
  const userWallet = Keypair.generate();
  const issuerWallet = Keypair.generate();
  return {
    backend,
    userWallet,
    issuerWallet,
    user: new ColoniiClient({
      mode: 'mock',
      wallet: userWallet,
      backend,
    }),
    issuer: new ColoniiClient({
      mode: 'mock',
      wallet: issuerWallet,
      backend,
    }),
  };
}

test('mock client completes the submission demo flow', async () => {
  const { user, issuer } = makeClients();

  const created = await user.createIdentity({ avatar: 'Anja' });
  assert.equal(created.identity.avatar, 'Anja');
  assert.equal(created.identity.status, 'secured');
  assert.equal(created.identity.credentialCount, 0);
  assert.equal(created.identity.memoryCount, 0);
  assert.match(created.identity.did, /^did:colonii:sol:/);

  const updated = await user.updateDid({
    traitsHash: hashMemoryPayload({ traits: ['curious', 'builder'] }),
    cultureTagsHash: hashMemoryPayload({ cultureTags: ['frontier', 'demo'] }),
    emotionalHash: hashMemoryPayload({ emotionalProfile: 'focused' }),
    metadataUri: 'ipfs://colonii-demo-profile',
  });
  assert.equal(updated.metadataUri, 'ipfs://colonii-demo-profile');
  assert.notEqual(updated.traitsHash, '0x0000000000000000000000000000000000000000000000000000000000000000');

  const bound = await user.bindAvatar({
    supabaseUuid: 'user_8f4f8d5e-3f0d-4e64-a09a-colonii-demo',
  });
  assert.equal(bound.supabaseUuid, 'user_8f4f8d5e-3f0d-4e64-a09a-colonii-demo');

  const issuerRecord = await issuer.createIssuer({
    metadataUri: 'https://colonii.app/issuers/frontier-demo.json',
  });
  assert.equal(issuerRecord.issuer.active, true);

  const issued = await issuer.issueCredential({
    subjectDid: created.identity.did,
    credentialType: CREDENTIAL_TYPE,
    metadataUri: 'https://colonii.app/credentials/frontier-hackathon.json',
  });
  assert.equal(issued.credential.status, 'active');
  assert.equal(issued.credential.credentialType, CREDENTIAL_TYPE);
  assert.equal(issued.credential.expiresAt, null);

  const unlocked = await user.checkAccess({
    did: created.identity.did,
    credentialType: CREDENTIAL_TYPE,
  });
  assert.equal(unlocked.decision, 'unlocked');
  assert.equal(unlocked.reason, 'Verified');

  const firstMemory = await user.anchorMemory({
    memory: { topic: 'identity', notes: 'User is preparing a pitch.' },
  });
  assert.equal(firstMemory.memory.sequence, 0);

  const secondMemory = await user.anchorMemory({
    memory: { topic: 'identity', notes: 'AI should remember the user.' },
  });
  assert.equal(secondMemory.memory.sequence, 1);

  const identityAfterMemory = await user.getIdentity(created.identity.did);
  assert.equal(identityAfterMemory.status, 'active');
  assert.equal(identityAfterMemory.credentialCount, 1);
  assert.equal(identityAfterMemory.memoryCount, 2);
  assert.ok(identityAfterMemory.lastAnchorAt instanceof Date);

  const memories = await user.listMemories(created.identity.did);
  assert.deepEqual(memories.map((m) => m.sequence), [0, 1]);

  const revoked = await issuer.revokeCredential({
    credentialAddress: issued.credential.address,
  });
  assert.equal(revoked.status, 'revoked');
  assert.ok(revoked.revokedAt instanceof Date);

  const locked = await user.checkAccess({
    did: created.identity.did,
    credentialType: CREDENTIAL_TYPE,
  });
  assert.equal(locked.decision, 'locked');
  assert.equal(locked.reason, 'Revoked');
});

test('mock backend enforces duplicate identity, duplicate credential, and issuer authority', async () => {
  const { backend, user, issuer, userWallet } = makeClients();
  const wrongIssuer = new ColoniiClient({
    mode: 'mock',
    wallet: Keypair.generate(),
    backend,
  });

  const created = await user.createIdentity({ avatar: 'Anja' });
  await issuer.createIssuer();
  await assert.rejects(
    () => user.createIdentity({ avatar: 'Anja' }),
    /Identity already exists/,
  );

  const issued = await issuer.issueCredential({
    subjectDid: created.identity.did,
    credentialType: CREDENTIAL_TYPE,
  });
  await assert.rejects(
    () =>
      issuer.issueCredential({
        subjectDid: created.identity.did,
        credentialType: CREDENTIAL_TYPE,
      }),
    /Credential already exists/,
  );

  await assert.rejects(
    () => wrongIssuer.revokeCredential({ credentialAddress: issued.credential.address }),
    /UnauthorizedIssuer/,
  );

  assert.equal(created.identity.ownerWallet.toBase58(), userWallet.publicKey.toBase58());
});

test('mock backend requires issuer registration and blocks inactive identities', async () => {
  const { user, issuer } = makeClients();
  const created = await user.createIdentity({ avatar: 'Anja' });

  await assert.rejects(
    () =>
      issuer.issueCredential({
        subjectDid: created.identity.did,
        credentialType: CREDENTIAL_TYPE,
      }),
    /IssuerInactive/,
  );

  await user.deactivateDid();
  await assert.rejects(
    () =>
      user.anchorMemory({
        memory: { should: 'fail' },
      }),
    /IdentityInactive/,
  );
});

test('mock memory hashing is stable across object key order', () => {
  const a = hashMemoryPayload({ b: 2, a: 1 });
  const b = hashMemoryPayload({ a: 1, b: 2 });
  assert.deepEqual([...a], [...b]);
  assert.equal(a.length, 32);
});
