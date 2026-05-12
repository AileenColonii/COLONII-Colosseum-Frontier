use anchor_lang::prelude::*;

use crate::errors::ColoniiError;
use crate::events::IdentityCreated;
use crate::state::{seeds, Avatar, Identity, IdentityStatus};

/// Accounts for `initialize_did`.
///
/// Creates a new Identity PDA owned by the signer and bound to one avatar.
/// The PDA address itself is the on-chain DID; the off-chain string form
/// `did:colonii:sol:<base58(pda)>` is computed in the SDK.
#[derive(Accounts)]
pub struct InitializeDid<'info> {
    /// The wallet that will own this identity. Must sign and pay for rent.
    #[account(mut)]
    pub owner: Signer<'info>,

    /// Newly created identity PDA.
    #[account(
        init,
        payer = owner,
        space = Identity::SIZE,
        seeds = [seeds::IDENTITY, owner.key().as_ref()],
        bump
    )]
    pub identity: Account<'info, Identity>,

    pub system_program: Program<'info, System>,
}

/// Create a fresh identity for `owner` and bind it to `avatar_code`.
///
/// `avatar_code` is the wire-level u8 representation: 0=Anja, 1=Hung,
/// 2=Grace, 3=Leon. Anything else returns `InvalidAvatarCode`.
pub fn handler(ctx: Context<InitializeDid>, avatar_code: u8) -> Result<()> {
    let avatar = Avatar::from_code(avatar_code).ok_or(ColoniiError::InvalidAvatarCode)?;

    let clock = Clock::get()?;
    let identity = &mut ctx.accounts.identity;

    identity.owner = ctx.accounts.owner.key();
    identity.avatar = avatar;
    identity.status = IdentityStatus::Secured;
    identity.created_at = clock.unix_timestamp;
    identity.last_anchor_at = 0;
    identity.credential_count = 0;
    identity.memory_count = 0;
    identity.traits_hash = [0; 32];
    identity.culture_tags_hash = [0; 32];
    identity.emotional_hash = [0; 32];
    identity.metadata_uri = String::new();
    identity.supabase_uuid = String::new();
    identity.bump = ctx.bumps.identity;

    emit!(IdentityCreated {
        identity: identity.key(),
        owner: identity.owner,
        avatar: identity.avatar,
        status: identity.status,
        timestamp: clock.unix_timestamp,
    });

    Ok(())
}
