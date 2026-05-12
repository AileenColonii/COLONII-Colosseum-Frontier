/**
 * Browser-safe entry point.
 *
 * Re-exports everything the visual demo needs without loading
 * `./client`, which depends on `@coral-xyz/anchor`. Frontend code should
 * import from `@colonii/identity-sdk/browser` to keep Anchor out of the
 * browser bundle.
 *
 * import { MockBackend, ... } from '@colonii/identity-sdk/browser';
 *
 * Server-side code (Node demos, tests) keeps using the default entry:
 *
 * import { ColoniiClient, ... } from '@colonii/identity-sdk';*/

export { DEFAULT_PROGRAM_ID } from './program-id';

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

export {
  MockBackend,
  mockIdentityToRecord,
  mockIssuerToRecord,
  mockCredentialToRecord,
  mockMemoryToRecord,
} from './mock';
