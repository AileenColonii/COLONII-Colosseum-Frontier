use anchor_lang::prelude::*;

use crate::errors::ColoniiError;
use crate::events::AvatarBound;
use crate::state::{seeds, Identity, IdentityStatus, MAX_SUPABASE_UUID_LEN};

/// Accounts for `bind_avatar`.
#[derive(Accounts)]
pub struct BindAvatar<'info> {
    /// Owner of the identity. Must sign.
    pub owner: Signer<'info>,

    /// Identity receiving the Supabase/avatar binding.
    #[account(
        mut,
        seeds = [seeds::IDENTITY, owner.key().as_ref()],
        bump = identity.bump,
        has_one = owner @ ColoniiError::UnauthorizedOwner,
    )]
    pub identity: Account<'info, Identity>,
}

/// Bind a Supabase UUID/user identifier to an on-chain DID.
pub fn handler(ctx: Context<BindAvatar>, supabase_uuid: String) -> Result<()> {
    require!(
        supabase_uuid.len() <= MAX_SUPABASE_UUID_LEN,
        ColoniiError::SupabaseUuidTooLong
    );

    let identity = &mut ctx.accounts.identity;
    require!(
        identity.status != IdentityStatus::Inactive,
        ColoniiError::IdentityInactive
    );

    identity.supabase_uuid = supabase_uuid.clone();

    emit!(AvatarBound {
        identity: identity.key(),
        owner: identity.owner,
        supabase_uuid,
        timestamp: Clock::get()?.unix_timestamp,
    });

    Ok(())
}
