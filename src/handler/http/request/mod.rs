// Copyright 2025 OpenObserve Inc.
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

use axum::http::{HeaderMap, HeaderValue, header::HeaderName};
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

pub mod actions;
// #[cfg(feature = "enterprise")]
pub mod agent;
#[cfg(feature = "enterprise")]
pub mod ai;
pub mod alerts;
pub mod authz;
#[cfg(feature = "cloud")]
pub mod cloud;
pub mod clusters;
pub mod dashboards;
#[cfg(feature = "enterprise")]
pub mod domain_management;
pub mod enrichment_table;
#[allow(deprecated)]
pub mod folders;
pub mod functions;
pub mod keys;
pub mod kv;
#[cfg(feature = "enterprise")]
pub mod license;
pub mod logs;
pub mod mcp;
pub mod metrics;
pub mod organization;
pub mod patterns;
pub mod pipeline;
pub mod pipelines;
pub mod promql;
pub mod ratelimit;
#[cfg(feature = "enterprise")]
pub mod re_pattern;
pub mod rum;
#[cfg(feature = "enterprise")]
pub mod script_server;
pub mod search;
pub mod service_accounts;
pub mod service_streams;
pub mod short_url;
pub mod status;
pub mod stream;
pub mod traces;
pub mod users;

pub const CONTENT_TYPE_JSON: &str = "application/json";
pub const CONTENT_TYPE_PROTO: &str = "application/x-protobuf";

// these are the common bulk delete req/res structs

#[derive(Clone, Debug, Serialize, Deserialize, ToSchema)]
pub struct BulkDeleteRequest {
    pub ids: Vec<String>,
}

#[derive(Default, Serialize, ToSchema)]
pub struct BulkDeleteResponse {
    pub successful: Vec<String>,
    pub unsuccessful: Vec<String>,
    pub err: Option<String>,
}

// Common utilities for request handling

pub const HEADER_O2_PROCESS_TIME: HeaderName = HeaderName::from_static("o2_process_time");

/// Returns the current time for process tracking, accounting for `ZO_ACTIX_SLOW_LOG_THRESHOLD` env.
/// Returns 0 if slow log threshold is not configured, avoiding unnecessary time tracking overhead.
pub fn get_process_time() -> i64 {
    if config::get_config().limit.http_slow_log_threshold > 0 {
        config::utils::time::now_micros()
    } else {
        0
    }
}

/// Inserts the process time header into the response if tracking is enabled.
/// This header helps with request performance monitoring and debugging.
pub fn insert_process_time_header(time: i64, headers: &mut HeaderMap) {
    if time > 0
        && let Ok(value) = HeaderValue::from_str(&time.to_string())
    {
        headers.insert(HEADER_O2_PROCESS_TIME.clone(), value);
    }
}
