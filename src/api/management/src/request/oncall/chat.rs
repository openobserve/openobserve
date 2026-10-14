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

//! Native Slack for on-call: connecting, showing and disconnecting the org's workspace, the
//! deployment's app manifest URLs, people linking their own Slack account, presses and `/oncall`.

use axum::{body::Bytes, extract::Path, http::HeaderMap, response::Response};
use common::meta::http::HttpResponse as MetaHttpResponse;
#[cfg(feature = "enterprise")]
use o2_enterprise::enterprise::{
    common::config::get_config as get_o2_config,
    oncall::chat::{
        command,
        payload::{Click, Command, ParsedClick, ParsedCommand},
        press,
        signature::Rejected,
    },
};
#[cfg(feature = "enterprise")]
use openobserve_api_common::extractors::Headers;
use openobserve_api_common::extractors::ValidatedJson;
use serde::Deserialize;

#[cfg(feature = "enterprise")]
use super::{CONFIG, RESPONSES, SETTINGS, allowed};
#[cfg(feature = "enterprise")]
use crate::service::auth::UserEmail;

// Header carrying Slack's request signature (https://docs.slack.dev/authentication/verifying-requests-from-slack).
#[cfg(feature = "enterprise")]
const SLACK_SIGNATURE_HEADER: &str = "x-slack-signature";
// Header carrying the timestamp Slack signed with the body (same page).
#[cfg(feature = "enterprise")]
const SLACK_TIMESTAMP_HEADER: &str = "x-slack-request-timestamp";

/// Slack's one-time code and the state `install/start` issued, as the callback page relays them.
#[derive(Deserialize, utoipa::ToSchema)]
pub struct ExchangeSlackInstallRequest {
    pub code: String,
    pub state: String,
}

/// The link token from the linking URL's `?t=`, which the Confirm page posts back.
#[derive(Deserialize, utoipa::ToSchema)]
pub struct ConfirmSlackLinkRequest {
    pub t: String,
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

/// Finds the caller in Slack by their own email and DMs them a Confirm button; nothing is linked.
#[utoipa::path(
    post,
    path = "/{org_id}/oncall/chat/slack/link/start",
    context_path = "/api",
    tag = "OnCall",
    operation_id = "StartOnCallSlackLink",
    summary = "Send yourself a Slack DM to link your Slack account",
    security(("Authorization" = [])),
    params(("org_id" = String, Path, description = "Organization name")),
    responses(
        (status = 200, description = "DM sent", content_type = "application/json", body = Object),
        (status = 400, description = "Slack is not connected", content_type = "application/json", body = Object),
        (status = 403, description = "Not a member of the organization", content_type = "application/json", body = Object),
        (status = 404, description = "No Slack account uses your email", content_type = "application/json", body = Object),
        (status = 409, description = "Slack would not deliver a direct message to you", content_type = "application/json", body = Object),
        (status = 502, description = "Slack could not be reached", content_type = "application/json", body = Object),
        (status = 503, description = "Slack is not set up", content_type = "application/json", body = Object),
    ),
)]
pub async fn start_slack_link(
    Path(org_id): Path<String>,
    #[cfg(feature = "enterprise")] Headers(user_email): Headers<UserEmail>,
) -> Response {
    #[cfg(feature = "enterprise")]
    {
        use o2_enterprise::enterprise::oncall::chat::link_flow;

        match link_flow::start(&org_id, &user_email.user_id).await {
            Ok(()) => MetaHttpResponse::json(serde_json::json!({ "sent": true })),
            Err(e) => link_refusal(e),
        }
    }
    #[cfg(not(feature = "enterprise"))]
    {
        let _ = org_id;
        MetaHttpResponse::forbidden("Not Supported")
    }
}

