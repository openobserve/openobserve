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

use std::collections::HashMap;

use axum::{
    body::{Body, Bytes},
    extract::{Path, Query},
    http::{StatusCode, header},
    response::Response,
};
use config::meta::actions::action::ActionType;
use o2_enterprise::enterprise::actions::action_deployer::ACTION_DEPLOYER;

pub async fn create_job(Path(org_id): Path<String>, body: Bytes) -> Response {
    log::info!("[action_server] create_job called for org_id: {org_id}");
    if let Some(deployer) = ACTION_DEPLOYER.get() {
        return match deployer.create_app(&org_id, body).await {
            Ok(created_at) => {
                log::info!("[action_server] create_job success for org_id: {org_id}");
                Response::builder()
                    .status(StatusCode::OK)
                    .body(Body::from(created_at.to_rfc3339()))
                    .unwrap()
            }
            Err(e) => {
                log::error!("[action_server] create_job failed for org_id: {org_id}, error: {e}");
                Response::builder()
                    .status(StatusCode::INTERNAL_SERVER_ERROR)
                    .header(header::CONTENT_TYPE, "application/json")
                    .body(Body::from(
                        serde_json::to_string(&serde_json::json!(e.to_string())).unwrap(),
                    ))
                    .unwrap()
            }
        };
    }

    log::error!("[action_server] create_job failed: AppDeployer not initialized");
    Response::builder()
        .status(StatusCode::INTERNAL_SERVER_ERROR)
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            serde_json::to_string(&serde_json::json!("AppDeployer not initialized")).unwrap(),
        ))
        .unwrap()
}

pub async fn delete_job(Path((org_id, name)): Path<(String, String)>) -> Response {
    log::info!("[action_server] delete_job called for org_id: {org_id}, name: {name}");
    if let Some(deployer) = ACTION_DEPLOYER.get() {
        return match deployer.delete_app(&org_id, &name).await {
            Ok(_) => {
                log::info!("[action_server] delete_job success for org_id: {org_id}, name: {name}");
                Response::builder()
                    .status(StatusCode::OK)
                    .body(Body::empty())
                    .unwrap()
            }
            Err(e) => {
                log::error!(
                    "[action_server] delete_job failed for org_id: {org_id}, name: {name}, error: {e}"
                );
                Response::builder()
                    .status(StatusCode::INTERNAL_SERVER_ERROR)
                    .header(header::CONTENT_TYPE, "application/json")
                    .body(Body::from(
                        serde_json::to_string(&serde_json::json!(e.to_string())).unwrap(),
                    ))
                    .unwrap()
            }
        };
    }
    log::error!("[action_server] delete_job failed: AppDeployer not initialized");
    Response::builder()
        .status(StatusCode::INTERNAL_SERVER_ERROR)
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            serde_json::to_string(&serde_json::json!("AppDeployer not initialized")).unwrap(),
        ))
        .unwrap()
}

pub async fn get_app_details(Path((org_id, name)): Path<(String, String)>) -> Response {
    log::info!("[action_server] get_app_details called for org_id: {org_id}, name: {name}");
    if let Some(deployer) = ACTION_DEPLOYER.get() {
        return match deployer.get_app_status(&org_id, &name).await {
            Ok(resp) => {
                log::info!(
                    "[action_server] get_app_details success for org_id: {org_id}, name: {name}"
                );
                Response::builder()
                    .status(StatusCode::OK)
                    .header(header::CONTENT_TYPE, "application/json")
                    .body(Body::from(serde_json::to_string(&resp).unwrap()))
                    .unwrap()
            }
            Err(e) => {
                log::error!(
                    "[action_server] get_app_details failed for org_id: {org_id}, name: {name}, error: {e}"
                );
                Response::builder()
                    .status(StatusCode::INTERNAL_SERVER_ERROR)
                    .header(header::CONTENT_TYPE, "application/json")
                    .body(Body::from(
                        serde_json::to_string(&serde_json::json!(e.to_string())).unwrap(),
                    ))
                    .unwrap()
            }
        };
    }
    log::error!("[action_server] get_app_details failed: AppDeployer not initialized");
    Response::builder()
        .status(StatusCode::INTERNAL_SERVER_ERROR)
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            serde_json::to_string(&serde_json::json!("AppDeployer not initialized")).unwrap(),
        ))
        .unwrap()
}

