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

use std::io::Error;

use actix_multipart::Multipart;
use actix_web::{delete, get, post, put, web, HttpRequest, HttpResponse};
use config::meta::actions::action::Action;
use futures::{StreamExt, TryStreamExt};
use infra::table::action_scripts::ActionScriptDetails;
use o2_enterprise::enterprise::actions::action::read_action_from_zip;
#[cfg(feature = "enterprise")]
use o2_enterprise::enterprise::actions::action::{
    delete_action_by_id, get_action_details, get_actions, save_and_run_action,
};

use crate::common::meta::http::HttpResponse as MetaHttpResponse;
/// Save Action
#[cfg(feature = "enterprise")]
#[utoipa::path(
    context_path = "/api",
    tag = "Actions",
    operation_id = "Create Action",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
    ),
    request_body(content = Template, description = "Template data", content_type = "application/json"),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = HttpResponse),
        (status = 400, description = "Error",   content_type = "application/json", body = HttpResponse),
    )
)]
#[post("/{org_id}/actions")]
pub async fn save_action(
    path: web::Path<String>,
    action: web::Json<Action>,
) -> Result<HttpResponse, Error> {
    let org_id = path.into_inner();
    let action = action.into_inner();
    match save_and_run_action(&*org_id, action).await {
        Ok(uuid) => Ok(MetaHttpResponse::json(serde_json::json!({"uuid":uuid}))),
        Err(e) => Ok(MetaHttpResponse::bad_request(e)),
    }
}

/// Delete Action
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
pub async fn delete_action(path: web::Path<(String, String)>) -> Result<HttpResponse, Error> {
    let (_org_id, ksuid) = path.into_inner();
    match delete_action_by_id(&ksuid).await {
        Ok(_) => Ok(MetaHttpResponse::ok("Action deleted")),
        Err(e) => Ok(MetaHttpResponse::bad_request(e)),
    }
}

/// Update Action
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
#[put("/{org_id}/actions")]
pub async fn update_action(
    path: web::Path<String>,
    action: web::Json<Action>,
) -> Result<HttpResponse, Error> {
    todo!();
}

/// List Actions
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
    let org_id = path.into_inner();

    Ok(get_actions(&org_id).await.map_or_else(
        |e| MetaHttpResponse::bad_request(e),
        |actions| MetaHttpResponse::json(actions),
    ))
}

/// Get single Action
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
    let (org_id, action_id) = path.into_inner();
    match get_action_details(&org_id, &action_id).await {
        Ok(action) => Ok(MetaHttpResponse::json(action)),
        Err(e) => Ok(MetaHttpResponse::bad_request(e)),
    }
}

/// Upload a zipped action file and process it.
/// This endpoint allows uploading a ZIP file containing an action, which will be extracted,
/// processed, and executed.
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
    mut payload: Multipart,
    req: HttpRequest,
) -> Result<HttpResponse, Error> {
    let org_id = path.into_inner();
    let mut data = Vec::new();

    // Validate Content-Type
    if let Some(content_type) = req.headers().get("Content-Type") {
        if !content_type
            .to_str()
            .unwrap_or("")
            .contains("multipart/form-data")
        {
            return Ok(HttpResponse::BadRequest().body("Invalid Content-Type"));
        }
    }

    // Read multipart payload
    while let Ok(Some(mut field)) = payload.try_next().await {
        if field.content_disposition().get_filename().is_some() {
            // Ensure this is the correct field
            while let Some(chunk) = field.next().await {
                match chunk {
                    Ok(bytes) => data.extend_from_slice(&bytes),
                    Err(_) => {
                        return Ok(HttpResponse::BadRequest().body("Failed to read uploaded file"));
                    }
                }
            }
        }
    }

    if data.is_empty() {
        return Ok(HttpResponse::BadRequest().body("Uploaded file is empty"));
    }

    // Attempt to read the uploaded data as a ZIP file
    match zip::read::ZipArchive::new(std::io::Cursor::new(data)) {
        Ok(mut archive) => {
            println!("Successfully read ZIP archive with {} files", archive.len());
            // Further processing...
            match read_action_from_zip(&org_id, archive).await {
                Ok(action_id) => Ok(HttpResponse::Ok().json(action_id)),
                Err(e) => {
                    Ok(HttpResponse::BadRequest().body(format!("Failed to process action: {}", e)))
                }
            }
        }
        Err(e) => {
            eprintln!("Error reading ZIP file: {:?}", e);
            Ok(HttpResponse::BadRequest().body(format!("Error reading ZIP file: {:?}", e)))
        }
    }
}
