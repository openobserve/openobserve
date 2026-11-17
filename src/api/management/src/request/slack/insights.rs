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

//! Settings › Slack › AutoObserve (S7): where and when the insights feed posts.

use axum::{
    Json,
    extract::{Path, rejection::JsonRejection},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use o2_enterprise::enterprise::slack::{error::SlackApiError, insights::feed::settings};
use openobserve_api_common::extractors::Headers;
use openobserve_core::auth::UserEmail;

use super::{caller, parse, slack_error};

/// SlackGetInsightsSettings
#[utoipa::path(
    get,
    path = "/{org_id}/slack/insights-settings",
    context_path = "/api",
    tag = "Slack",
    operation_id = "SlackGetInsightsSettings",
    summary = "Get the AutoObserve insights settings",
    description = "The channel the AutoObserve digest and urgent outages post to, the digest time and zone, whether trial findings post as they happen, whether changes from Slack are allowed, the newest digest, and whether the caller may save. Any member of the organization may read it.",
    security(("Authorization" = [])),
    params(("org_id" = String, Path, description = "Organization name")),
    responses(
        (status = 200, description = "`{\"channel\", \"digest_time\", \"digest_time_zone\", \"post_trial_findings\", \"allow_changes_from_slack\", \"revision\", \"last_digest\", \"can_edit\"}`", content_type = "application/json", body = Object),
        (status = 403, description = "Not a member of the organization", content_type = "application/json", body = ()),
        (status = 404, description = "Slack insights are not enabled", content_type = "application/json", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Slack", "operation": "get"})),
        ("x-o2-mcp" = json!({"enabled": false}))
    )
)]
pub async fn get_insights_settings(
    Path(org_id): Path<String>,
    Headers(user_email): Headers<UserEmail>,
) -> Response {
    let caller = caller(&org_id, &user_email.user_id);
    answer(settings::get(&caller).await)
}

/// SlackPutInsightsSettings
#[utoipa::path(
    put,
    path = "/{org_id}/slack/insights-settings",
    context_path = "/api",
    tag = "Slack",
    operation_id = "SlackPutInsightsSettings",
    summary = "Set the AutoObserve insights settings",
    security(("Authorization" = [])),
    params(("org_id" = String, Path, description = "Organization name")),
    request_body(content = Object, description = "`{\"channel\": {\"installation_id\", \"channel_id\", \"channel_name\"} | null, \"digest_time\": \"HH:MM\", \"digest_time_zone\", \"post_trial_findings\", \"allow_changes_from_slack\", \"revision\"}`", content_type = "application/json"),
    responses(
        (status = 200, description = "The saved settings, as GET answers them", content_type = "application/json", body = Object),
        (status = 400, description = "A malformed time or zone, or `code: \"not_in_channel\"` for a channel the OpenObserve app is not in", content_type = "application/json", body = ()),
        (status = 403, description = "Not allowed to manage Slack for this organization", content_type = "application/json", body = ()),
        (status = 404, description = "Slack insights are not enabled", content_type = "application/json", body = ()),
        (status = 409, description = "`code: \"revision_mismatch\"`: someone else saved first", content_type = "application/json", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Slack", "operation": "update"})),
        ("x-o2-mcp" = json!({"enabled": false}))
    )
)]
pub async fn put_insights_settings(
    Path(org_id): Path<String>,
    Headers(user_email): Headers<UserEmail>,
    body: Result<Json<serde_json::Value>, JsonRejection>,
) -> Response {
    let req = match parse(&org_id, body) {
        Ok(req) => req,
        Err(response) => return response,
    };
    let caller = caller(&org_id, &user_email.user_id);
    answer(settings::put(&caller, &req).await)
}

/// The page tells a stale save and a channel the bot is not in apart by the body's string `code`.
fn answer(result: Result<settings::SettingsView, SlackApiError>) -> Response {
    match result {
        Ok(view) => (StatusCode::OK, Json(view)).into_response(),
        Err(e) => match e.error_detail.as_deref() {
            Some(code @ (settings::CODE_STALE | settings::CODE_NOT_IN_CHANNEL)) => {
                let status = StatusCode::from_u16(e.status).unwrap_or(StatusCode::BAD_REQUEST);
                let body = serde_json::json!({"code": code, "message": e.message});
                (status, Json(body)).into_response()
            }
            _ => slack_error(e),
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    async fn body(response: Response) -> (u16, serde_json::Value) {
        let status = response.status().as_u16();
        let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        (status, serde_json::from_slice(&bytes).unwrap())
    }

    #[tokio::test]
    async fn refusals_carry_the_code_the_page_reads() {
        let stale = SlackApiError::conflict("Someone else changed these settings.")
            .with_detail(settings::CODE_STALE);
        let (status, b) = body(answer(Err(stale))).await;
        assert_eq!(
            (status, b["code"].as_str()),
            (409, Some("revision_mismatch"))
        );
        let refused = SlackApiError::bad_request("Invite the OpenObserve app to #ops first")
            .with_detail(settings::CODE_NOT_IN_CHANNEL);
        let (status, b) = body(answer(Err(refused))).await;
        assert_eq!((status, b["code"].as_str()), (400, Some("not_in_channel")));
        let (status, _) = body(answer(Err(SlackApiError::disabled()))).await;
        assert_eq!(status, 404);
    }
}
