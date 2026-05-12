use anchor_lang::prelude::*;

use super::{MAX_METADATA_URI_LEN, MAX_SUPABASE_UUID_LEN};

/// The four launch avatars in the COLONII Beta app. Encoded as a fixed-size
/// enum so account-space accounting stays trivial.
///
/// Adding a new avatar later means appending a variant; never reorder.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug)]
#[repr(u8)]
pub enum Avatar {
    Anja = 0,
    Hung = 1,
    Grace = 2,
    Leon = 3,
}

impl Avatar {
    /// Decode from the wire-level u8 used by the SDK and clients.
    pub fn from_code(code: u8) -> Option<Self> {
        match code {
            0 => Some(Avatar::Anja),
            1 => Some(Avatar::Hung),
            2 => Some(Avatar::Grace),
            3 => Some(Avatar::Leon),
            _ => None,
        }
    }
}

/// User-facing lifecycle status for an identity.
///
/// Vocabulary is intentionally product-friendly (no "minted", "pending_tx",
/// etc.) so the SDK can surface it directly to the UI without translation.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug)]
#[repr(u8)]
pub enum IdentityStatus {
    /// Created but no credentials or memory anchors yet.
    Secured = 0,
    /// Has at least one credential or memory anchor.
    Active = 1,
    /// Disabled by the owner. Existing credentials are not revoked, but
    /// the identity refuses new memory anchors and credential issuance.
    Inactive = 2,
}

/// The DID account. One per wallet.
///
/// PDA: seeds = [`seeds::IDENTITY`, owner.key().as_ref()]
#[account]
pub struct Identity {
    /// Wallet that owns this identity. Required signer for all mutations.
    pub owner: Pubkey,
    /// Currently bound avatar.
    pub avatar: Avatar,
    /// Lifecycle status.
    pub status: IdentityStatus,
    /// Unix timestamp of creation.
    pub created_at: i64,
    /// Timestamp of the most recent memory anchor (0 if none).
    pub last_anchor_at: i64,
    /// Number of credentials ever issued to this identity (active or revoked).
    pub credential_count: u32,
    /// Sequence counter for memory anchors. Next anchor uses this value
    /// then increments.
    pub memory_count: u64,
    /// Hash of traits/profile data stored off-chain.
    pub traits_hash: [u8; 32],
    /// Hash of culture tags stored off-chain.
    pub culture_tags_hash: [u8; 32],
    /// Hash of emotional profile data stored off-chain.
    pub emotional_hash: [u8; 32],
    /// Optional off-chain profile/lore metadata pointer.
    pub metadata_uri: String,
    /// Optional Supabase UUID/user identifier bound to this DID.
    pub supabase_uuid: String,
    /// PDA bump.
    pub bump: u8,
}

impl Identity {
    /// 8 (discriminator) + struct size, conservative.
    /// owner(32) + avatar(1) + status(1) + created_at(8) + last_anchor_at(8)
    /// + credential_count(4) + memory_count(8) + profile hashes(96)
    /// + metadata_uri(4+200) + supabase_uuid(4+64) + bump(1) = 431
    pub const SIZE: usize = 8
        + 32
        + 1
        + 1
        + 8
        + 8
        + 4
        + 8
        + 32
        + 32
        + 32
        + 4 + MAX_METADATA_URI_LEN
        + 4 + MAX_SUPABASE_UUID_LEN
        + 1;
}
