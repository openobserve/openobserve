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

use std::{
    collections::{HashMap, HashSet},
    io::Error,
};

use actix_web::{HttpRequest, HttpResponse, Result, get, http, post, put, web};
use config::meta::cluster::NodeInfo;
#[cfg(feature = "enterprise")]
use o2_enterprise::enterprise::common::config::get_config as get_o2_config;
#[cfg(feature = "cloud")]
use {
    crate::common::meta::organization::OrganizationInvites,
    crate::common::meta::organization::{AllOrgListDetails, AllOrganizationResponse},
    o2_enterprise::enterprise::cloud::list_customer_billings,
};

use crate::{
    common::{
        infra::cluster,
        meta::{
            http::HttpResponse as MetaHttpResponse,
            organization::{
                ClusterInfo, ClusterInfoResponse, ExtendTrialPeriodRequest, NodeListResponse,
                OrgDetails, OrgRenameBody, OrgUser, Organization, OrganizationResponse,
                PasscodeResponse, RumIngestionResponse, THRESHOLD,
            },
        },
        utils::auth::{UserEmail, is_root_user},
    },
    service::organization::{self, get_passcode, get_rum_token, update_passcode, update_rum_token},
};

/// GetOrganizations
///
/// #{"ratelimit_module":"Organizations", "ratelimit_module_operation":"list"}#
#[utoipa::path(
    context_path = "/api",
    tag = "Organizations",
    operation_id = "GetUserOrganizations",
    security(
        ("Authorization"= [])
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = OrganizationResponse),
    )
)]
#[get("/organizations")]
pub async fn organizations(user_email: UserEmail, req: HttpRequest) -> Result<HttpResponse, Error> {
    let user_id = user_email.user_id.as_str();
    let mut id = 0;
    let query = web::Query::<HashMap<String, String>>::from_query(req.query_string()).unwrap();

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
            return Ok(
                HttpResponse::InternalServerError().json(MetaHttpResponse::error(
                    http::StatusCode::INTERNAL_SERVER_ERROR,
                    "Something went wrong",
                )),
            );
        };
        records
    } else {
        let Ok(records) = organization::list_orgs_by_user(user_id).await else {
            return Ok(HttpResponse::NotFound().json(MetaHttpResponse::error(
                http::StatusCode::NOT_FOUND,
                "Something went wrong",
            )));
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
            return Ok(
                HttpResponse::InternalServerError().json(MetaHttpResponse::error(
                    http::StatusCode::INTERNAL_SERVER_ERROR,
                    e.to_string(),
                )),
            );
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

    Ok(HttpResponse::Ok().json(org_response))
}

#[cfg(feature = "cloud")]
#[utoipa::path(
    context_path = "/api",
    tag = "Organizations",
    operation_id = "GetAllOrganizations",
    security(
        ("Authorization"= [])
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = AllOrganizationResponse),
    )
)]
#[get("/{org_id}/organizations")]
pub async fn all_organizations(
    org_id: web::Path<String>,
    req: HttpRequest,
) -> Result<HttpResponse, Error> {
    let org = org_id.into_inner();
    if org != "_meta" {
        return Ok(HttpResponse::Unauthorized().json(MetaHttpResponse::error(
            http::StatusCode::UNAUTHORIZED,
            "not authorized to access this resource".to_string(),
        )));
    }

    let mut orgs = vec![];
    let mut org_names = HashSet::new();
    let query = web::Query::<HashMap<String, String>>::from_query(req.query_string()).unwrap();
    let limit = query
        .get("page_size")
        .unwrap_or(&"100".to_string())
        .parse::<i64>()
        .ok();

    let all_orgs = match infra::table::organizations::list(limit).await {
        Ok(orgs) => orgs,
        Err(e) => {
            return Ok(
                HttpResponse::InternalServerError().json(MetaHttpResponse::error(
                    http::StatusCode::INTERNAL_SERVER_ERROR,
                    e.to_string(),
                )),
            );
        }
    };

    let all_subscriptions = match list_customer_billings().await {
        Ok(orgs) => orgs
            .into_iter()
            .map(|cb| (cb.org_id, cb.subscription_type as i32))
            .collect::<HashMap<_, _>>(),
        Err(e) => {
            return Ok(
                HttpResponse::InternalServerError().json(MetaHttpResponse::error(
                    http::StatusCode::INTERNAL_SERVER_ERROR,
                    e.to_string(),
                )),
            );
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

    Ok(HttpResponse::Ok().json(org_response))
}

/// GetOrganizationSummary
///
/// #{"ratelimit_module":"Summary", "ratelimit_module_operation":"get"}#
#[utoipa::path(
    context_path = "/api",
    tag = "Organizations",
    operation_id = "GetOrganizationSummary",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
      ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = OrgSummary),
    )
)]
#[get("/{org_id}/summary")]
async fn org_summary(org_id: web::Path<String>) -> Result<HttpResponse, Error> {
    let org = org_id.into_inner();
    let org_summary = organization::get_summary(&org).await;
    Ok(HttpResponse::Ok().json(org_summary))
}

