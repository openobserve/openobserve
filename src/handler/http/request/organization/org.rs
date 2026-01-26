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

use std::collections::{HashMap, HashSet};

use axum::{
    Json,
    extract::{Path, Query},
    response::{IntoResponse, Response},
};
use config::meta::cluster::NodeInfo;
#[cfg(feature = "enterprise")]
use o2_enterprise::enterprise::common::config::get_config as get_o2_config;
#[cfg(feature = "cloud")]
use {
    crate::common::meta::organization::OrganizationInvites,
    crate::common::meta::organization::{
        AllOrgListDetails, AllOrganizationResponse, ExtendTrialPeriodRequest,
        OrganizationInviteUserRecord,
    },
    axum::body::Body,
    axum::http::StatusCode,
    o2_enterprise::enterprise::cloud::list_customer_billings,
};

use crate::{
    common::{
        meta::{
            http::HttpResponse as MetaHttpResponse,
            organization::{
                ClusterInfo, ClusterInfoResponse, NodeListResponse, OrgDetails, OrgRenameBody,
                OrgUser, Organization, OrganizationCreationResponse, OrganizationResponse,
                PasscodeResponse, RumIngestionResponse, THRESHOLD,
            },
        },
        utils::auth::{UserEmail, is_root_user},
    },
    handler::http::extractors::Headers,
    service::organization::{self, get_passcode, get_rum_token, update_passcode, update_rum_token},
};

/// GetOrganizations

#[utoipa::path(
    get,
    path = "/organizations",
    context_path = "/api",
    tag = "Organizations",
    operation_id = "GetUserOrganizations",
    summary = "Get user's organizations",
    description = "Retrieves a list of all organizations that the authenticated user has access to, including organization details, permissions, and subscription information. Root users can see all organizations in the system.",
    security(
        ("Authorization"= [])
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = inline(OrganizationResponse)),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Organizations", "operation": "list"})),
        ("x-o2-mcp" = json!({"description": "Get user organizations", "category": "users"}))
    )
)]
pub async fn organizations(
    Headers(user_email): Headers<UserEmail>,
    Query(query): Query<HashMap<String, String>>,
) -> Response {
    let user_id = user_email.user_id.as_str();
    let mut id = 0;

    let mut orgs: Vec<OrgDetails> = vec![];
    let mut org_names = HashSet::new();
    let user_detail = OrgUser {
        first_name: "".to_string(),
        last_name: "".to_string(),
        email: user_id.to_string(),
    };

    let limit = query
        .get("page_size")
        .unwrap_or(&"100".to_string())
        .parse::<i64>()
        .ok();
    let is_root_user = is_root_user(user_id);
    let all_orgs = if is_root_user {
        let Ok(records) = organization::list_all_orgs(limit).await else {
            return MetaHttpResponse::internal_error("Something went wrong");
        };
        records
    } else {
        let Ok(records) = organization::list_orgs_by_user(user_id).await else {
            return MetaHttpResponse::not_found("Something went wrong");
        };
        records
    };

    #[cfg(feature = "cloud")]
    let all_subscriptions = match list_customer_billings().await {
        Ok(orgs) => orgs
            .into_iter()
            .map(|cb| (cb.org_id, cb.subscription_type as i32))
            .collect::<HashMap<_, _>>(),
        Err(e) => {
            return MetaHttpResponse::internal_error(e.to_string());
        }
    };

    for org in all_orgs {
        id += 1;
        #[cfg(feature = "cloud")]
        let org_subscription: i32 = all_subscriptions
            .get(&org.identifier)
            .cloned()
            .unwrap_or_default();
        #[cfg(not(feature = "cloud"))]
        let org_subscription = 0;
        let org = OrgDetails {
            id,
            identifier: org.identifier.clone(),
            name: org.name,
            user_email: user_id.to_string(),
            ingest_threshold: THRESHOLD,
            search_threshold: THRESHOLD,
            org_type: org.org_type,
            user_obj: user_detail.clone(),
            plan: org_subscription,
        };
        if !org_names.contains(&org.identifier) {
            org_names.insert(org.identifier.clone());
            orgs.push(org)
        }
    }
    orgs.sort_by(|a, b| a.name.cmp(&b.name));
    let org_response = OrganizationResponse { data: orgs };

    MetaHttpResponse::json(org_response)
}

