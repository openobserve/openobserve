// Copyright 2024 OpenObserve Inc.
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

use actix_web::{get, http, post, put, web, HttpResponse, Result};
use config::meta::cluster::NodeInfo;
use infra::schema::STREAM_SCHEMAS_LATEST;
#[cfg(feature = "enterprise")]
use o2_enterprise::enterprise::common::infra::config::get_config as get_o2_config;
#[cfg(feature = "enterprise")]
use o2_enterprise::enterprise::super_cluster::kv::cluster::get_grpc_addr;

use crate::{
    common::{
        infra::{cluster, config::USERS},
        meta::{
            http::HttpResponse as MetaHttpResponse,
            organization::{
                to_federated_node, FederatedNode, NodeListRequest, NodeListResponse, OrgDetails,
                OrgUser, Organization, OrganizationResponse, PasscodeResponse,
                RumIngestionResponse, CUSTOM, DEFAULT_ORG, THRESHOLD,
            },
        },
        utils::auth::{is_root_user, UserEmail},
    },
    service::organization::{self, get_passcode, get_rum_token, update_passcode, update_rum_token},
};

/// GetOrganizations
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
/// This endpoint returns a list of all nodes in the OpenObserve cluster along with their
/// versions and other essential information. It can be useful for:
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
        ("org_id" = String, Path, description = "Must be '_meta'")
    ),
    request_body(content = NodeListRequest, description = "Request with regions to filter by", content_type = "application/json"),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = NodeListResponse),
        (status = 403, description = "Forbidden - Not the _meta organization", content_type = "application/json", body = HttpResponse),
        (status = 404, description = "NotFound", content_type = "application/json", body = HttpResponse),
        (status = 400, description = "Bad Request - Invalid JSON body", content_type = "application/json", body = HttpResponse),
    )
)]
#[get("/{org_id}/node/list")]
async fn node_list(org_id: web::Path<String>, payload: web::Bytes) -> Result<HttpResponse, Error> {
    let org = org_id.into_inner();
    // Ensure this API is only available for the "_meta" organization
    if org != "_meta" {
        return Ok(HttpResponse::Forbidden().json(MetaHttpResponse::error(
            http::StatusCode::FORBIDDEN.into(),
            "This API is only available for the _meta organization".to_string(),
        )));
    }

    let req: NodeListRequest = match serde_json::from_slice(&payload) {
        Ok(v) => v,
        Err(e) => {
            return Ok(MetaHttpResponse::bad_request(e));
        }
    };

    // Check if super cluster is enabled
    #[cfg(feature = "enterprise")]
    let super_cluster_enabled = get_o2_config().super_cluster.enabled;

    #[cfg(not(feature = "enterprise"))]
    let super_cluster_enabled = false;

    // Get all nodes from cache
    let mut nodes: Vec<FederatedNode> = match cluster::get_cached_nodes(|_| true).await {
        Some(nodes) => nodes
            .iter()
            .map(|node| to_federated_node(node.clone(), node.get_region(), node.get_cluster_name()))
            .collect(),
        None => Vec::new(),
    };

    #[cfg(feature = "enterprise")]
    if super_cluster_enabled {
        let super_cluster_nodes =
            match o2_enterprise::enterprise::super_cluster::search::get_cluster_nodes(
                "list_nodes",
                req.regions.clone(),
                vec![],
            )
            .await
            {
                Ok(nodes) => nodes,
                Err(e) => {
                    log::error!("Failed to get super cluster nodes: {:?}", e);
                    Vec::new()
                }
            };

        // For each node in the super cluster
        for node in super_cluster_nodes {
            // Skip the current node
            if node.get_grpc_addr() == get_grpc_addr() {
                continue;
            }

            let region = node.get_region();
            let cluster_name = node.get_cluster_name();

            match crate::service::node::get_node_list(node).await {
                Ok(cluster_nodes) => {
                    for node in cluster_nodes {
                        nodes.push(to_federated_node(
                            node.clone(),
                            region.clone(),
                            cluster_name.clone(),
                        ));
                    }
                }
                Err(e) => {
                    log::error!("Failed to get node list: {:?}", e);
                    return Ok(MetaHttpResponse::internal_error(format!(
                        "Failed to get node list: {:?}",
                        e
                    )));
                }
            }
        }
    }

    // Return response with nodes
    Ok(HttpResponse::Ok().json(NodeListResponse { nodes }))
}
