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

use axum::{
    Json,
    extract::{Multipart, Path},
    response::Response,
};
#[cfg(feature = "enterprise")]
use {
    crate::{
        common::{
            meta::authz::Authz,
            utils::auth::{check_permissions, remove_ownership, set_ownership},
        },
        handler::http::models::action::{GetActionDetailsResponse, GetActionInfoResponse},
        service::organization::get_passcode,
    },
    bytes::Bytes,
    config::meta::actions::action::{Action, ExecutionDetailsType},
    infra::table::action_scripts,
    o2_enterprise::enterprise::actions::action_manager::{
        delete_app_from_target_cluster, get_action_details, get_actions, register_app,
        serve_file_from_s3, update_app_on_target_cluster,
    },
    once_cell::sync::Lazy,
    regex::Regex,
    serde_json,
    std::collections::HashMap,
    std::str::FromStr,
    svix_ksuid::Ksuid,
};

use crate::{
    common::{meta::http::HttpResponse as MetaHttpResponse, utils::auth::UserEmail},
    handler::http::{
        extractors::Headers,
        request::{BulkDeleteRequest, BulkDeleteResponse},
    },
};

#[cfg(feature = "enterprise")]
const MANDATORY_FIELDS_FOR_ACTION_CREATION: [&str; 5] =
    ["name", "owner", "file", "filename", "execution_details"];
#[cfg(feature = "enterprise")]
static ENV_VAR_REGEX: Lazy<Regex> = Lazy::new(|| Regex::new(r"^[A-Z][A-Z0-9_]*$").unwrap());
#[cfg(feature = "enterprise")]
fn validate_environment_variables(env_vars: &HashMap<String, String>) -> Result<(), String> {
    for key in env_vars.keys() {
        if !ENV_VAR_REGEX.is_match(key) {
            return Err("Environment variable keys must be uppercase and alphanumeric".to_string());
        }
    }
    Ok(())
}

/// Delete Action
#[utoipa::path(
    delete,
    path = "/{org_id}/actions/{ksuid}",
    context_path = "/api",
    tag = "Actions",
    operation_id = "DeleteAction",
    summary = "Delete automated action",
    description = "Permanently removes an automated action from the organization. The action must not be in use by active \
                   workflows or schedules before deletion. Once deleted, any scheduled executions or trigger-based \
                   invocations will stop, and the action configuration cannot be recovered.",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("ksuid" = String, Path, description = "Action ID"),
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = Object),
        (status = 400, description = "Error",   content_type = "application/json",body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Actions", "operation": "delete"})),
        ("x-o2-mcp" = json!({"enabled": false}))
    )
)]
pub async fn delete_action(Path((org_id, action_id)): Path<(String, String)>) -> Response {
    #[cfg(feature = "enterprise")]
    {
        let action_id = match Ksuid::from_str(&action_id) {
            Ok(id) => id,
            Err(_) => {
                return MetaHttpResponse::not_found(format!("invalid action id {action_id}"));
            }
        };
        match delete_app_from_target_cluster(&org_id, action_id).await {
            Ok(_) => {
                remove_ownership(&org_id, "actions", Authz::new(&action_id.to_string())).await;
                MetaHttpResponse::ok("Action deleted")
            }
            Err(e) => MetaHttpResponse::bad_request(e),
        }
    }

    #[cfg(not(feature = "enterprise"))]
    {
        let _ = (org_id, action_id);
        MetaHttpResponse::forbidden("Not Supported")
    }
}