#[cfg(feature = "cloud")]
#[utoipa::path(
    get,
    path = "/{org_id}/organizations",
    context_path = "/api",
    tag = "Organizations",
    operation_id = "GetAllOrganizations",
    summary = "Get all organizations (meta only)",
    description = "Retrieves a comprehensive list of all organizations in the system with detailed information including subscription types, trial periods, and creation dates. Only accessible through the '_meta' organization for administrative purposes.",
    security(
        ("Authorization"= [])
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = inline(AllOrganizationResponse)),
    )
)]
pub async fn all_organizations(
    Path(org_id): Path<String>,
    Query(query): Query<HashMap<String, String>>,
) -> Response {
    let org = org_id;
    if org != "_meta" {
        return MetaHttpResponse::unauthorized("not authorized to access this resource");
    }

    let mut orgs = vec![];
    let mut org_names = HashSet::new();
    let limit = query
        .get("page_size")
        .unwrap_or(&"100".to_string())
        .parse::<i64>()
        .ok();

    let filter = infra::table::organizations::ListFilter::with_limit(limit);
    let all_orgs = match infra::table::organizations::list(filter).await {
        Ok(orgs) => orgs,
        Err(e) => {
            return MetaHttpResponse::internal_error(e.to_string());
        }
    };

    let all_subscriptions = match list_customer_billings().await {
        Ok(orgs) => orgs
            .into_iter()
            .map(|cb| (cb.org_id, cb.subscription_type as i32))
            .collect::<HashMap<_, _>>(),
        Err(e) => {
            return MetaHttpResponse::internal_error(e.to_string());
        }
    };

    let mut id = 1;
    for org in all_orgs {
        let org = AllOrgListDetails {
            id,
            identifier: org.identifier.clone(),
            name: org.org_name,
            org_type: org.org_type.to_string(),
            plan: all_subscriptions
                .get(&org.identifier)
                .cloned()
                .unwrap_or_default(),
            created_at: org.created_at,
            updated_at: org.updated_at,
            trial_expires_at: Some(org.trial_ends_at),
        };
        if !org_names.contains(&org.identifier) {
            org_names.insert(org.identifier.clone());
            orgs.push(org);
            id += 1;
        }
    }
    orgs.sort_by(|a, b| a.name.cmp(&b.name));
    let org_response = AllOrganizationResponse { data: orgs };

    MetaHttpResponse::json(org_response)
}

/// GetOrganizationSummary

#[utoipa::path(
    get,
    path = "/{org_id}/summary",
    context_path = "/api",
    tag = "Organizations",
    operation_id = "GetOrganizationSummary",
    summary = "Get organization summary",
    description = "Retrieves comprehensive summary statistics and information about an organization including data ingestion metrics, storage usage, stream counts, and other key performance indicators useful for monitoring organization health and usage.",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
      ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = Object),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Summary", "operation": "get"})),
        ("x-o2-mcp" = json!({"description": "Get organization summary", "category": "organizations"}))
    )
)]
pub async fn org_summary(Path(org_id): Path<String>) -> impl IntoResponse {
    let org = org_id;
    let org_summary = organization::get_summary(&org).await;
    Json(org_summary)
}

/// GetIngestToken

