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
use db::{
    authz::{remove_ownership, set_ownership},
    saved_view,
};

use crate::common::meta::{
    authz::Authz,
    http::HttpResponse as MetaHttpResponse,
    saved_view::{
        CreateViewRequest, CreateViewResponse, DeleteViewResponse, UpdateViewRequest, View,
    },
};

/// GetSavedView - Retrieve a single saved view associated with this org.

#[utoipa::path(
    get,
    path = "/{org_id}/savedviews/{view_id}",
    context_path = "/api",
    tag = "Saved Views",
    operation_id = "GetSavedView",
    summary = "Get saved view",
    description = "Retrieves a specific saved search view by its ID. Saved views allow users to store and reuse complex search queries, filters, and visualization settings. The view contains all the necessary information to recreate the exact search state, including query parameters, time ranges, and display configurations.",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("view_id" = String, Path, description = "The view_id which was stored"),
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = inline(View), example = json!({
            "org_id": "some-org-id",
            "view_id": "some-uuid-v4",
            "view_name": "view-name",
            "payload": "base64-encoded-object-as-sent-by-frontend"
        })),
        (status = 400, description = "Failure", content_type = "application/json", body = ()),
        (status = 500, description = "Failure", content_type = "application/json", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Saved Views", "operation": "get"})),
        ("x-o2-mcp" = json!({"description": "Get saved view details", "category": "search"}))
    )
)]
pub async fn get_view(Path(path): Path<(String, String)>) -> Response {
    let (org_id, view_id) = path;
    let view_id = view_id.trim();
    match saved_view::get_view(&org_id, view_id).await {
        Ok(view) => {
            let view: View = view;
            MetaHttpResponse::json(view)
        }
        Err(e) => MetaHttpResponse::bad_request(e),
    }
}

/// ListSavedViews - Retrieve the list of saved views.

#[utoipa::path(
    get,
    path = "/{org_id}/savedviews",
    context_path = "/api",
    tag = "Saved Views",
    operation_id = "ListSavedViews",
    summary = "List saved views",
    description = "Retrieves a list of all saved search views for the organization. This provides an overview of all stored queries and visualizations that users have created and saved for reuse. Each view includes basic metadata such as name and ID, allowing users to identify and select the views they want to load.",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = Object, example = json!([{
                "org_id": "some-org-id",
                "view_name": "view-name",
                "view_id": "view-id",
                "payload": "base-64-encoded-versioned-payload"
        }])),
        (status = 400, description = "Failure", content_type = "application/json", body = ()),
        (status = 500, description = "Failure", content_type = "application/json", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Saved Views", "operation": "list"})),
        ("x-o2-mcp" = json!({"description": "List all saved views", "category": "search"}))
    )
)]
pub async fn get_views(Path(path): Path<String>) -> Response {
    let org_id = path;
    match saved_view::get_views_list_only(&org_id).await {
        Ok(views) => MetaHttpResponse::json(views),
        Err(e) => MetaHttpResponse::bad_request(e),
    }
}

/// DeleteSavedViews - Delete a view associated with this given org.

#[utoipa::path(
    delete,
    path = "/{org_id}/savedviews/{view_id}",
    context_path = "/api",
    tag = "Saved Views",
    operation_id = "DeleteSavedViews",
    summary = "Delete saved view",
    description = "Permanently removes a saved search view from the organization. This action deletes the stored query configuration, visualization settings, and all associated metadata. Once deleted, the view cannot be recovered, so use this operation carefully when cleaning up unused or outdated saved views.",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("view_id" = String, Path, description = "The view_id to delete"),
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = inline(DeleteViewResponse), example = json!([{
            "org_id": "some-org-id",
            "view_id": "view_id",
        }])),
        (status = 400, description = "Failure", content_type = "application/json", body = ()),
        (status = 500, description = "Failure", content_type = "application/json", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Saved Views", "operation": "delete"})),
        ("x-o2-mcp" = json!({"description": "Delete a saved view", "category": "search", "requires_confirmation": true}))
    )
)]
pub async fn delete_view(Path(path): Path<(String, String)>) -> Response {
    let (org_id, view_id) = path;
    match saved_view::delete_view(&org_id, &view_id).await {
        Ok(_) => {
            remove_ownership(&org_id, "savedviews", Authz::new(&view_id)).await;
            MetaHttpResponse::json(DeleteViewResponse { org_id, view_id })
        }
        Err(e) => MetaHttpResponse::bad_request(e),
    }
}

