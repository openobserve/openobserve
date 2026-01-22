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
    Json,
    extract::{Multipart, Path, Query},
    response::Response,
};
use infra::table::source_maps::FileType;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use crate::{
    common::meta::http::HttpResponse as MetaHttpResponse,
    service::{db::sourcemaps as db_sourcemaps, sourcemaps as sv_sourcemaps},
};

#[derive(Serialize)]
struct SourceMapRepr {
    pub service: Option<String>,
    pub env: Option<String>,
    pub version: Option<String>,
    pub source_file_name: String,
    pub source_map_file_name: String,
    pub file_type: FileType,
    pub created_at: i64,
}

#[derive(Deserialize, ToSchema)]
pub struct StacktraceRequest {
    service: Option<String>,
    env: Option<String>,
    version: Option<String>,
    stacktrace: String,
}

#[derive(Serialize)]
struct StacktraceResponse {
    stacktrace: String,
}

/// ListSourcemaps
#[utoipa::path(
    get,
    path = "/{org_id}/sourcemaps",
    context_path = "/api",
    tag = "Sourcemaps",
    operation_id = "SourcemapList",
    summary = "List sourcemaps uploaded in org",
    description = "Lists sourcemaps in the organizations, filtering with provided service, env, version filters.",
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
        ("x-o2-ratelimit" = json!({"module": "Sourcemaps", "operation": "list"})),
        ("x-o2-mcp" = json!({"description": "List sourcemaps", "category": "sourcemaps"}))
    )
)]
pub async fn list(
    Path(org_id): Path<String>,
    Query(query): Query<HashMap<String, String>>,
) -> Response {
    let service = query.get("service").cloned();
    let env = query.get("env").cloned();
    let version = query.get("version").cloned();

    let sourcemaps = match db_sourcemaps::list_files(&org_id, service, env, version).await {
        Ok(v) => v,
        Err(e) => {
            log::error!("error listing sourcemaps for org_id {org_id} : {e}");
            return MetaHttpResponse::internal_error(e);
        }
    };

    let ret: Vec<_> = sourcemaps
        .into_iter()
        .map(|m| SourceMapRepr {
            service: m.service,
            env: m.env,
            version: m.version,
            source_file_name: m.source_file_name,
            source_map_file_name: m.source_map_file_name,
            file_type: m.file_type,
            created_at: m.created_at,
        })
        .collect();

    MetaHttpResponse::json(ret)
}

/// ListSourcemaps
#[utoipa::path(
    delete,
    path = "/{org_id}/sourcemaps",
    context_path = "/api",
    tag = "Sourcemaps",
    operation_id = "SourcemapDelete",
    summary = "Delete sourcemaps uploaded in org",
    description = "Deletes sourcemaps in the organizations, filtering with provided service, env, version filters.",
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
        ("x-o2-ratelimit" = json!({"module": "Sourcemaps", "operation": "delete"})),
        ("x-o2-mcp" = json!({"description": "List sourcemaps", "category": "sourcemaps"}))
    )
)]
pub async fn delete(
    Path(org_id): Path<String>,
    Query(query): Query<HashMap<String, String>>,
) -> Response {
    let service = query.get("service").cloned();
    let env = query.get("env").cloned();
    let version = query.get("version").cloned();

    match db_sourcemaps::delete_group(&org_id, service, env, version).await {
        Ok(_) => MetaHttpResponse::ok("deleted successfully"),
        Err(e) => {
            log::error!("error listing sourcemaps for org_id {org_id} : {e}");
            MetaHttpResponse::internal_error(e)
        }
    }
}

