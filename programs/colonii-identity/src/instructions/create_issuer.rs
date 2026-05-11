use anchor_lang::prelude::*;

use crate::errors::ColoniiError;
use crate::events::IssuerCreated;
use crate::state::{seeds, Issuer, MAX_METADATA_URI_LEN};

/// Accounts for `create_issuer`.
#[derive(Accounts)]
pub struct CreateIssuer<'info> {
    /// Wallet being registered as an issuer. Must sign and pay rent.
    #[account(mut)]
    pub authority: Signer<'info>,

    /// Issuer registry PDA for the authority wallet.
    #[account(
        init,
        payer = authority,
        space = Issuer::SIZE,
        seeds = [seeds::ISSUER, authority.key().as_ref()],
        bump,
    )]
    pub issuer: Account<'info, Issuer>,

    pub system_program: Program<'info, System>,
}

/// Register a wallet as an active credential issuer.
pub fn handler(ctx: Context<CreateIssuer>, metadata_uri: String) -> Result<()> {
    require!(
        metadata_uri.len() <= MAX_METADATA_URI_LEN,
        ColoniiError::IssuerMetadataUriTooLong
    );

    let issuer = &mut ctx.accounts.issuer;
    issuer.authority = ctx.accounts.authority.key();
    issuer.active = true;
    issuer.metadata_uri = metadata_uri.clone();
    issuer.created_at = Clock::get()?.unix_timestamp;
    issuer.bump = ctx.bumps.issuer;

    emit!(IssuerCreated {
        issuer: issuer.key(),
        authority: issuer.authority,
        metadata_uri,
        timestamp: issuer.created_at,
    });

    Ok(())
}