/// CreateSavedViews - Create a view for later retrieval associated with the given search.

#[utoipa::path(
    post,
    path = "/{org_id}/savedviews",
    context_path = "/api",
    tag = "Saved Views",
    operation_id = "CreateSavedViews",
    summary = "Create a new saved view",
    description = "Creates a saved search view with specified query parameters and filters",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
    ),
    request_body(content = inline(CreateViewRequest), description = "Create view data", content_type = "application/json"),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = inline(CreateViewResponse), example = json!([{
            "org_id": "some-org-id",
            "view_id": "view_id",
        }])),
        (status = 400, description = "Failure", content_type = "application/json", body = ()),
        (status = 500, description = "Failure", content_type = "application/json", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Saved Views", "operation": "create"})),
        ("x-o2-mcp" = json!({"description": "Create a saved view", "category": "search"}))
    )
)]
pub async fn create_view(
    Path(path): Path<String>,
    Json(view): Json<CreateViewRequest>,
) -> Response {
    let org_id = path;

    match saved_view::set_view(&org_id, &view).await {
        Ok(created_view) => {
            set_ownership(&org_id, "savedviews", Authz::new(&created_view.view_id)).await;
            MetaHttpResponse::json(CreateViewResponse {
                org_id,
                view_id: created_view.view_id,
                view_name: view.view_name.clone(),
            })
        }
        Err(e) => MetaHttpResponse::bad_request(e),
    }
}

/// UpdateSavedViews - Update a saved view

#[utoipa::path(
    put,
    path = "/{org_id}/savedviews/{view_id}",
    context_path = "/api",
    tag = "Saved Views",
    operation_id = "UpdateSavedViews",
    summary = "Update an existing saved view",
    description = "Updates the configuration and parameters of an existing saved search view",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("view_id" = String, Path, description = "View id to be updated"),
    ),
    request_body(content = inline(UpdateViewRequest), description = "Update view data", content_type = "application/json"),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = inline(View), example = json!([{
            "org_id": "some-org-id",
            "view_name": "view-name",
            "view_id": "view-id",
            "payload": "base-64-encoded-versioned-payload"
        }])),
        (status = 400, description = "Failure", content_type = "application/json", body = ()),
        (status = 500, description = "Failure", content_type = "application/json", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Saved Views", "operation": "update"})),
        ("x-o2-mcp" = json!({"description": "Update a saved view", "category": "search"}))
    )
)]
pub async fn update_view(
    Path(path): Path<(String, String)>,
    Json(view): Json<UpdateViewRequest>,
) -> Response {
    let (org_id, view_id) = path;

    match saved_view::update_view(&org_id, &view_id, &view).await {
        Ok(updated_view) => MetaHttpResponse::json(updated_view),
        Err(e) => MetaHttpResponse::bad_request(e),
    }
}

#[cfg(test)]
mod tests {
    use axum::{
        Router,
        body::Body,
        http::{Request, StatusCode},
        routing::{post, put},
    };
    use serde_json::{Value, json};
    use tower::ServiceExt;

    use super::*;

    fn app() -> Router {
        Router::new()
            .route("/{org_id}/savedviews", post(create_view).get(get_views))
            .route(
                "/{org_id}/savedviews/{view_id}",
                put(update_view).get(get_view),
            )
    }

    async fn call(method: &str, uri: &str, body: Option<Value>) -> (StatusCode, Value) {
        let req = Request::builder()
            .method(method)
            .uri(uri)
            .header("content-type", "application/json")
            .body(body.map_or_else(Body::empty, |b| Body::from(b.to_string())))
            .unwrap();
        let resp = app().oneshot(req).await.unwrap();
        let status = resp.status();
        let bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
            .await
            .unwrap();
        (
            status,
            serde_json::from_slice(&bytes).unwrap_or(Value::Null),
        )
    }

