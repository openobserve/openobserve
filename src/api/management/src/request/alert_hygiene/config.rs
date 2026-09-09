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

//! The org's single alert_hygiene config: a read and a partial update.

use axum::{Json, extract::Path, response::Response};
use common::meta::http::HttpResponse as MetaHttpResponse;
use o2_enterprise::enterprise::alert_hygiene_service::{self, UpdateAlertHygieneConfig};

use super::{deployment_disabled, error_response};

#[utoipa::path(
    get,
    path = "/v2/{org_id}/alert_hygiene/config",
    context_path = "/api",
    tag = "Alert Hygiene",
    operation_id = "GetAlertHygieneConfig",
    summary = "Get the org's alert hygiene config",
    description = "Returns the organization's stored alert hygiene settings: the enable flag, the digest cadence and the analysis window.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = Object),
        (status = 404, description = "Alert hygiene is disabled deployment-wide (ZO_ALERT_HYGIENE_ENABLED=false), or the org has no config", content_type = "application/json", body = Object),
        (status = 500, description = "Internal Server Error", content_type = "application/json", body = Object),
    )
)]
pub async fn get_alert_hygiene_config(Path(org_id): Path<String>) -> Response {
    if let Some(disabled) = deployment_disabled() {
        return disabled;
    }
    match alert_hygiene_service::get_config(&org_id).await {
        Ok(config) => MetaHttpResponse::json(config),
        Err(error) => error_response(&error),
    }
}

#[utoipa::path(
    put,
    path = "/v2/{org_id}/alert_hygiene/config",
    context_path = "/api",
    tag = "Alert Hygiene",
    operation_id = "UpdateAlertHygieneConfig",
    summary = "Update the org's alert hygiene config",
    description = "Applies a partial update; an absent field is left alone. Upserts, so a missing config is created rather than rejected.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
    ),
    request_body(content = inline(Object), description = "Partial alert hygiene config: enabled, frequency_minutes, window_minutes", content_type = "application/json"),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = Object),
        (status = 400, description = "A cadence or window outside its accepted bounds", content_type = "application/json", body = Object),
        (status = 404, description = "Alert hygiene is disabled deployment-wide (ZO_ALERT_HYGIENE_ENABLED=false)", content_type = "application/json", body = Object),
        (status = 500, description = "Internal Server Error", content_type = "application/json", body = Object),
    )
)]
pub async fn update_alert_hygiene_config(
    Path(org_id): Path<String>,
    Json(update): Json<UpdateAlertHygieneConfig>,
) -> Response {
    if let Some(disabled) = deployment_disabled() {
        return disabled;
    }
    match alert_hygiene_service::update_config(&org_id, update).await {
        Ok(config) => MetaHttpResponse::json(config),
        Err(error) => error_response(&error),
    }
}
