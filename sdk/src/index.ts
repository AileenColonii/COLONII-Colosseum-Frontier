/**
 * Public surface for `@colonii/identity-sdk`.
 *
 * Integrators should import from this module:
 *
 *   import { ColoniiClient, AvatarName } from '@colonii/identity-sdk';
 *
 * Anything imported from a deeper path (e.g. `./mock`) is considered
 * internal and may change without a major bump.
 */

export { ColoniiClient, DEFAULT_PROGRAM_ID } from './client';
export type {
  ColoniiClientConfig,
  ColoniiClientLiveConfig,
  ColoniiClientMockConfig,
} from './client';

export type {
  AccessCheckResult,
  AccessDecision,
  AnchorMemoryResult,
  AvatarName,
  CreateIdentityResult,
  CreateIssuerResult,
  CredentialRecord,
  CredentialStatus,
  DidHandle,
  IdentityRecord,
  IdentityStatus,
  IssuerRecord,
  IssueCredentialResult,
  MemoryRecord,
} from './types';

export {
  didFromPubkey,
  pubkeyFromDid,
  truncateWallet,
  truncateHashHex,
  hashMemoryPayload,
  bytesToHex,
  hexToBytes,
} from './format';

export {
  deriveIssuerPda,
  deriveIdentityPda,
  deriveCredentialPda,
  deriveMemoryAnchorPda,
} from './pda';

export { COLONII_IDL } from './idl';

// Mock backend is exported for advanced testing scenarios (e.g. seeding
// state across multiple clients in unit tests) and for browser-side demos
// that want to avoid bundling Anchor. The conversion helpers turn raw
// mock state into the same `*Record` shapes the live client returns.
export {
  MockBackend,
  mockIdentityToRecord,
  mockIssuerToRecord,
  mockCredentialToRecord,
  mockMemoryToRecord,
} from './mock';
