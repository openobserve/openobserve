// Copyright 2024 Zinc Labs Inc.
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

use actix_web::{delete, get, post, put, web, HttpResponse};

use crate::{
    common::{
        meta::{
            authz::Authz,
            http::HttpResponse as MetaHttpResponse,
            saved_view::{
                CreateViewRequest, CreateViewResponse, DeleteViewResponse, UpdateViewRequest, View,
            },
        },
        utils::auth::{remove_ownership, set_ownership},
    },
    service::db::saved_view,
};

// GetSavedView
//
// Retrieve a single saved view associated with this org.
//
#[utoipa::path(
    context_path = "/api",
    tag = "Saved Views",
    operation_id = "GetSavedView",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("view_id" = String, Path, description = "The view_id which was stored"),
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = View, example = json!({
            "org_id": "some-org-id",
            "view_id": "some-uuid-v4",
            "view_name": "view-name",
            "payload": "base64-encoded-object-as-sent-by-frontend"
        })),
        (status = 400, description = "Failure", content_type = "application/json", body = HttpResponse),
        (status = 500, description = "Failure", content_type = "application/json", body = HttpResponse),
    )
)]
#[get("/{org_id}/savedviews/{view_id}")]
pub async fn get_view(path: web::Path<(String, String)>) -> Result<HttpResponse, Error> {
    let (org_id, view_id) = path.into_inner();
    let view_id = view_id.trim();
    match saved_view::get_view(&org_id, view_id).await {
        Ok(view) => {
            let view: View = view;
            Ok(MetaHttpResponse::json(view))
        }
        Err(e) => Ok(MetaHttpResponse::bad_request(e)),
    }
}

// ListSavedViews
//
// Retrieve the list of saved views.
//
#[utoipa::path(
    context_path = "/api",
    tag = "Saved Views",
    operation_id = "ListSavedViews",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = ViewsWithoutData, example = json!([{
                "org_id": "some-org-id",
                "view_name": "view-name",
                "view_id": "view-id",
                "payload": "base-64-encoded-versioned-payload"
        }])),
        (status = 400, description = "Failure", content_type = "application/json", body = HttpResponse),
        (status = 500, description = "Failure", content_type = "application/json", body = HttpResponse),
    )
)]
#[get("/{org_id}/savedviews")]
pub async fn get_views(path: web::Path<String>) -> Result<HttpResponse, Error> {
    let org_id = path.into_inner();
    match saved_view::get_views_list_only(&org_id).await {
        Ok(views) => Ok(MetaHttpResponse::json(views)),
        Err(e) => Ok(MetaHttpResponse::bad_request(e)),
    }
}

// DeleteSavedViews
//
// Delete a view associated with this given org.
//
#[utoipa::path(
    context_path = "/api",
    tag = "Saved Views",
    operation_id = "DeleteSavedViews",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("view_id" = String, Path, description = "The view_id to delete"),
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = DeleteViewResponse, example = json!([{
            "org_id": "some-org-id",
            "view_id": "view_id",
        }])),
        (status = 400, description = "Failure", content_type = "application/json", body = HttpResponse),
        (status = 500, description = "Failure", content_type = "application/json", body = HttpResponse),
    )
)]
#[delete("/{org_id}/savedviews/{view_id}")]
pub async fn delete_view(path: web::Path<(String, String)>) -> Result<HttpResponse, Error> {
    let (org_id, view_id) = path.into_inner();
    match saved_view::delete_view(&org_id, &view_id).await {
        Ok(_) => {
            remove_ownership(&org_id, "savedviews", Authz::new(&view_id)).await;
            Ok(MetaHttpResponse::json(DeleteViewResponse {
                org_id,
                view_id,
            }))
        }
        Err(e) => Ok(MetaHttpResponse::bad_request(e)),
    }
}

// CreateSavedViews
//
// Create a view for later retrieval associated with the given search.
//
#[utoipa::path(
    context_path = "/api",
    tag = "Saved Views",
    operation_id = "CreateSavedViews",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
    ),
    request_body(content = CreateViewRequest, description = "Create view data", content_type = "application/json"),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = CreateViewResponse, example = json!([{
            "org_id": "some-org-id",
            "view_id": "view_id",
        }])),
        (status = 400, description = "Failure", content_type = "application/json", body = HttpResponse),
        (status = 500, description = "Failure", content_type = "application/json", body = HttpResponse),
    )
)]
#[post("/{org_id}/savedviews")]
pub async fn create_view(
    path: web::Path<String>,
    view: web::Json<CreateViewRequest>,
) -> Result<HttpResponse, Error> {
    let org_id = path.into_inner();

    match saved_view::set_view(&org_id, &view).await {
        Ok(created_view) => {
            set_ownership(&org_id, "savedviews", Authz::new(&created_view.view_id)).await;
            Ok(MetaHttpResponse::json(CreateViewResponse {
                org_id,
                view_id: created_view.view_id,
                view_name: view.view_name.clone(),
            }))
        }
        Err(e) => Ok(MetaHttpResponse::bad_request(e)),
    }
}

// UpdateSavedViews
//
// Update a saved view
//
#[utoipa::path(
    context_path = "/api",
    tag = "Saved Views",
    operation_id = "UpdateSavedViews",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("view_id" = String, Path, description = "View id to be updated"),
    ),
    request_body(content = UpdateViewRequest, description = "Update view data", content_type = "application/json"),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = View, example = json!([{
            "org_id": "some-org-id",
            "view_name": "view-name",
            "view_id": "view-id",
            "payload": "base-64-encoded-versioned-payload"
        }])),
        (status = 400, description = "Failure", content_type = "application/json", body = HttpResponse),
        (status = 500, description = "Failure", content_type = "application/json", body = HttpResponse),
    )
)]
#[put("/{org_id}/savedviews/{view_id}")]
pub async fn update_view(
    path: web::Path<(String, String)>,
    view: web::Json<UpdateViewRequest>,
) -> Result<HttpResponse, Error> {
    let (org_id, view_id) = path.into_inner();

    match saved_view::update_view(&org_id, &view_id, &view).await {
        Ok(updated_view) => Ok(MetaHttpResponse::json(updated_view)),
        Err(e) => Ok(MetaHttpResponse::bad_request(e)),
    }
}

#[cfg(test)]
mod tests {
    use actix_web::{test, App};

    use super::*;

    #[tokio::test]
    async fn test_create_view_post() {
        let payload = CreateViewRequest {
            data: "base64-encoded-data".into(),
            view_name: "query-for-blah".into(),
        };
        let app = test::init_service(App::new().service(create_view)).await;
        let req = test::TestRequest::post()
            .uri("/default/savedviews")
            .set_json(&payload)
            .to_request();
        let resp = test::call_service(&app, req).await;
        assert!(resp.status().is_success());
        let json_body: CreateViewResponse = test::read_body_json(resp).await;
        assert!(!json_body.view_id.is_empty());
    }
}
