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

use std::collections::HashMap;

use actix_web::{Responder, post, web};
use config::utils::json;

use crate::{
    common::{
        meta::{http::HttpResponse as MetaHttpResponse, telemetry},
        utils::auth::UserEmail,
    },
    handler::http::models::billings::NewUserAttribution,
};

/// HandleUserAttributionEvent
#[utoipa::path(
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
        content = NewUserAttribution,
        description = "New user attribution info",
        example = json!({
            "from": "Over the web",
            "company": "Monster Inc.",
        }),
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = Object),
        (status = 500, description = "Failure",   content_type = "application/json", body = ()),
    ),
)]
#[post("/{org_id}/billings/new_user_attribution")]
pub async fn handle_new_attribution_event(
    user_email: UserEmail,
    req_body: web::Json<NewUserAttribution>,
) -> impl Responder {
    let email = user_email.user_id.as_str();
    let new_usr_attribution = req_body.into_inner();

    // Send new user info to ActiveCampaign via segment proxy
    log::info!("sending track event to segment");
    let segment_event_data = HashMap::from([
        (
            "from".to_string(),
            json::Value::String(new_usr_attribution.from),
        ),
        (
            "company".to_string(),
            json::Value::String(new_usr_attribution.company),
        ),
        ("email".to_string(), json::Value::String(email.to_string())),
        (
            "created_at".to_string(),
            json::Value::String(chrono::Local::now().format("%Y-%m-%d").to_string()),
        ),
    ]);
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
