/**
 * Public surface for the vendored Colonii identity SDK.
 *
 * Mirrors `gmxbt/colonii-identity/sdk/src/index.ts` byte-for-byte
 * except for one substitution: the upstream `ColoniiClient` is
 * exported from `./client` (which hard-imports `@coral-xyz/anchor`),
 * but the Colosseum demo uses the browser-safe wrapper in
 * `./client-browser` to keep the Anchor bundle off the first-load
 * graph. The API surface is identical in mock mode — when the team
 * flips to live devnet, swap this single re-export line.
 *
 * Program ID (deployed target): `E8K8WUxSjEgQAArjT4NkpDxrri59b3SNLVmDCU3yyCCG`
 * Deployment status: Anchor program built + tested locally, pending
 * devnet deploy (deployer wallet funding outstanding — see * INTEGRATION_HANDOFF.md in `gmxbt/colonii-identity`).*/

// The mock-mode client. Aliased to upstream names so a future
// live-mode rev only needs to swap these three lines for
// `export { ColoniiClient, DEFAULT_PROGRAM_ID } from './client';`
// `export type { ColoniiClientConfig, ColoniiClientMockConfig } from './client';`
// (and add @coral-xyz/anchor to package.json).
export {
  BrowserMockColoniiClient as ColoniiClient,
  createDemoClient,
} from "./client-browser";
export type { BrowserMockClientConfig as ColoniiClientConfig } from "./client-browser";
export { DEFAULT_PROGRAM_ID } from "./program-id";

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
} from "./types";

export {
  didFromPubkey,
  pubkeyFromDid,
  truncateWallet,
  truncateHashHex,
  hashMemoryPayload,
  bytesToHex,
  hexToBytes,
} from "./format";

export {
  deriveIssuerPda,
  deriveIdentityPda,
  deriveCredentialPda,
  deriveMemoryAnchorPda,
} from "./pda";

export { COLONII_IDL } from "./idl";

// Mock backend exported for advanced testing scenarios (seeding state
// across multiple clients) and for the browser demos that want to
// avoid bundling Anchor entirely. The `mock*ToRecord` helpers convert
// raw mock state into the same `*Record` shapes the live client returns.
export {
  MockBackend,
  mockIdentityToRecord,
  mockIssuerToRecord,
  mockCredentialToRecord,
  mockMemoryToRecord,
} from "./mock";
