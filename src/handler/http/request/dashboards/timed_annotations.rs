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

use actix_web::{HttpRequest, HttpResponse, delete, get, http::StatusCode, post, put, web};
use config::meta::timed_annotations::{
    ListTimedAnnotationsQuery, TimedAnnotation, TimedAnnotationDelete, TimedAnnotationReq,
};

use crate::{
    common::meta::http::HttpResponse as MetaHttpResponse, service::dashboards::timed_annotations,
};

/// Create Timed Annotations
///
/// #{"ratelimit_module":"Dashboards", "ratelimit_module_operation":"create"}#
#[utoipa::path(
    post,
    context_path = "/api",
    tag = "Dashboards",
    operation_id = "CreateAnnotations",
    path = "/{org_id}/dashboards/{dashboard_id}/annotations",
    security(
        ("Authorization" = [])
    ),
    request_body(
        content = TimedAnnotationReq,
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
)]
#[post("/{org_id}/dashboards/{dashboard_id}/annotations")]
pub async fn create_annotations(
    path: web::Path<(String, String)>,
    body: web::Bytes,
) -> Result<HttpResponse, Error> {
    let (_org_id, dashboard_id) = path.into_inner();
    let req = serde_json::from_slice::<TimedAnnotationReq>(&body)?;
    if let Err(validation_err) = req.validate() {
        return Ok(MetaHttpResponse::bad_request(validation_err));
    }

    match timed_annotations::create_timed_annotations(&dashboard_id, req).await {
        Ok(res) => Ok(MetaHttpResponse::json(res)),
        Err(e) => {
            log::error!("Error creating timed annotations: {e}");
            Ok(
                HttpResponse::InternalServerError().json(MetaHttpResponse::error(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "Failed to create timed annotations",
                )),
            )
        }
    }
}

/// Get Timed Annotations
///
/// #{"ratelimit_module":"Dashboards", "ratelimit_module_operation":"list"}#
#[utoipa::path(
    get,
    context_path = "/api",
    tag = "Dashboards",
    operation_id = "GetAnnotations",
    path = "/{org_id}/dashboards/{dashboard_id}/annotations",
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
)]
#[get("/{org_id}/dashboards/{dashboard_id}/annotations")]
pub async fn get_annotations(
    path: web::Path<(String, String)>,
    req: HttpRequest,
) -> Result<HttpResponse, Error> {
    let (_org_id, dashboard_id) = path.into_inner();
    let Ok(query) = web::Query::<ListTimedAnnotationsQuery>::from_query(req.query_string()) else {
        return Ok(MetaHttpResponse::bad_request(
            "Error parsing query parameters".to_string(),
        ));
    };
    let query = query.into_inner();
    if let Err(validation_err) = query.validate() {
        return Ok(MetaHttpResponse::bad_request(validation_err));
    }

    let (panels, start_time, end_time) = (query.get_panels(), query.start_time, query.end_time);

    match timed_annotations::get_timed_annotations(&dashboard_id, panels, start_time, end_time)
        .await
    {
        Ok(data) => Ok(MetaHttpResponse::json(data)),
        Err(e) => {
            log::error!("Error getting timed annotations: {e}");
            Ok(
                HttpResponse::InternalServerError().json(MetaHttpResponse::error(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "Failed to get timed annotations",
                )),
            )
        }
    }
}