/// Delete Action
#[utoipa::path(
    delete,
    path = "/{org_id}/actions/bulk",
    context_path = "/api",
    tag = "Actions",
    operation_id = "DeleteActionBulk",
    summary = "Delete multiple automated action",
    description = "Permanently removes multiple automated actions from the organization. Any action must not be in use by active \
                   workflows or schedules before deletion. Once deleted, any scheduled executions or trigger-based \
                   invocations will stop, and the action configuration cannot be recovered.",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
    ),
    request_body(content = BulkDeleteRequest, description = "Ids for actions to be deleted", content_type = "application/json"),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = BulkDeleteResponse),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Actions", "operation": "delete"})),
        ("x-o2-mcp" = json!({"enabled": false}))
    )
)]
pub async fn delete_action_bulk(
    Path(org_id): Path<String>,
    Headers(user_email): Headers<UserEmail>,
    Json(req): Json<BulkDeleteRequest>,
) -> Response {
    #[cfg(feature = "enterprise")]
    {
        let user_id = user_email.user_id;

        for id in &req.ids {
            if Ksuid::from_str(id).is_err() {
                return MetaHttpResponse::bad_request(format!("invalid action id {id}"));
            };
            if !check_permissions(id, &org_id, &user_id, "actions", "DELETE", None).await {
                return MetaHttpResponse::forbidden("Unauthorized Access");
            }
        }

        let mut successful = Vec::with_capacity(req.ids.len());
        let mut unsuccessful = Vec::with_capacity(req.ids.len());
        let mut err = None;

        for id in req.ids {
            // we have already checked the conversion in the perm checks above,
            // so can unwrap safely
            let action_id = Ksuid::from_str(&id).unwrap();
            match delete_app_from_target_cluster(&org_id, action_id).await {
                Ok(_) => {
                    remove_ownership(&org_id, "actions", Authz::new(&id.to_string())).await;
                    successful.push(id);
                }
                Err(e) => {
                    log::error!("error while deleting action {org_id}/{id} : {e}");
                    unsuccessful.push(id);
                    err = Some(e.to_string());
                }
            }
        }
        MetaHttpResponse::json(BulkDeleteResponse {
            successful,
            unsuccessful,
            err,
        })
    }

    #[cfg(not(feature = "enterprise"))]
    {
        drop(org_id);
        drop(user_email);
        drop(req);
        MetaHttpResponse::forbidden("Not Supported")
    }
}

/// Serve Action zip file
#[utoipa::path(
    get,
    path = "/{org_id}/actions/download/{ksuid}",
    context_path = "/api",
    tag = "Actions",
    operation_id = "GetActionZip",
    summary = "Download action package",
    description = "Downloads the complete action package as a ZIP file containing all source code, configuration files, \
                   dependencies, and metadata for a specific automated action. Useful for backup, version control, \
                   sharing actions across environments, or performing offline analysis of action implementations.",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("ksuid" = String, Path, description = "Action ID"),
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/zip", body = String),
        (status = 400, description = "Error",   content_type = "application/json",body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Actions", "operation": "get"})),
        ("x-o2-mcp" = json!({"enabled": false}))
    )
)]
pub async fn serve_action_zip(Path((org_id, action_id)): Path<(String, String)>) -> Response {
    #[cfg(feature = "enterprise")]
    {
        let action_id = match Ksuid::from_str(&action_id) {
            Ok(id) => id,
            Err(_) => {
                return MetaHttpResponse::not_found(format!("invalid action id {action_id}"));
            }
        };
        match serve_file_from_s3(&org_id, action_id).await {
            Ok((bytes, file_name)) => {
                use axum::{
                    body::Body,
                    http::{StatusCode, header},
                };
                use futures::stream;

                let stream = stream::once(async move { Ok::<Bytes, std::io::Error>(bytes) });

                axum::http::Response::builder()
                    .status(StatusCode::OK)
                    .header(
                        header::CONTENT_DISPOSITION,
                        format!("attachment; filename=\"{file_name}\""),
                    )
                    .header(header::CONTENT_TYPE, "application/zip")
                    .body(Body::from_stream(stream))
                    .unwrap_or_else(|_| Response::new(Body::empty()))
            }
            Err(e) => MetaHttpResponse::bad_request(e),
        }
    }

    #[cfg(not(feature = "enterprise"))]
    {
        let _ = (org_id, action_id);
        MetaHttpResponse::forbidden("Not Supported")
    }
}