    async fn create(org: &str, name: &str, view_type: Option<&str>) -> (StatusCode, Value) {
        let mut body = json!({"data": {"v": 1}, "view_name": name});
        if let Some(t) = view_type {
            body["view_type"] = json!(t);
        }
        call("POST", &format!("/{org}/savedviews"), Some(body)).await
    }

    async fn list(org: &str) -> Vec<Value> {
        let (status, body) = call("GET", &format!("/{org}/savedviews"), None).await;
        assert_eq!(status, StatusCode::OK);
        body["views"].as_array().cloned().unwrap_or_default()
    }

    fn new_org() -> String {
        format!("svorg{}", config::ider::uuid()).to_lowercase()
    }

    #[tokio::test]
    async fn test_create_view_post() {
        infra::db::create_table().await.unwrap();
        let payload = CreateViewRequest {
            data: "base64-encoded-data".into(),
            view_name: format!("query-for-blah-{}", config::ider::uuid()),
            view_type: None,
        };
        let app = Router::new().route("/{org_id}/savedviews", post(create_view));
        let req = Request::builder()
            .method("POST")
            .uri("/default/savedviews")
            .header("content-type", "application/json")
            .body(Body::from(serde_json::to_string(&payload).unwrap()))
            .unwrap();
        let resp = app.oneshot(req).await.unwrap();
        assert!(resp.status() == StatusCode::OK || resp.status().is_success());
    }

    #[tokio::test]
    async fn test_traces_view_type_is_stored_listed_and_kept_on_update() {
        infra::db::create_table().await.unwrap();
        let org = new_org();
        let (status, created) = create(&org, "checkout errors", Some("traces")).await;
        assert_eq!(status, StatusCode::OK);
        let view_id = created["view_id"].as_str().unwrap().to_string();

        let views = list(&org).await;
        assert_eq!(views.len(), 1);
        assert_eq!(views[0]["view_type"], "traces");

        let (status, updated) = call(
            "PUT",
            &format!("/{org}/savedviews/{view_id}"),
            Some(json!({"data": {"v": 2}, "view_name": "checkout errors", "view_type": "logs"})),
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(updated["view_type"], "traces");
        assert_eq!(list(&org).await[0]["view_type"], "traces");
    }

    #[tokio::test]
    async fn test_create_view_rejects_unknown_type() {
        infra::db::create_table().await.unwrap();
        let org = new_org();
        let (status, _) = create(&org, "bad", Some("metrics")).await;
        assert_eq!(status, StatusCode::BAD_REQUEST);
        assert!(list(&org).await.is_empty());
    }

    #[tokio::test]
    async fn test_view_names_are_unique_per_type() {
        infra::db::create_table().await.unwrap();
        let org = new_org();
        assert_eq!(create(&org, "dup", None).await.0, StatusCode::OK);
        assert_eq!(create(&org, "DUP", Some("traces")).await.0, StatusCode::OK);
        assert_eq!(
            create(&org, "Dup", Some("traces")).await.0,
            StatusCode::BAD_REQUEST
        );
        assert_eq!(
            create(&org, "dup", Some("logs")).await.0,
            StatusCode::BAD_REQUEST
        );
    }

    #[tokio::test]
    async fn test_update_traces_view_to_a_logs_view_name_succeeds() {
        infra::db::create_table().await.unwrap();
        let org = new_org();
        assert_eq!(create(&org, "alpha", None).await.0, StatusCode::OK);
        let (status, created) = create(&org, "beta", Some("traces")).await;
        assert_eq!(status, StatusCode::OK);
        let view_id = created["view_id"].as_str().unwrap();
        let (status, _) = call(
            "PUT",
            &format!("/{org}/savedviews/{view_id}"),
            Some(json!({"data": {}, "view_name": "alpha"})),
        )
        .await;
        assert_eq!(status, StatusCode::OK);
    }

    #[tokio::test]
    async fn test_an_org_sharing_a_name_prefix_keeps_its_views_separate() {
        infra::db::create_table().await.unwrap();
        let org = new_org();
        let longer_org = format!("{org}b");
        assert_eq!(create(&longer_org, "shared", None).await.0, StatusCode::OK);
        assert!(list(&org).await.is_empty());
        assert_eq!(create(&org, "shared", None).await.0, StatusCode::OK);
    }
}
