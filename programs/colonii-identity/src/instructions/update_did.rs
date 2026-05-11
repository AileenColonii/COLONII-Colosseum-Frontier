use anchor_lang::prelude::*;

use crate::errors::ColoniiError;
use crate::events::IdentityUpdated;
use crate::state::{seeds, Identity, IdentityStatus, MAX_METADATA_URI_LEN};

/// Accounts for `update_did`.
#[derive(Accounts)]
pub struct UpdateDid<'info> {
    /// Owner of the identity. Must sign.
    pub owner: Signer<'info>,

    /// The identity whose off-chain profile references are being updated.
    #[account(
        mut,
        seeds = [seeds::IDENTITY, owner.key().as_ref()],
        bump = identity.bump,
        has_one = owner @ ColoniiError::UnauthorizedOwner,
    )]
    pub identity: Account<'info, Identity>,
}

/// Update the DID's off-chain profile references.
///
/// Full traits, culture tags, emotional profile, and lore stay off-chain.
/// The program stores hashes and a metadata URI so the app can prove
/// integrity without storing private profile data on-chain.
pub fn handler(
    ctx: Context<UpdateDid>,
    traits_hash: [u8; 32],
    culture_tags_hash: [u8; 32],
    emotional_hash: [u8; 32],
    metadata_uri: String,
) -> Result<()> {
    require!(
        metadata_uri.len() <= MAX_METADATA_URI_LEN,
        ColoniiError::MetadataUriTooLong
    );

    let identity = &mut ctx.accounts.identity;
    require!(
        identity.status != IdentityStatus::Inactive,
        ColoniiError::IdentityInactive
    );

    identity.traits_hash = traits_hash;
    identity.culture_tags_hash = culture_tags_hash;
    identity.emotional_hash = emotional_hash;
    identity.metadata_uri = metadata_uri.clone();

    emit!(IdentityUpdated {
        identity: identity.key(),
        traits_hash,
        culture_tags_hash,
        emotional_hash,
        metadata_uri,
        timestamp: Clock::get()?.unix_timestamp,
    });

    Ok(())
}