/// Update Action
#[utoipa::path(
    put,
    path = "/{org_id}/actions/{action_id}",
    context_path = "/api",
    tag = "Actions",
    operation_id = "UpdateAction",
    summary = "Update automated action",
    description = "Updates the configuration and parameters of an existing automated action. Allows modification of \
                   execution settings, environment variables, scheduling parameters, and other action properties. \
                   Changes take effect on the next execution cycle, ensuring continuous operation with updated \
                   configuration.",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("action_id" = String, Path, description = "Action ID"),
    ),
    request_body(content = inline(config::meta::destinations::Template), description = "Template data", content_type = "application/json"),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = Object),
        (status = 400, description = "Error", content_type = "application/json", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Actions", "operation": "update"})),
        ("x-o2-mcp" = json!({"enabled": false}))
    )
)]
pub async fn update_action_details(
    Path((org_id, action_id)): Path<(String, String)>,
    Json(req): Json<config::meta::actions::action::UpdateActionDetailsRequest>,
) -> Response {
    #[cfg(feature = "enterprise")]
    {
        let action_id = match Ksuid::from_str(&action_id) {
            Ok(id) => id,
            Err(_) => {
                return MetaHttpResponse::not_found(format!("invalid action id {action_id}"));
            }
        };
        let mut req = req;

        // Validate environment variables if they are being updated
        if let Some(ref env_vars) = req.environment_variables
            && let Err(e) = validate_environment_variables(env_vars)
        {
            return MetaHttpResponse::bad_request(e);
        }

        let sa = match req.service_account.clone() {
            None => {
                if let Ok(action) = action_scripts::get(&action_id.to_string(), &org_id).await {
                    action.service_account
                } else {
                    return MetaHttpResponse::bad_request("Failed to fetch action");
                }
            }
            Some(sa) => sa,
        };
        let passcode =
            if let Ok(res) = crate::service::organization::get_passcode(Some(&org_id), &sa).await {
                res.passcode
            } else {
                return MetaHttpResponse::bad_request("Failed to fetch passcode");
            };

        req.service_account = Some(sa);
        match update_app_on_target_cluster(&org_id, action_id, req, &passcode).await {
            Ok(uuid) => MetaHttpResponse::json(serde_json::json!({"uuid":uuid})),
            Err(e) => MetaHttpResponse::bad_request(e),
        }
    }

    #[cfg(not(feature = "enterprise"))]
    {
        drop(org_id);
        drop(action_id);
        drop(req);
        MetaHttpResponse::forbidden("Not Supported")
    }
}

/// List Actions
#[utoipa::path(
    get,
    path = "/{org_id}/actions",
    context_path = "/api",
    tag = "Actions",
    operation_id = "ListActions",
    summary = "List automated actions",
    description = "Retrieves a list of all automated actions configured for the organization. Returns action metadata \
                   including names, status, execution schedules, and basic configuration details. Helps administrators \
                   manage automation workflows, monitor action health, and understand the complete automation landscape \
                   across the organization.",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = Object),
        (status = 400, description = "Error", content_type = "application/json", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Actions", "operation": "list"})),
        ("x-o2-mcp" = json!({"enabled": false}))
    )
)]
pub async fn list_actions(Path(org_id): Path<String>) -> Response {
    #[cfg(feature = "enterprise")]
    {
        if let Ok(list) = get_actions(&org_id).await {
            if let Ok(list) = list
                .into_iter()
                .map(GetActionInfoResponse::try_from)
                .collect::<Result<Vec<GetActionInfoResponse>, _>>()
            {
                MetaHttpResponse::json(list)
            } else {
                MetaHttpResponse::bad_request("Failed to transform actions")
            }
        } else {
            MetaHttpResponse::bad_request("Failed to fetch actions")
        }
    }

    #[cfg(not(feature = "enterprise"))]
    {
        drop(org_id);
        MetaHttpResponse::forbidden("Not Supported")
    }
}

