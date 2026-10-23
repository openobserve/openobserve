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

//! Section 7.3 linking: link requests from Slack, the caller's own links, and the admin list.

use axum::{
    Json,
    extract::{
        Path, Query,
        rejection::{JsonRejection, QueryRejection},
    },
    response::Response,
};
#[cfg(feature = "enterprise")]
use o2_enterprise::enterprise::slack as ent;
use openobserve_api_common::extractors::Headers;
use openobserve_core::auth::UserEmail;
use serde::{Deserialize, Serialize};
use utoipa::IntoParams;

#[cfg(not(feature = "enterprise"))]
use super::not_supported;
#[cfg(feature = "enterprise")]
use super::{caller, parse, parse_query, respond};

/// Query of the admin link list.
#[derive(Debug, Default, Deserialize, Serialize, IntoParams)]
#[into_params(parameter_in = Query)]
pub struct LinksQuery {
    /// Only this installation; all installations connected to the organization when absent.
    pub installation_id: Option<String>,
    /// `next_cursor` from the previous page.
    pub cursor: Option<String>,
}

/// SlackLinkRequestStart
#[utoipa::path(
    post,
    path = "/{org_id}/slack/link-requests/{request_id}/start",
    context_path = "/api",
    tag = "Slack",
    operation_id = "SlackLinkRequestStart",
    summary = "Start linking a Slack account",
    description = "Checks the signed link the bot sent and returns the Sign in with Slack URL for the signed-in user. Any member of a connected organization may call it.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Any organization the caller belongs to"),
        ("request_id" = String, Path, description = "Link request id from `?r=<id>.<sig>`"),
    ),
    request_body(content = Object, description = "`{\"sig\"}`", content_type = "application/json"),
    responses(
        (status = 200, description = "`{\"url\", \"request\": {\"question_preview\", \"channel_name\", \"team_name\"}, \"help_contact\"}`", content_type = "application/json", body = Object),
        (status = 400, description = "Bad signature", content_type = "application/json", body = ()),
        (status = 403, description = "No O2 account in a connected organization (`error_detail` `no_access`, `hint` the help contact), or the OSS build", content_type = "application/json", body = ()),
        (status = 404, description = "Slack is not enabled for this organization, or unknown request", content_type = "application/json", body = ()),
        (status = 410, description = "Expired, redeemed or discarded", content_type = "application/json", body = ()),
        (status = 429, description = "More than 10 start or confirm calls in a minute", content_type = "application/json", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Slack", "operation": "create"})),
        ("x-o2-mcp" = json!({"enabled": false}))
    )
)]
pub async fn start(
    Path((org_id, request_id)): Path<(String, String)>,
    Headers(user_email): Headers<UserEmail>,
    body: Result<Json<serde_json::Value>, JsonRejection>,
) -> Response {
    #[cfg(feature = "enterprise")]
    {
        let req = match parse(&org_id, body) {
            Ok(req) => req,
            Err(response) => return response,
        };
        respond(ent::links::start(&caller(&org_id, &user_email.user_id), &request_id, &req).await)
    }
    #[cfg(not(feature = "enterprise"))]
    {
        let _ = (org_id, request_id, user_email, body);
        not_supported()
    }
}

