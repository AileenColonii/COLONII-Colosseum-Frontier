use anchor_lang::prelude::*;

use super::{MAX_CREDENTIAL_TYPE_LEN, MAX_METADATA_URI_LEN};

/// Verifiable credential lifecycle status.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug)]
#[repr(u8)]
pub enum CredentialStatus {
    Active = 0,
    Revoked = 1,
}

/// A verifiable credential issued by `issuer` to `subject` (an Identity PDA).
///
/// PDA: seeds = [`seeds::CREDENTIAL`, subject.as_ref(), &type_hash]
/// where `type_hash = sha256(credential_type)`.
///
/// Constraint: at most one credential of each type per subject. To re-issue
/// after revocation, close the existing account first (out of scope for the
/// hackathon demo).
#[account]
pub struct Credential {
    /// The Identity PDA the credential is bound to.
    pub subject: Pubkey,
    /// Wallet that issued this credential. Only this key may revoke it.
    pub issuer: Pubkey,
    /// Lifecycle status.
    pub status: CredentialStatus,
    /// Unix timestamp of issuance.
    pub issued_at: i64,
    /// Timestamp of revocation (0 if not revoked).
    pub revoked_at: i64,
    /// Expiration timestamp (0 means no expiration).
    pub expires_at: i64,
    /// SHA-256 of `credential_type`. Stored explicitly so verifiers don't
    /// need to recompute and so the value is auditable on-chain.
    pub type_hash: [u8; 32],
    /// Human-readable credential type (e.g. "Frontier Hackathon Participant").
    /// Bounded by `MAX_CREDENTIAL_TYPE_LEN`.
    pub credential_type: String,
    /// Optional off-chain metadata pointer (IPFS URI, HTTPS URL, etc.).
    pub metadata_uri: String,
    /// PDA bump.
    pub bump: u8,
}

impl Credential {
    /// Account size including the 8-byte Anchor discriminator and the
    /// 4-byte length prefix Borsh emits before each `String`.
    pub const SIZE: usize = 8
        + 32                              // subject
        + 32                              // issuer
        + 1                               // status
        + 8                               // issued_at
        + 8                               // revoked_at
        + 8                               // expires_at
        + 32                              // type_hash
        + 4 + MAX_CREDENTIAL_TYPE_LEN     // credential_type (length-prefixed)
        + 4 + MAX_METADATA_URI_LEN        // metadata_uri (length-prefixed)
        + 1; // bump
}