/// ListSourcemaps
#[utoipa::path(
    delete,
    path = "/{org_id}/sourcemaps/stacktrace",
    context_path = "/api",
    tag = "Sourcemaps",
    operation_id = "SourcemapStacktrace",
    summary = "Translate stacktrace from minified to original source",
    description = "Converts the stacktrace from the minified files into original source stacktrace based on uploaded sourcemaps",
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
        ("x-o2-ratelimit" = json!({"module": "Sourcemaps", "operation": "delete"})),
        ("x-o2-mcp" = json!({"description": "List sourcemaps", "category": "sourcemaps"}))
    )
)]
pub async fn translate_stacktrace(
    Path(org_id): Path<String>,
    Json(req): Json<StacktraceRequest>,
) -> Response {
    let service = req.service;
    let env = req.env;
    let version = req.version;
    let st = req.stacktrace;

    match sv_sourcemaps::translate_stacktrace(&org_id, service, env, version, st).await {
        Ok(cst) => MetaHttpResponse::json(StacktraceResponse { stacktrace: cst }),
        Err(e) => {
            log::error!("error translating stacktrace for org_id {org_id} : {e}");
            MetaHttpResponse::internal_error(e)
        }
    }
}

/// UploadZippedSourcemaps
///
/// Upload a zipped fie with minfied source and sourcemaps
/// This endpoint allows uploading a ZIP file containing minified source files and corresponding
/// sourcemaps which will be extracted, processed, and stored.
#[utoipa::path(
    post,
    path = "/{org_id}/sourcemaps",
    context_path = "/api",
    tag = "Sourcemaps",
    operation_id = "UploadZippedSourcemaps",
    summary = "Upload zippsed sourcemap files",
    description = "Uploads a ZIP file containing minified source files and corresponding sourcemaps.",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
    ),
    responses(
        (status = 200, description = "Sourcemaps stored successfully", content_type = "application/json", body = String),
        (status = 400, description = "Error processing action", content_type = "application/json", body = String),
        (status = 500, description = "Internal server error", content_type = "application/json", body = String),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Actions", "operation": "create"})),
        ("x-o2-mcp" = json!({"enabled": false}))
    )
)]
pub async fn upload_maps(Path(org_id): Path<String>, mut multipart: Multipart) -> Response {
    let mut file_data = Vec::new();

    let mut service = None;
    let mut env = None;
    let mut version = None;

    while let Ok(Some(field)) = multipart.next_field().await {
        let field_name = field.name().unwrap_or("").to_string();

        match field_name.as_str() {
            "service" => {
                let bytes = match field.bytes().await {
                    Ok(b) => b,
                    Err(_) => {
                        return MetaHttpResponse::bad_request("Failed to read service field");
                    }
                };
                if let Ok(svc) = String::from_utf8(bytes.to_vec()) {
                    service = Some(svc);
                } else {
                    return MetaHttpResponse::bad_request(
                        "service field contains invalid UTF-8 data",
                    );
                }
            }
            "env" => {
                let bytes = match field.bytes().await {
                    Ok(b) => b,
                    Err(_) => {
                        return MetaHttpResponse::bad_request("Failed to read env field");
                    }
                };
                if let Ok(e) = String::from_utf8(bytes.to_vec()) {
                    env = Some(e);
                } else {
                    return MetaHttpResponse::bad_request("env field contains invalid UTF-8 data");
                }
            }
            "version" => {
                let bytes = match field.bytes().await {
                    Ok(b) => b,
                    Err(_) => {
                        return MetaHttpResponse::bad_request("Failed to read version field");
                    }
                };
                if let Ok(v) = String::from_utf8(bytes.to_vec()) {
                    version = Some(v);
                } else {
                    return MetaHttpResponse::bad_request(
                        "version field contains invalid UTF-8 data",
                    );
                }
            }
            "file" => {
                let bytes = match field.bytes().await {
                    Ok(b) => b,
                    Err(_) => return MetaHttpResponse::bad_request("Failed to read file"),
                };
                file_data = bytes.to_vec();
                if file_data.is_empty() {
                    return MetaHttpResponse::bad_request("File is missing or empty");
                }
            }
            f => {
                log::debug!("unknown field {f} received in multipart sourcemap upload request");
            }
        }
    }

    if file_data.is_empty() {
        return MetaHttpResponse::bad_request("Uploaded file is empty");
    }

    match sv_sourcemaps::process_zip(&org_id, service, env, version, file_data).await {
        Ok(_) => {
            log::info!("successfully saved sourcemaps for {org_id}");
            MetaHttpResponse::created("successfully stored sourcemaps")
        },
        Err(e) => {
            log::info!("error in storing sourcemaps for org_id {org_id} : {e}");
            MetaHttpResponse::bad_request(e)
        }
    }
}
