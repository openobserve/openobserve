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

//! The alert calibration REST surface; every handler is a 404 while the switch is off.

pub mod config;
pub mod digests;

use axum::response::{IntoResponse, Response};
use common::meta::http::HttpResponse as MetaHttpResponse;
use o2_enterprise::enterprise::alert_calibration_service::{self, AlertCalibrationServiceError};

const DISABLED_MESSAGE: &str = "Alert calibration is disabled (O2_ALERT_CALIBRATION_ENABLED=false)";

fn deployment_disabled() -> Option<Response> {
    (!alert_calibration_service::is_enabled())
        .then(|| MetaHttpResponse::not_found(DISABLED_MESSAGE))
}

fn error_response(error: &AlertCalibrationServiceError) -> Response {
    let status = error.http_status();
    if status >= 500 {
        log::error!("[alert_calibration] {error}");
    }
    MetaHttpResponse::error(status, error.to_string()).into_response()
}