#[utoipa::path(
    get,
    path = "/{org_id}/passcode",
    context_path = "/api",
    tag = "Organizations",
    operation_id = "GetOrganizationUserIngestToken",
    summary = "Get user's ingestion token",
    description = "Retrieves the current ingestion token (passcode) for the authenticated user within the specified organization. This token is used to authenticate data ingestion requests and can be used with various ingestion endpoints.",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
      ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = inline(PasscodeResponse)),
        (status = 404, description = "NotFound", content_type = "application/json", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Ingestion Token", "operation": "get"})),
        ("x-o2-mcp" = json!({"enabled": false}))
    )
)]
pub async fn get_user_passcode(
    Headers(user_email): Headers<UserEmail>,
    Path(org_id): Path<String>,
) -> Response {
    let org = org_id;
    let user_id = user_email.user_id.as_str();
    let mut org_id = Some(org.as_str());
    if is_root_user(user_id) {
        org_id = None;
    }
    match get_passcode(org_id, user_id).await {
        Ok(passcode) => MetaHttpResponse::json(PasscodeResponse { data: passcode }),
        Err(e) => MetaHttpResponse::not_found(e),
    }
}

/// UpdateIngestToken

#[utoipa::path(
    put,
    path = "/{org_id}/passcode",
    context_path = "/api",
    tag = "Organizations",
    operation_id = "UpdateOrganizationUserIngestToken",
    summary = "Update user's ingestion token",
    description = "Generates a new ingestion token (passcode) for the authenticated user within the specified organization. The old token will be invalidated and all ingestion processes using the old token will need to be updated with the new token.",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
      ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = inline(PasscodeResponse)),
        (status = 404, description = "NotFound", content_type = "application/json", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Ingestion Token", "operation": "update"})),
        ("x-o2-mcp" = json!({"enabled": false}))
    )
)]
pub async fn update_user_passcode(
    Headers(user_email): Headers<UserEmail>,
    Path(org_id): Path<String>,
) -> Response {
    let org = org_id;
    let user_id = user_email.user_id.as_str();
    let mut org_id = Some(org.as_str());
    if is_root_user(user_id) {
        org_id = None;
    }
    match update_passcode(org_id, user_id).await {
        Ok(passcode) => MetaHttpResponse::json(PasscodeResponse { data: passcode }),
        Err(e) => MetaHttpResponse::not_found(e),
    }
}

/// GetRumIngestToken

#[utoipa::path(
    get,
    path = "/{org_id}/rumtoken",
    context_path = "/api",
    tag = "Organizations",
    operation_id = "GetOrganizationUserRumIngestToken",
    summary = "Get user's RUM ingestion token",
    description = "Retrieves the current Real User Monitoring (RUM) ingestion token for the authenticated user within the specified organization. This token is specifically used for ingesting RUM data from web applications and mobile apps.",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
      ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = inline(RumIngestionResponse)),
        (status = 404, description = "NotFound", content_type = "application/json", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Rumtokens", "operation": "get"})),
        ("x-o2-mcp" = json!({"enabled": false}))
    )
)]
pub async fn get_user_rumtoken(
    Headers(user_email): Headers<UserEmail>,
    Path(org_id): Path<String>,
) -> Response {
    let org = org_id;
    let user_id = user_email.user_id.as_str();
    let mut org_id = Some(org.as_str());
    if is_root_user(user_id) {
        org_id = None;
    }
    match get_rum_token(org_id, user_id).await {
        Ok(rumtoken) => MetaHttpResponse::json(RumIngestionResponse { data: rumtoken }),
        Err(e) => MetaHttpResponse::not_found(e),
    }
}

/// UpdateRumIngestToken

#[utoipa::path(
    put,
    path = "/{org_id}/rumtoken",
    context_path = "/api",
    tag = "Organizations",
    operation_id = "UpdateOrganizationUserRumIngestToken",
    summary = "Update user's RUM ingestion token",
    description = "Generates a new Real User Monitoring (RUM) ingestion token for the authenticated user within the specified organization. The old RUM token will be invalidated and all RUM data collection processes using the old token will need to be updated.",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
      ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = inline(RumIngestionResponse)),
        (status = 404, description = "NotFound", content_type = "application/json", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Rumtokens", "operation": "update"})),
        ("x-o2-mcp" = json!({"enabled": false}))
    )
)]
pub async fn update_user_rumtoken(
    Headers(user_email): Headers<UserEmail>,
    Path(org_id): Path<String>,
) -> Response {
    let org = org_id;
    let user_id = user_email.user_id.as_str();
    let mut org_id = Some(org.as_str());
    if is_root_user(user_id) {
        org_id = None;
    }
    match update_rum_token(org_id, user_id).await {
        Ok(rumtoken) => MetaHttpResponse::json(RumIngestionResponse { data: rumtoken }),
        Err(e) => MetaHttpResponse::not_found(e),
    }
}

