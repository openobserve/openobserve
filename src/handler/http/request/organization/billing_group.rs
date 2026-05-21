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

use axum::{Json, extract::Path, response::Response};
use o2_enterprise::enterprise::cloud::billing_invites;
use serde::Deserialize;
use utoipa::ToSchema;

use crate::{
    common::{meta::http::HttpResponse, utils::auth::UserEmail},
    handler::http::extractors::Headers,
};

#[derive(Deserialize, ToSchema)]
pub struct InviteRequest {
    org_id: String,
}

/// get invites for the org
#[utoipa::path(
    get,
    path = "/{org_id}/billing_group/invites",
    context_path = "/api",
    operation_id = "ListBillingGroupInvites",
    summary = "List invites for and from the org for billing groups",
    description = "List invites for and from the org for billing groups",
    responses(
        (
            status = 200,
            description = "Storage details",
            body = Object,
            content_type = "application/json",
        ),
    ),
    tag = "Organizations",
    extensions(
        ("x-o2-mcp" = json!({"enabled": false}))
    )
)]
pub async fn list_invites(Path(org_id): Path<String>) -> Response {
    match billing_invites::list_all_invites(&org_id).await {
        Ok(v) => HttpResponse::json(v),
        Err(e) => {
            log::error!("error listing billing group invites for org {org_id} : {e}");
            HttpResponse::internal_error(format!("error listing invites : {e}"))
        }
    }
}

/// invite an org as a member
#[utoipa::path(
    post,
    path = "/{org_id}/billing_group/invites",
    context_path = "/api",
    operation_id = "BillingGroupInvite",
    summary = "invite an org as a billing group member",
    description = "invite an org as a billing group member",
    request_body(
        content = inline(InviteRequest),
        description = "invite request body",
        content_type = "application/json",
    ),
    params(
        ("org_id" = String, Path, description = "Inviter Organization id"),
    ),
    responses(
        (
            status = 200,
            description = "Empty response",
            body = (),
            content_type = "application/json",
        ),
        (status = 400, description = "Invalid request", content_type = "application/json")
    ),
    tag = "Organizations",
    extensions(
        ("x-o2-mcp" = json!({"enabled": false}))
    )
)]
pub async fn invite(
    Headers(user_email): Headers<UserEmail>,
    Path(org_id): Path<String>,
    Json(body): Json<InviteRequest>,
) -> Response {
    let req = body;
    let user = user_email.user_id;

    if org_id == req.org_id {
        return HttpResponse::bad_request(format!("a org cannot send invite to itself"));
    }

    if let Err(e) = billing_invites::invite_org(&user, &org_id, &req.org_id).await {
        return HttpResponse::bad_request(format!("error in creating invite: {e}"));
    }

    HttpResponse::ok("successfully invited")
}

/// accept an invite as a member
#[utoipa::path(
    post,
    path = "/{org_id}/billing_group/invites/{token}/accept",
    context_path = "/api",
    operation_id = "AcceptBillingGroupInvite",
    summary = "accept an invite as a billing group member",
    description = "accept an invite as a billing group member",
    request_body(
        content = inline(()),
        description = "empty",
        content_type = "application/json",
    ),
    params(
        ("org_id" = String, Path, description = "Invitee Organization id"),
        ("token" = String, Path, description = "invite token"),
    ),
    responses(
        (
            status = 200,
            description = "Empty response",
            body = (),
            content_type = "application/json",
        ),
        (status = 400, description = "Invalid request", content_type = "application/json")
    ),
    tag = "Organizations",
    extensions(
        ("x-o2-mcp" = json!({"enabled": false}))
    )
)]
pub async fn accept(
    Headers(user_email): Headers<UserEmail>,
    Path((org_id, token)): Path<(String, String)>,
) -> Response {
    let user = user_email.user_id;

    if let Err(e) = billing_invites::accept_invite(user, &org_id, &token).await {
        return HttpResponse::bad_request(format!("error in accepting invite: {e}"));
    }
    HttpResponse::ok("successfully accepted")
}

/// reject an invite as a member
#[utoipa::path(
    delete,
    path = "/{org_id}/billing_group/invites/{token}/reject",
    context_path = "/api",
    operation_id = "RejectBillingGroupInvite",
    summary = "reject an invite as a billing group member",
    description = "reject an invite as a billing group member",
    request_body(
        content = inline(()),
        description = "empty",
        content_type = "application/json",
    ),
    params(
        ("org_id" = String, Path, description = "Invitee Organization id"),
        ("token" = String, Path, description = "invite token"),
    ),
    responses(
        (
            status = 200,
            description = "Empty response",
            body = (),
            content_type = "application/json",
        ),
        (status = 400, description = "Invalid request", content_type = "application/json")
    ),
    tag = "Organizations",
    extensions(
        ("x-o2-mcp" = json!({"enabled": false}))
    )
)]
pub async fn reject(
    Headers(user_email): Headers<UserEmail>,
    Path((org_id, token)): Path<(String, String)>,
) -> Response {
    let user = user_email.user_id;

    log::info!("user {user} has rejected billing org invite for org {org_id} with token {token}");

    if let Err(e) = billing_invites::reject_invite(&org_id, &token).await {
        return HttpResponse::bad_request(format!("error in accepting invite: {e}"));
    }
    HttpResponse::ok("successfully rejected")
}
