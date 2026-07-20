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

//! Search, PromQL, and trace HTTP APIs.

#![recursion_limit = "256"]

pub use openobserve_api_common::extractors;
pub(crate) use openobserve_core as service;

pub(crate) mod common {
    pub mod meta {
        pub use ::common::meta::*;
        pub use openobserve_ingestion::types as ingestion;
    }

    pub mod utils {
        pub use ::common::utils::*;
        pub use openobserve_organization::auth;
        pub use openobserve_search_service::stream_utils as stream;
    }
}

pub mod promql;
pub mod search;
pub mod traces;