/// SlackLinkRequestConfirm
#[utoipa::path(
    post,
    path = "/{org_id}/slack/link-requests/confirm",
    context_path = "/api",
    tag = "Slack",
    operation_id = "SlackLinkRequestConfirm",
    summary = "Finish linking a Slack account",
    description = "Redeems the Sign in with Slack code; the link request comes from the signed state. Checks that the Slack user is the one the link was sent to, links, and returns where to go back in Slack.",
    security(("Authorization" = [])),
    params(("org_id" = String, Path, description = "Any organization the caller belongs to")),
    request_body(content = Object, description = "`{\"oidc_code\", \"oidc_state\"}`", content_type = "application/json"),
    responses(
        (status = 200, description = "`{\"linked_as\", \"org_id\", \"orgs\", \"return_url\"}`", content_type = "application/json", body = Object),
        (status = 400, description = "Bad or reused state, nonce mismatch", content_type = "application/json", body = ()),
        (status = 403, description = "Another Slack account, team or Grid org (`error_detail` `wrong_account`), no O2 account in a connected organization (`no_access`), or the OSS build", content_type = "application/json", body = ()),
        (status = 404, description = "Slack is not enabled for this organization, or unknown request", content_type = "application/json", body = ()),
        (status = 410, description = "Expired, redeemed or discarded", content_type = "application/json", body = ()),
        (status = 429, description = "More than 10 start or confirm calls in a minute", content_type = "application/json", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Slack", "operation": "create"})),
        ("x-o2-mcp" = json!({"enabled": false}))
    )
)]
pub async fn confirm(
    Path(org_id): Path<String>,
    Headers(user_email): Headers<UserEmail>,
    body: Result<Json<serde_json::Value>, JsonRejection>,
) -> Response {
    #[cfg(feature = "enterprise")]
    {
        let req = match parse(&org_id, body) {
            Ok(req) => req,
            Err(response) => return response,
        };
        respond(ent::links::confirm(&caller(&org_id, &user_email.user_id), &req).await)
    }
    #[cfg(not(feature = "enterprise"))]
    {
        let _ = (org_id, user_email, body);
        not_supported()
    }
}

/// SlackLinkRequestResend
#[utoipa::path(
    post,
    path = "/{org_id}/slack/link-requests/{request_id}/resend",
    context_path = "/api",
    tag = "Slack",
    operation_id = "SlackLinkRequestResend",
    summary = "Send a new link",
    description = "Sends the Slack user of an expired link a new one by DM, keeping the held question.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Any organization the caller belongs to"),
        ("request_id" = String, Path, description = "Link request id from `?r=<id>.<sig>`"),
    ),
    request_body(content = Object, description = "`{\"sig\"}`", content_type = "application/json"),
    responses(
        (status = 202, description = "A new link was sent"),
        (status = 400, description = "Bad signature", content_type = "application/json", body = ()),
        (status = 403, description = "The OSS build", content_type = "application/json", body = ()),
        (status = 404, description = "Slack is not enabled for this organization, or unknown request", content_type = "application/json", body = ()),
        (status = 429, description = "Five link requests in 10 minutes for this Slack user", content_type = "application/json", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Slack", "operation": "create"})),
        ("x-o2-mcp" = json!({"enabled": false}))
    )
)]
pub async fn resend(
    Path((org_id, request_id)): Path<(String, String)>,
    Headers(user_email): Headers<UserEmail>,
    body: Result<Json<serde_json::Value>, JsonRejection>,
) -> Response {
    #[cfg(feature = "enterprise")]
    {
        use axum::response::IntoResponse;

        let req = match parse(&org_id, body) {
            Ok(req) => req,
            Err(response) => return response,
        };
        let caller = caller(&org_id, &user_email.user_id);
        match ent::links::resend(&caller, &request_id, &req).await {
            Ok(()) => axum::http::StatusCode::ACCEPTED.into_response(),
            Err(e) => super::slack_error(e),
        }
    }
    #[cfg(not(feature = "enterprise"))]
    {
        let _ = (org_id, request_id, user_email, body);
        not_supported()
    }
}

