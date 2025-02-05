//! Module that contains a client for performing authorization checks.

pub mod client;
pub mod object;

pub use client::{AuthorizationClient, AuthorizationClientTrait};
pub use object::ObjectType;