/// GetIngestToken
///
/// #{"ratelimit_module":"Ingestion Token", "ratelimit_module_operation":"get"}#
#[utoipa::path(
    context_path = "/api",
    tag = "Organizations",
    operation_id = "GetOrganizationUserIngestToken",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
      ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = PasscodeResponse),
        (status = 404, description = "NotFound", content_type = "application/json", body = HttpResponse),
    )
)]
#[get("/{org_id}/passcode")]
async fn get_user_passcode(
    user_email: UserEmail,
    org_id: web::Path<String>,
) -> Result<HttpResponse, Error> {
    let org = org_id.into_inner();
    let user_id = user_email.user_id.as_str();
    let mut org_id = Some(org.as_str());
    if is_root_user(user_id) {
        org_id = None;
    }
    match get_passcode(org_id, user_id).await {
        Ok(passcode) => Ok(HttpResponse::Ok().json(PasscodeResponse { data: passcode })),
        Err(e) => {
            Ok(HttpResponse::NotFound()
                .json(MetaHttpResponse::error(http::StatusCode::NOT_FOUND, e)))
        }
    }
}

/// UpdateIngestToken
///
/// #{"ratelimit_module":"Ingestion Token", "ratelimit_module_operation":"update"}#
#[utoipa::path(
    context_path = "/api",
    tag = "Organizations",
    operation_id = "UpdateOrganizationUserIngestToken",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
      ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = PasscodeResponse),
        (status = 404, description = "NotFound", content_type = "application/json", body = HttpResponse),
    )
)]
#[put("/{org_id}/passcode")]
async fn update_user_passcode(
    user_email: UserEmail,
    org_id: web::Path<String>,
) -> Result<HttpResponse, Error> {
    let org = org_id.into_inner();
    let user_id = user_email.user_id.as_str();
    let mut org_id = Some(org.as_str());
    if is_root_user(user_id) {
        org_id = None;
    }
    match update_passcode(org_id, user_id).await {
        Ok(passcode) => Ok(HttpResponse::Ok().json(PasscodeResponse { data: passcode })),
        Err(e) => {
            Ok(HttpResponse::NotFound()
                .json(MetaHttpResponse::error(http::StatusCode::NOT_FOUND, e)))
        }
    }
}

/// GetRumIngestToken
///
/// #{"ratelimit_module":"Rumtokens", "ratelimit_module_operation":"get"}#
#[utoipa::path(
    context_path = "/api",
    tag = "Organizations",
    operation_id = "GetOrganizationUserRumIngestToken",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
      ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = RumIngestionResponse),
        (status = 404, description = "NotFound", content_type = "application/json", body = HttpResponse),
    )
)]
#[get("/{org_id}/rumtoken")]
async fn get_user_rumtoken(
    user_email: UserEmail,
    org_id: web::Path<String>,
) -> Result<HttpResponse, Error> {
    let org = org_id.into_inner();
    let user_id = user_email.user_id.as_str();
    let mut org_id = Some(org.as_str());
    if is_root_user(user_id) {
        org_id = None;
    }
    match get_rum_token(org_id, user_id).await {
        Ok(rumtoken) => Ok(HttpResponse::Ok().json(RumIngestionResponse { data: rumtoken })),
        Err(e) => {
            Ok(HttpResponse::NotFound()
                .json(MetaHttpResponse::error(http::StatusCode::NOT_FOUND, e)))
        }
    }
}