/// Links the Slack account a linking URL names to the caller, if Slack confirms the same email.
#[utoipa::path(
    post,
    path = "/{org_id}/oncall/chat/slack/link",
    context_path = "/api",
    tag = "OnCall",
    operation_id = "ConfirmOnCallSlackLink",
    summary = "Confirm linking your Slack account",
    security(("Authorization" = [])),
    params(("org_id" = String, Path, description = "Organization name")),
    request_body(content = ConfirmSlackLinkRequest, content_type = "application/json"),
    responses(
        (status = 200, description = "Linked", content_type = "application/json", body = Object),
        (status = 400, description = "This link can't be used", content_type = "application/json", body = Object),
        (status = 403, description = "Not a member of the organization", content_type = "application/json", body = Object),
        (status = 502, description = "Slack could not be reached", content_type = "application/json", body = Object),
        (status = 503, description = "Slack is not set up", content_type = "application/json", body = Object),
    ),
)]
pub async fn confirm_slack_link(
    Path(org_id): Path<String>,
    #[cfg(feature = "enterprise")] Headers(user_email): Headers<UserEmail>,
    ValidatedJson(body): ValidatedJson<ConfirmSlackLinkRequest>,
) -> Response {
    #[cfg(feature = "enterprise")]
    {
        use o2_enterprise::enterprise::oncall::chat::link_flow;

        match link_flow::confirm(&org_id, &user_email.user_id, &body.t).await {
            Ok(view) => MetaHttpResponse::json(view),
            Err(e) => link_refusal(e),
        }
    }
    #[cfg(not(feature = "enterprise"))]
    {
        let _ = (org_id, body);
        MetaHttpResponse::forbidden("Not Supported")
    }
}

/// The caller's own Slack link, or null, and whether its workspace is connected; never another's.
#[utoipa::path(
    get,
    path = "/{org_id}/oncall/chat/identities/me",
    context_path = "/api",
    tag = "OnCall",
    operation_id = "GetMyOnCallChatIdentity",
    summary = "Show your own Slack link",
    security(("Authorization" = [])),
    params(("org_id" = String, Path, description = "Organization name")),
    responses(
        (status = 200, description = "Your link, or null", content_type = "application/json", body = Object),
        (status = 403, description = "Not a member of the organization", content_type = "application/json", body = Object),
    ),
)]
pub async fn get_my_chat_identity(
    Path(org_id): Path<String>,
    #[cfg(feature = "enterprise")] Headers(user_email): Headers<UserEmail>,
) -> Response {
    #[cfg(feature = "enterprise")]
    {
        use o2_enterprise::enterprise::oncall::chat::link_flow;

        match link_flow::mine(&org_id, &user_email.user_id).await {
            Ok(view) => MetaHttpResponse::json(view),
            Err(e) => link_refusal(e),
        }
    }
    #[cfg(not(feature = "enterprise"))]
    {
        let _ = org_id;
        MetaHttpResponse::forbidden("Not Supported")
    }
}

/// Unlinks the caller's own Slack account; nobody else's can be named.
#[utoipa::path(
    delete,
    path = "/{org_id}/oncall/chat/identities/me",
    context_path = "/api",
    tag = "OnCall",
    operation_id = "DeleteMyOnCallChatIdentity",
    summary = "Unlink your own Slack account",
    security(("Authorization" = [])),
    params(("org_id" = String, Path, description = "Organization name")),
    responses(
        (status = 200, description = "Whether a link was removed", content_type = "application/json", body = Object),
        (status = 403, description = "Not a member of the organization", content_type = "application/json", body = Object),
    ),
)]
pub async fn delete_my_chat_identity(
    Path(org_id): Path<String>,
    #[cfg(feature = "enterprise")] Headers(user_email): Headers<UserEmail>,
) -> Response {
    #[cfg(feature = "enterprise")]
    {
        use o2_enterprise::enterprise::oncall::chat::link_flow;

        match link_flow::unlink(&org_id, &user_email.user_id).await {
            Ok(unlinked) => MetaHttpResponse::json(serde_json::json!({ "unlinked": unlinked })),
            Err(e) => link_refusal(e),
        }
    }
    #[cfg(not(feature = "enterprise"))]
    {
        let _ = org_id;
        MetaHttpResponse::forbidden("Not Supported")
    }
}

