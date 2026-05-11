use anchor_lang::prelude::*;

use super::MAX_METADATA_URI_LEN;

/// Wallet authority allowed to issue COLONII credentials.
///
/// PDA: seeds = [`seeds::ISSUER`, authority.key().as_ref()]
#[account]
pub struct Issuer {
    /// Wallet registered as the issuing authority.
    pub authority: Pubkey,
    /// Whether this issuer is active.
    pub active: bool,
    /// Optional off-chain metadata pointer for issuer policy/profile.
    pub metadata_uri: String,
    /// Unix timestamp of registration.
    pub created_at: i64,
    /// PDA bump.
    pub bump: u8,
}

impl Issuer {
    /// 8 (discriminator) + authority(32) + active(1)
    /// + metadata_uri(4+200) + created_at(8) + bump(1) = 254
    pub const SIZE: usize = 8 + 32 + 1 + 4 + MAX_METADATA_URI_LEN + 8 + 1;
}
