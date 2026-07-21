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
pub use openobserve_api_management::request::{
    alerts, authz, dashboards, folders, organization, users,
};
#[cfg(feature = "enterprise")]
pub mod anomaly_detection;
#[cfg(feature = "cloud")]
pub mod cloud;
pub mod clusters;
#[cfg(feature = "enterprise")]
pub mod domain_management;
pub mod enrichment_table;
#[cfg(feature = "enterprise")]
pub mod eval_jobs;
pub mod functions;
pub mod gen_ai;
pub mod keys;
pub mod kv;
#[cfg(feature = "enterprise")]
pub mod license;
pub mod logs;
pub mod mcp;
pub mod metrics;
pub mod model_pricing;
pub mod patterns;
pub mod pipeline;
pub mod pipelines;
#[cfg(feature = "profiling")]
pub mod profiling;
pub use openobserve_api_query::{promql, search, traces};
#[cfg(feature = "enterprise")]
pub mod providers;
pub mod ratelimit;
#[cfg(feature = "enterprise")]
pub mod re_pattern;
pub mod rum;
#[cfg(feature = "enterprise")]
pub mod score_configs;
#[cfg(feature = "enterprise")]
pub mod scorers;
pub mod service_accounts;
pub mod service_streams;
pub mod short_url;
pub mod sourcemaps;
pub mod status;
pub mod stream;
pub mod synthetics;
#[cfg(feature = "enterprise")]
pub mod workflows;

pub use openobserve_api_common::request::{BulkDeleteRequest, BulkDeleteResponse};

pub use crate::common::meta::http::{CONTENT_TYPE_JSON, CONTENT_TYPE_PROTO};
