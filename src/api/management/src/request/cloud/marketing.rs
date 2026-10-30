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

use std::collections::HashMap;

use axum::{extract::Path, response::Response};
use config::utils::json;
use openobserve_api_common::extractors::Headers;
use openobserve_core::auth::UserEmail;

use crate::{
    common::meta::{http::HttpResponse as MetaHttpResponse, telemetry},
    models::billings::NewUserAttribution,
};

/// HandleUserAttributionEvent
#[utoipa::path(
    post,
    path = "/{org_id}/billings/new_user_attribution",
    context_path = "/api",
    tag = "Marketing",
    operation_id = "HandleUserAttributionEvent",
    summary = "Handle user attribution event for marketing",
    description = "Processes user attribution data for marketing analytics and campaign tracking",
    security(
        ("Authorization" = [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
    ),
    request_body(
        content = inline(NewUserAttribution),
        description = "New user attribution info",
        example = json!({
            "from": "Over the web",
            "company": "Monster Inc.",
            "first_source": "kubernetes",
            "skipped": false,
        }),
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = Object),
        (status = 500, description = "Failure",   content_type = "application/json", body = ()),
    ),
    extensions(
        ("x-o2-mcp" = json!({"enabled": false}))
    )
)]
pub async fn handle_new_attribution_event(
    Path(_org_id): Path<String>,
    Headers(user_email): Headers<UserEmail>,
    axum::Json(req_body): axum::Json<NewUserAttribution>,
) -> Response {
    let email = user_email.user_id.as_str();

    // Send new user info to ActiveCampaign via segment proxy
    log::info!("sending track event to segment");
    let segment_event_data = attribution_event_data(
        req_body,
        email,
        &chrono::Local::now().format("%Y-%m-%d").to_string(),
    );
    let mut telemetry_instance = telemetry::Telemetry::new();
    telemetry_instance
        .send_track_event(
            "OpenObserve - New user attribution",
            Some(segment_event_data.clone()),
            false,
            false,
        )
        .await;

    telemetry_instance
        .send_keyevent_track_event(
            "OpenObserve - New user attribution",
            Some(segment_event_data),
            false,
            false,
        )
        .await;

    MetaHttpResponse::ok("Success")
}

fn attribution_event_data(
    attribution: NewUserAttribution,
    email: &str,
    created_at: &str,
) -> HashMap<String, json::Value> {
    HashMap::from([
        ("from".to_string(), json::Value::String(attribution.from)),
        (
            "company".to_string(),
            json::Value::String(attribution.company),
        ),
        (
            "first_source".to_string(),
            attribution
                .first_source
                .map_or(json::Value::Null, json::Value::String),
        ),
        (
            "skipped".to_string(),
            json::Value::Bool(attribution.skipped),
        ),
        ("email".to_string(), json::Value::String(email.to_string())),
        (
            "created_at".to_string(),
            json::Value::String(created_at.to_string()),
        ),
    ])
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_attribution_forwards_first_source_and_skipped() {
        let attribution: NewUserAttribution = json::from_str(
            r#"{"from":"","company":"","first_source":"kubernetes","skipped":true}"#,
        )
        .unwrap();
        let data = attribution_event_data(attribution, "a@b.c", "2026-10-07");
        assert_eq!(data["first_source"], json::json!("kubernetes"));
        assert_eq!(data["skipped"], json::json!(true));
        assert_eq!(data["email"], json::json!("a@b.c"));
        assert_eq!(data["created_at"], json::json!("2026-10-07"));
    }

    #[test]
    fn test_attribution_without_the_new_fields_still_parses() {
        let attribution: NewUserAttribution =
            json::from_str(r#"{"from":"web","company":"Acme"}"#).unwrap();
        let data = attribution_event_data(attribution, "a@b.c", "2026-10-07");
        assert_eq!(data["first_source"], json::Value::Null);
        assert_eq!(data["skipped"], json::json!(false));
        assert_eq!(data["from"], json::json!("web"));
    }
}
