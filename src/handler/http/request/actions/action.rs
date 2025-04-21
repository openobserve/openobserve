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

use std::io::Error;

use actix_multipart::Multipart;
use actix_web::{HttpRequest, HttpResponse, delete, get, post, put, web};
use config::meta::actions::action::UpdateActionDetailsRequest;
use svix_ksuid::Ksuid;
#[cfg(feature = "enterprise")]
use {
    crate::{
        common::{
            meta::{authz::Authz, http::HttpResponse as MetaHttpResponse},
            utils::auth::{check_permissions, remove_ownership, set_ownership},
        },
        handler::http::models::action::{GetActionDetailsResponse, GetActionInfoResponse},
        service::organization::get_passcode,
    },
    bytes::Bytes,
    config::meta::actions::action::{Action, ExecutionDetailsType},
    futures::{StreamExt, TryStreamExt},
    futures_util::stream::{self},
    infra::table::action_scripts,
    o2_enterprise::enterprise::actions::action_manager::{
        delete_app_from_target_cluster, get_action_details, get_actions, register_app,
        serve_file_from_s3, update_app_on_target_cluster, register_empty_action
    },
    once_cell::sync::Lazy,
    regex::Regex,
    serde_json,
    std::collections::HashMap,
    std::str::FromStr,
};

use crate::common::utils::auth::UserEmail;

#[cfg(feature = "enterprise")]
const MANDATORY_FIELDS_FOR_ACTION_CREATION: [&str; 3] =
    ["name", "owner", "execution_details"];
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

#[cfg(feature = "enterprise")]
struct MultipartActionData {
    action: Action,
    file_data: Vec<u8>,
    received_fields: Vec<String>,
}

