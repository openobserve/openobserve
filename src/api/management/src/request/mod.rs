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

#[cfg(feature = "enterprise")]
pub mod action_server;
pub mod actions;
#[cfg(feature = "enterprise")]
pub mod ai;
pub mod alerts;
#[cfg(feature = "enterprise")]
pub mod anomaly_detection;
pub mod authz;
#[cfg(feature = "cloud")]
pub mod cloud;
pub mod dashboards;
#[cfg(feature = "enterprise")]
pub mod domain_management;
#[cfg(feature = "enterprise")]
pub mod eval_jobs;
#[allow(deprecated)]
pub mod folders;
pub mod gen_ai;
pub mod keys;
pub mod kv;
#[cfg(feature = "enterprise")]
pub mod license;
pub mod model_pricing;
pub mod organization;
#[cfg(feature = "profiling")]
pub mod profiling;
#[cfg(feature = "enterprise")]
pub mod providers;
#[cfg(feature = "enterprise")]
pub mod score_configs;
#[cfg(feature = "enterprise")]
pub mod scorers;
pub mod service_accounts;
pub mod service_streams;
pub mod short_url;
pub mod slos;
pub mod sourcemaps;
pub mod status;
pub mod stream;
pub mod synthetics;
pub mod users;
#[cfg(feature = "enterprise")]
pub mod workflows;

use openobserve_api_common::request::{BulkDeleteRequest, BulkDeleteResponse};
