// Copyright 2026 OpenObserve Inc.

#![recursion_limit = "256"]

#[allow(clippy::single_component_path_imports)]
use common;
use openobserve_core as service;

pub mod models;
pub mod request;

#[doc(hidden)]
pub mod handler {
    pub mod http {
        #[cfg(feature = "enterprise")]
        pub use openobserve_http_common::auth;
        pub use openobserve_http_common::extractors;

        pub use crate::{models, request};
    }
}
