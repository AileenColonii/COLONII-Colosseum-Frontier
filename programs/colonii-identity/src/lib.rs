//! # COLONII Identity Program
//!
//! On-chain identity layer for the COLONII Beta app:
//!
//! 1. **DID layer** — create, update, deactivate, avatar/app binding
//! 2. **Issuer layer** — issuer registration
//! 3. **Verifiable Credentials** — issue, revoke, verify with expiry checks
//! 4. **Memory anchoring** — `anchor_memory`
//!
//! Every instruction is in `instructions/`. Account schemas in `state/`.
//! Errors in `errors.rs`, events in `events.rs`. The SDK in `../sdk` wraps
//! these into a UX-friendly TypeScript surface that hides Solana from the
//! frontend.

use anchor_lang::prelude::*;

pub mod errors;
pub mod events;
pub mod instructions;
pub mod state;

use instructions::*;

declare_id!("E8K8WUxSjEgQAArjT4NkpDxrri59b3SNLVmDCU3yyCCG");

#[program]
pub mod colonii_identity {
    use super::*;

    /// Create a fresh identity bound to the signer's wallet and one avatar.
    /// `avatar_code`: 0=Anja, 1=Hung, 2=Grace, 3=Leon.
    pub fn initialize_did(ctx: Context<InitializeDid>, avatar_code: u8) -> Result<()> {
        instructions::initialize_did::handler(ctx, avatar_code)
    }

    /// Switch which avatar an existing identity is bound to.
    pub fn update_avatar_binding(
        ctx: Context<UpdateAvatarBinding>,
        avatar_code: u8,
    ) -> Result<()> {
        instructions::update_avatar::handler(ctx, avatar_code)
    }

    /// Update traits/culture/emotional hashes and metadata URI for a DID.
    pub fn update_did(
        ctx: Context<UpdateDid>,
        traits_hash: [u8; 32],
        culture_tags_hash: [u8; 32],
        emotional_hash: [u8; 32],
        metadata_uri: String,
    ) -> Result<()> {
        instructions::update_did::handler(
            ctx,
            traits_hash,
            culture_tags_hash,
            emotional_hash,
            metadata_uri,
        )
    }

    /// Mark an identity inactive.
    pub fn deactivate_did(ctx: Context<DeactivateDid>) -> Result<()> {
        instructions::deactivate_did::handler(ctx)
    }

    /// Register the signer wallet as an active credential issuer.
    pub fn create_issuer(ctx: Context<CreateIssuer>, metadata_uri: String) -> Result<()> {
        instructions::create_issuer::handler(ctx, metadata_uri)
    }

    /// Bind an app-level Supabase UUID/avatar record to the signer's DID.
    pub fn bind_avatar(ctx: Context<BindAvatar>, supabase_uuid: String) -> Result<()> {
        instructions::bind_avatar::handler(ctx, supabase_uuid)
    }

    /// Issue a verifiable credential of `credential_type` to a subject
    /// identity, optionally pointing at off-chain metadata.
    pub fn issue_credential(
        ctx: Context<IssueCredential>,
        credential_type_hash: [u8; 32],
        credential_type: String,
        metadata_uri: String,
        expires_at: i64,
    ) -> Result<()> {
        instructions::issue_credential::handler(
            ctx,
            credential_type_hash,
            credential_type,
            metadata_uri,
            expires_at,
        )
    }

    /// Revoke a previously issued credential. Only the original issuer
    /// can call this.
    pub fn revoke_credential(ctx: Context<RevokeCredential>) -> Result<()> {
        instructions::revoke_credential::handler(ctx)
    }

    /// Verify on-chain that an identity holds an active credential of
    /// `credential_type`. Errors if not active. Useful for CPI.
    pub fn verify_credential(
        ctx: Context<VerifyCredential>,
        credential_type_hash: [u8; 32],
        credential_type: String,
    ) -> Result<()> {
        instructions::verify_credential::handler(ctx, credential_type_hash, credential_type)
    }

    /// Anchor a 32-byte memory hash to the caller's identity, with a
    /// monotonically increasing sequence number. The hash format is
    /// agreed off-chain (sha256/blake3/keccak); the program is opaque.
    pub fn anchor_memory(
        ctx: Context<AnchorMemory>,
        memory_hash: [u8; 32],
        sequence: u64,
    ) -> Result<()> {
        instructions::anchor_memory::handler(ctx, memory_hash, sequence)
    }
}
