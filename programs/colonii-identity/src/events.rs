use anchor_lang::prelude::*;

use crate::state::{Avatar, CredentialStatus, IdentityStatus};

/// Emitted when a new DID/identity is created and bound to a wallet.
#[event]
pub struct IdentityCreated {
    pub identity: Pubkey,
    pub owner: Pubkey,
    pub avatar: Avatar,
    pub status: IdentityStatus,
    pub timestamp: i64,
}

/// Emitted when an identity changes its bound avatar.
#[event]
pub struct AvatarUpdated {
    pub identity: Pubkey,
    pub previous: Avatar,
    pub current: Avatar,
    pub timestamp: i64,
}

/// Emitted when profile/reference fields on a DID are updated.
#[event]
pub struct IdentityUpdated {
    pub identity: Pubkey,
    pub traits_hash: [u8; 32],
    pub culture_tags_hash: [u8; 32],
    pub emotional_hash: [u8; 32],
    pub metadata_uri: String,
    pub timestamp: i64,
}

/// Emitted when a DID is deactivated.
#[event]
pub struct IdentityDeactivated {
    pub identity: Pubkey,
    pub owner: Pubkey,
    pub timestamp: i64,
}

/// Emitted when a wallet registers as an issuer.
#[event]
pub struct IssuerCreated {
    pub issuer: Pubkey,
    pub authority: Pubkey,
    pub metadata_uri: String,
    pub timestamp: i64,
}

/// Emitted when an app-level avatar/user ID is bound to a DID.
#[event]
pub struct AvatarBound {
    pub identity: Pubkey,
    pub owner: Pubkey,
    pub supabase_uuid: String,
    pub timestamp: i64,
}

/// Emitted when a verifiable credential is issued to an identity.
#[event]
pub struct CredentialIssued {
    pub credential: Pubkey,
    pub subject: Pubkey,
    pub issuer: Pubkey,
    pub credential_type: String,
    pub expires_at: i64,
    pub timestamp: i64,
}

/// Emitted when a verifiable credential is revoked.
#[event]
pub struct CredentialRevoked {
    pub credential: Pubkey,
    pub subject: Pubkey,
    pub issuer: Pubkey,
    pub timestamp: i64,
}

/// Emitted by the on-chain verify_credential instruction.
/// Useful for CPI callers and indexing.
#[event]
pub struct CredentialVerified {
    pub credential: Pubkey,
    pub subject: Pubkey,
    pub credential_type: String,
    pub status: CredentialStatus,
    pub valid: bool,
    pub expires_at: i64,
    pub timestamp: i64,
}

/// Emitted on every memory hash anchor.
#[event]
pub struct MemoryAnchored {
    pub identity: Pubkey,
    pub anchor: Pubkey,
    pub sequence: u64,
    pub memory_hash: [u8; 32],
    pub timestamp: i64,
}