/// Slack's button presses: verified, answered at once with an empty 200, then worked (CL-1, CL-3).
#[utoipa::path(
    post,
    path = "/v2/oncall/chat/slack/interact",
    context_path = "/api",
    tag = "OnCall",
    operation_id = "OnCallSlackInteract",
    summary = "Receive a Slack button press",
    request_body(content = String, content_type = "application/x-www-form-urlencoded", description = "Slack's signed block_actions form"),
    responses(
        (status = 200, description = "Accepted; any reply goes to Slack's response_url"),
        (status = 401, description = "Not signed by Slack, or too old", content_type = "application/json", body = Object),
        (status = 403, description = "Not Supported", content_type = "application/json", body = Object),
        (status = 413, description = "Body over 64 KiB"),
    ),
)]
pub async fn slack_interact(headers: HeaderMap, body: Bytes) -> Response {
    #[cfg(feature = "enterprise")]
    {
        use axum::{http::StatusCode, response::IntoResponse};

        // Verified before any parse or I/O, so an unsigned request costs one HMAC (CL-8).
        match accept_signed(&headers, &body, press::accept_press) {
            Err(unauthorized) => unauthorized,
            Ok(ParsedClick::Ignore) => StatusCode::OK.into_response(),
            Ok(ParsedClick::Click(click)) => {
                // Slack wants the 200 within 3 s; the work and any reply follow on their own.
                tokio::spawn(press_worker(click));
                StatusCode::OK.into_response()
            }
        }
    }
    #[cfg(not(feature = "enterprise"))]
    {
        let _ = (headers, body);
        MetaHttpResponse::forbidden("Not Supported")
    }
}