/// CreateRumIngestToken

#[utoipa::path(
    post,
    path = "/{org_id}/rumtoken",
    context_path = "/api",
    tag = "Organizations",
    operation_id = "CreateOrganizationUserRumIngestToken",
    summary = "Create user's RUM ingestion token",
    description = "Creates a new Real User Monitoring (RUM) ingestion token for the authenticated user within the specified organization. This endpoint is used when no RUM token exists yet and you need to generate the initial token for RUM data collection.",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
      ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = inline(RumIngestionResponse)),
        (status = 404, description = "NotFound", content_type = "application/json", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Rumtokens", "operation": "create"})),
        ("x-o2-mcp" = json!({"enabled": false}))
    )
)]
pub async fn create_user_rumtoken(
    Headers(user_email): Headers<UserEmail>,
    Path(org_id): Path<String>,
) -> Response {
    let org = org_id;
    let user_id = user_email.user_id.as_str();
    let mut org_id = Some(org.as_str());
    if is_root_user(user_id) {
        org_id = None;
    }
    match update_rum_token(org_id, user_id).await {
        Ok(rumtoken) => MetaHttpResponse::json(RumIngestionResponse { data: rumtoken }),
        Err(e) => MetaHttpResponse::not_found(e),
    }
}

/// CreateOrganization

#[utoipa::path(
    post,
    path = "/organizations",
    context_path = "/api",
    tag = "Organizations",
    operation_id = "CreateOrganization",
    summary = "Create new organization",
    description = "Creates a new organization with the specified configuration and settings. The authenticated user will be automatically added as an owner of the newly created organization and can then invite other users and configure the organization. If the creator is a service account, the response will include the service account's token for the newly created organization, enabling automated workflows to immediately access the new organization without additional token retrieval steps.",
    security(
        ("Authorization"= [])
    ),
    request_body(content = inline(Organization), description = "Organization data", content_type = "application/json"),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = inline(OrganizationCreationResponse)),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Organizations", "operation": "create"})),
        ("x-o2-mcp" = json!({"description": "Create an organization", "category": "organizations"}))
    )
)]
pub async fn create_org(
    Headers(user_email): Headers<UserEmail>,
    Json(org): Json<Organization>,
) -> Response {
    let mut org = org;

    let result = organization::create_org(&mut org, &user_email.user_id).await;
    match result {
        Ok((created_org, service_account_info)) => {
            use crate::common::meta::organization::OrganizationCreationResponse;
            let response = OrganizationCreationResponse {
                organization: created_org,
                service_account: service_account_info,
            };
            MetaHttpResponse::json(response)
        }
        Err(err) => MetaHttpResponse::bad_request(err),
    }
}

