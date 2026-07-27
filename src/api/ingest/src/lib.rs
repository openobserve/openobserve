// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

#![recursion_limit = "256"]

#[allow(clippy::single_component_path_imports)]
use common;
use openobserve_core as service;

pub mod request;

#[doc(hidden)]
pub mod handler {
    pub mod http {
        #[cfg(feature = "enterprise")]
        pub use openobserve_http_common::auth;
        pub use openobserve_http_common::extractors;

        pub use crate::request;
    }
}
