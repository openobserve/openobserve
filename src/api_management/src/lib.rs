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

// Path-compatibility re-exports: these modules are owned by their source
// crates; re-exporting them keeps `crate::extractors`, `crate::common`, and
// `crate::service` paths working in handlers moved from `openobserve-api`.
pub use openobserve_api_common::extractors;
pub use openobserve_core::{common, service};

pub mod auth;
pub mod models;
pub mod request;
