use anchor_lang::prelude::*;

/// A single anchored memory hash.
///
/// Each anchor is its own account, chained off an `Identity` by a monotonic
/// `sequence` counter. This preserves a verifiable history that the UI can
/// render as a memory timeline (per the wireframes).
///
/// PDA: seeds = [`seeds::MEMORY`, identity.as_ref(), &sequence.to_le_bytes()]
#[account]
pub struct MemoryAnchor {
    /// The Identity PDA this anchor belongs to.
    pub identity: Pubkey,
    /// Monotonic sequence number, starting at 0.
    pub sequence: u64,
    /// 32-byte hash of the off-chain memory record. Format-agnostic
    /// (sha256, blake3, keccak) — the issuer chooses, the chain just
    /// preserves it.
    pub memory_hash: [u8; 32],
    /// Unix timestamp of the anchor.
    pub timestamp: i64,
    /// PDA bump.
    pub bump: u8,
}

impl MemoryAnchor {
    /// 8 (discriminator) + identity(32) + sequence(8) + hash(32)
    /// + timestamp(8) + bump(1) = 89
    pub const SIZE: usize = 8 + 32 + 8 + 32 + 8 + 1;
}
