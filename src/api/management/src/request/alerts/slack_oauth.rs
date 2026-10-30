// Copyright 2026 OpenObserve Inc.

use axum::{
    Json,
    extract::Path,
    http::StatusCode,
    response::{IntoResponse, Response},
};
use o2_enterprise::enterprise::cloud::slack_oauth::{
    self, SlackOAuthConnection as CloudSlackOAuthConnection, SlackOAuthError,
};
use openobserve_api_common::extractors::Headers;
use openobserve_core::auth::UserEmail;
use serde::{Deserialize, Serialize};

use crate::common::meta::http::HttpResponse as MetaHttpResponse;

/// Where to send the browser to authorize the app; the signed state is already embedded in the URL.
#[derive(Debug, Serialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct SlackOAuthStartResponse {
    authorization_url: String,
}

/// Slack's callback code plus the still-unexpired state issued by `start`.
#[derive(Debug, Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct SlackOAuthExchangeRequest {
    code: String,
    state: String,
}

/// Only the channel-bound incoming webhook; the access token never leaves the server.
#[derive(Debug, Serialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct SlackOAuthConnection {
    webhook_url: String,
    channel: String,
    channel_id: String,
    team_id: String,
    team_name: String,
}

impl From<CloudSlackOAuthConnection> for SlackOAuthConnection {
    fn from(connection: CloudSlackOAuthConnection) -> Self {
        Self {
            webhook_url: connection.webhook_url,
            channel: connection.channel,
            channel_id: connection.channel_id,
            team_id: connection.team_id,
            team_name: connection.team_name,
        }
    }
}

// A misconfigured deployment is a 503 and a broken Slack is a 502; everything else is the
// caller's state or code, which is a 400 — the flow must never leak why beyond that.
fn error_response(error: SlackOAuthError) -> Response {
    let status = match error {
        SlackOAuthError::NotConfigured | SlackOAuthError::InvalidConfiguration => {
            StatusCode::SERVICE_UNAVAILABLE
        }
        SlackOAuthError::SlackUnavailable
        | SlackOAuthError::InvalidSlackResponse
        | SlackOAuthError::MissingWebhook
        | SlackOAuthError::InvalidWebhook => StatusCode::BAD_GATEWAY,
        SlackOAuthError::InvalidState | SlackOAuthError::AuthorizationFailed => {
            StatusCode::BAD_REQUEST
        }
    };
    (status, Json(MetaHttpResponse::error(status, error))).into_response()
}

/// Issues a Slack authorize URL whose state is signed and bound to this org and user.
#[utoipa::path(
    post,
    path = "/{org_id}/alerts/destinations/slack/oauth/start",
    context_path = "/api",
    tag = "Alerts",
    operation_id = "StartSlackDestinationOAuth",
    security(("Authorization" = [])),
    params(("org_id" = String, Path, description = "Organization name")),
    responses(
        (status = 200, description = "Slack authorization URL", body = SlackOAuthStartResponse),
        (status = 500, description = "Internal server error"),
        (status = 503, description = "Slack OAuth is not configured")
    )
)]
pub async fn start(
    Path(org_id): Path<String>,
    Headers(user_email): Headers<UserEmail>,
) -> Response {
    match slack_oauth::authorization_url(&org_id, &user_email.user_id) {
        Ok(authorization_url) => {
            MetaHttpResponse::json(SlackOAuthStartResponse { authorization_url })
        }
        Err(error) => error_response(error),
    }
}

/// Verifies the signed state, redeems the code, and returns only the channel-bound webhook.
#[utoipa::path(
    post,
    path = "/{org_id}/alerts/destinations/slack/oauth/exchange",
    context_path = "/api",
    tag = "Alerts",
    operation_id = "ExchangeSlackDestinationOAuth",
    security(("Authorization" = [])),
    params(("org_id" = String, Path, description = "Organization name")),
    request_body(content = SlackOAuthExchangeRequest, content_type = "application/json"),
    responses(
        (status = 200, description = "Connected Slack incoming webhook", body = SlackOAuthConnection),
        (status = 400, description = "Invalid or rejected authorization"),
        (status = 502, description = "Slack authorization service failure"),
        (status = 503, description = "Slack OAuth is not configured")
    )
)]
pub async fn exchange(
    Path(org_id): Path<String>,
    Headers(user_email): Headers<UserEmail>,
    Json(request): Json<SlackOAuthExchangeRequest>,
) -> Response {
    match slack_oauth::exchange_code(&org_id, &user_email.user_id, &request.code, &request.state)
        .await
    {
        Ok(connection) => MetaHttpResponse::json(SlackOAuthConnection::from(connection)),
        Err(error) => error_response(error),
    }
}
