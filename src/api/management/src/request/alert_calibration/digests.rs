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

//! Requesting a calibration run out of cadence.

use axum::{
    extract::Path,
    http::StatusCode,
    response::{IntoResponse, Response},
};
use o2_enterprise::enterprise::alert_calibration_service;

use super::{deployment_disabled, error_response};

/// 202, not 200: the run is only queued here, and the scheduler writes the digest.
#[utoipa::path(
    post,
    path = "/v2/{org_id}/alert_calibration/digests/run",
    context_path = "/api",
    tag = "Alert Calibration",
    operation_id = "RunAlertCalibration",
    summary = "Request an alert calibration run now",
    description = "Brings the org's scheduled run forward to now. An org has one scheduled run, so a request while one is due or running is accepted without queuing another.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
    ),
    responses(
        (status = 202, description = "Run accepted"),
        (status = 400, description = "The org's alert calibration config is disabled", content_type = "application/json", body = Object),
        (status = 403, description = "Forbidden", content_type = "application/json", body = Object),
        (status = 404, description = "Alert calibration is disabled for this deployment, or the org has no config", content_type = "application/json", body = Object),
        (status = 500, description = "Internal Server Error", content_type = "application/json", body = Object),
    )
)]
pub async fn run_alert_calibration(Path(org_id): Path<String>) -> Response {
    if let Some(disabled) = deployment_disabled() {
        return disabled;
    }
    match alert_calibration_service::request_run(&org_id).await {
        Ok(()) => StatusCode::ACCEPTED.into_response(),
        Err(error) => error_response(&error),
    }
}