#[cfg(feature = "cloud")]
#[utoipa::path(
    put,
    path = "/{org_id}/extend_trial_period",
    context_path = "/api",
    tag = "Organizations",
    operation_id = "ExtendTrialPeriod",
    summary = "Extend organization trial period",
    description = "Extends the trial period for a specified organization to a new end date. This administrative endpoint allows extending trial periods for organizations, giving them more time to evaluate the service before requiring a paid subscription.",
    security(
        ("Authorization"= [])
    ),
    request_body(content = inline(ExtendTrialPeriodRequest), description = "Extend free trial request", content_type = "application/json"),
    responses(
        (status = 200, description = "Success", content_type = "text", body = String),
    ),
    extensions(
        ("x-o2-mcp" = json!({"enabled": false}))
    )
)]
pub async fn extend_trial_period(
    Path(org_id): Path<String>,
    Json(req): Json<ExtendTrialPeriodRequest>,
) -> Response {
    use crate::service::db::organization::ORG_KEY_PREFIX;

    let org = org_id;
    if org != "_meta" {
        return MetaHttpResponse::unauthorized("not authorized to access this resource");
    }

    let org = match infra::table::organizations::get(&req.org_id).await {
        Ok(org) => org,
        Err(e) => {
            return MetaHttpResponse::not_found(e.to_string());
        }
    };
    if org.trial_ends_at > req.new_end_date {
        return MetaHttpResponse::bad_request("Existing trial end date is after the provided date");
    }

    let ret = match infra::table::organizations::set_trial_period_end(&req.org_id, req.new_end_date)
        .await
    {
        Ok(_) => axum::response::Response::builder()
            .status(StatusCode::OK)
            .body(Body::from("success"))
            .unwrap(),
        Err(err) => {
            return MetaHttpResponse::bad_request(err.to_string());
        }
    };

    let key = format!("{ORG_KEY_PREFIX}{}", req.org_id);
    let _ = infra::db::put_into_db_coordinator(&key, Default::default(), true, None).await;
    ret
}

/// RenameOrganization
#[utoipa::path(
    put,
    path = "/{org_id}/rename",
    context_path = "/api",
    tag = "Organizations",
    operation_id = "RenameOrganization",
    summary = "Rename organization",
    description = "Changes the display name of an organization. The organization identifier remains unchanged, but the human-readable name is updated. This helps with organization management and branding without affecting API integrations or data access.",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization id"),
    ),
    request_body(content = inline(OrgRenameBody), description = "Organization new name", content_type = "application/json"),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = inline(Organization)),
    )
)]
pub async fn rename_org(
    Headers(user_email): Headers<UserEmail>,
    Path(path): Path<String>,
    Json(new_name): Json<OrgRenameBody>,
) -> Response {
    let org = path;
    let new_name = new_name.new_name;
    if new_name.is_empty() {
        return MetaHttpResponse::bad_request("New name cannot be empty");
    }

    let result = organization::rename_org(&org, &new_name, &user_email.user_id).await;
    match result {
        Ok(org) => MetaHttpResponse::json(org),
        Err(err) => MetaHttpResponse::bad_request(err),
    }
}

/// InviteOrganizationMembers
#[cfg(feature = "cloud")]
#[utoipa::path(
    get,
    path = "/{org_id}/invites",
    context_path = "/api",
    tag = "Organizations",
    operation_id = "GetOrganizationMemberInvites",
    summary = "Get pending organization invites",
    description = "Retrieves a list of all pending invitations for the organization. Shows invitations that have been sent but not yet accepted, allowing administrators to track and manage the invitation process for new team members.",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization id"),
      ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = inline(OrganizationInviteUserRecord)),
    )
)]
pub async fn get_org_invites(Path(path): Path<String>) -> Response {
    use crate::common::meta::user::InviteStatus;

    let org = path;

    let result = organization::get_invitations_for_org(&org).await;
    match result {
        Ok(result) => {
            let result: Vec<_> = result
                .into_iter()
                .filter(|invite| invite.status == InviteStatus::Pending)
                .collect();
            MetaHttpResponse::json(result)
        }
        Err(err) => MetaHttpResponse::bad_request(err),
    }
}

/// InviteOrganizationMembers
#[cfg(feature = "cloud")]
#[utoipa::path(
    post,
    path = "/{org_id}/invites",
    context_path = "/api",
    tag = "Organizations",
    operation_id = "InviteOrganizationMembers",
    summary = "Invite users to organization",
    description = "Sends invitations to one or more users to join the organization. Invited users will receive email invitations with links to accept and join the organization with the specified roles and permissions.",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization id"),
      ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = inline(Organization)),
    )
)]
pub async fn generate_org_invite(
    Headers(user_email): Headers<UserEmail>,
    Path(path): Path<String>,
    Json(invites): Json<OrganizationInvites>,
) -> Response {
    let org = path;

    let result = organization::generate_invitation(&org, &user_email.user_id, invites).await;
    match result {
        Ok(org) => MetaHttpResponse::json(org),
        Err(err) => MetaHttpResponse::bad_request(err),
    }
}

