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
use infra::table::org_storage_providers::{OrgStorageProvider, ProviderType};
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use crate::common::meta::http::HttpResponse;

#[derive(Deserialize, ToSchema)]
pub struct SetupStorageRequest {
    #[schema(value_type = String)]
    provider: ProviderType,
    data: serde_json::Value,
}

#[derive(Serialize)]
struct GetStorageResponse {
    provider: Option<ProviderType>,
    data: serde_json::Value,
    created_at: i64,
    updated_at: i64,
}

/// Store a key credential in db
#[utoipa::path(
    post,
    path = "/{org_id}/storage",
    context_path = "/api",
    operation_id = "AddOrgStorage",
    summary = "Set up org level storage for data",
    description = "Sets up org level storage if enabled for the given org",
    request_body(
        content = inline(SetupStorageRequest),
        description = "storage credentials",
        content_type = "application/json",
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
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
pub async fn save(Path(org_id): Path<String>, Json(body): Json<SetupStorageRequest>) -> Response {
    let req = body;

    #[cfg(feature = "cloud")]
    {
        // for cloud, the org storage must be enabled first
        let org_settings = match crate::service::db::organization::get_org_setting(&org_id).await {
            Ok(org) => org,
            Err(e) => {
                return HttpResponse::not_found(e.to_string());
            }
        };

        if !org_settings.org_storage_enabled {
            return HttpResponse::bad_request(
                "org level storage is not enabled for this organization, please contact administrators.",
            );
        }
    }

    // don't let org which already have set the storage use this route,
    // they can use PUT route for updating credentials
    match crate::service::org_storage_providers::get_redacted_config(&org_id).await {
        Err(e) => {
            log::error!("error getting org storage config for org {org_id} : {e}");
            return HttpResponse::internal_error(e);
        }
        Ok(Some(_)) => {
            return HttpResponse::bad_request(
                "org level storage is already setup for this organization",
            );
        }
        Ok(None) => {}
    }

    let validated_data = match crate::service::org_storage_providers::enforce_checks(
        req.provider,
        req.data.to_string(),
    ) {
        Ok(v) => v,
        Err(e) => {
            return HttpResponse::bad_request(e);
        }
    };

    log::info!("setting up org-level storage for org {org_id}");

    let provider = OrgStorageProvider {
        org_id: org_id.clone(),
        provider_type: req.provider,
        created_at: chrono::Utc::now().timestamp_micros(),
        updated_at: chrono::Utc::now().timestamp_micros(),
        data: validated_data,
    };

    match crate::service::org_storage_providers::set_storage(&org_id, provider).await {
        Ok(_) => {
            log::info!("successfully set org-level storage for org {org_id}");
            HttpResponse::created("successfully setup storage")
        }
        Err(e) => {
            log::error!(
                "error in setting org level storage of type {} for org {} : {e}",
                req.provider,
                org_id
            );
            HttpResponse::bad_request(e)
        }
    }
}

/// get key with given name if present
#[utoipa::path(
    get,
    path = "/{org_id}/storage",
    context_path = "/api",
    operation_id = "GetStorageInformation",
    summary = "Get storage details",
    description = "retrieves storage details if configured in redacted manor",
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
pub async fn get(Path(org_id): Path<String>) -> Response {
    match crate::service::org_storage_providers::get_redacted_config(&org_id).await {
        Ok(Some(v)) => {
            let data_json: serde_json::Value = serde_json::from_str(&v.data).unwrap();
            HttpResponse::json(GetStorageResponse {
                provider: Some(v.provider_type),
                data: data_json,
                created_at: v.created_at,
                updated_at: v.updated_at,
            })
        }
        Ok(None) => HttpResponse::json(GetStorageResponse {
            provider: None,
            data: serde_json::Value::Null,
            created_at: 0,
            updated_at: 0,
        }),
        Err(e) => {
            log::info!("error in getting redacted storage config for org : {org_id}");
            HttpResponse::internal_error(e)
        }
    }
}

/// update the credentials for given key
#[utoipa::path(
    put,
    path = "/{org_id}/storage",
    context_path = "/api",
    operation_id = "UpdateStorageDetails",
    summary = "Update storage details",
    description = "Updates the org level storage details such as credentials",
    params(
        ("org_id" = String, Path, description = "Organization name"),
    ),
    request_body(
        content = inline(SetupStorageRequest),
        description = "updated key data",
        content_type = "application/json",
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
pub async fn update(Path(org_id): Path<String>, Json(req): Json<SetupStorageRequest>) -> Response {
    #[cfg(feature = "cloud")]
    {
        // for cloud, org storage must be enabled first
        let org_settings = match crate::service::db::organization::get_org_setting(&org_id).await {
            Ok(org) => org,
            Err(e) => {
                return HttpResponse::not_found(e.to_string());
            }
        };

        if !org_settings.org_storage_enabled {
            return HttpResponse::bad_request(
                "org level storage is not enabled for this organization, please contact administrators.",
            );
        }
    }

    let mut existing = match crate::service::db::org_storage_providers::get_for_org(&org_id).await {
        Ok(Some(v)) => v,
        Ok(None) => {
            return HttpResponse::bad_request("org level storage is not set, cannot edit it");
        }
        Err(e) => {
            log::error!("error in getting redacted storage config for org : {org_id}");
            return HttpResponse::internal_error(e);
        }
    };

    if existing.provider_type != req.provider {
        return HttpResponse::bad_request("cannot change provider type after initial setup");
    }

    let new_creds = match crate::service::org_storage_providers::merge_configs(
        existing.provider_type,
        &existing.data,
        &req.data.to_string(),
    ) {
        Ok(v) => v,
        Err(e) => {
            return HttpResponse::bad_request(format!("error setting new config : {e}"));
        }
    };

    let validated_data =
        match crate::service::org_storage_providers::enforce_checks(req.provider, new_creds) {
            Ok(v) => v,
            Err(e) => {
                return HttpResponse::bad_request(e);
            }
        };

    existing.data = validated_data;
    existing.updated_at = chrono::Utc::now().timestamp_micros();

    match crate::service::org_storage_providers::set_storage(&org_id, existing).await {
        Ok(_) => {
            log::info!("successfully updated org-level storage credentials for org {org_id}");
            HttpResponse::created("successfully updated storage credentials")
        }
        Err(e) => {
            log::error!(
                "error in updating org level storage credentials of type {} for org {} : {e}",
                req.provider,
                org_id
            );
            HttpResponse::bad_request(e)
        }
    }
}
