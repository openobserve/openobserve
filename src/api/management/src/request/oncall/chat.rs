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

//! Native Slack for on-call: connecting, showing and disconnecting the org's workspace, and the
//! deployment's app manifest URLs.

use axum::{extract::Path, response::Response};
use common::meta::http::HttpResponse as MetaHttpResponse;
#[cfg(feature = "enterprise")]
use openobserve_api_common::extractors::Headers;
use openobserve_api_common::extractors::ValidatedJson;
use serde::Deserialize;

#[cfg(feature = "enterprise")]
use super::{CONFIG, SETTINGS, allowed};
#[cfg(feature = "enterprise")]
use crate::service::auth::UserEmail;

/// Slack's one-time code and the state `install/start` issued, as the callback page relays them.
#[derive(Deserialize, utoipa::ToSchema)]
pub struct ExchangeSlackInstallRequest {
    pub code: String,
    pub state: String,
}

/// The URL to open in a popup for the admin to approve the Slack app.
#[utoipa::path(
    post,
    path = "/{org_id}/oncall/chat/slack/install/start",
    context_path = "/api",
    tag = "OnCall",
    operation_id = "StartOnCallSlackInstall",
    summary = "Start connecting a Slack workspace",
    security(("Authorization" = [])),
    params(("org_id" = String, Path, description = "Organization name")),
    responses(
        (status = 200, description = "Success",   content_type = "application/json", body = Object),
        (status = 400, description = "No master key", content_type = "application/json", body = Object),
        (status = 403, description = "Forbidden", content_type = "application/json", body = Object),
        (status = 503, description = "Slack is not set up", content_type = "application/json", body = Object),
    ),
)]
pub async fn start_slack_install(
    Path(org_id): Path<String>,
    #[cfg(feature = "enterprise")] Headers(user_email): Headers<UserEmail>,
) -> Response {
    #[cfg(feature = "enterprise")]
    {
        use o2_enterprise::enterprise::oncall::chat::install_flow;

        let permitted = allowed(&org_id, &user_email.user_id, SETTINGS, "PUT").await;
        match install_flow::start(&org_id, &user_email.user_id, permitted) {
            Ok(url) => MetaHttpResponse::json(serde_json::json!({ "url": url })),
            Err(e) => refusal(e),
        }
    }
    #[cfg(not(feature = "enterprise"))]
    {
        let _ = org_id;
        MetaHttpResponse::forbidden("Not Supported")
    }
}

/// Redeems the code while logged in; a workspace another org holds is refused without naming it.
#[utoipa::path(
    post,
    path = "/{org_id}/oncall/chat/slack/install/exchange",
    context_path = "/api",
    tag = "OnCall",
    operation_id = "ExchangeOnCallSlackInstall",
    summary = "Finish connecting a Slack workspace",
    security(("Authorization" = [])),
    params(("org_id" = String, Path, description = "Organization name")),
    request_body(content = ExchangeSlackInstallRequest, content_type = "application/json"),
    responses(
        (status = 200, description = "Success",   content_type = "application/json", body = Object),
        (status = 400, description = "Invalid or expired approval, refused by Slack, or no master key", content_type = "application/json", body = Object),
        (status = 403, description = "Forbidden", content_type = "application/json", body = Object),
        (status = 409, description = "Connected to another organization", content_type = "application/json", body = Object),
        (status = 502, description = "Slack could not be reached", content_type = "application/json", body = Object),
        (status = 503, description = "Slack is not set up", content_type = "application/json", body = Object),
    ),
)]
pub async fn exchange_slack_install(
    Path(org_id): Path<String>,
    #[cfg(feature = "enterprise")] Headers(user_email): Headers<UserEmail>,
    ValidatedJson(body): ValidatedJson<ExchangeSlackInstallRequest>,
) -> Response {
    #[cfg(feature = "enterprise")]
    {
        use o2_enterprise::enterprise::oncall::chat::install_flow;

        let user_id = &user_email.user_id;
        let permitted = allowed(&org_id, user_id, SETTINGS, "PUT").await;
        match install_flow::exchange(&org_id, user_id, permitted, &body.code, &body.state).await {
            Ok(view) => MetaHttpResponse::json(view),
            Err(e) => refusal(e),
        }
    }
    #[cfg(not(feature = "enterprise"))]
    {
        let _ = (org_id, body);
        MetaHttpResponse::forbidden("Not Supported")
    }
}