/// RemoveOrganizationInvite
#[cfg(feature = "cloud")]
#[utoipa::path(
    delete,
    path = "/{org_id}/invites/{token}",
    context_path = "/api",
    tag = "Organizations",
    operation_id = "RemoveOrganizationInvite",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization id"),
        ("id" = String, Path, description = "invitation token"),
      ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = inline(Organization)),
    )
)]
pub async fn delete_org_invite(Path(path): Path<(String, String)>) -> Response {
    let (org_id, token) = path;

    let result = organization::delete_invite_by_token(&org_id, &token).await;
    match result {
        Ok(_) => MetaHttpResponse::json("success"),
        Err(err) => MetaHttpResponse::bad_request(err),
    }
}
/// AcceptOrganizationInvite
#[cfg(feature = "cloud")]
#[utoipa::path(
    put,
    path = "/{org_id}/member_subscription/{invite_token}",
    context_path = "/api",
    tag = "Organizations",
    operation_id = "AcceptOrganizationInvite",
    summary = "Accept organization invitation",
    description = "Accepts a pending organization invitation using the invitation token received via email. This adds the user to the organization with the roles and permissions specified in the original invitation.",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization id"),
        ("invite_token" = String, Path, description = "The token sent to the user"),
      ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = inline(Organization)),
    )
)]
pub async fn accept_org_invite(
    Headers(user_email): Headers<UserEmail>,
    Path(path): Path<(String, String)>,
) -> Response {
    let (_org, invite_token) = path;

    let result = organization::accept_invitation(&user_email.user_id, &invite_token).await;
    match result {
        Ok(_) => MetaHttpResponse::ok("Invitation accepted successfully"),
        Err(err) => MetaHttpResponse::bad_request(err),
    }
}

/// GetNodeList
///
/// This endpoint returns a hierarchical list of all nodes in the OpenObserve cluster organized by
/// regions and clusters, along with node details including versions and other essential
/// information. It can be useful for:
///
/// - Monitoring which nodes are online/offline in a distributed deployment
/// - Checking version consistency across the cluster
/// - Identifying nodes by their roles
/// - Filtering nodes by region when using a multi-region setup
///
/// NOTE: This endpoint is only accessible through the "_meta" organization and requires
/// the user to have access to this special organization.
#[utoipa::path(
    get,
    path = "/{org_id}/node/list",
    context_path = "/api",
    tag = "Organizations",
    operation_id = "GetMetaOrganizationNodeList",
    summary = "Get cluster node list",
    description = "Retrieves a hierarchical list of all nodes in the OpenObserve cluster organized by regions and clusters, with detailed information about each node including versions and roles. Useful for monitoring cluster health and managing distributed deployments.",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Must be '_meta'"),
        ("regions" = String, Query, description = "Optional comma-separated list of regions to filter by (e.g., 'us-east-1,us-west-2')")
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = inline(NodeListResponse)),
        (status = 403, description = "Forbidden - Not the _meta organization", content_type = "application/json", body = ()),
        (status = 404, description = "NotFound", content_type = "application/json", body = ()),
    ),
    extensions(
        ("x-o2-mcp" = json!({"enabled": false}))
    )
)]
pub async fn node_list(
    Path(org_id): Path<String>,
    Query(query): Query<std::collections::HashMap<String, String>>,
) -> Response {
    node_list_impl(&org_id, query).await
}

