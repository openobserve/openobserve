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
    handler::http::models::billings::NewUserAttrition,
};

/// HandleUserAttritionEvent
#[utoipa::path(
    context_path = "/api",
    tag = "Marketing",
    operation_id = "HandleUserAttritionEvent",
    security(
        ("Authorization" = [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
    ),
    request_body(
        content = NewUserAttrition,
        description = "New user attrition info",
        example = json!({
            "from": "Over the web",
            "company": "Monster Inc.",
        }),
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = HttpResponse),
        (status = 500, description = "Failure",   content_type = "application/json", body = HttpResponse),
    ),
)]
#[post("/{org_id}/billings/new_user_attrition")]
pub async fn handle_new_attrition_event(
    user_email: UserEmail,
    req_body: web::Json<NewUserAttrition>,
) -> impl Responder {
    let email = user_email.user_id.as_str();
    let new_usr_attrition = req_body.into_inner();

    // Send new user info to ActiveCampaign via segment proxy
    log::info!("sending track event to segment");
    let segment_event_data = HashMap::from([
        (
            "from".to_string(),
            json::Value::String(new_usr_attrition.from),
        ),
        (
            "company".to_string(),
            json::Value::String(new_usr_attrition.company),
        ),
        ("email".to_string(), json::Value::String(email.to_string())),
        (
            "created_at".to_string(),
            json::Value::String(chrono::Local::now().format("%Y-%m-%d").to_string()),
        ),
    ]);
    telemetry::Telemetry::new()
        .send_track_event(
            "OpenObserve - New user attrition",
            Some(segment_event_data),
            false,
            false,
        )
        .await;

    MetaHttpResponse::ok("Success")
}
