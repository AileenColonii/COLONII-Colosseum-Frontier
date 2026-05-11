use anchor_lang::prelude::*;

/// All program errors. Codes start at 6000 (Anchor convention).
#[error_code]
pub enum ColoniiError {
    #[msg("Avatar code is not in the allowed range.")]
    InvalidAvatarCode,

    #[msg("Credential type string exceeds the 64-byte limit.")]
    CredentialTypeTooLong,

    #[msg("Metadata URI exceeds the 200-byte limit.")]
    MetadataUriTooLong,

    #[msg("Credential is already revoked.")]
    CredentialAlreadyRevoked,

    #[msg("Credential is not active.")]
    CredentialNotActive,

    #[msg("Only the original issuer may revoke this credential.")]
    UnauthorizedIssuer,

    #[msg("Signer does not own this identity.")]
    UnauthorizedOwner,

    #[msg("Identity is inactive; operation not allowed.")]
    IdentityInactive,

    #[msg("Memory hash must be exactly 32 bytes.")]
    InvalidMemoryHash,

    #[msg("Arithmetic overflow.")]
    ArithmeticOverflow,

    #[msg("Credential subject mismatch with provided identity.")]
    CredentialSubjectMismatch,

    #[msg("Sequence does not match the identity's memory_count.")]
    SequenceMismatch,

    #[msg("Credential type hash does not match the credential type string.")]
    CredentialTypeHashMismatch,

    #[msg("Supabase UUID exceeds the 64-byte limit.")]
    SupabaseUuidTooLong,

    #[msg("Issuer metadata URI exceeds the 200-byte limit.")]
    IssuerMetadataUriTooLong,

    #[msg("Issuer is not active.")]
    IssuerInactive,

    #[msg("Credential is expired.")]
    CredentialExpired,
}