pub async fn node_list_impl(
    org_id: &str,
    query: std::collections::HashMap<String, String>,
) -> Response {
    // Ensure this API is only available for the "_meta" organization
    if org_id != config::META_ORG_ID {
        return MetaHttpResponse::forbidden(
            "This API is only available for the _meta organization",
        );
    }

    // Extract regions from query params
    let _regions = query.get("regions").map_or_else(Vec::new, |regions_str| {
        regions_str
            .split(',')
            .filter(|s| !s.is_empty())
            .map(String::from)
            .collect()
    });

    // Configure and populate the response based on environment
    #[cfg(feature = "enterprise")]
    let mut response = if get_o2_config().super_cluster.enabled {
        // Super cluster is enabled, get nodes from super cluster
        match get_super_cluster_nodes(&_regions).await {
            Ok(response) => response,
            Err(e) => return MetaHttpResponse::bad_request(e),
        }
    } else {
        // Super cluster not enabled, get local nodes
        get_local_nodes().await
    };

    #[cfg(not(feature = "enterprise"))]
    let mut response = get_local_nodes().await;

    // Sort the nodes by id
    for region in response.regions.values_mut() {
        for cluster in region.clusters.values_mut() {
            cluster.sort_by_key(|node| node.id);
        }
    }

    // Return the nested response
    MetaHttpResponse::json(response)
}

/// GetClusterInfo
///
/// This endpoint returns detailed information about the OpenObserve cluster, organized by
/// regions and clusters. It provides comprehensive visibility into cluster status and can be used
/// for:
///
/// - Monitoring cluster health and status across regions
/// - Viewing current workload information including pending jobs
/// - Identifying potential bottlenecks or issues
/// - Checking resource utilization across nodes
/// - Filtering information by region when using a multi-region setup
///
/// NOTE: This endpoint is only accessible through the "_meta" organization and requires
/// the user to have access to this special organization.
#[utoipa::path(
    get,
    path = "/{org_id}/cluster/info",
    context_path = "/api",
    tag = "Organizations",
    operation_id = "GetMetaOrganizationClusterInfo",
    summary = "Get cluster information",
    description = "Retrieves comprehensive information about the OpenObserve cluster organized by regions and clusters, including workload information, pending jobs, and resource utilization metrics. Essential for monitoring cluster performance and identifying bottlenecks.",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Must be '_meta'"),
        ("regions" = String, Query, description = "Optional comma-separated list of regions to filter by (e.g., 'us-east-1,us-west-2')")
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = inline(ClusterInfoResponse)),
        (status = 403, description = "Forbidden - Not the _meta organization", content_type = "application/json", body = ()),
        (status = 404, description = "NotFound", content_type = "application/json", body = ()),
    ),
    extensions(
        ("x-o2-mcp" = json!({"enabled": false}))
    )
)]
pub async fn cluster_info(
    Path(org_id): Path<String>,
    Query(query): Query<std::collections::HashMap<String, String>>,
) -> Response {
    let org = org_id;

    // Ensure this API is only available for the "_meta" organization
    if org != config::META_ORG_ID {
        return MetaHttpResponse::forbidden(
            "This API is only available for the _meta organization",
        );
    }

    // Extract regions from query params
    let _regions = query.get("regions").map_or_else(Vec::new, |regions_str| {
        regions_str
            .split(',')
            .filter(|s| !s.is_empty())
            .map(String::from)
            .collect()
    });

    // Configure and populate the response based on environment
    #[cfg(feature = "enterprise")]
    let cluster_info_response = if get_o2_config().super_cluster.enabled {
        // Super cluster is enabled, get info from super cluster
        match get_super_cluster_info(&_regions).await {
            Ok(resp) => resp,
            Err(e) => return MetaHttpResponse::bad_request(e),
        }
    } else {
        // Super cluster not enabled, get local info
        match get_local_cluster_info().await {
            Ok(resp) => resp,
            Err(e) => return MetaHttpResponse::bad_request(e),
        }
    };

    #[cfg(not(feature = "enterprise"))]
    let cluster_info_response = match get_local_cluster_info().await {
        Ok(resp) => resp,
        Err(e) => return MetaHttpResponse::bad_request(e),
    };

    // Return the response
    MetaHttpResponse::json(cluster_info_response)
}