pub async fn list_deployed_apps(Path(org_id): Path<String>) -> Response {
    log::info!("[action_server] list_deployed_apps called for org_id: {org_id}");
    if let Some(deployer) = ACTION_DEPLOYER.get() {
        return match deployer.list_apps(&org_id).await {
            Ok(resp) => {
                log::info!(
                    "[action_server] list_deployed_apps success for org_id: {org_id}, count: {}",
                    resp.len()
                );
                Response::builder()
                    .status(StatusCode::OK)
                    .header(header::CONTENT_TYPE, "application/json")
                    .body(Body::from(serde_json::to_string(&resp).unwrap()))
                    .unwrap()
            }
            Err(e) => {
                log::error!(
                    "[action_server] list_deployed_apps failed for org_id: {org_id}, error: {e}"
                );
                Response::builder()
                    .status(StatusCode::INTERNAL_SERVER_ERROR)
                    .header(header::CONTENT_TYPE, "application/json")
                    .body(Body::from(
                        serde_json::to_string(&serde_json::json!(e.to_string())).unwrap(),
                    ))
                    .unwrap()
            }
        };
    }

    log::error!("[action_server] list_deployed_apps failed: AppDeployer not initialized");
    Response::builder()
        .status(StatusCode::INTERNAL_SERVER_ERROR)
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            serde_json::to_string(&serde_json::json!("AppDeployer not initialized")).unwrap(),
        ))
        .unwrap()
}

// Update/patch a resource (handles both PUT and PATCH methods)
pub async fn patch_action(
    Path((org_id, id)): Path<(String, String)>,
    Query(query): Query<HashMap<String, String>>,
    body: Bytes,
) -> Response {
    log::info!("[action_server] patch_action called for org_id: {org_id}, id: {id}");
    // Extract the "action_type" from query parameters and handle missing cases properly
    let action_type: ActionType = match query.get("action_type") {
        Some(value) => match value.clone().as_str().try_into() {
            Ok(action_type) => action_type,
            Err(e) => {
                log::error!(
                    "[action_server] patch_action failed: invalid action_type for org_id: {org_id}, id: {id}, error: {e}"
                );
                return Response::builder()
                    .status(StatusCode::BAD_REQUEST)
                    .header(header::CONTENT_TYPE, "application/json")
                    .body(Body::from(
                        serde_json::to_string(&serde_json::json!(e.to_string())).unwrap(),
                    ))
                    .unwrap();
            }
        },
        None => {
            log::error!(
                "[action_server] patch_action failed: missing action_type parameter for org_id: {org_id}, id: {id}"
            );
            return Response::builder()
                .status(StatusCode::BAD_REQUEST)
                .body(Body::from("Missing required 'action_type' parameter"))
                .unwrap();
        }
    };

    if let Some(deployer) = ACTION_DEPLOYER.get() {
        return match deployer
            .update_action(&org_id, &id, action_type, body)
            .await
        {
            Ok(modified_at) => {
                log::info!("[action_server] patch_action success for org_id: {org_id}, id: {id}");
                Response::builder()
                    .status(StatusCode::OK)
                    .body(Body::from(modified_at.to_rfc3339()))
                    .unwrap()
            }
            Err(e) => {
                log::error!(
                    "[action_server] patch_action failed for org_id: {org_id}, id: {id}, error: {e}"
                );
                Response::builder()
                    .status(StatusCode::INTERNAL_SERVER_ERROR)
                    .header(header::CONTENT_TYPE, "application/json")
                    .body(Body::from(
                        serde_json::to_string(&serde_json::json!(e.to_string())).unwrap(),
                    ))
                    .unwrap()
            }
        };
    }

    log::error!("[action_server] patch_action failed: AppDeployer not initialized");
    Response::builder()
        .status(StatusCode::INTERNAL_SERVER_ERROR)
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            serde_json::to_string(&serde_json::json!("AppDeployer not initialized")).unwrap(),
        ))
        .unwrap()
}
