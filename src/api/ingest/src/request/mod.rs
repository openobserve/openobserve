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

pub mod clusters;
pub mod datadog;
pub mod logs;
pub mod metrics;
pub mod profiles;
pub mod rum;

/// A quota refusal (an expired trial or a contract usage block) is 429; nothing else reads as one.
pub(crate) fn ingestion_not_allowed_response(e: infra::errors::Error) -> axum::response::Response {
    use axum::{http::StatusCode, response::IntoResponse};

    let status = if e.is_quota_refusal() {
        StatusCode::TOO_MANY_REQUESTS
    } else {
        StatusCode::SERVICE_UNAVAILABLE
    };
    let body = match &e {
        infra::errors::Error::ErrorCode(code) => {
            crate::common::meta::http::HttpResponse::error_code_with_trace_id(code, None)
        }
        _ => crate::common::meta::http::HttpResponse::error(status, e),
    };
    (status, axum::Json(body)).into_response()
}
