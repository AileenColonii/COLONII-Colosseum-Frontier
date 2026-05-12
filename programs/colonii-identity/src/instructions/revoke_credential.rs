use anchor_lang::prelude::*;

use crate::errors::ColoniiError;
use crate::events::CredentialRevoked;
use crate::state::{Credential, CredentialStatus};

/// Accounts for `revoke_credential`.
#[derive(Accounts)]
pub struct RevokeCredential<'info> {
    /// Original issuer of the credential. Required signer.
    pub issuer: Signer<'info>,

    /// The credential being revoked. The `has_one = issuer` constraint
    /// guarantees only the original issuer can revoke.
    #[account(
        mut,
        has_one = issuer @ ColoniiError::UnauthorizedIssuer,
    )]
    pub credential: Account<'info, Credential>,
}

/// Mark a credential as revoked. The account is preserved (not closed) so
/// indexers can still see the historical record. To re-issue an identical
/// (subject, type) credential after revocation, close this account first.
pub fn handler(ctx: Context<RevokeCredential>) -> Result<()> {
    let credential = &mut ctx.accounts.credential;

    require!(
        credential.status == CredentialStatus::Active,
        ColoniiError::CredentialAlreadyRevoked
    );

    let clock = Clock::get()?;
    credential.status = CredentialStatus::Revoked;
    credential.revoked_at = clock.unix_timestamp;

    emit!(CredentialRevoked {
        credential: credential.key(),
        subject: credential.subject,
        issuer: credential.issuer,
        timestamp: clock.unix_timestamp,
    });

    Ok(())
}