/// Slack's `/oncall`: verified, answered at once with an empty 200, then worked (CL-1, RB-9).
#[utoipa::path(
    post,
    path = "/v2/oncall/chat/slack/command",
    context_path = "/api",
    tag = "OnCall",
    operation_id = "OnCallSlackCommand",
    summary = "Receive the Slack /oncall command",
    request_body(content = String, content_type = "application/x-www-form-urlencoded", description = "Slack's signed slash-command form"),
    responses(
        (status = 200, description = "Accepted; the reply goes to Slack's response_url"),
        (status = 401, description = "Not signed by Slack, or too old", content_type = "application/json", body = Object),
        (status = 403, description = "Not Supported", content_type = "application/json", body = Object),
        (status = 413, description = "Body over 64 KiB"),
    ),
)]
pub async fn slack_command(headers: HeaderMap, body: Bytes) -> Response {
    #[cfg(feature = "enterprise")]
    {
        use axum::{http::StatusCode, response::IntoResponse};

        match accept_signed(&headers, &body, command::accept_command) {
            Err(unauthorized) => unauthorized,
            Ok(ParsedCommand::SslCheck | ParsedCommand::Ignore) => StatusCode::OK.into_response(),
            Ok(ParsedCommand::Command(slash)) => {
                // Slack wants the 200 within 3 s; the reply follows through its response_url.
                tokio::spawn(command_worker(slash));
                StatusCode::OK.into_response()
            }
        }
    }
    #[cfg(not(feature = "enterprise"))]
    {
        let _ = (headers, body);
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

/// Like [`refusal`], for linking a Slack account.
#[cfg(feature = "enterprise")]
fn link_refusal(e: o2_enterprise::enterprise::oncall::chat::link_flow::LinkFlowError) -> Response {
    use axum::response::IntoResponse;
    use o2_enterprise::enterprise::oncall::chat::link_flow::LinkFlowError;

    if let LinkFlowError::Storage(cause) = &e {
        return super::internal_error("slack link", cause);
    }
    MetaHttpResponse::error(e.http_status(), e.to_string()).into_response()
}

/// Runs `accept` on the body with the deployment's signing secret and Slack's headers; else 401.
#[cfg(feature = "enterprise")]
fn accept_signed<T>(
    headers: &HeaderMap,
    body: &[u8],
    accept: impl FnOnce(&[u8], &str, &[u8], &str, i64) -> Result<T, Rejected>,
) -> Result<T, Response> {
    use axum::{http::StatusCode, response::IntoResponse};

    let header = |name: &str| {
        headers
            .get(name)
            .and_then(|v| v.to_str().ok())
            .unwrap_or_default()
    };
    let secret = get_o2_config().oncall.slack_signing_secret.clone();
    let now_secs = config::utils::time::now_micros() / 1_000_000;
    accept(
        secret.as_bytes(),
        header(SLACK_TIMESTAMP_HEADER),
        body,
        header(SLACK_SIGNATURE_HEADER),
        now_secs,
    )
    .map_err(|_| {
        MetaHttpResponse::error(
            StatusCode::UNAUTHORIZED.as_u16(),
            "Unauthorized".to_string(),
        )
        .into_response()
    })
}

/// Answers one press as the linked person, then posts any private reply (CL-5 to CL-7).
#[cfg(feature = "enterprise")]
async fn press_worker(click: Click) {
    // The on-call client secret keys link tokens; their own domain keeps them apart (C7).
    let link_key = get_o2_config().oncall.slack_client_secret.clone();
    let may_work_pages =
        async |org_id: &str, email: &str| allowed(org_id, email, RESPONSES, "POST").await;
    let reply = press::answer_click(
        &click,
        link_key.as_bytes(),
        may_work_pages,
        config::utils::time::now_micros(),
    )
    .await;
    press::send_reply(&click.response_url, &reply).await;
}

/// Answers one `/oncall` command privately through Slack's reply address (C21). [no-fail]
#[cfg(feature = "enterprise")]
async fn command_worker(slash: Command) {
    // The on-call client secret keys link tokens, as for presses (C7).
    let link_key = get_o2_config().oncall.slack_client_secret.clone();
    let may = async |org_id: &str, email: &str, method: &str| {
        allowed(org_id, email, CONFIG, method).await
    };
    let reply = command::answer_command(
        &slash,
        link_key.as_bytes(),
        may,
        config::utils::time::now_micros(),
    )
    .await;
    press::send_text(&slash.response_url, &reply).await;
}

#[cfg(test)]
mod tests {
    /// CL-1, RB-9: an unsigned command is refused with 401; an `ssl_check` probe gets 200.
    #[cfg(feature = "enterprise")]
    #[tokio::test]
    async fn test_slack_command_refuses_unsigned_and_answers_ssl_check() {
        use axum::http::StatusCode;

        use super::*;

        let cases = [
            ("command=%2Foncall&text=help", StatusCode::UNAUTHORIZED),
            ("ssl_check=1&token=x", StatusCode::OK),
        ];
        for (body, status) in cases {
            let resp = slack_command(HeaderMap::new(), Bytes::from(body)).await;
            assert_eq!(resp.status(), status, "{body}");
        }
    }

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
            (
                "slack interact",
                Box::pin(slack_interact(HeaderMap::new(), Bytes::new())),
            ),
            (
                "slack command",
                Box::pin(slack_command(HeaderMap::new(), Bytes::new())),
            ),
            ("link start", Box::pin(start_slack_link(org()))),
            (
                "link confirm",
                Box::pin(confirm_slack_link(
                    org(),
                    ValidatedJson(ConfirmSlackLinkRequest { t: "t".to_string() }),
                )),
            ),
            ("my link", Box::pin(get_my_chat_identity(org()))),
            ("unlink", Box::pin(delete_my_chat_identity(org()))),
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