#[cfg(feature = "enterprise")]
async fn process_action_multipart(
    org_id: String,
    mut payload: Multipart,
    req: &HttpRequest,
) -> Result<MultipartActionData, HttpResponse> {
    let mut file_data = Vec::new();
    let mut action = Action {
        org_id: org_id.clone(),
        ..Default::default()
    };

    // Validate Content-Type
    if let Some(content_type) = req.headers().get("Content-Type") {
        match content_type.to_str() {
            Ok(content_type_str) => {
                if !content_type_str.contains("multipart/form-data") {
                    return Err(HttpResponse::BadRequest().body("Invalid Content-Type"));
                }
            }
            Err(_) => {
                return Err(HttpResponse::BadRequest().body("Invalid Content-Type header value"));
            }
        }
    }

    let mut received_fields = Vec::new();
    while let Ok(Some(mut field)) = payload.try_next().await {
        match field.name().unwrap_or("") {
            "description" => {
                received_fields.push("description".to_string());
                let mut description = Vec::new();
                while let Some(chunk) = field.next().await {
                    match chunk {
                        Ok(bytes) => description.extend_from_slice(&bytes),
                        Err(_) => {
                            return Err(HttpResponse::BadRequest()
                                .body("Failed to read description field"));
                        }
                    }
                }
                if let Ok(description) = String::from_utf8(description) {
                    action.description = Some(description);
                } else {
                    return Err(HttpResponse::BadRequest()
                        .body("Description field contains invalid UTF-8 data"));
                }
            }
            "file" => {
                received_fields.push("file".to_string());
                if let Some(name) = field.content_disposition() {
                    action.zip_file_name = name.to_string();
                }

                while let Some(chunk) = field.next().await {
                    match chunk {
                        Ok(bytes) => file_data.extend_from_slice(&bytes),
                        Err(_) => {
                            return Err(HttpResponse::BadRequest().body("Failed to read file"));
                        }
                    }
                }
                if file_data.is_empty() {
                    return Err(HttpResponse::BadRequest().body("File is missing or empty"));
                }
            }
            "filename" => {
                received_fields.push("filename".to_string());
                let mut filename = Vec::new();
                while let Some(chunk) = field.next().await {
                    match chunk {
                        Ok(bytes) => filename.extend_from_slice(&bytes),
                        Err(_) => {
                            return Err(HttpResponse::BadRequest()
                                .body("Failed to read filename field"));
                        }
                    }
                }
                if filename.is_empty() {
                    return Err(
                        HttpResponse::BadRequest().body("Filename field is missing or empty")
                    );
                }
                if let Ok(filename) = String::from_utf8(filename) {
                    action.zip_file_name = filename;
                } else {
                    return Err(HttpResponse::BadRequest()
                        .body("Filename field contains invalid UTF-8 data"));
                }
            }
            "name" => {
                received_fields.push("name".to_string());
                let mut name = Vec::new();
                while let Some(chunk) = field.next().await {
                    match chunk {
                        Ok(bytes) => name.extend_from_slice(&bytes),
                        Err(_) => {
                            return Err(
                                HttpResponse::BadRequest().body("Failed to read name field")
                            );
                        }
                    }
                }
                if name.is_empty() {
                    return Err(
                        HttpResponse::BadRequest().body("Name field is missing or empty")
                    );
                }
                if let Ok(name) = String::from_utf8(name) {
                    action.name = name;
                } else {
                    return Err(HttpResponse::BadRequest()
                        .body("Name field contains invalid UTF-8 data"));
                }
            }
            "execution_details" => {
                received_fields.push("execution_details".to_string());
                let mut details = Vec::new();
                while let Some(chunk) = field.next().await {
                    match chunk {
                        Ok(bytes) => details.extend_from_slice(&bytes),
                        Err(_) => {
                            return Err(HttpResponse::BadRequest()
                                .body("Failed to read execution_details field"));
                        }
                    }
                }
                if details.is_empty() {
                    return Err(HttpResponse::BadRequest()
                        .body("Execution details field is missing or empty"));
                }
                if let Ok(exec_details) = std::str::from_utf8(&details) {
                    if let Ok(exec_details_type) = ExecutionDetailsType::try_from(exec_details)
                    {
                        action.execution_details = exec_details_type;
                    } else {
                        return Err(HttpResponse::BadRequest().body("Invalid execution details"));
                    }
                } else {
                    return Err(HttpResponse::BadRequest()
                        .body("Execution details field contains invalid UTF-8 data"));
                }
            }
            "cron_expr" => {
                received_fields.push("cron_expr".to_string());
                let mut cron = Vec::new();
                while let Some(chunk) = field.next().await {
                    match chunk {
                        Ok(bytes) => cron.extend_from_slice(&bytes),
                        Err(_) => {
                            return Err(HttpResponse::BadRequest()
                                .body("Failed to read cron_expr field"));
                        }
                    }
                }
                if let Ok(cron) = String::from_utf8(cron) {
                    action.cron_expr = Some(cron);
                } else {
                    return Err(HttpResponse::BadRequest()
                        .body("Cron expression contains invalid UTF-8 data"));
                }
            }
            "environment_variables" => {
                received_fields.push("environment_variables".to_string());
                let mut env_vars = Vec::new();
                while let Some(chunk) = field.next().await {
                    match chunk {
                        Ok(bytes) => env_vars.extend_from_slice(&bytes),
                        Err(_) => {
                            return Err(HttpResponse::BadRequest()
                                .body("Failed to read environment_variables field"));
                        }
                    }
                }
                if let Ok(env_vars) = String::from_utf8(env_vars) {
                    if let Ok(env_vars) = serde_json::from_str(&env_vars) {
                        // Validate environment variables before assigning
                        if let Err(e) = validate_environment_variables(&env_vars) {
                            return Err(MetaHttpResponse::bad_request(e));
                        }
                        action.environment_variables = env_vars;
                    } else {
                        return Err(HttpResponse::BadRequest()
                            .body("Invalid JSON in environment variables"));
                    }
                } else {
                    return Err(HttpResponse::BadRequest()
                        .body("Invalid JSON in environment variables"));
                }
            }
            "owner" => {
                received_fields.push("owner".to_string());
                let mut owner = Vec::new();
                while let Some(chunk) = field.next().await {
                    match chunk {
                        Ok(bytes) => owner.extend_from_slice(&bytes),
                        Err(_) => {
                            return Err(
                                HttpResponse::BadRequest().body("Failed to read owner field")
                            );
                        }
                    }
                }
                if let Ok(owner) = String::from_utf8(owner) {
                    action.created_by = owner;
                } else {
                    return Err(HttpResponse::BadRequest()
                        .body("Owner field contains invalid UTF-8 data"));
                }
            }
            "id" => {
                received_fields.push("id".to_string());
                let mut id = Vec::new();
                while let Some(chunk) = field.next().await {
                    match chunk {
                        Ok(bytes) => id.extend_from_slice(&bytes),
                        Err(_) => {
                            return Err(
                                HttpResponse::BadRequest().body("Failed to read id field")
                            );
                        }
                    }
                }
                if let Ok(id) = String::from_utf8(id) {
                    if let Ok(id) = Ksuid::from_str(&id) {
                        action.id = Some(id);
                    } else {
                        return Err(HttpResponse::BadRequest().body("Invalid ID"));
                    }
                } else {
                    return Err(HttpResponse::BadRequest().body("Invalid ID"));
                }
            }
            "service_account" => {
                received_fields.push("service_account".to_string());
                let mut service_account = Vec::new();
                while let Some(chunk) = field.next().await {
                    match chunk {
                        Ok(bytes) => service_account.extend_from_slice(&bytes),
                        Err(_) => {
                            return Err(HttpResponse::BadRequest()
                                .body("Failed to read service_account field"));
                        }
                    }
                }
                if let Ok(service_account) = String::from_utf8(service_account) {
                    action.service_account = service_account;
                } else {
                    return Err(HttpResponse::BadRequest()
                        .body("Service account field contains invalid UTF-8 data"));
                }
            }
            _ => {}
        }
    }

    Ok(MultipartActionData {
        action,
        file_data,
        received_fields,
    })
}

