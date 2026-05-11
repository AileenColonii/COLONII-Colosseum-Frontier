use anchor_lang::prelude::*;

use crate::errors::ColoniiError;
use crate::events::MemoryAnchored;
use crate::state::{seeds, Identity, IdentityStatus, MemoryAnchor};

/// Accounts for `anchor_memory`.
///
/// `sequence` is the value of `identity.memory_count` *before* the call.
/// The SDK reads it off the identity, passes it in, and the program
/// validates it matches. This makes the PDA fully deterministic from
/// (identity, sequence) without trusting the caller to bump correctly.
#[derive(Accounts)]
#[instruction(memory_hash: [u8; 32], sequence: u64)]
pub struct AnchorMemory<'info> {
    /// Owner of the identity. Pays rent for the new memory anchor account.
    #[account(mut)]
    pub owner: Signer<'info>,

    /// The identity being anchored to. Must be owned by `owner` and not
    /// inactive. `sequence` is validated against `identity.memory_count`.
    #[account(
        mut,
        seeds = [seeds::IDENTITY, owner.key().as_ref()],
        bump = identity.bump,
        has_one = owner @ ColoniiError::UnauthorizedOwner,
        constraint = identity.memory_count == sequence @ ColoniiError::SequenceMismatch,
    )]
    pub identity: Account<'info, Identity>,

    /// New memory anchor PDA.
    #[account(
        init,
        payer = owner,
        space = MemoryAnchor::SIZE,
        seeds = [
            seeds::MEMORY,
            identity.key().as_ref(),
            &sequence.to_le_bytes(),
        ],
        bump,
    )]
    pub anchor: Account<'info, MemoryAnchor>,

    pub system_program: Program<'info, System>,
}

/// Anchor a 32-byte memory hash to the caller's identity.
///
/// The off-chain memory record stays in Supabase (or wherever the Beta
/// app stores it). On-chain we keep just the hash and sequence, which is
/// enough to prove integrity if the off-chain record is ever disputed.
pub fn handler(
    ctx: Context<AnchorMemory>,
    memory_hash: [u8; 32],
    sequence: u64,
) -> Result<()> {
    let clock = Clock::get()?;
    let identity = &mut ctx.accounts.identity;
    let anchor = &mut ctx.accounts.anchor;

    require!(
        identity.status != IdentityStatus::Inactive,
        ColoniiError::IdentityInactive
    );

    anchor.identity = identity.key();
    anchor.sequence = sequence;
    anchor.memory_hash = memory_hash;
    anchor.timestamp = clock.unix_timestamp;
    anchor.bump = ctx.bumps.anchor;

    identity.memory_count = identity
        .memory_count
        .checked_add(1)
        .ok_or(ColoniiError::ArithmeticOverflow)?;
    identity.last_anchor_at = clock.unix_timestamp;

    if identity.status == IdentityStatus::Secured {
        identity.status = IdentityStatus::Active;
    }

    emit!(MemoryAnchored {
        identity: identity.key(),
        anchor: anchor.key(),
        sequence,
        memory_hash,
        timestamp: clock.unix_timestamp,
    });

    Ok(())
}