/// The org's connected workspace, if any; never the bot token.
#[utoipa::path(
    get,
    path = "/{org_id}/oncall/chat/installs",
    context_path = "/api",
    tag = "OnCall",
    operation_id = "ListOnCallChatInstalls",
    summary = "Show the org's connected Slack workspace",
    security(("Authorization" = [])),
    params(("org_id" = String, Path, description = "Organization name")),
    responses(
        (status = 200, description = "Success",   content_type = "application/json", body = Object),
        (status = 403, description = "Forbidden", content_type = "application/json", body = Object),
    ),
)]
pub async fn list_chat_installs(
    Path(org_id): Path<String>,
    #[cfg(feature = "enterprise")] Headers(user_email): Headers<UserEmail>,
) -> Response {
    #[cfg(feature = "enterprise")]
    {
        use o2_enterprise::enterprise::oncall::chat::install_flow;

        let permitted = allowed(&org_id, &user_email.user_id, SETTINGS, "LIST").await;
        match install_flow::list(&org_id, permitted).await {
            Ok(views) => MetaHttpResponse::json(views),
            Err(e) => refusal(e),
        }
    }
    #[cfg(not(feature = "enterprise"))]
    {
        let _ = org_id;
        MetaHttpResponse::forbidden("Not Supported")
    }
}

/// Cuts our access and forgets the workspace; people's links are kept for a reconnect.
#[utoipa::path(
    delete,
    path = "/{org_id}/oncall/chat/installs/{workspace_id}",
    context_path = "/api",
    tag = "OnCall",
    operation_id = "DeleteOnCallChatInstall",
    summary = "Disconnect the org's Slack workspace",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("workspace_id" = String, Path, description = "Slack workspace (team) id"),
    ),
    responses(
        (status = 200, description = "Success",   content_type = "application/json", body = Object),
        (status = 403, description = "Forbidden", content_type = "application/json", body = Object),
        (status = 404, description = "Not connected to that workspace", content_type = "application/json", body = Object),
    ),
)]
pub async fn delete_chat_install(
    Path((org_id, workspace_id)): Path<(String, String)>,
    #[cfg(feature = "enterprise")] Headers(user_email): Headers<UserEmail>,
) -> Response {
    #[cfg(feature = "enterprise")]
    {
        use o2_enterprise::enterprise::oncall::chat::install_flow;

        let permitted = allowed(&org_id, &user_email.user_id, SETTINGS, "PUT").await;
        match install_flow::disconnect(&org_id, &workspace_id, permitted).await {
            Ok(message) => MetaHttpResponse::json(serde_json::json!({ "message": message })),
            Err(e) => refusal(e),
        }
    }
    #[cfg(not(feature = "enterprise"))]
    {
        let _ = (org_id, workspace_id);
        MetaHttpResponse::forbidden("Not Supported")
    }
}

/// The addresses the deployment's Slack app manifest needs; only the admin org is answered.
#[utoipa::path(
    get,
    path = "/{org_id}/oncall/chat/slack/manifest",
    context_path = "/api",
    tag = "OnCall",
    operation_id = "GetOnCallSlackManifestUrls",
    summary = "Get the Slack app manifest URLs",
    security(("Authorization" = [])),
    params(("org_id" = String, Path, description = "Organization name")),
    responses(
        (status = 200, description = "Success",   content_type = "application/json", body = Object),
        (status = 403, description = "Forbidden, or not the admin organization", content_type = "application/json", body = Object),
    ),
)]
pub async fn get_slack_manifest(
    Path(org_id): Path<String>,
    #[cfg(feature = "enterprise")] Headers(user_email): Headers<UserEmail>,
) -> Response {
    #[cfg(feature = "enterprise")]
    {
        use o2_enterprise::enterprise::oncall::chat::install_flow::{self, InstallFlowError};

        // Cheap refusal first, so other orgs never cost a permission lookup (IN-3).
        if org_id != config::META_ORG_ID {
            return refusal(InstallFlowError::Forbidden);
        }
        let permitted = allowed(&org_id, &user_email.user_id, SETTINGS, "GET").await;
        match install_flow::manifest(&org_id, permitted) {
            Ok(urls) => MetaHttpResponse::json(urls),
            Err(e) => refusal(e),
        }
    }
    #[cfg(not(feature = "enterprise"))]
    {
        let _ = org_id;
        MetaHttpResponse::forbidden("Not Supported")
    }
}