/// Delete Action
///
/// #{"ratelimit_module":"Actions", "ratelimit_module_operation":"delete"}#
#[utoipa::path(
    context_path = "/api",
    tag = "Actions",
    operation_id = "DeleteAction",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
    ),
    request_body(content = Template, description = "Template data", content_type ="application/json"),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body =HttpResponse),
        (status = 400, description = "Error",   content_type = "application/json",body = HttpResponse),
    )
)]
#[delete("/{org_id}/actions/{ksuid}")]
pub async fn delete_action(path: web::Path<(String, Ksuid)>) -> Result<HttpResponse, Error> {
    #[cfg(feature = "enterprise")]
    {
        let (org_id, ksuid) = path.into_inner();
        match delete_app_from_target_cluster(&org_id, ksuid).await {
            Ok(_) => {
                remove_ownership(&org_id, "actions", Authz::new(&ksuid.to_string())).await;
                Ok(MetaHttpResponse::ok("Action deleted"))
            }
            Err(e) => Ok(MetaHttpResponse::bad_request(e)),
        }
    }

    #[cfg(not(feature = "enterprise"))]
    {
        drop(path);
        Ok(HttpResponse::Forbidden().json("Not Supported"))
    }
}

/// Serve Action zip file
///
/// #{"ratelimit_module":"Actions", "ratelimit_module_operation":"get"}#
#[utoipa::path(
    context_path = "/api",
    tag = "Actions",
    operation_id = "GetActionZip",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
    ),
    request_body(content = Template, description = "Template data", content_type ="application/json"),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body =HttpResponse),
        (status = 400, description = "Error",   content_type = "application/json",body = HttpResponse),
    )
)]
#[get("/{org_id}/actions/download/{ksuid}")]
pub async fn serve_action_zip(path: web::Path<(String, Ksuid)>) -> Result<HttpResponse, Error> {
    #[cfg(feature = "enterprise")]
    {
        let (org_id, ksuid) = path.into_inner();
        match serve_file_from_s3(&org_id, ksuid).await {
            Ok((bytes, file_name)) => {
                let resp = HttpResponse::Ok()
                    .insert_header((
                        "Content-Disposition",
                        format!("attachment; filename=\"{}\"", file_name),
                    ))
                    .content_type("application/zip")
                    .streaming(stream::once(async { Ok::<Bytes, actix_web::Error>(bytes) }));
                Ok(resp)
            }
            Err(e) => Ok(MetaHttpResponse::bad_request(e)),
        }
    }

    #[cfg(not(feature = "enterprise"))]
    {
        drop(path);
        Ok(HttpResponse::Forbidden().json("Not Supported"))
    }
}