/// Helper function to collect nodes from the local cluster
async fn get_local_nodes() -> NodeListResponse {
    let mut response = NodeListResponse::new();

    // Get all nodes from cache if available
    if let Some(nodes) = infra::cluster::get_cached_nodes(|_| true).await {
        for node in nodes {
            response.add_node(node.clone(), node.get_region(), node.get_cluster());
        }
    }

    response
}

#[cfg(feature = "enterprise")]
/// Helper function to collect nodes from all clusters in a super cluster
async fn get_super_cluster_nodes(regions: &[String]) -> Result<NodeListResponse, anyhow::Error> {
    let mut response = NodeListResponse::new();

    // Get all clusters in the super cluster
    let clusters = match o2_enterprise::enterprise::super_cluster::search::get_cluster_nodes(
        "list_clusters_for_nodes",
        regions.to_vec(),
        vec![],
        Some(config::meta::cluster::RoleGroup::Interactive),
    )
    .await
    {
        Ok(nodes) => nodes,
        Err(e) => {
            log::error!("Failed to get super clusters: {e}");
            return Ok(response); // Return empty response instead of failing
        }
    };

    // For each node in the super cluster
    let trace_id = config::ider::generate_trace_id();
    for cluster in clusters {
        let region = cluster.get_region();
        let cluster_name = cluster.get_cluster();

        // Fetch child nodes from this cluster
        match crate::service::node::get_node_list(&trace_id, cluster).await {
            Ok(cluster_nodes) => {
                for node in cluster_nodes {
                    response.add_node(node.clone(), region.clone(), cluster_name.clone());
                }
            }
            Err(e) => {
                log::error!("Failed to get node list from cluster {cluster_name}: {e:?}");
                return Err(anyhow::anyhow!("Failed to get node list: {e}"));
            }
        }
    }

    Ok(response)
}

/// Helper function to collect cluster info from the local cluster
async fn get_local_cluster_info() -> Result<ClusterInfoResponse, anyhow::Error> {
    let mut response = ClusterInfoResponse::default();

    let pending_jobs_map = infra::file_list::get_pending_jobs_count().await?;
    let local_cluster = config::get_cluster_name();

    // Sum up all pending jobs across all organizations and stream types
    let total_pending_jobs: u64 = pending_jobs_map
        .values()
        .flat_map(|inner_map| inner_map.values())
        .map(|&count| count as u64)
        .sum();

    let cluster_info_obj = ClusterInfo {
        pending_jobs: total_pending_jobs,
    };
    response.add_cluster_info(cluster_info_obj, local_cluster, "openobserve".to_string());

    Ok(response)
}

#[cfg(feature = "enterprise")]
/// Helper function to collect cluster info from all clusters in a super cluster
async fn get_super_cluster_info(regions: &[String]) -> Result<ClusterInfoResponse, anyhow::Error> {
    let mut response = ClusterInfoResponse::default();

    // Get all clusters in the super cluster
    let clusters = match o2_enterprise::enterprise::super_cluster::search::get_cluster_nodes(
        "list_clusters_for_info",
        regions.to_vec(),
        vec![],
        Some(config::meta::cluster::RoleGroup::Interactive),
    )
    .await
    {
        Ok(nodes) => nodes,
        Err(e) => {
            log::error!("Failed to get super cluster nodes: {e}");
            return Ok(response); // Return empty response instead of failing
        }
    };

    // For each node in the super cluster
    let trace_id = config::ider::generate_trace_id();
    for cluster in clusters {
        let region = cluster.get_region();
        let cluster_name = cluster.get_cluster();

        // Fetch cluster info from this cluster node
        match crate::service::cluster_info::get_super_cluster_info(&trace_id, cluster).await {
            Ok(cluster_info_obj) => {
                response.add_cluster_info(cluster_info_obj, cluster_name.clone(), region.clone());
            }
            Err(e) => {
                log::error!("Failed to get cluster info from cluster {cluster_name}: {e:?}");
                // Return error
                return Err(anyhow::anyhow!("Failed to get cluster info: {e}"));
            }
        }
    }

    Ok(response)
}