/// Get single Action
#[utoipa::path(
    get,
    path = "/{org_id}/actions/{action_id}",
    context_path = "/api",
    tag = "Actions",
    operation_id = "GetAction",
    summary = "Get automated action details",
    description = "Retrieves complete configuration and runtime details for a specific automated action. Returns \
                   execution parameters, environment variables, scheduling configuration, execution history, and \
                   performance metrics. Used for monitoring action behavior, troubleshooting issues, and reviewing \
                   automation settings.",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("action_id" = String, Path, description = "Action ID"),
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = Object),
        (status = 400, description = "Error", content_type = "application/json", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Actions", "operation": "get"})),
        ("x-o2-mcp" = json!({"enabled": false}))
    )
)]
pub async fn get_action_from_id(Path((org_id, action_id)): Path<(String, String)>) -> Response {
    #[cfg(feature = "enterprise")]
    {
        match get_action_details(&org_id, &action_id).await {
            Ok(action) => {
                if let Ok(resp) = GetActionDetailsResponse::try_from(action) {
                    MetaHttpResponse::json(resp)
                } else {
                    MetaHttpResponse::bad_request("Failed to fetch action details")
                }
            }
            Err(e) => MetaHttpResponse::bad_request(e),
        }
    }

    #[cfg(not(feature = "enterprise"))]
    {
        drop(org_id);
        drop(action_id);
        MetaHttpResponse::forbidden("Not Supported")
    }
}

