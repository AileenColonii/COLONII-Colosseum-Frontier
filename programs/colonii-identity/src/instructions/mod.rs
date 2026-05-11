//! Instruction handlers for the COLONII identity program.
//!
//! Each instruction lives in its own module so accounts contexts and
//! handler logic stay readable as the surface area grows.
#![allow(ambiguous_glob_reexports)]

pub mod anchor_memory;
pub mod bind_avatar;
pub mod create_issuer;
pub mod deactivate_did;
pub mod initialize_did;
pub mod issue_credential;
pub mod revoke_credential;
pub mod update_did;
pub mod update_avatar;
pub mod verify_credential;

pub use anchor_memory::*;
pub use bind_avatar::*;
pub use create_issuer::*;
pub use deactivate_did::*;
pub use initialize_did::*;
pub use issue_credential::*;
pub use revoke_credential::*;
pub use update_did::*;
pub use update_avatar::*;
pub use verify_credential::*;