/// Delete Timed Annotations
///
/// #{"ratelimit_module":"Dashboards", "ratelimit_module_operation":"delete"}#
#[utoipa::path(
    delete,
    tag = "Dashboards",
    context_path = "/api",
    operation_id = "DeleteAnnotations",
    path = "/{org_id}/dashboards/{dashboard_id}/annotations",
    security(
        ("Authorization" = [])
    ),
    request_body(
        content = TimedAnnotationDelete,
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
)]
#[delete("/{org_id}/dashboards/{dashboard_id}/annotations")]
pub async fn delete_annotations(
    path: web::Path<(String, String)>,
    body: web::Bytes,
) -> Result<HttpResponse, Error> {
    let (_org_id, dashboard_id) = path.into_inner();
    let req: TimedAnnotationDelete = serde_json::from_slice(&body)?;
    if let Err(validation_err) = req.validate() {
        return Ok(MetaHttpResponse::bad_request(validation_err));
    }

    match timed_annotations::delete_timed_annotations(&dashboard_id, req).await {
        Ok(_) => Ok(HttpResponse::Ok().finish()),
        Err(e) => {
            log::error!("Error deleting timed annotations: {e}");
            Ok(
                HttpResponse::InternalServerError().json(MetaHttpResponse::error(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "Failed to delete timed annotations",
                )),
            )
        }
    }
}

/// Update Timed Annotations
///
/// #{"ratelimit_module":"Dashboards", "ratelimit_module_operation":"update"}#
#[utoipa::path(
    put,
    tag = "Dashboards",
    context_path = "/api",
    operation_id = "UpdateAnnotations",
    path = "/{org_id}/dashboards/{dashboard_id}/annotations/{timed_annotation_id}",
    security(
        ("Authorization" = [])
    ),
    request_body(
        content = TimedAnnotation,
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
)]
#[put("/{org_id}/dashboards/{dashboard_id}/annotations/{timed_annotation_id}")]
pub async fn update_annotations(
    path: web::Path<(String, String, String)>,
    body: web::Bytes,
) -> Result<HttpResponse, Error> {
    let (_org_id, dashboard_id, timed_annotation_id) = path.into_inner();
    let mut req: TimedAnnotation = serde_json::from_slice(&body)?;
    // ensure the annotation id is always set for update
    req.annotation_id = Some(timed_annotation_id.clone());
    if let Err(validation_err) = req.validate() {
        return Ok(MetaHttpResponse::bad_request(validation_err));
    }

    match timed_annotations::update_timed_annotations(&dashboard_id, &timed_annotation_id, &req)
        .await
    {
        Ok(res) => Ok(MetaHttpResponse::json(res)),
        Err(e) => {
            log::error!("Error updating timed annotations: {e}");
            Ok(
                HttpResponse::InternalServerError().json(MetaHttpResponse::error(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "Failed to update timed annotations",
                )),
            )
        }
    }
}

/// Delete Timed Annotation Panels
///
/// #{"ratelimit_module":"Dashboards", "ratelimit_module_operation":"delete"}#
#[utoipa::path(
    delete,
    tag = "Dashboards",
    context_path = "/api",
    operation_id = "RemoveTimedAnnotationFromPanel",
    path = "/{org_id}/dashboards/{dashboard_id}/annotations/panels/{timed_annotation_id}",
    security(
        ("Authorization" = [])
    ),
    request_body(
        content = Vec<String>,
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
)]
#[delete("/{org_id}/dashboards/{dashboard_id}/annotations/panels/{timed_annotation_id}")]
pub async fn delete_annotation_panels(
    path: web::Path<(String, String, String)>,
    body: web::Bytes,
) -> Result<HttpResponse, Error> {
    let (_org_id, _dashboard_id, timed_annotation_id) = path.into_inner();
    let panels: Vec<String> = serde_json::from_slice(&body)?;
    if panels.is_empty() {
        return Ok(MetaHttpResponse::bad_request(
            "panels cannot be empty".to_string(),
        ));
    }
    match timed_annotations::delete_timed_annotation_panels(&timed_annotation_id, panels).await {
        Ok(_) => Ok(HttpResponse::Ok().finish()),
        Err(e) => {
            log::error!("Error deleting timed annotation panels: {e}");
            Ok(
                HttpResponse::InternalServerError().json(MetaHttpResponse::error(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "Failed to delete timed annotation panels",
                )),
            )
        }
    }
}