/// SlackMyLinks
#[utoipa::path(
    get,
    path = "/{org_id}/slack/links/me",
    context_path = "/api",
    tag = "Slack",
    operation_id = "SlackMyLinks",
    summary = "List my linked Slack accounts",
    description = "The caller's active links, with the workspace, the Slack display name and the default organization.",
    security(("Authorization" = [])),
    params(("org_id" = String, Path, description = "Any organization the caller belongs to")),
    responses(
        (status = 200, description = "`{\"links\": [{\"id\", \"team_name\", \"slack_display_name\", \"default_org_id\", \"link_method\", \"created_at\", \"last_used_at\"}]}`", content_type = "application/json", body = Object),
        (status = 403, description = "Not a member of this organization, or the OSS build", content_type = "application/json", body = ()),
        (status = 404, description = "Slack is not enabled for this organization", content_type = "application/json", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Slack", "operation": "list"})),
        ("x-o2-mcp" = json!({"enabled": false}))
    )
)]
pub async fn links_me(
    Path(org_id): Path<String>,
    Headers(user_email): Headers<UserEmail>,
) -> Response {
    #[cfg(feature = "enterprise")]
    {
        respond(ent::links::links_me(&caller(&org_id, &user_email.user_id)).await)
    }
    #[cfg(not(feature = "enterprise"))]
    {
        let _ = (org_id, user_email);
        not_supported()
    }
}

/// SlackDeleteLink
#[utoipa::path(
    delete,
    path = "/{org_id}/slack/links/{link_id}",
    context_path = "/api",
    tag = "Slack",
    operation_id = "SlackDeleteLink",
    summary = "Unlink a Slack account",
    description = "The owner unlinks their own link; an admin of this organization may unlink a member of it. The Slack user is not linked automatically again in that workspace.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("link_id" = String, Path, description = "Link id"),
    ),
    responses(
        (status = 204, description = "Unlinked"),
        (status = 403, description = "Not the owner and not an admin, or the OSS build", content_type = "application/json", body = ()),
        (status = 404, description = "Slack is not enabled for this organization, or no such link for this organization's members", content_type = "application/json", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Slack", "operation": "delete"})),
        ("x-o2-mcp" = json!({"enabled": false}))
    )
)]
pub async fn delete_link(
    Path((org_id, link_id)): Path<(String, String)>,
    Headers(user_email): Headers<UserEmail>,
) -> Response {
    #[cfg(feature = "enterprise")]
    {
        use axum::response::IntoResponse;

        let caller = caller(&org_id, &user_email.user_id);
        match ent::links::delete_link(&caller, &link_id).await {
            Ok(()) => axum::http::StatusCode::NO_CONTENT.into_response(),
            Err(e) => super::slack_error(e),
        }
    }
    #[cfg(not(feature = "enterprise"))]
    {
        let _ = (org_id, link_id, user_email);
        not_supported()
    }
}

/// SlackListLinks
#[utoipa::path(
    get,
    path = "/{org_id}/slack/links",
    context_path = "/api",
    tag = "Slack",
    operation_id = "SlackListLinks",
    summary = "List linked Slack accounts",
    description = "Active links of this organization's members only, 100 a page.",
    security(("Authorization" = [])),
    params(("org_id" = String, Path, description = "Organization name"), LinksQuery),
    responses(
        (status = 200, description = "`{\"links\": [{\"id\", \"slack_user_id\", \"user_email\", \"link_method\", \"created_at\", \"last_used_at\", \"default_org_is_this_org\"}], \"next_cursor\"}`", content_type = "application/json", body = Object),
        (status = 403, description = "Not an admin, or the OSS build", content_type = "application/json", body = ()),
        (status = 404, description = "Slack is not enabled for this organization, or the installation is not connected", content_type = "application/json", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Slack", "operation": "list"})),
        ("x-o2-mcp" = json!({"enabled": false}))
    )
)]
pub async fn list_links(
    Path(org_id): Path<String>,
    query: Result<Query<LinksQuery>, QueryRejection>,
    Headers(user_email): Headers<UserEmail>,
) -> Response {
    #[cfg(feature = "enterprise")]
    {
        let query = match parse_query(&org_id, query) {
            Ok(query) => query,
            Err(response) => return response,
        };
        let q = ent::links::LinksQuery {
            installation_id: query.installation_id.filter(|i| !i.is_empty()),
            cursor: query.cursor.filter(|c| !c.is_empty()),
        };
        respond(ent::links::list_links(&caller(&org_id, &user_email.user_id), &q).await)
    }
    #[cfg(not(feature = "enterprise"))]
    {
        let _ = (org_id, query, user_email);
        not_supported()
    }
}