/// Update Action
///
/// #{"ratelimit_module":"Actions", "ratelimit_module_operation":"update"}#
#[utoipa::path(
    context_path = "/api",
    tag = "Actions",
    operation_id = "UpdateAction",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
    ),
    request_body(content = Template, description = "Template data", content_type =
"application/json"),     responses(
        (status = 200, description = "Success", content_type = "application/json", body =
HttpResponse),         (status = 400, description = "Error",   content_type = "application/json",
body = HttpResponse),     )
)]
#[put("/{org_id}/actions/{action_id}")]
pub async fn update_action_details(
    path: web::Path<(String, Ksuid)>,
    req: Option<web::Json<UpdateActionDetailsRequest>>,
    payload: Option<Multipart>,
    http_req: HttpRequest,
    user_email: UserEmail,
) -> Result<HttpResponse, Error> {
    #[cfg(feature = "enterprise")]
    {
        let (org_id, ksuid) = path.into_inner();
        
        // Check if this is a multipart request (ZIP update) or JSON request
        if let Some(payload) = payload {
            // Process the multipart request
            let multipart_data = match process_action_multipart(org_id.clone(), payload, &http_req).await {
                Ok(data) => data,
                Err(response) => return Ok(response),
            };
            
            // Check for mandatory fields
            if !MANDATORY_FIELDS_FOR_ACTION_CREATION
                .iter()
                .all(|field| multipart_data.received_fields.contains(&field.to_string()))
            {
                return Ok(HttpResponse::BadRequest().body("Missing mandatory fields"));
            }
            
            // Check permissions
            if !check_permissions(
                multipart_data.action.id.map(|ksuid| ksuid.to_string()),
                &org_id,
                &user_email.user_id,
                "actions",
                "PUT",
                "",
            )
            .await
            {
                return Ok(HttpResponse::Forbidden().body("Unauthorized Access"));
            }
            
            if multipart_data.file_data.is_empty() {
                // Create Action without source code. Only update metadata
                match register_empty_action(multipart_data.action).await {
                    Ok(ksuid) => {
                        return Ok(MetaHttpResponse::json(serde_json::json!({"uuid":ksuid})));
                    }
                    Err(e) => {
                        return Ok(MetaHttpResponse::bad_request(e));
                    }
                }
            }
            
            let file_path = format!("files/{}/actions/{}", org_id, multipart_data.action.zip_file_name);
            
            let passcode = if let Ok(res) = get_passcode(Some(&org_id), &multipart_data.action.service_account).await {
                res.passcode
            } else {
                return Ok(HttpResponse::BadRequest().body("Failed to fetch passcode"));
            };
            
            // Upload and register the app
            match zip::read::ZipArchive::new(std::io::Cursor::new(multipart_data.file_data)) {
                Ok(archive) => {
                    log::info!("Successfully read ZIP archive with {} files", archive.len());
                    match register_app(multipart_data.action, archive, &file_path, &passcode).await {
                        Ok(uuid) => {
                            // No need to set ownership on update (PUT)
                            Ok(MetaHttpResponse::json(serde_json::json!({"uuid":uuid})))
                        }
                        Err(e) => Ok(HttpResponse::BadRequest().json(
                            serde_json::json!({"message":format!("Failed to process action:{}", e)}),
                        )),
                    }
                }
                Err(e) => {
                    log::error!("Error reading ZIP file: {:?}", e);
                    Ok(HttpResponse::BadRequest().json(
                        serde_json::json!({"message":format!("Error reading ZIP file: {:?}", e)}),
                    ))
                }
            }
        } else if let Some(req) = req {
            // Handle JSON update as before
            let mut req = req.into_inner();

            // Validate environment variables if they are being updated
            if let Some(ref env_vars) = req.environment_variables {
                if let Err(e) =
                    crate::handler::http::request::actions::action::validate_environment_variables(
                        env_vars,
                    )
                {
                    return Ok(MetaHttpResponse::bad_request(e));
                }
            }

            let sa = match req.service_account.clone() {
                None => {
                    if let Ok(action) = action_scripts::get(&ksuid.to_string(), &org_id).await {
                        action.service_account
                    } else {
                        return Ok(MetaHttpResponse::bad_request("Failed to fetch action"));
                    }
                }
                Some(sa) => sa,
            };
            let passcode =
                if let Ok(res) = crate::service::organization::get_passcode(Some(&org_id), &sa).await {
                    res.passcode
                } else {
                    return Ok(MetaHttpResponse::bad_request("Failed to fetch passcode"));
                };

            req.service_account = Some(sa);
            match update_app_on_target_cluster(&org_id, ksuid, req, &passcode).await {
                Ok(uuid) => Ok(MetaHttpResponse::json(serde_json::json!({"uuid":uuid}))),
                Err(e) => Ok(MetaHttpResponse::bad_request(e)),
            }
        } else {
            Ok(MetaHttpResponse::bad_request("Invalid request format"))
        }
    }

    #[cfg(not(feature = "enterprise"))]
    {
        drop(path);
        drop(req);
        drop(payload);
        drop(http_req);
        drop(user_email);
        Ok(HttpResponse::Forbidden().json("Not Supported"))
    }
}

