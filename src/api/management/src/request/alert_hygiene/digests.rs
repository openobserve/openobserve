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

//! The manual run request.

use axum::{
    Json,
    extract::Path,
    http::StatusCode,
    response::{IntoResponse, Response},
};
use o2_enterprise::enterprise::alert_hygiene_service;

use super::{deployment_disabled, error_response};

/// Answers 202, not 200: the run is only enqueued here, and the scheduler produces the digest.
#[utoipa::path(
    post,
    path = "/v2/{org_id}/alert_hygiene/digests/run",
    context_path = "/api",
    tag = "Alert Hygiene",
    operation_id = "RunAlertHygieneDigest",
    summary = "Request a manual alert hygiene run",
    description = "Enqueues a run and returns the time the scheduler will pick it up. An org has at most one alert hygiene job, so a second request while one is due or in flight is accepted without enqueuing another.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
    ),
    responses(
        (status = 202, description = "Run accepted", content_type = "application/json", body = Object),
        (status = 400, description = "The org's alert hygiene config is disabled, so a run would produce no digest", content_type = "application/json", body = Object),
        (status = 404, description = "Alert hygiene is disabled deployment-wide (ZO_ALERT_HYGIENE_ENABLED=false), or the org has no config", content_type = "application/json", body = Object),
        (status = 500, description = "Internal Server Error", content_type = "application/json", body = Object),
    )
)]
pub async fn run_alert_hygiene_digest(Path(org_id): Path<String>) -> Response {
    if let Some(disabled) = deployment_disabled() {
        return disabled;
    }
    match alert_hygiene_service::request_run(&org_id).await {
        Ok(accepted) => (StatusCode::ACCEPTED, Json(accepted)).into_response(),
        Err(error) => error_response(&error),
    }
}
