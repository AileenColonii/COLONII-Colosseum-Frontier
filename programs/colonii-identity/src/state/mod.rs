//! On-chain state accounts for the COLONII identity layer.
//!
//! Account types:
//! - `Identity`     — the DID, bound 1:1 to a wallet and one avatar.
//! - `Issuer`       — a wallet authorized to issue credentials.
//! - `Credential`   — a verifiable credential issued to an identity.
//! - `MemoryAnchor` — a sequenced anchor of an off-chain memory hash.

pub mod credential;
pub mod identity;
pub mod issuer;
pub mod memory;

pub use credential::*;
pub use identity::*;
pub use issuer::*;
pub use memory::*;

/// Common PDA seed prefixes. Using constants keeps seeds consistent
/// across instructions and the SDK.
pub mod seeds {
    pub const IDENTITY: &[u8] = b"identity";
    pub const ISSUER: &[u8] = b"issuer";
    pub const CREDENTIAL: &[u8] = b"credential";
    pub const MEMORY: &[u8] = b"memory";
}

/// Maximum byte length we accept for a credential type label
/// (e.g. "Frontier Hackathon Participant").
pub const MAX_CREDENTIAL_TYPE_LEN: usize = 64;

/// Maximum byte length for an off-chain metadata URI.
pub const MAX_METADATA_URI_LEN: usize = 200;

/// Maximum byte length for Supabase UUID/user identifier bindings.
pub const MAX_SUPABASE_UUID_LEN: usize = 64;