/// List Actions
///
/// #{"ratelimit_module":"Actions", "ratelimit_module_operation":"list"}#
#[utoipa::path(
    context_path = "/api",
    tag = "Actions",
    operation_id = "ListActions",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
    ),
    request_body(content = Template, description = "Template data", content_type =
"application/json"),     responses(
        (status = 200, description = "Success", content_type = "application/json", body =
HttpResponse),         (status = 400, description = "Error",   content_type = "application/json",
body = HttpResponse),     )
)]
#[get("/{org_id}/actions")]
pub async fn list_actions(path: web::Path<String>) -> Result<HttpResponse, Error> {
    #[cfg(feature = "enterprise")]
    {
        let org_id = path.into_inner();

        if let Ok(list) = get_actions(&org_id).await {
            if let Ok(list) = list
                .into_iter()
                .map(GetActionInfoResponse::try_from)
                .collect::<Result<Vec<GetActionInfoResponse>, _>>()
            {
                Ok(MetaHttpResponse::json(list))
            } else {
                Ok(MetaHttpResponse::bad_request("Failed to transform actions"))
            }
        } else {
            Ok(MetaHttpResponse::bad_request("Failed to fetch actions"))
        }
    }

    #[cfg(not(feature = "enterprise"))]
    {
        drop(path);
        Ok(HttpResponse::Forbidden().json("Not Supported"))
    }
}

/// Get single Action
///
/// #{"ratelimit_module":"Actions", "ratelimit_module_operation":"get"}#
#[utoipa::path(
    context_path = "/api",
    tag = "Actions",
    operation_id = "GetAction",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("action_id" = String, Path, description = "Action ID"),
    ),
    request_body(content = Template, description = "Template data", content_type =
"application/json"),     responses(
        (status = 200, description = "Success", content_type = "application/json", body =
HttpResponse),         (status = 400, description = "Error",   content_type = "application/json",
body = HttpResponse),     )
)]
#[get("/{org_id}/actions/{action_id}")]
pub async fn get_action_from_id(path: web::Path<(String, String)>) -> Result<HttpResponse, Error> {
    #[cfg(feature = "enterprise")]
    {
        let (org_id, action_id) = path.into_inner();
        match get_action_details(&org_id, &action_id).await {
            Ok(action) => {
                if let Ok(resp) = GetActionDetailsResponse::try_from(action) {
                    Ok(MetaHttpResponse::json(resp))
                } else {
                    Ok(MetaHttpResponse::bad_request(
                        "Failed to fetch action details",
                    ))
                }
            }
            Err(e) => Ok(MetaHttpResponse::bad_request(e)),
        }
    }

    #[cfg(not(feature = "enterprise"))]
    {
        drop(path);
        Ok(HttpResponse::Forbidden().json("Not Supported"))
    }
}

