use anchor_lang::prelude::*;
use solana_sha256_hasher::hashv;

use crate::errors::ColoniiError;
use crate::events::CredentialVerified;
use crate::state::{seeds, Credential, CredentialStatus, Identity};

/// Accounts for `verify_credential`.
///
/// This is a read-only-style instruction: it validates the credential
/// belongs to the identity and is active, then emits an event. CPI
/// callers (e.g. a future gating program) can rely on the instruction
/// completing successfully as proof of access.
#[derive(Accounts)]
#[instruction(credential_type_hash: [u8; 32])]
pub struct VerifyCredential<'info> {
    /// The identity whose access is being checked.
    pub identity: Account<'info, Identity>,

    /// The credential to verify. PDA derivation re-checks (subject, type)
    /// binding without trusting the caller's account input.
    #[account(
        seeds = [
            seeds::CREDENTIAL,
            identity.key().as_ref(),
            &credential_type_hash,
        ],
        bump = credential.bump,
    )]
    pub credential: Account<'info, Credential>,
}

/// Verify that `identity` holds an active credential of `credential_type`.
///
/// Returns `Ok(())` if active, `CredentialNotActive` otherwise.
/// Emits `CredentialVerified` either way (the `valid` field on the event
/// reflects the outcome).
pub fn handler(
    ctx: Context<VerifyCredential>,
    credential_type_hash: [u8; 32],
    credential_type: String,
) -> Result<()> {
    let credential = &ctx.accounts.credential;
    let identity = &ctx.accounts.identity;

    require!(
        credential_type_hash == hashv(&[credential_type.as_bytes()]).to_bytes(),
        ColoniiError::CredentialTypeHashMismatch
    );

    // Cross-check: the credential's subject must match the supplied identity.
    // The seed constraint above already guarantees this, but checking the
    // stored field defends against future schema changes.
    require_keys_eq!(
        credential.subject,
        identity.key(),
        ColoniiError::CredentialSubjectMismatch
    );

    let clock = Clock::get()?;
    let not_expired = credential.expires_at == 0 || credential.expires_at > clock.unix_timestamp;
    let valid = credential.status == CredentialStatus::Active && not_expired;

    emit!(CredentialVerified {
        credential: credential.key(),
        subject: credential.subject,
        credential_type,
        status: credential.status,
        valid,
        expires_at: credential.expires_at,
        timestamp: clock.unix_timestamp,
    });

    require!(
        credential.status == CredentialStatus::Active,
        ColoniiError::CredentialNotActive
    );
    require!(not_expired, ColoniiError::CredentialExpired);
    Ok(())
}