/// UpdateRumIngestToken
///
/// #{"ratelimit_module":"Rumtokens", "ratelimit_module_operation":"update"}#
#[utoipa::path(
    context_path = "/api",
    tag = "Organizations",
    operation_id = "UpdateOrganizationUserRumIngestToken",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
      ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = RumIngestionResponse),
        (status = 404, description = "NotFound", content_type = "application/json", body = HttpResponse),
    )
)]
#[put("/{org_id}/rumtoken")]
async fn update_user_rumtoken(
    user_email: UserEmail,
    org_id: web::Path<String>,
) -> Result<HttpResponse, Error> {
    let org = org_id.into_inner();
    let user_id = user_email.user_id.as_str();
    let mut org_id = Some(org.as_str());
    if is_root_user(user_id) {
        org_id = None;
    }
    match update_rum_token(org_id, user_id).await {
        Ok(rumtoken) => Ok(HttpResponse::Ok().json(RumIngestionResponse { data: rumtoken })),
        Err(e) => {
            Ok(HttpResponse::NotFound()
                .json(MetaHttpResponse::error(http::StatusCode::NOT_FOUND, e)))
        }
    }
}

/// CreateRumIngestToken
///
/// #{"ratelimit_module":"Rumtokens", "ratelimit_module_operation":"create"}#
#[utoipa::path(
    context_path = "/api",
    tag = "Organizations",
    operation_id = "CreateOrganizationUserRumIngestToken",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
      ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = RumIngestionResponse),
        (status = 404, description = "NotFound", content_type = "application/json", body = HttpResponse),
    )
)]
#[post("/{org_id}/rumtoken")]
async fn create_user_rumtoken(
    user_email: UserEmail,
    org_id: web::Path<String>,
) -> Result<HttpResponse, Error> {
    let org = org_id.into_inner();
    let user_id = user_email.user_id.as_str();
    let mut org_id = Some(org.as_str());
    if is_root_user(user_id) {
        org_id = None;
    }
    match update_rum_token(org_id, user_id).await {
        Ok(rumtoken) => Ok(HttpResponse::Ok().json(RumIngestionResponse { data: rumtoken })),
        Err(e) => {
            Ok(HttpResponse::NotFound()
                .json(MetaHttpResponse::error(http::StatusCode::NOT_FOUND, e)))
        }
    }
}

/// CreateOrganization
///
/// #{"ratelimit_module":"Organizations", "ratelimit_module_operation":"create"}#
#[utoipa::path(
    context_path = "/api",
    tag = "Organizations",
    operation_id = "CreateOrganization",
    security(
        ("Authorization"= [])
    ),
    request_body(content = Organization, description = "Organization data", content_type = "application/json"),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = RumIngestionResponse),
    )
)]
#[post("/organizations")]
async fn create_org(
    user_email: UserEmail,
    org: web::Json<Organization>,
) -> Result<HttpResponse, Error> {
    let mut org = org.into_inner();

    let result = organization::create_org(&mut org, &user_email.user_id).await;
    match result {
        Ok(_) => Ok(HttpResponse::Ok().json(org)),
        Err(err) => Ok(HttpResponse::BadRequest()
            .json(MetaHttpResponse::error(http::StatusCode::BAD_REQUEST, err))),
    }
}

#[utoipa::path(
    context_path = "/api",
    tag = "Organizations",
    operation_id = "ExtendTrialPeriod",
    security(
        ("Authorization"= [])
    ),
    request_body(content = ExtendTrialPeriodRequest, description = "Extend free trial request", content_type = "application/json"),
    responses(
        (status = 200, description = "Success", content_type = "text"),
    )
)]
#[put("/{org_id}/extend_trial_period")]
async fn extend_trial_period(
    org_id: web::Path<String>,
    req: web::Json<ExtendTrialPeriodRequest>,
) -> Result<HttpResponse, Error> {
    let req = req.into_inner();
    let org = org_id.into_inner();
    if org != "_meta" {
        return Ok(HttpResponse::Unauthorized().json(MetaHttpResponse::error(
            http::StatusCode::UNAUTHORIZED,
            "not authorized to access this resource".to_string(),
        )));
    }

    let org = match infra::table::organizations::get(&req.org_id).await {
        Ok(org) => org,
        Err(e) => {
            return Ok(HttpResponse::NotFound().json(MetaHttpResponse::error(
                http::StatusCode::NOT_FOUND,
                e.to_string(),
            )));
        }
    };
    if org.trial_ends_at > req.new_end_date {
        return Ok(HttpResponse::BadRequest().json(MetaHttpResponse::error(
            http::StatusCode::BAD_REQUEST,
            "Existing trial end date is after the provided date".to_string(),
        )));
    }

    match infra::table::organizations::set_trial_period_end(&req.org_id, req.new_end_date).await {
        Ok(_) => Ok(HttpResponse::Ok().body("success")),
        Err(err) => Ok(HttpResponse::BadRequest().json(MetaHttpResponse::error(
            http::StatusCode::BAD_REQUEST,
            err.to_string(),
        ))),
    }
}

