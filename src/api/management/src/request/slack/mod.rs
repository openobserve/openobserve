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

//! Slack app install and settings handlers: enterprise only, 403 "Not Supported" in the OSS build.

pub mod installations;
pub mod settings;

#[cfg(feature = "enterprise")]
use axum::{Json, response::IntoResponse};
use axum::{http::StatusCode, response::Response};
use serde::{Deserialize, Serialize};
use utoipa::IntoParams;

use crate::common::meta::http::HttpResponse as MetaHttpResponse;

/// Paging query of rows 12 and 20.
#[derive(Debug, Default, Deserialize, Serialize, IntoParams)]
#[into_params(parameter_in = Query)]
pub struct CursorQuery {
    /// Slack's `next_cursor` from the previous page.
    pub cursor: Option<String>,
}

/// Row 20 query.
#[derive(Debug, Default, Deserialize, Serialize, IntoParams)]
#[into_params(parameter_in = Query)]
pub struct ChannelsQuery {
    /// Name filter.
    pub q: Option<String>,
    /// Slack's `next_cursor` from the previous page.
    pub cursor: Option<String>,
}

/// Row 5 query.
#[derive(Debug, Default, Deserialize, Serialize, IntoParams)]
#[into_params(parameter_in = Query)]
pub struct ManifestQuery {
    /// `socket` or `http`.
    pub mode: Option<String>,
    /// App name shown in Slack.
    pub name: Option<String>,
    /// Adds the channel-history scopes and events.
    pub channel_history: Option<bool>,
}

/// O2's `{"code","message"}` body with the given status; anything outside 400-599 becomes 500.
pub fn error_response(status: u16, message: &str) -> Response {
    let code = StatusCode::from_u16(status)
        .ok()
        .filter(|c| c.is_client_error() || c.is_server_error())
        .unwrap_or(StatusCode::INTERNAL_SERVER_ERROR);
    MetaHttpResponse::error_with_header(code, message)
}

#[cfg(not(feature = "enterprise"))]
fn not_supported() -> Response {
    MetaHttpResponse::forbidden("Not Supported")
}

/// The caller of a Slack route; the section 7 `authorize_slack_admin` rule runs inside each ENT fn.
#[cfg(feature = "enterprise")]
fn caller(org_id: &str, user_id: &str) -> o2_enterprise::enterprise::slack::authz::Caller {
    o2_enterprise::enterprise::slack::authz::Caller::new(
        org_id,
        user_id,
        db::user::is_root_user(user_id),
    )
}

#[cfg(feature = "enterprise")]
fn slack_error(e: o2_enterprise::enterprise::slack::error::SlackApiError) -> Response {
    error_response(e.status, &e.message)
}

/// A body that does not fit still answers 404 while Slack is off for the org, like every route.
#[cfg(feature = "enterprise")]
fn parse<T: serde::de::DeserializeOwned>(
    org_id: &str,
    value: serde_json::Value,
) -> Result<T, Response> {
    serde_json::from_value(value).map_err(|e| {
        match o2_enterprise::enterprise::slack::authz::require_enabled(org_id) {
            Err(disabled) => slack_error(disabled),
            Ok(()) => error_response(400, &format!("Invalid request: {e}")),
        }
    })
}

#[cfg(feature = "enterprise")]
fn respond<T: Serialize>(
    result: Result<T, o2_enterprise::enterprise::slack::error::SlackApiError>,
) -> Response {
    respond_with(StatusCode::OK, result)
}

#[cfg(feature = "enterprise")]
fn respond_with<T: Serialize>(
    status: StatusCode,
    result: Result<T, o2_enterprise::enterprise::slack::error::SlackApiError>,
) -> Response {
    match result {
        Ok(body) => (status, Json(body)).into_response(),
        Err(e) => slack_error(e),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    async fn body(response: Response) -> serde_json::Value {
        let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        serde_json::from_slice(&bytes).unwrap()
    }

    #[tokio::test]
    async fn every_section_7_status_keeps_its_code_and_message() {
        for status in [400u16, 403, 404, 409, 410, 422, 500, 502, 503] {
            let response = error_response(status, "These credentials belong to another Slack app");
            assert_eq!(response.status().as_u16(), status);
            assert_eq!(
                body(response).await,
                serde_json::json!({"code": status, "message": "These credentials belong to another Slack app"})
            );
        }
    }

    #[tokio::test]
    async fn a_status_that_is_not_an_error_becomes_500() {
        for status in [0u16, 99, 200, 204, 302, 1000] {
            let response = error_response(status, "x");
            assert_eq!(response.status(), StatusCode::INTERNAL_SERVER_ERROR);
            assert_eq!(body(response).await["code"], 500);
        }
    }

    #[cfg(feature = "enterprise")]
    #[tokio::test]
    async fn a_bad_body_answers_404_while_slack_is_off() {
        let response = parse::<o2_enterprise::enterprise::slack::install::ConnectRequest>(
            "default",
            serde_json::json!({"ticket": 1}),
        )
        .unwrap_err();
        assert_eq!(response.status(), StatusCode::NOT_FOUND);
        assert_eq!(body(response).await["message"], "Slack is not enabled");
    }

    #[cfg(feature = "enterprise")]
    #[test]
    fn the_caller_is_lower_cased_and_not_root_for_a_member() {
        let c = caller("default", "Dana@Acme.com");
        assert_eq!(c.org_id, "default");
        assert_eq!(c.user_email, "dana@acme.com");
        assert!(!c.is_root);
    }
}
