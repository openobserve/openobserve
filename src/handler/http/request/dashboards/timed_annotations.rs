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
    extract::{Path, Query},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use config::meta::timed_annotations::{
    ListTimedAnnotationsQuery, TimedAnnotation, TimedAnnotationDelete, TimedAnnotationReq,
};

use crate::{
    common::meta::http::HttpResponse as MetaHttpResponse, service::dashboards::timed_annotations,
};

/// Create Timed Annotations

#[utoipa::path(
    post,
    path = "/{org_id}/dashboards/{dashboard_id}/annotations",
    context_path = "/api",
    tag = "Dashboards",
    operation_id = "CreateAnnotations",
    summary = "Create timed annotations for dashboard",
    description = "Creates new timed annotations for specific panels within a dashboard",
    security(
        ("Authorization" = [])
    ),
    request_body(
        content = inline(TimedAnnotationReq),
        description = "Timed annotation request payload",
        content_type = "application/json",
    ),
    responses(
        (
            status = 200,
            description = "Timed annotations created successfully",
            body = [TimedAnnotation],
            content_type = "application/json",
        ),
        (status = 500, description = "Failed to create timed annotations", content_type = "application/json")
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Dashboards", "operation": "create"})),
        ("x-o2-mcp" = json!({"description": "Create time annotations", "category": "dashboards"}))
    )
)]
pub async fn create_annotations(
    Path((_org_id, dashboard_id)): Path<(String, String)>,
    axum::Json(req): axum::Json<TimedAnnotationReq>,
) -> Response {
    if let Err(validation_err) = req.validate() {
        return MetaHttpResponse::bad_request(validation_err);
    }

    match timed_annotations::create_timed_annotations(&dashboard_id, req).await {
        Ok(res) => MetaHttpResponse::json(res),
        Err(e) => {
            log::error!("Error creating timed annotations: {e}");
            MetaHttpResponse::internal_error("Failed to create timed annotations")
        }
    }
}

/// Get Timed Annotations

#[utoipa::path(
    get,
    path = "/{org_id}/dashboards/{dashboard_id}/annotations",
    context_path = "/api",
    tag = "Dashboards",
    operation_id = "GetAnnotations",
    summary = "Get timed annotations for dashboard",
    description = "Retrieves timed annotations for dashboard panels within a specified time range",
    security(
        ("Authorization" = [])
    ),
    params(
        ListTimedAnnotationsQuery
    ),
    responses(
        (
            status = 200,
            description = "Timed annotations retrieved successfully",
            body = [TimedAnnotation],
            content_type = "application/json",
        ),
        (status = 400, description = "Invalid query parameters", content_type = "application/json"),
        (status = 500, description = "Failed to get timed annotations", content_type = "application/json")
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Dashboards", "operation": "list"})),
        ("x-o2-mcp" = json!({"description": "Get annotations", "category": "dashboards"}))
    )
)]
pub async fn get_annotations(
    Path((_org_id, dashboard_id)): Path<(String, String)>,
    query: Result<Query<ListTimedAnnotationsQuery>, axum::extract::rejection::QueryRejection>,
) -> Response {
    let query = match query {
        Ok(Query(q)) => q,
        Err(_) => {
            return MetaHttpResponse::bad_request("Error parsing query parameters".to_string());
        }
    };

    if let Err(validation_err) = query.validate() {
        return MetaHttpResponse::bad_request(validation_err);
    }

    let (panels, start_time, end_time) = (query.get_panels(), query.start_time, query.end_time);

    match timed_annotations::get_timed_annotations(&dashboard_id, panels, start_time, end_time)
        .await
    {
        Ok(data) => MetaHttpResponse::json(data),
        Err(e) => {
            log::error!("Error getting timed annotations: {e}");
            MetaHttpResponse::internal_error("Failed to get timed annotations")
        }
    }
}

/// Delete Timed Annotations

