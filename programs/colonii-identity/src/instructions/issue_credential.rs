use anchor_lang::prelude::*;
use solana_sha256_hasher::hashv;

use crate::errors::ColoniiError;
use crate::events::CredentialIssued;
use crate::state::{
    seeds, Credential, CredentialStatus, Identity, IdentityStatus, Issuer, MAX_CREDENTIAL_TYPE_LEN,
    MAX_METADATA_URI_LEN,
};

/// Accounts for `issue_credential`.
///
/// The issuer wallet must have a registered active Issuer PDA. The
/// credential's `issuer` field records the actual issuing authority.
#[derive(Accounts)]
#[instruction(credential_type_hash: [u8; 32])]
pub struct IssueCredential<'info> {
    /// Issuer wallet. Pays rent for the credential PDA.
    #[account(mut)]
    pub issuer: Signer<'info>,

    /// Registered issuer account for the issuer wallet.
    #[account(
        seeds = [seeds::ISSUER, issuer.key().as_ref()],
        bump = issuer_registry.bump,
        has_one = authority @ ColoniiError::UnauthorizedIssuer,
        constraint = issuer_registry.active @ ColoniiError::IssuerInactive,
    )]
    pub issuer_registry: Account<'info, Issuer>,

    /// CHECK: Compared via `has_one` above; Anchor needs the field present
    /// because the stored issuer authority is named `authority`.
    pub authority: UncheckedAccount<'info>,

    /// The identity receiving the credential. Must exist and not be
    /// inactive.
    #[account(mut)]
    pub subject_identity: Account<'info, Identity>,

    /// The new credential PDA. Seeded by subject + sha256(type), so each
    /// (subject, type) pair maps to one PDA.
    #[account(
        init,
        payer = issuer,
        space = Credential::SIZE,
        seeds = [
            seeds::CREDENTIAL,
            subject_identity.key().as_ref(),
            &credential_type_hash,
        ],
        bump
    )]
    pub credential: Account<'info, Credential>,

    pub system_program: Program<'info, System>,
}

/// Issue a verifiable credential of `credential_type` to `subject_identity`,
/// optionally pointing at off-chain metadata via `metadata_uri`.
pub fn handler(
    ctx: Context<IssueCredential>,
    credential_type_hash: [u8; 32],
    credential_type: String,
    metadata_uri: String,
    expires_at: i64,
) -> Result<()> {
    require!(
        credential_type.len() <= MAX_CREDENTIAL_TYPE_LEN,
        ColoniiError::CredentialTypeTooLong
    );
    require!(
        metadata_uri.len() <= MAX_METADATA_URI_LEN,
        ColoniiError::MetadataUriTooLong
    );
    require!(
        credential_type_hash == hashv(&[credential_type.as_bytes()]).to_bytes(),
        ColoniiError::CredentialTypeHashMismatch
    );

    let subject = &mut ctx.accounts.subject_identity;
    require!(
        subject.status != IdentityStatus::Inactive,
        ColoniiError::IdentityInactive
    );
    require_keys_eq!(
        ctx.accounts.authority.key(),
        ctx.accounts.issuer.key(),
        ColoniiError::UnauthorizedIssuer
    );

    let clock = Clock::get()?;
    require!(
        expires_at == 0 || expires_at > clock.unix_timestamp,
        ColoniiError::CredentialExpired
    );
    let credential = &mut ctx.accounts.credential;

    credential.subject = subject.key();
    credential.issuer = ctx.accounts.issuer.key();
    credential.status = CredentialStatus::Active;
    credential.issued_at = clock.unix_timestamp;
    credential.revoked_at = 0;
    credential.expires_at = expires_at;
    credential.type_hash = credential_type_hash;
    credential.credential_type = credential_type.clone();
    credential.metadata_uri = metadata_uri;
    credential.bump = ctx.bumps.credential;

    // First successful credential or memory anchor flips status from
    // Secured -> Active so the dashboard's status pill stays meaningful.
    if subject.status == IdentityStatus::Secured {
        subject.status = IdentityStatus::Active;
    }
    subject.credential_count = subject
        .credential_count
        .checked_add(1)
        .ok_or(ColoniiError::ArithmeticOverflow)?;

    emit!(CredentialIssued {
        credential: credential.key(),
        subject: credential.subject,
        issuer: credential.issuer,
        credential_type,
        expires_at,
        timestamp: clock.unix_timestamp,
    });

    Ok(())
}
