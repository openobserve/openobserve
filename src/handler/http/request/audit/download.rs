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

use actix_web::{HttpResponse, Result as ActixResult, post, web};
use serde::{Deserialize, Serialize};
use serde_json::json;

#[derive(Debug, Serialize, Deserialize)]
pub enum DownloadType {
    Csv,
    Json,
}

#[derive(Debug, Serialize, Deserialize)]
pub enum Module {
    Logs,
    Traces,
    Dashboard,
    Alert,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct DownloadAuditRequest {
    pub download_type: DownloadType,
    pub module: Module,
    pub query: Option<String>,       // Original query if applicable
    pub stream_name: Option<String>, // Stream being downloaded
    pub start_time: Option<i64>,
    pub end_time: Option<i64>,
    pub estimated_rows: Option<usize>,
    pub file_size_bytes: Option<usize>,
    pub additional_context: Option<serde_json::Value>, // Any extra metadata
}

/// Log download activity for audit purposes
///
/// This endpoint logs download activities and is automatically audit logged via middleware.
/// The audit middleware captures: user, org, timestamp, request body, response status.
#[utoipa::path(
    context_path = "/api",
    tag = "Audit",
    operation_id = "LogDownloadActivity",
    security(("Authorization"= [])),
    params(("org_id" = String, Path, description = "Organization name")),
    request_body(content = DownloadAuditRequest, description = "Download audit details"),
    responses(
        (status = 200, description = "Audit logged successfully"),
        (status = 400, description = "Bad request"),
    )
)]
#[post("/{org_id}/_audit/download")]
pub async fn log_download_activity(
    org_id: web::Path<String>,
    req: web::Json<DownloadAuditRequest>,
) -> ActixResult<HttpResponse> {
    let _org_id = org_id.into_inner();
    let audit_req = req.into_inner();

    // The audit middleware automatically captures:
    // - user_id (from headers)
    // - org_id (from path)
    // - timestamp (middleware adds)
    // - complete request body with all download details
    // - HTTP method, path, response status

    // We just need to return success - the middleware does the actual logging
    Ok(HttpResponse::Ok().json(json!({
        "status": "audit_logged",
        "message": "Download activity recorded",
        "download_type": audit_req.download_type,
        "module": audit_req.module
    })))
}