#[utoipa::path(
    delete,
    path = "/{org_id}/dashboards/{dashboard_id}/annotations",
    tag = "Dashboards",
    context_path = "/api",
    operation_id = "DeleteAnnotations",
    summary = "Delete timed annotations from dashboard",
    description = "Removes timed annotations from dashboard panels based on specified criteria",
    security(
        ("Authorization" = [])
    ),
    request_body(
        content = inline(TimedAnnotationDelete),
        description = "Timed annotation delete request payload",
        content_type = "application/json",
    ),
    responses(
        (
            status = 200,
            description = "Timed annotations deleted successfully"
        ),
        (status = 500, description = "Failed to delete timed annotations", content_type = "application/json")
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Dashboards", "operation": "delete"})),
        ("x-o2-mcp" = json!({"description": "Delete annotations", "category": "dashboards"}))
    )
)]
pub async fn delete_annotations(
    Path((_org_id, dashboard_id)): Path<(String, String)>,
    axum::Json(req): axum::Json<TimedAnnotationDelete>,
) -> Response {
    if let Err(validation_err) = req.validate() {
        return MetaHttpResponse::bad_request(validation_err);
    }

    match timed_annotations::delete_timed_annotations(&dashboard_id, req).await {
        Ok(_) => (StatusCode::OK, "").into_response(),
        Err(e) => {
            log::error!("Error deleting timed annotations: {e}");
            MetaHttpResponse::internal_error("Failed to delete timed annotations")
        }
    }
}

/// Update Timed Annotations

#[utoipa::path(
    put,
    path = "/{org_id}/dashboards/{dashboard_id}/annotations/{timed_annotation_id}",
    tag = "Dashboards",
    context_path = "/api",
    operation_id = "UpdateAnnotations",
    summary = "Update timed annotation",
    description = "Updates an existing timed annotation with new content or metadata",
    security(
        ("Authorization" = [])
    ),
    request_body(
        content = inline(TimedAnnotation),
        description = "Timed annotation update request payload",
        content_type = "application/json",
    ),
    responses(
        (
            status = 200,
            description = "Timed annotations updated successfully"
        ),
        (status = 500, description = "Failed to update timed annotations", content_type = "application/json")
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Dashboards", "operation": "update"})),
        ("x-o2-mcp" = json!({"description": "Update annotations", "category": "dashboards"}))
    )
)]
pub async fn update_annotations(
    Path((_org_id, dashboard_id, timed_annotation_id)): Path<(String, String, String)>,
    axum::Json(mut req): axum::Json<TimedAnnotation>,
) -> Response {
    // ensure the annotation id is always set for update
    req.annotation_id = Some(timed_annotation_id.clone());
    if let Err(validation_err) = req.validate() {
        return MetaHttpResponse::bad_request(validation_err);
    }

    match timed_annotations::update_timed_annotations(&dashboard_id, &timed_annotation_id, &req)
        .await
    {
        Ok(res) => MetaHttpResponse::json(res),
        Err(e) => {
            log::error!("Error updating timed annotations: {e}");
            MetaHttpResponse::internal_error("Failed to update timed annotations")
        }
    }
}

/// Delete Timed Annotation Panels

#[utoipa::path(
    delete,
    path = "/{org_id}/dashboards/{dashboard_id}/annotations/panels/{timed_annotation_id}",
    tag = "Dashboards",
    context_path = "/api",
    operation_id = "RemoveTimedAnnotationFromPanel",
    summary = "Remove timed annotation from panel",
    description = "Removes a specific timed annotation from a dashboard panel",
    security(
        ("Authorization" = [])
    ),
    request_body(
        content = inline(Vec<String>),
        description = "IDs of dashboard panels from which to remove the timed annotation",
        content_type = "application/json",
    ),
    responses(
        (
            status = 200,
            description = "Removed timed annotation from dashboard panels successfully"
        ),
        (status = 500, description = "Failed to remove timed annotation from panels", content_type = "application/json")
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Dashboards", "operation": "delete"})),
        ("x-o2-mcp" = json!({"description": "Remove annotation from panel", "category": "dashboards"}))
    )
)]
pub async fn delete_annotation_panels(
    Path((_org_id, _dashboard_id, timed_annotation_id)): Path<(String, String, String)>,
    axum::Json(panels): axum::Json<Vec<String>>,
) -> Response {
    if panels.is_empty() {
        return MetaHttpResponse::bad_request("panels cannot be empty".to_string());
    }
    match timed_annotations::delete_timed_annotation_panels(&timed_annotation_id, panels).await {
        Ok(_) => (StatusCode::OK, "").into_response(),
        Err(e) => {
            log::error!("Error deleting timed annotation panels: {e}");
            MetaHttpResponse::internal_error("Failed to delete timed annotation panels")
        }
    }
}
