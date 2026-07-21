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

use std::sync::LazyLock;

use config::{RwAHashMap, meta::triggers::Trigger};

#[cfg(feature = "enterprise")]
pub mod anomaly_detection;
pub use openobserve_query_evaluation as evaluation;
pub mod grouping;
mod http;
pub mod ports;
pub mod repository;
pub mod service;
pub mod synthetics;

/// Realtime alert triggers are domain state and therefore live with alerts.
pub static REALTIME_ALERT_TRIGGERS: LazyLock<RwAHashMap<String, Trigger>> =
    LazyLock::new(Default::default);
