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
use o2_enterprise::enterprise::cloud::{billing_group, billing_invites, billing_invites::Status};
use openobserve_api_common::extractors::Headers;
use openobserve_core::auth::UserEmail;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use crate::common::meta::http::HttpResponse;

#[derive(Deserialize, ToSchema)]
pub struct InviteRequest {
    org_id: String,
}

#[derive(Serialize)]
pub struct MembershipResponse {
    membership: Option<MemberResponseItem>,
}

#[derive(Serialize)]
pub struct MemberResponseItem {
    id: i32,
    payer_org_id: String,
    payer_org_name: String,
    member_org_id: String,
    member_org_name: String,
    created_at: i64,
    created_by: String,
    accepted_by: Option<String>,
}

#[derive(Serialize)]
pub struct InviteResponseItem {
    id: i32,
    inviter_org_id: String,
    inviter_org_name: String,
    invitee_org_id: String,
    invitee_org_name: String,
    inviter_id: String,
    created_at: i64,
    expires_at: i64,
    status: Status,
    token: String,
}

async fn get_org_name(org_id: &str) -> String {
    let info = openobserve_core::organization::get_org(org_id).await;
    info.map(|v| v.name).unwrap_or("".to_string())
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
        Ok(v) => {
            let mut res = Vec::with_capacity(v.len());
            for invite in v {
                let inviter_org_name = get_org_name(&invite.inviter_org_id).await;
                let invitee_org_name = get_org_name(&invite.invitee_org_id).await;
                res.push(InviteResponseItem {
                    id: invite.id,
                    inviter_org_id: invite.inviter_org_id,
                    inviter_org_name,
                    invitee_org_id: invite.invitee_org_id,
                    invitee_org_name,
                    inviter_id: invite.inviter_id,
                    created_at: invite.created_at,
                    expires_at: invite.expires_at,
                    status: invite.status,
                    token: invite.token,
                })
            }
            HttpResponse::json(res)
        }
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
        return HttpResponse::bad_request("a org cannot send invite to itself".to_string());
    }

    let o2cfg = o2_enterprise::enterprise::common::config::get_config();

    if o2cfg
        .cloud
        .billing_group_allowed_orgs
        .split(",")
        .find(|v| *v == org_id)
        .is_none()
    {
        return HttpResponse::bad_request("billing group is not enabled for this org".to_string());
    }

    let org_info = openobserve_core::organization::get_org(&req.org_id).await;
    if org_info.is_none() {
        return HttpResponse::bad_request(format!("org with org_id {} does not exist", req.org_id));
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

/// remove a member org from own billing group
#[utoipa::path(
    delete,
    path = "/{org_id}/billing_group/members/{member_org_id}",
    context_path = "/api",
    operation_id = "RemoveBillingGroupMember",
    summary = "remove a member org from own billing group",
    description = "remove a member org from own billing group, the member becomes a free org",
    params(
        ("org_id" = String, Path, description = "Payer Organization id"),
        ("member_org_id" = String, Path, description = "Member Organization id"),
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
pub async fn remove_member(
    Headers(user_email): Headers<UserEmail>,
    Path((org_id, member_org_id)): Path<(String, String)>,
) -> Response {
    let user = user_email.user_id;

    log::info!("user {user} is removing org {member_org_id} from billing group of org {org_id}");

    if let Err(e) = billing_group::remove_billing_member(&org_id, &member_org_id).await {
        return HttpResponse::bad_request(format!("error in removing member: {e}"));
    }
    HttpResponse::ok("successfully removed")
}

/// leave own billing group as a member
#[utoipa::path(
    delete,
    path = "/{org_id}/billing_group/membership",
    context_path = "/api",
    operation_id = "LeaveBillingGroup",
    summary = "leave own billing group as a member",
    description = "leave own billing group as a member, the org becomes a free org",
    params(
        ("org_id" = String, Path, description = "Member Organization id"),
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
pub async fn leave_group(
    Headers(user_email): Headers<UserEmail>,
    Path(org_id): Path<String>,
) -> Response {
    let user = user_email.user_id;

    let membership = match billing_group::list_billing_membership_of(&org_id).await {
        Ok(Some(m)) => m,
        Ok(None) => {
            return HttpResponse::bad_request("org is not part of a billing group".to_string());
        }
        Err(e) => return HttpResponse::bad_request(format!("error in leaving billing group: {e}")),
    };

    log::info!(
        "user {user} is removing org {org_id} from billing group of org {}",
        membership.payer_org_id
    );

    if let Err(e) = billing_group::remove_billing_member(&membership.payer_org_id, &org_id).await {
        return HttpResponse::bad_request(format!("error in leaving billing group: {e}"));
    }
    HttpResponse::ok("successfully left")
}

/// get own membership
#[utoipa::path(
    get,
    path = "/{org_id}/billing_group/membership",
    context_path = "/api",
    operation_id = "GetBIllingGRoupMembership",
    summary = "get info about own billing group membership",
    description = "get info about own billing group membership",
    request_body(
        content = inline(()),
        description = "empty",
        content_type = "application/json",
    ),
    params(
        ("org_id" = String, Path, description = "Organization id"),
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
pub async fn check_membership(Path(org_id): Path<String>) -> Response {
    match billing_group::list_billing_membership_of(&org_id).await {
        Ok(Some(membership)) => {
            let payer_org_name = get_org_name(&membership.payer_org_id).await;
            let member_org_name = get_org_name(&membership.member_org_id).await;
            HttpResponse::json(MembershipResponse {
                membership: Some(MemberResponseItem {
                    id: membership.id,
                    payer_org_id: membership.payer_org_id,
                    payer_org_name,
                    member_org_id: membership.member_org_id,
                    member_org_name,
                    created_at: membership.created_at,
                    created_by: membership.created_by,
                    accepted_by: membership.accepted_by,
                }),
            })
        }
        Ok(None) => HttpResponse::json(MembershipResponse { membership: None }),
        Err(e) => {
            log::error!("error checking billing group membership for {org_id} : {e}");
            HttpResponse::internal_error(format!("error in checking membership : {e}"))
        }
    }
}

/// get members of self
#[utoipa::path(
    get,
    path = "/{org_id}/billing_group/members",
    context_path = "/api",
    operation_id = "GetBIllingGRoupMembers",
    summary = "get info about members of own billing group",
    description = "get info about members of own billing group",
    request_body(
        content = inline(()),
        description = "empty",
        content_type = "application/json",
    ),
    params(
        ("org_id" = String, Path, description = "Organization id"),
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
pub async fn check_members(Path(org_id): Path<String>) -> Response {
    let payer_org_name = get_org_name(&org_id).await;

    match billing_group::list_billing_group_members_of(&org_id).await {
        Ok(members) => {
            let mut res = Vec::with_capacity(members.len());
            for member in members {
                let member_org_name = get_org_name(&member.member_org_id).await;
                res.push(MemberResponseItem {
                    id: member.id,
                    payer_org_id: member.payer_org_id,
                    payer_org_name: payer_org_name.clone(),
                    member_org_id: member.member_org_id,
                    member_org_name,
                    created_at: member.created_at,
                    created_by: member.created_by,
                    accepted_by: member.accepted_by,
                });
            }
            HttpResponse::json(res)
        }
        Err(e) => {
            log::error!("error checking billing group members for {org_id} : {e}");
            HttpResponse::internal_error(format!("error in checking members : {e}"))
        }
    }
}

#[cfg(test)]
mod tests {
    use axum::http::StatusCode;
    use config::meta::organization::OrganizationType;
    use svix_ksuid::{Ksuid, KsuidLike};

    use super::*;

    const USER: &str = "billing-group-handler-test@zo.dev";

    async fn db() {
        static ONCE: tokio::sync::OnceCell<()> = tokio::sync::OnceCell::const_new();
        ONCE.get_or_init(|| async {
            // The cloud config check panics on empty values; the migrations read that config.
            // SAFETY: the single-threaded body of a `OnceCell` initialiser, before the refresh.
            unsafe {
                for key in [
                    "O2_STRIPE_SECRET_KEY",
                    "O2_STRIPE_WEBHOOK_SECRET",
                    "O2_AZURE_TENANT_ID",
                    "O2_AZURE_CLIENT_ID",
                    "O2_AZURE_CLIENT_SECRET",
                ] {
                    std::env::set_var(key, "test");
                }
            }
            o2_enterprise::enterprise::common::config::refresh_config().unwrap();
            std::fs::create_dir_all(&config::get_config().common.data_db_dir).unwrap();
            infra::db_init().await.unwrap();
            infra::table::migrate().await.unwrap();
            o2_enterprise::enterprise::cloud::migrate().await.unwrap();
            // `customer_billings` has foreign keys to `users` and `organizations`.
            if infra::table::users::get(USER).await.is_err() {
                infra::table::users::add(infra::table::users::UserRecord {
                    email: USER.to_string(),
                    first_name: "billing".to_string(),
                    last_name: "group".to_string(),
                    password: "hash".to_string(),
                    salt: "salt".to_string(),
                    is_root: false,
                    password_ext: None,
                    user_type: config::meta::user::UserType::Internal,
                    created_at: 0,
                    updated_at: 0,
                    must_reset_password: false,
                    password_reset_reason: None,
                    flagged_at: None,
                    password_updated_at: None,
                })
                .await
                .unwrap();
            }
        })
        .await;
    }

    /// Fresh org ids per test; `linked` puts the member in the payer's group.
    async fn orgs(name: &str, linked: bool) -> (String, String) {
        db().await;
        let id = Ksuid::new(None, None).to_string();
        let (payer, member) = (format!("payer_{name}_{id}"), format!("member_{name}_{id}"));
        for org in [&payer, &member] {
            infra::table::organizations::add(org, org, OrganizationType::Custom)
                .await
                .unwrap();
        }
        if linked {
            billing_group::add_as_billing_member(USER, &payer, &member, None)
                .await
                .unwrap();
        }
        (payer, member)
    }

    fn user() -> Headers<UserEmail> {
        Headers(UserEmail {
            user_id: USER.to_string(),
        })
    }

    #[tokio::test]
    async fn test_remove_member_by_payer_returns_ok() {
        let (payer, member) = orgs("remove_ok", true).await;

        let response = remove_member(user(), Path((payer, member.clone()))).await;

        assert_eq!(response.status(), StatusCode::OK);
        let membership = billing_group::list_billing_membership_of(&member).await;
        assert!(membership.unwrap().is_none());
    }

    #[tokio::test]
    async fn test_remove_member_by_other_org_returns_bad_request() {
        let (payer, member) = orgs("remove_other", true).await;
        let (other, _) = orgs("remove_other_payer", false).await;

        let response = remove_member(user(), Path((other, member.clone()))).await;

        assert_eq!(response.status(), StatusCode::BAD_REQUEST);
        let membership = billing_group::list_billing_membership_of(&member).await;
        assert_eq!(membership.unwrap().unwrap().payer_org_id, payer);
    }

    #[tokio::test]
    async fn test_leave_group_by_member_returns_ok() {
        let (_, member) = orgs("leave_ok", true).await;

        let response = leave_group(user(), Path(member.clone())).await;

        assert_eq!(response.status(), StatusCode::OK);
        let membership = billing_group::list_billing_membership_of(&member).await;
        assert!(membership.unwrap().is_none());
    }

    #[tokio::test]
    async fn test_leave_group_by_standalone_org_returns_bad_request() {
        let (_, standalone) = orgs("leave_standalone", false).await;

        let response = leave_group(user(), Path(standalone)).await;

        assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    }
}
