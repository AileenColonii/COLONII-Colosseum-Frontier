use anchor_lang::prelude::*;

use crate::errors::ColoniiError;
use crate::events::IdentityDeactivated;
use crate::state::{seeds, Identity, IdentityStatus};

/// Accounts for `deactivate_did`.
#[derive(Accounts)]
pub struct DeactivateDid<'info> {
    /// Owner of the identity. Must sign.
    pub owner: Signer<'info>,

    /// Identity being marked inactive.
    #[account(
        mut,
        seeds = [seeds::IDENTITY, owner.key().as_ref()],
        bump = identity.bump,
        has_one = owner @ ColoniiError::UnauthorizedOwner,
    )]
    pub identity: Account<'info, Identity>,
}

/// Mark an identity inactive. This preserves historical credentials and
/// memory anchors while preventing future writes to the DID.
pub fn handler(ctx: Context<DeactivateDid>) -> Result<()> {
    let identity = &mut ctx.accounts.identity;
    identity.status = IdentityStatus::Inactive;

    emit!(IdentityDeactivated {
        identity: identity.key(),
        owner: identity.owner,
        timestamp: Clock::get()?.unix_timestamp,
    });

    Ok(())
}
