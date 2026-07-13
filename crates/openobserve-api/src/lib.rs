// Copyright 2026 OpenObserve Inc.
//
// HTTP/gRPC transport frontend, including OpenAPI schema generation.

#![feature(variant_count)]
#![recursion_limit = "256"]

#[cfg(feature = "enterprise")]
pub use openobserve_core::cipher;
pub use openobserve_core::{common, service};

#[path = "../../../src/handler/mod.rs"]
pub mod handler;
#[path = "../../../src/router/mod.rs"]
pub mod router;
