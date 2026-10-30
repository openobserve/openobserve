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
pub mod logs;
pub mod metrics;
pub mod profiles;
pub mod rum;

/// An expired trial is the only quota answer; no other refusal should read as a quota problem.
#[cfg(feature = "cloud")]
pub(crate) fn ingestion_not_allowed_response(e: infra::errors::Error) -> axum::response::Response {
    use axum::{http::StatusCode, response::IntoResponse};

    let status = if matches!(e, infra::errors::Error::TrialPeriodExpired) {
        StatusCode::TOO_MANY_REQUESTS
    } else {
        StatusCode::SERVICE_UNAVAILABLE
    };
    (
        status,
        axum::Json(crate::common::meta::http::HttpResponse::error(status, e)),
    )
        .into_response()
}