/// RenameOrganization
#[utoipa::path(
    context_path = "/api",
    tag = "Organizations",
    operation_id = "RenameOrganization",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization id"),
    ),
    request_body(content = OrgRenameBody, description = "Organization new name", content_type = "application/json"),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = Organization),
    )
)]
#[put("/{org_id}/rename")]
async fn rename_org(
    user_email: UserEmail,
    path: web::Path<String>,
    new_name: web::Json<OrgRenameBody>,
) -> Result<HttpResponse, Error> {
    let org = path.into_inner();
    let new_name = new_name.into_inner().new_name;
    if new_name.is_empty() {
        return Ok(HttpResponse::BadRequest().json(MetaHttpResponse::error(
            http::StatusCode::BAD_REQUEST,
            "New name cannot be empty",
        )));
    }

    let result = organization::rename_org(&org, &new_name, &user_email.user_id).await;
    match result {
        Ok(org) => Ok(HttpResponse::Ok().json(org)),
        Err(err) => Ok(HttpResponse::BadRequest()
            .json(MetaHttpResponse::error(http::StatusCode::BAD_REQUEST, err))),
    }
}

/// InviteOrganizationMembers
#[cfg(feature = "cloud")]
#[utoipa::path(
    context_path = "/api",
    tag = "Organizations",
    operation_id = "GetOrganizationMemberInvites",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization id"),
      ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = OrganizationInviteUserRecord),
    )
)]
#[get("/{org_id}/invites")]
pub async fn get_org_invites(path: web::Path<String>) -> Result<HttpResponse, Error> {
    use crate::common::meta::user::InviteStatus;

    let org = path.into_inner();

    let result = organization::get_invitations_for_org(&org).await;
    match result {
        Ok(result) => {
            let result: Vec<_> = result
                .into_iter()
                .filter(|invite| invite.status != InviteStatus::Accepted)
                .collect();
            Ok(HttpResponse::Ok().json(result))
        }
        Err(err) => Ok(HttpResponse::BadRequest()
            .json(MetaHttpResponse::error(http::StatusCode::BAD_REQUEST, err))),
    }
}

/// InviteOrganizationMembers
#[cfg(feature = "cloud")]
#[utoipa::path(
    context_path = "/api",
    tag = "Organizations",
    operation_id = "InviteOrganizationMembers",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization id"),
      ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = Organization),
    )
)]
#[post("/{org_id}/invites")]
pub async fn generate_org_invite(
    user_email: UserEmail,
    path: web::Path<String>,
    invites: web::Json<OrganizationInvites>,
) -> Result<HttpResponse, Error> {
    let org = path.into_inner();
    let invites = invites.into_inner();

    let result = organization::generate_invitation(&org, &user_email.user_id, invites).await;
    match result {
        Ok(org) => Ok(HttpResponse::Ok().json(org)),
        Err(err) => Ok(HttpResponse::BadRequest()
            .json(MetaHttpResponse::error(http::StatusCode::BAD_REQUEST, err))),
    }
}

