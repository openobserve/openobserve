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

use std::{collections::HashSet, io::Error};

use actix_web::{HttpResponse, Result, get, http, post, put, web};
use config::meta::cluster::NodeInfo;
use infra::schema::STREAM_SCHEMAS_LATEST;
#[cfg(feature = "enterprise")]
use o2_enterprise::enterprise::common::infra::config::get_config as get_o2_config;

use crate::{
    common::{
        infra::{cluster, config::USERS},
        meta::{
            http::HttpResponse as MetaHttpResponse,
            organization::{
                CUSTOM, ClusterInfo, ClusterInfoResponse, DEFAULT_ORG, NodeListResponse,
                OrgDetails, OrgUser, Organization, OrganizationResponse, PasscodeResponse,
                RumIngestionResponse, THRESHOLD,
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
pub async fn organizations(user_email: UserEmail) -> Result<HttpResponse, Error> {
    let user_id = user_email.user_id.as_str();
    let mut id = 0;

    let mut orgs: Vec<OrgDetails> = vec![];
    let mut org_names = HashSet::new();
    let user_detail = OrgUser {
        first_name: user_id.to_string(),
        last_name: user_id.to_string(),
        email: user_id.to_string(),
    };

    let is_root_user = is_root_user(user_id);
    if is_root_user {
        id += 1;
        org_names.insert(DEFAULT_ORG.to_string());
        orgs.push(OrgDetails {
            id,
            identifier: DEFAULT_ORG.to_string(),
            name: DEFAULT_ORG.to_string(),
            user_email: user_id.to_string(),
            ingest_threshold: THRESHOLD,
            search_threshold: THRESHOLD,
            org_type: DEFAULT_ORG.to_string(),
            user_obj: user_detail.clone(),
        });

        let r = STREAM_SCHEMAS_LATEST.read().await;
        for key in r.keys() {
            if !key.contains('/') {
                continue;
            }

            id += 1;
            let org = OrgDetails {
                id,
                identifier: key.split('/').collect::<Vec<&str>>()[0].to_string(),
                name: key.split('/').collect::<Vec<&str>>()[0].to_string(),
                user_email: user_id.to_string(),
                ingest_threshold: THRESHOLD,
                search_threshold: THRESHOLD,
                org_type: CUSTOM.to_string(),
                user_obj: user_detail.clone(),
            };
            if !org_names.contains(&org.identifier) {
                org_names.insert(org.identifier.clone());
                orgs.push(org)
            }
        }
        drop(r);
    }
    for user in USERS.iter() {
        if !user.key().contains('/') {
            continue;
        }
        if !user.key().ends_with(&format!("/{user_id}")) {
            continue;
        }

        id += 1;
        let org = OrgDetails {
            id,
            identifier: user.key().split('/').collect::<Vec<&str>>()[0].to_string(),
            name: user.key().split('/').collect::<Vec<&str>>()[0].to_string(),
            user_email: user_id.to_string(),
            ingest_threshold: THRESHOLD,
            search_threshold: THRESHOLD,
            org_type: CUSTOM.to_string(),
            user_obj: user_detail.clone(),
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
        Err(e) => Ok(HttpResponse::NotFound().json(MetaHttpResponse::error(
            http::StatusCode::NOT_FOUND.into(),
            e.to_string(),
        ))),
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
        Err(e) => Ok(HttpResponse::NotFound().json(MetaHttpResponse::error(
            http::StatusCode::NOT_FOUND.into(),
            e.to_string(),
        ))),
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
        Err(e) => Ok(HttpResponse::NotFound().json(MetaHttpResponse::error(
            http::StatusCode::NOT_FOUND.into(),
            e.to_string(),
        ))),
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
        Err(e) => Ok(HttpResponse::NotFound().json(MetaHttpResponse::error(
            http::StatusCode::NOT_FOUND.into(),
            e.to_string(),
        ))),
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
        Err(e) => Ok(HttpResponse::NotFound().json(MetaHttpResponse::error(
            http::StatusCode::NOT_FOUND.into(),
            e.to_string(),
        ))),
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
    params(
        ("org_id" = String, Path, description = "Organization name"),
      ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = RumIngestionResponse),
    )
)]
#[post("/organizations")]
async fn create_org(
    _user_email: UserEmail,
    org: web::Json<Organization>,
) -> Result<HttpResponse, Error> {
    let org = org.into_inner();

    let result = organization::create_org(&org).await;
    match result {
        Ok(_) => Ok(HttpResponse::Ok().json(org)),
        Err(err) => Err(err),
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
    let org = org_id.into_inner();

    // Ensure this API is only available for the "_meta" organization
    if org != config::META_ORG_ID {
        return Ok(HttpResponse::Forbidden().json(MetaHttpResponse::error(
            http::StatusCode::FORBIDDEN.into(),
            "This API is only available for the _meta organization".to_string(),
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
    let response = if get_o2_config().super_cluster.enabled {
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
    let response = get_local_nodes().await;

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
            http::StatusCode::FORBIDDEN.into(),
            "This API is only available for the _meta organization".to_string(),
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
            log::error!("Failed to get super clusters: {:?}", e);
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
                return Err(anyhow::anyhow!("Failed to get node list: {:?}", e));
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
            log::error!("Failed to get super cluster nodes: {:?}", e);
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
                return Err(anyhow::anyhow!("Failed to get cluster info: {:?}", e));
            }
        }
    }

    Ok(response)
}