/// Posts one plain test message to the team's Slack channel and says what to fix (RO-7).
#[utoipa::path(
    post,
    path = "/{org_id}/oncall/teams/{team_id}/slack/test",
    context_path = "/api",
    tag = "OnCall",
    operation_id = "TestOnCallTeamSlackChannel",
    summary = "Send a test message to a team's Slack channel",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("team_id" = String, Path, description = "Team ID"),
    ),
    responses(
        (status = 200, description = "Sent, or the reason it was not with advice", content_type = "application/json", body = Object),
        (status = 403, description = "Forbidden", content_type = "application/json", body = Object),
        (status = 404, description = "Team not found", content_type = "application/json", body = Object),
        (status = 502, description = "Slack could not be reached", content_type = "application/json", body = Object),
    ),
)]
pub async fn test_team_slack_channel(
    Path((org_id, team_id)): Path<(String, String)>,
    #[cfg(feature = "enterprise")] Headers(user_email): Headers<UserEmail>,
) -> Response {
    #[cfg(feature = "enterprise")]
    {
        use axum::response::IntoResponse;
        use o2_enterprise::enterprise::oncall::chat::room::{self, RoomTestError};

        let permitted = allowed(&org_id, &user_email.user_id, CONFIG, "PUT").await;
        match room::test(&org_id, &team_id, permitted).await {
            Ok(result) => MetaHttpResponse::json(result),
            Err(RoomTestError::Storage(cause)) => super::internal_error("slack test", &cause),
            Err(e) => MetaHttpResponse::error(e.http_status(), e.to_string()).into_response(),
        }
    }
    #[cfg(not(feature = "enterprise"))]
    {
        let _ = (org_id, team_id);
        MetaHttpResponse::forbidden("Not Supported")
    }
}

/// A storage failure is logged and answered as a bare 500; every other refusal is worded for the
/// caller.
#[cfg(feature = "enterprise")]
fn refusal(e: o2_enterprise::enterprise::oncall::chat::install_flow::InstallFlowError) -> Response {
    use axum::response::IntoResponse;
    use o2_enterprise::enterprise::oncall::chat::install_flow::InstallFlowError;

    if let InstallFlowError::Storage(cause) = &e {
        return super::internal_error("slack install", cause);
    }
    MetaHttpResponse::error(e.http_status(), e.to_string()).into_response()
}

#[cfg(test)]
mod tests {
    /// RB-11: without the enterprise build every handler answers 403 "Not Supported".
    #[cfg(not(feature = "enterprise"))]
    #[tokio::test]
    async fn test_every_handler_is_not_supported_without_enterprise() {
        use std::{future::Future, pin::Pin};

        use axum::http::StatusCode;

        use super::*;

        // One handler call, awaited by the loop below.
        type Call = Pin<Box<dyn Future<Output = Response>>>;

        let org = || Path("acme".to_string());
        let exchange = || ExchangeSlackInstallRequest {
            code: "c".to_string(),
            state: "s".to_string(),
        };
        let cases: Vec<(&str, Call)> = vec![
            ("start", Box::pin(start_slack_install(org()))),
            (
                "exchange",
                Box::pin(exchange_slack_install(org(), ValidatedJson(exchange()))),
            ),
            ("list", Box::pin(list_chat_installs(org()))),
            (
                "delete",
                Box::pin(delete_chat_install(Path((
                    "acme".to_string(),
                    "T1".to_string(),
                )))),
            ),
            ("manifest", Box::pin(get_slack_manifest(org()))),
            (
                "team slack test",
                Box::pin(test_team_slack_channel(Path((
                    "acme".to_string(),
                    "t1".to_string(),
                )))),
            ),
        ];
        for (name, handler) in cases {
            let resp = handler.await;
            assert_eq!(resp.status(), StatusCode::FORBIDDEN, "{name}");
            let body = axum::body::to_bytes(resp.into_body(), usize::MAX)
                .await
                .unwrap();
            assert!(
                String::from_utf8_lossy(&body).contains("Not Supported"),
                "{name}"
            );
        }
    }
}