/// AcceptOrganizationInvite
#[cfg(feature = "cloud")]
#[utoipa::path(
    context_path = "/api",
    tag = "Organizations",
    operation_id = "AcceptOrganizationInvite",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization id"),
        ("invite_token" = String, Path, description = "The token sent to the user"),
      ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = Organization),
    )
)]
#[put("/{org_id}/member_subscription/{invite_token}")]
async fn accept_org_invite(
    user_email: UserEmail,
    path: web::Path<(String, String)>,
) -> Result<HttpResponse, Error> {
    let (_org, invite_token) = path.into_inner();

    let result = organization::accept_invitation(&user_email.user_id, &invite_token).await;
    match result {
        Ok(_) => Ok(MetaHttpResponse::ok("Invitation accepted successfully")),
        Err(err) => Ok(HttpResponse::BadRequest()
            .json(MetaHttpResponse::error(http::StatusCode::BAD_REQUEST, err))),
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
    context_path = "/api",
    tag = "Organizations",
    operation_id = "GetMetaOrganizationNodeList",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Must be '_meta'"),
        ("regions" = String, Query, description = "Optional comma-separated list of regions to filter by (e.g., 'us-east-1,us-west-2')")
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = NodeListResponse),
        (status = 403, description = "Forbidden - Not the _meta organization", content_type = "application/json", body = HttpResponse),
        (status = 404, description = "NotFound", content_type = "application/json", body = HttpResponse),
    )
)]
#[get("/{org_id}/node/list")]
async fn node_list(
    org_id: web::Path<String>,
    query: web::Query<std::collections::HashMap<String, String>>,
) -> Result<HttpResponse, Error> {
    node_list_impl(&org_id.into_inner(), query.into_inner()).await
}

pub async fn node_list_impl(
    org_id: &str,
    query: std::collections::HashMap<String, String>,
) -> Result<HttpResponse, Error> {
    // Ensure this API is only available for the "_meta" organization
    if org_id != config::META_ORG_ID {
        return Ok(HttpResponse::Forbidden().json(MetaHttpResponse::error(
            http::StatusCode::FORBIDDEN,
            "This API is only available for the _meta organization",
        )));
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
            Err(e) => return Ok(MetaHttpResponse::bad_request(e)),
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
    Ok(HttpResponse::Ok().json(response))
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
    context_path = "/api",
    tag = "Organizations",
    operation_id = "GetMetaOrganizationClusterInfo",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Must be '_meta'"),
        ("regions" = String, Query, description = "Optional comma-separated list of regions to filter by (e.g., 'us-east-1,us-west-2')")
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = ClusterInfoResponse),
        (status = 403, description = "Forbidden - Not the _meta organization", content_type = "application/json", body = HttpResponse),
        (status = 404, description = "NotFound", content_type = "application/json", body = HttpResponse),
    )
)]
#[get("/{org_id}/cluster/info")]
async fn cluster_info(
    org_id: web::Path<String>,
    query: web::Query<std::collections::HashMap<String, String>>,
) -> Result<HttpResponse, Error> {
    let org = org_id.into_inner();

    // Ensure this API is only available for the "_meta" organization
    if org != config::META_ORG_ID {
        return Ok(HttpResponse::Forbidden().json(MetaHttpResponse::error(
            http::StatusCode::FORBIDDEN,
            "This API is only available for the _meta organization",
        )));
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
            Err(e) => return Ok(MetaHttpResponse::bad_request(e)),
        }
    } else {
        // Super cluster not enabled, get local info
        match get_local_cluster_info().await {
            Ok(resp) => resp,
            Err(e) => return Ok(MetaHttpResponse::bad_request(e)),
        }
    };

    #[cfg(not(feature = "enterprise"))]
    let cluster_info_response = match get_local_cluster_info().await {
        Ok(resp) => resp,
        Err(e) => return Ok(MetaHttpResponse::bad_request(e)),
    };

    // Return the response
    Ok(HttpResponse::Ok().json(cluster_info_response))
}

/// Helper function to collect nodes from the local cluster
async fn get_local_nodes() -> NodeListResponse {
    let mut response = NodeListResponse::new();

    // Get all nodes from cache if available
    if let Some(nodes) = cluster::get_cached_nodes(|_| true).await {
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
                log::error!(
                    "Failed to get node list from cluster {}: {:?}",
                    cluster_name,
                    e
                );
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
                log::error!(
                    "Failed to get cluster info from cluster {}: {:?}",
                    cluster_name,
                    e
                );
                // Return error
                return Err(anyhow::anyhow!("Failed to get cluster info: {e}"));
            }
        }
    }

    Ok(response)
}
