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

//! The org's single alert calibration config: a read and a partial update.

use axum::{Json, extract::Path, response::Response};
use common::meta::http::HttpResponse as MetaHttpResponse;
use infra::table::entity::alert_calibration_configs::Model as ConfigModel;
use o2_enterprise::enterprise::alert_calibration_service::{self, UpdateAlertCalibrationConfig};
use openobserve_api_common::extractors::Headers;
use serde::Serialize;

use super::{deployment_disabled, error_response};
use crate::{request::alert_grants::org_wide_allows, service::auth::UserEmail};

/// The config and what this caller may do with it, so the page offers only what will be allowed.
#[derive(Serialize)]
struct ConfigView {
    #[serde(flatten)]
    config: ConfigModel,
    can_edit: bool,
    can_run: bool,
}

#[utoipa::path(
    get,
    path = "/v2/{org_id}/alert_calibration/config",
    context_path = "/api",
    tag = "Alert Calibration",
    operation_id = "GetAlertCalibrationConfig",
    summary = "Get the org's alert calibration config",
    description = "Returns the organization's alert calibration settings: whether it runs, how often, and how much history each run analyses. `can_edit` and `can_run` say whether the caller may save the config and request a run, by the same checks those routes make.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = infra::table::entity::alert_calibration_configs::Model),
        (status = 403, description = "Forbidden", content_type = "application/json", body = Object),
        (status = 404, description = "Alert calibration is disabled for this deployment", content_type = "application/json", body = Object),
        (status = 500, description = "Internal Server Error", content_type = "application/json", body = Object),
    ),
    extensions(
        ("x-o2-mcp" = json!({"enabled": true})),
        ("x-o2-ratelimit" = json!({"module": "Alert Calibration", "operation": "list"}))
    )
)]
pub async fn get_alert_calibration_config(
    Path(org_id): Path<String>,
    Headers(user): Headers<UserEmail>,
) -> Response {
    if let Some(disabled) = deployment_disabled() {
        return disabled;
    }
    let config = match alert_calibration_service::get_config(&org_id).await {
        Ok(config) => config,
        Err(error) => return error_response(&error),
    };
    // The PUT config and POST run routes check these grants on `alert_calibration:{org}`.
    let (can_edit, can_run) = tokio::join!(
        org_wide_allows(&org_id, &user.user_id, "alert_calibration", "PUT"),
        org_wide_allows(&org_id, &user.user_id, "alert_calibration", "POST"),
    );
    MetaHttpResponse::json(ConfigView {
        config,
        can_edit,
        can_run,
    })
}

#[utoipa::path(
    put,
    path = "/v2/{org_id}/alert_calibration/config",
    context_path = "/api",
    tag = "Alert Calibration",
    operation_id = "UpdateAlertCalibrationConfig",
    summary = "Update the org's alert calibration config",
    description = "Applies a partial update; an absent field keeps its stored value. Creates the config on the org's first write.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
    ),
    request_body(content = inline(Object), description = "Any of enabled, frequency_minutes and window_minutes", content_type = "application/json"),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = infra::table::entity::alert_calibration_configs::Model),
        (status = 400, description = "A cadence or window outside its accepted bounds, or an unknown field", content_type = "application/json", body = Object),
        (status = 403, description = "Forbidden", content_type = "application/json", body = Object),
        (status = 404, description = "Alert calibration is disabled for this deployment", content_type = "application/json", body = Object),
        (status = 500, description = "Internal Server Error", content_type = "application/json", body = Object),
    ),
    extensions(
        ("x-o2-mcp" = json!({"enabled": true})),
        ("x-o2-ratelimit" = json!({"module": "Alert Calibration", "operation": "update"}))
    )
)]
pub async fn update_alert_calibration_config(
    Path(org_id): Path<String>,
    Json(update): Json<UpdateAlertCalibrationConfig>,
) -> Response {
    if let Some(disabled) = deployment_disabled() {
        return disabled;
    }
    match alert_calibration_service::update_config(&org_id, update).await {
        Ok(config) => {
            if config.enabled {
                prepare_writer_token(&org_id).await;
            }
            MetaHttpResponse::json(config)
        }
        Err(error) => error_response(&error),
    }
}

/// Made when calibration is turned on, so the first pass finds it in every ingester's cache.
async fn prepare_writer_token(org_id: &str) {
    use openobserve_core::ingestion::feature_writer::{self, FeatureWriter};
    // Each pass looks the token up again and reports why it could not write, so this only logs.
    if let Err(e) = feature_writer::token(FeatureWriter::AlertCalibration, org_id).await {
        log::warn!("[alert_calibration] could not prepare the ingestion token for {org_id}: {e}");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_config_carries_what_the_caller_may_do_beside_its_fields() {
        let config = ConfigModel {
            id: "c1".into(),
            org: "demo-org".into(),
            enabled: true,
            frequency_minutes: 60,
            window_minutes: 1440,
            created_at: 1,
            updated_at: 2,
        };
        let view = serde_json::to_value(ConfigView {
            config,
            can_edit: false,
            can_run: true,
        })
        .unwrap();
        assert_eq!(view["frequency_minutes"], 60);
        assert_eq!(view["enabled"], true);
        assert_eq!(
            (&view["can_edit"], &view["can_run"]),
            (&false.into(), &true.into())
        );
    }
}