/// UploadZippedAction
///
/// Upload a zipped action file and process it.
/// This endpoint allows uploading a ZIP file containing an action, which will be extracted,
/// processed, and executed.
/// #{"ratelimit_module":"Actions", "ratelimit_module_operation":"create"}#
#[utoipa::path(
    context_path = "/api",
    tag = "Actions",
    operation_id = "UploadZippedAction",
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
    )
)]
#[post("/{org_id}/actions/upload")]
pub async fn upload_zipped_action(
    path: web::Path<String>,
    #[cfg_attr(not(feature = "enterprise"), allow(unused_mut))] payload: Multipart,
    req: HttpRequest,
    user_email: UserEmail,
) -> Result<HttpResponse, Error> {
    #[cfg(feature = "enterprise")]
    {
        let org_id = path.into_inner();
        
        // Process the multipart request
        let multipart_data = match process_action_multipart(org_id.clone(), payload, &req).await {
            Ok(data) => data,
            Err(response) => return Ok(response),
        };
        
        // Check if the multipart data has an id
        if multipart_data.action.id.is_some() {
            return Ok(HttpResponse::BadRequest().body("ID is not allowed in multipart request"));
        }
        
        // Check for mandatory fields
        if !MANDATORY_FIELDS_FOR_ACTION_CREATION
            .iter()
            .all(|field| multipart_data.received_fields.contains(&field.to_string()))
        {
            return Ok(HttpResponse::BadRequest().body("Missing mandatory fields"));
        }
        
        if !check_permissions(
            multipart_data.action.id.map(|ksuid| ksuid.to_string()),
            &org_id,
            &user_email.user_id,
            "actions",
            "POST",
            "",
        )
        .await
        {
            return Ok(HttpResponse::Forbidden().body("Unauthorized Access"));
        }
        
        if multipart_data.file_data.is_empty() {
            return Ok(HttpResponse::BadRequest().body("Uploaded file is empty"));
        }
        
        let file_path = format!("files/{}/actions/{}", org_id, multipart_data.action.zip_file_name);
        
        let passcode = if let Ok(res) = get_passcode(Some(&org_id), &multipart_data.action.service_account).await {
            res.passcode
        } else {
            return Ok(HttpResponse::BadRequest().body("Failed to fetch passcode"));
        };
        
        // Upload and register the app
        match zip::read::ZipArchive::new(std::io::Cursor::new(multipart_data.file_data)) {
            Ok(archive) => {
                log::info!("Successfully read ZIP archive with {} files", archive.len());
                match register_app(multipart_data.action, archive, &file_path, &passcode).await {
                    Ok(uuid) => {
                        set_ownership(&org_id, "actions", Authz::new(&uuid.to_string())).await;
                        Ok(MetaHttpResponse::json(serde_json::json!({"uuid":uuid})))
                    }
                    Err(e) => Ok(HttpResponse::BadRequest().json(
                        serde_json::json!({"message":format!("Failed to process action:{}", e)}),
                    )),
                }
            }
            Err(e) => {
                log::error!("Error reading ZIP file: {:?}", e);
                Ok(HttpResponse::BadRequest().json(
                    serde_json::json!({"message":format!("Error reading ZIP file: {:?}", e)}),
                ))
            }
        }
    }

    #[cfg(not(feature = "enterprise"))]
    {
        drop(path);
        let _ = payload;
        drop(req);
        drop(user_email);
        Ok(HttpResponse::Forbidden().json("Not Supported"))
    }
}
