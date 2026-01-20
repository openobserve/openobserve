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

use axum::http::{HeaderMap, HeaderValue, header::HeaderName};

mod access_log;
mod slow_log;

pub use access_log::{AccessLogLayer, AccessLogService, get_http_access_log_format};
pub use slow_log::{SlowLogLayer, SlowLogService};
// Re-export tower_http compression for convenience
pub use tower_http::compression::CompressionLayer;

// Common utilities for request handling

pub const HEADER_O2_PROCESS_TIME: HeaderName = HeaderName::from_static("o2_process_time");

/// Returns the current time for process tracking, accounting for `ZO_HTTP_SLOW_LOG_THRESHOLD` env.
/// Returns 0 if slow log threshold is not configured, avoiding unnecessary time tracking overhead.
pub fn get_process_time() -> i64 {
    if crate::get_config().limit.http_slow_log_threshold > 0 {
        crate::utils::time::now_micros()
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
