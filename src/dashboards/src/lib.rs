// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

//! Dashboard CRUD, catalog, panel, and annotation services.

use std::sync::LazyLock;

use config::RwAHashMap;

/// Dashboard ID to organization catalog used for tenant-boundary checks.
pub static DASHBOARD_ID_TO_ORG: LazyLock<RwAHashMap<String, String>> =
    LazyLock::new(Default::default);

mod distinct_values;
pub mod repository;
mod service;
pub mod timed_annotations;

pub use service::*;