/// UploadZippedAction
///
/// Upload a zipped action file and process it.
/// This endpoint allows uploading a ZIP file containing an action, which will be extracted,
/// processed, and executed.
#[utoipa::path(
    post,
    path = "/{org_id}/actions/upload",
    context_path = "/api",
    tag = "Actions",
    operation_id = "UploadZippedAction",
    summary = "Upload automated action package",
    description = "Uploads a ZIP file containing an automated action package with source code, configuration, and \
                   dependencies. The package is extracted, validated, and deployed to the action execution \
                   environment. Supports both new action creation and updates to existing actions. Includes validation \
                   of environment variables, execution parameters, and package integrity.",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
    ),
    responses(
        (status = 200, description = "Action processed successfully", content_type = "application/json", body = String),
        (status = 400, description = "Error processing action", content_type = "application/json", body = String),
        (status = 500, description = "Internal server error", content_type = "application/json", body = String),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Actions", "operation": "create"})),
        ("x-o2-mcp" = json!({"enabled": false}))
    )
)]
pub async fn upload_zipped_action(
    Path(org_id): Path<String>,
    Headers(user_email): Headers<UserEmail>,
    #[cfg_attr(not(feature = "enterprise"), allow(unused_mut))] mut multipart: Multipart,
) -> Response {
    #[cfg(feature = "enterprise")]
    {
        let mut file_data = Vec::new();
        let mut is_update = false;
        let mut action = Action {
            org_id: org_id.clone(),
            ..Default::default()
        };

        let mut received_fields = Vec::new();
        while let Ok(Some(field)) = multipart.next_field().await {
            let field_name = field.name().unwrap_or("").to_string();

            match field_name.as_str() {
                "description" => {
                    received_fields.push("description");
                    let bytes = match field.bytes().await {
                        Ok(b) => b,
                        Err(_) => {
                            return MetaHttpResponse::bad_request(
                                "Failed to read description field",
                            );
                        }
                    };
                    if let Ok(description) = String::from_utf8(bytes.to_vec()) {
                        action.description = Some(description);
                    } else {
                        return MetaHttpResponse::bad_request(
                            "Description field contains invalid UTF-8 data",
                        );
                    }
                }
                "file" => {
                    received_fields.push("file");
                    if let Some(name) = field.file_name() {
                        action.zip_file_name = name.to_string();
                    }

                    let bytes = match field.bytes().await {
                        Ok(b) => b,
                        Err(_) => return MetaHttpResponse::bad_request("Failed to read file"),
                    };
                    file_data = bytes.to_vec();
                    if file_data.is_empty() {
                        return MetaHttpResponse::bad_request("File is missing or empty");
                    }
                }
                "filename" => {
                    received_fields.push("filename");
                    let bytes = match field.bytes().await {
                        Ok(b) => b,
                        Err(_) => {
                            return MetaHttpResponse::bad_request("Failed to read filename field");
                        }
                    };
                    if bytes.is_empty() {
                        return MetaHttpResponse::bad_request("Filename field is missing or empty");
                    }
                    if let Ok(filename) = String::from_utf8(bytes.to_vec()) {
                        action.zip_file_name = filename;
                    } else {
                        return MetaHttpResponse::bad_request(
                            "Filename field contains invalid UTF-8 data",
                        );
                    }
                }
                "name" => {
                    received_fields.push("name");
                    let bytes = match field.bytes().await {
                        Ok(b) => b,
                        Err(_) => {
                            return MetaHttpResponse::bad_request("Failed to read name field");
                        }
                    };
                    if bytes.is_empty() {
                        return MetaHttpResponse::bad_request("Name field is missing or empty");
                    }
                    if let Ok(name) = String::from_utf8(bytes.to_vec()) {
                        action.name = name;
                    } else {
                        return MetaHttpResponse::bad_request(
                            "Name field contains invalid UTF-8 data",
                        );
                    }
                }
                "execution_details" => {
                    received_fields.push("execution_details");
                    let bytes = match field.bytes().await {
                        Ok(b) => b,
                        Err(_) => {
                            return MetaHttpResponse::bad_request(
                                "Failed to read execution_details field",
                            );
                        }
                    };
                    if bytes.is_empty() {
                        return MetaHttpResponse::bad_request(
                            "Execution details field is missing or empty",
                        );
                    }
                    if let Ok(exec_details) = std::str::from_utf8(&bytes) {
                        if let Ok(exec_details_type) = ExecutionDetailsType::try_from(exec_details)
                        {
                            action.execution_details = exec_details_type;
                        } else {
                            return MetaHttpResponse::bad_request("Invalid execution details");
                        }
                    } else {
                        return MetaHttpResponse::bad_request(
                            "Execution details field contains invalid UTF-8 data",
                        );
                    }
                }
                "cron_expr" => {
                    received_fields.push("cron_expr");
                    let bytes = match field.bytes().await {
                        Ok(b) => b,
                        Err(_) => {
                            return MetaHttpResponse::bad_request("Failed to read cron_expr field");
                        }
                    };
                    if let Ok(cron) = String::from_utf8(bytes.to_vec()) {
                        action.cron_expr = Some(cron);
                    } else {
                        return MetaHttpResponse::bad_request(
                            "Cron expression contains invalid UTF-8 data",
                        );
                    }
                }
                "environment_variables" => {
                    received_fields.push("environment_variables");
                    let bytes = match field.bytes().await {
                        Ok(b) => b,
                        Err(_) => {
                            return MetaHttpResponse::bad_request(
                                "Failed to read environment_variables field",
                            );
                        }
                    };
                    if let Ok(env_vars) = String::from_utf8(bytes.to_vec()) {
                        if let Ok(env_vars) = serde_json::from_str(&env_vars) {
                            // Validate environment variables before assigning
                            if let Err(e) = validate_environment_variables(&env_vars) {
                                return MetaHttpResponse::bad_request(e);
                            }
                            action.environment_variables = env_vars;
                        } else {
                            return MetaHttpResponse::bad_request(
                                "Invalid JSON in environment variables",
                            );
                        }
                    } else {
                        return MetaHttpResponse::bad_request(
                            "Invalid JSON in environment variables",
                        );
                    }
                }
                "owner" => {
                    received_fields.push("owner");
                    let bytes = match field.bytes().await {
                        Ok(b) => b,
                        Err(_) => {
                            return MetaHttpResponse::bad_request("Failed to read owner field");
                        }
                    };
                    if let Ok(owner) = String::from_utf8(bytes.to_vec()) {
                        action.created_by = owner;
                    } else {
                        return MetaHttpResponse::bad_request(
                            "Owner field contains invalid UTF-8 data",
                        );
                    }
                }
                "id" => {
                    received_fields.push("id");
                    let bytes = match field.bytes().await {
                        Ok(b) => b,
                        Err(_) => return MetaHttpResponse::bad_request("Failed to read id field"),
                    };
                    if let Ok(id) = String::from_utf8(bytes.to_vec()) {
                        if let Ok(id) = Ksuid::from_str(&id) {
                            action.id = Some(id);
                            is_update = true;
                        } else {
                            return MetaHttpResponse::bad_request("Invalid ID");
                        }
                    } else {
                        return MetaHttpResponse::bad_request("Invalid ID");
                    }
                }
                "service_account" => {
                    received_fields.push("service_account");
                    let bytes = match field.bytes().await {
                        Ok(b) => b,
                        Err(_) => {
                            return MetaHttpResponse::bad_request(
                                "Failed to read service_account field",
                            );
                        }
                    };
                    if let Ok(service_account) = String::from_utf8(bytes.to_vec()) {
                        action.service_account = service_account;
                    } else {
                        return MetaHttpResponse::bad_request(
                            "Service account field contains invalid UTF-8 data",
                        );
                    }
                }
                _ => {}
            }
        }

        if !MANDATORY_FIELDS_FOR_ACTION_CREATION
            .iter()
            .all(|field| received_fields.contains(field))
        {
            return MetaHttpResponse::bad_request("Missing mandatory fields");
        }

        // If action ID is present as field then we know its an update request
        // Hence we treat it as a PUT request and check for permissions
        let method = match action.id {
            Some(_) => "PUT",
            None => "POST",
        };
        // the default to org_id is what the original check_permission impl would do
        let action_id = action
            .id
            .map(|ksuid| ksuid.to_string())
            .unwrap_or(org_id.clone());
        if !check_permissions(
            &action_id,
            &org_id,
            &user_email.user_id,
            "actions",
            method,
            None,
        )
        .await
        {
            return MetaHttpResponse::forbidden("Unauthorized Access");
        }

        if file_data.is_empty() {
            return MetaHttpResponse::bad_request("Uploaded file is empty");
        }

        let file_path = format!("files/{}/actions/{}", org_id, action.zip_file_name);

        let passcode = if let Ok(res) = get_passcode(Some(&org_id), &action.service_account).await {
            res.passcode
        } else {
            return MetaHttpResponse::bad_request("Failed to fetch passcode");
        };

        // Attempt to read the uploaded data as a ZIP file
        match zip::read::ZipArchive::new(std::io::Cursor::new(file_data)) {
            Ok(archive) => {
                log::info!("Successfully read ZIP archive with {} files", archive.len());
                match register_app(action, archive, &file_path, &passcode).await {
                    Ok(uuid) => {
                        if !is_update {
                            set_ownership(&org_id, "actions", Authz::new(&uuid.to_string())).await;
                        }
                        MetaHttpResponse::json(serde_json::json!({"uuid":uuid}))
                    }
                    Err(e) => {
                        MetaHttpResponse::bad_request(format!("Failed to process action:{}", e))
                    }
                }
            }
            Err(e) => {
                log::error!("Error reading ZIP file: {e}");
                MetaHttpResponse::bad_request(format!("Error reading ZIP file: {e}"))
            }
        }
    }

    #[cfg(not(feature = "enterprise"))]
    {
        drop(org_id);
        drop(user_email);
        drop(multipart);
        MetaHttpResponse::forbidden("Not Supported")
    }
}
