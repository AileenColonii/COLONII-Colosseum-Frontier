use anchor_lang::prelude::*;

use crate::errors::ColoniiError;
use crate::events::AvatarUpdated;
use crate::state::{seeds, Avatar, Identity, IdentityStatus};

/// Accounts for `update_avatar_binding`.
#[derive(Accounts)]
pub struct UpdateAvatarBinding<'info> {
    /// Owner of the identity. Must sign.
    pub owner: Signer<'info>,

    /// The identity whose avatar binding is being changed.
    /// Validated to be owned by `owner` via the `has_one` constraint.
    #[account(
        mut,
        seeds = [seeds::IDENTITY, owner.key().as_ref()],
        bump = identity.bump,
        has_one = owner @ ColoniiError::UnauthorizedOwner,
    )]
    pub identity: Account<'info, Identity>,
}

/// Switch the avatar bound to an existing identity.
///
/// Inactive identities cannot change avatar.
pub fn handler(ctx: Context<UpdateAvatarBinding>, avatar_code: u8) -> Result<()> {
    let new_avatar = Avatar::from_code(avatar_code).ok_or(ColoniiError::InvalidAvatarCode)?;

    let identity = &mut ctx.accounts.identity;
    require!(
        identity.status != IdentityStatus::Inactive,
        ColoniiError::IdentityInactive
    );

    let previous = identity.avatar;
    identity.avatar = new_avatar;

    let clock = Clock::get()?;
    emit!(AvatarUpdated {
        identity: identity.key(),
        previous,
        current: new_avatar,
        timestamp: clock.unix_timestamp,
    });

    Ok(())
}
