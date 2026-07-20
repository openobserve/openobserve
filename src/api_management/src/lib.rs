// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

//! Management HTTP APIs and authentication helpers.

#![recursion_limit = "256"]
#![feature(variant_count)]

pub use openobserve_api_common::extractors;
pub(crate) use openobserve_core as service;

pub(crate) mod common {
    pub mod infra {
        pub use ::common::infra::*;
    }

    pub mod meta {
        pub use ::common::meta::*;
    }

    pub mod utils {
        pub use ::common::utils::*;
        pub use openobserve_core::{auth, stream_utils as stream};
    }
}

pub mod auth;
pub mod models;
pub mod request;
