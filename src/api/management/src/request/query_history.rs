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
    extract::{Path, Query},
    response::Response,
};
use infra::table::{entity::query_history::Model, query_history};
use openobserve_api_common::extractors::Headers;
use openobserve_core::auth::UserEmail;
use serde::{Deserialize, Serialize};
use utoipa::{IntoParams, ToSchema};

use crate::common::meta::http::HttpResponse as MetaHttpResponse;

const MAX_QUERY_BYTES: usize = 16 * 1024;
const MAX_CONTEXT_BYTES: usize = 64 * 1024;
const DEFAULT_LIMIT: u64 = 50;
const MAX_LIMIT: u64 = 200;

#[derive(Deserialize, Serialize, ToSchema)]
pub struct QueryHistoryRequest {
    pub query: String,
    /// Time range, step, chart type and the panel data that reopens the query.
    pub context: serde_json::Value,
}

#[derive(Deserialize, Serialize, ToSchema)]
pub struct QueryHistoryStarRequest {
    pub starred: bool,
}

#[derive(Deserialize, Serialize, ToSchema)]
pub struct QueryHistoryEntry {
    pub id: String,
    pub query: String,
    pub context: serde_json::Value,
    pub starred: bool,
    pub created_at: i64,
}

impl From<Model> for QueryHistoryEntry {
    fn from(m: Model) -> Self {
        Self {
            id: m.id,
            query: m.query,
            context: m.context,
            starred: m.starred,
            created_at: m.created_at,
        }
    }
}

#[derive(Deserialize, IntoParams)]
#[into_params(parameter_in = Query)]
pub struct QueryHistoryListParams {
    /// Only starred (`true`) or only unstarred (`false`) entries.
    pub starred: Option<bool>,
    /// Substring match on the query text.
    pub q: Option<String>,
    /// Defaults to 50, at most 200.
    pub limit: Option<u64>,
    pub offset: Option<u64>,
}

fn list_limit(limit: Option<u64>) -> u64 {
    limit.unwrap_or(DEFAULT_LIMIT).clamp(1, MAX_LIMIT)
}

/// RecordQueryHistory

#[utoipa::path(
    post,
    path = "/{org_id}/query_history",
    context_path = "/api",
    tag = "Query History",
    operation_id = "RecordQueryHistory",
    summary = "Record a query history entry",
    description = "Records a query the caller ran. Running the same query as the caller's latest entry refreshes that entry instead of adding one.",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
    ),
    request_body(content = QueryHistoryRequest, description = "Query and its context", content_type = "application/json"),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = QueryHistoryEntry),
        (status = 400, description = "Query empty, or query or context too large", content_type = "application/json", body = ()),
        (status = 500, description = "Failure", content_type = "application/json", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Query History", "operation": "create"})),
        ("x-o2-mcp" = json!({"enabled": false}))
    )
)]
pub async fn record(
    Path(org_id): Path<String>,
    Headers(user_email): Headers<UserEmail>,
    Json(req): Json<QueryHistoryRequest>,
) -> Response {
    if req.query.trim().is_empty() {
        return MetaHttpResponse::bad_request("query is empty");
    }
    if req.query.len() > MAX_QUERY_BYTES {
        return MetaHttpResponse::bad_request("query exceeds 16 KB");
    }
    if req.context.to_string().len() > MAX_CONTEXT_BYTES {
        return MetaHttpResponse::bad_request("context exceeds 64 KB");
    }
    match query_history::record(
        &org_id,
        &user_email.user_id,
        &req.query,
        req.context,
        config::utils::time::now_micros(),
    )
    .await
    {
        Ok(entry) => MetaHttpResponse::json(QueryHistoryEntry::from(entry)),
        Err(e) => MetaHttpResponse::internal_error(e),
    }
}

/// ListQueryHistory

#[utoipa::path(
    get,
    path = "/{org_id}/query_history",
    context_path = "/api",
    tag = "Query History",
    operation_id = "ListQueryHistory",
    summary = "List query history",
    description = "Lists the caller's query history, newest first.",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        QueryHistoryListParams,
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = Vec<QueryHistoryEntry>),
        (status = 500, description = "Failure", content_type = "application/json", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Query History", "operation": "list"})),
        ("x-o2-mcp" = json!({"enabled": false}))
    )
)]
pub async fn list(
    Path(org_id): Path<String>,
    Headers(user_email): Headers<UserEmail>,
    Query(params): Query<QueryHistoryListParams>,
) -> Response {
    match query_history::list(
        &org_id,
        &user_email.user_id,
        params.starred,
        params.q.as_deref(),
        list_limit(params.limit),
        params.offset.unwrap_or(0),
    )
    .await
    {
        Ok(entries) => MetaHttpResponse::json(
            entries
                .into_iter()
                .map(QueryHistoryEntry::from)
                .collect::<Vec<_>>(),
        ),
        Err(e) => MetaHttpResponse::internal_error(e),
    }
}

/// StarQueryHistory

#[utoipa::path(
    patch,
    path = "/{org_id}/query_history/{id}",
    context_path = "/api",
    tag = "Query History",
    operation_id = "StarQueryHistory",
    summary = "Star or unstar a query history entry",
    description = "Starred entries are kept until deleted.",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("id" = String, Path, description = "Entry id"),
    ),
    request_body(content = QueryHistoryStarRequest, description = "Starred flag", content_type = "application/json"),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = QueryHistoryEntry),
        (status = 404, description = "Not found", content_type = "application/json", body = ()),
        (status = 500, description = "Failure", content_type = "application/json", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Query History", "operation": "update"})),
        ("x-o2-mcp" = json!({"enabled": false}))
    )
)]
pub async fn star(
    Path((org_id, id)): Path<(String, String)>,
    Headers(user_email): Headers<UserEmail>,
    Json(req): Json<QueryHistoryStarRequest>,
) -> Response {
    match query_history::set_starred(&org_id, &user_email.user_id, &id, req.starred).await {
        Ok(Some(entry)) => MetaHttpResponse::json(QueryHistoryEntry::from(entry)),
        Ok(None) => MetaHttpResponse::not_found("query history entry not found"),
        Err(e) => MetaHttpResponse::internal_error(e),
    }
}

/// DeleteQueryHistory

#[utoipa::path(
    delete,
    path = "/{org_id}/query_history/{id}",
    context_path = "/api",
    tag = "Query History",
    operation_id = "DeleteQueryHistory",
    summary = "Delete a query history entry",
    description = "Deletes one of the caller's query history entries.",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("id" = String, Path, description = "Entry id"),
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = ()),
        (status = 404, description = "Not found", content_type = "application/json", body = ()),
        (status = 500, description = "Failure", content_type = "application/json", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Query History", "operation": "delete"})),
        ("x-o2-mcp" = json!({"enabled": false}))
    )
)]
pub async fn delete(
    Path((org_id, id)): Path<(String, String)>,
    Headers(user_email): Headers<UserEmail>,
) -> Response {
    match query_history::delete(&org_id, &user_email.user_id, &id).await {
        Ok(true) => MetaHttpResponse::ok("query history entry deleted"),
        Ok(false) => MetaHttpResponse::not_found("query history entry not found"),
        Err(e) => MetaHttpResponse::internal_error(e),
    }
}

#[cfg(test)]
mod tests {
    use axum::http::StatusCode;
    use infra::table::entity::query_history::Entity;
    use sea_orm::{ConnectionTrait, Schema};
    use serde_json::{Value, json};

    use super::*;

    async fn setup() {
        infra::db::create_table().await.unwrap();
        let conn = infra::db::get_orm_client_rw().await;
        let backend = conn.get_database_backend();
        let mut stmt = Schema::new(backend).create_table_from_entity(Entity);
        conn.execute(backend.build(stmt.if_not_exists()))
            .await
            .unwrap();
    }

    fn user() -> String {
        format!("{}@example.com", config::ider::uuid())
    }

    fn headers(user: &str) -> Headers<UserEmail> {
        Headers(UserEmail {
            user_id: user.to_string(),
        })
    }

    async fn parts(resp: Response) -> (StatusCode, Value) {
        let status = resp.status();
        let bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
            .await
            .unwrap();
        (
            status,
            serde_json::from_slice(&bytes).unwrap_or(Value::Null),
        )
    }

    async fn post(org: &str, user: &str, query: &str, context: Value) -> (StatusCode, Value) {
        let req = QueryHistoryRequest {
            query: query.to_string(),
            context,
        };
        parts(record(Path(org.to_string()), headers(user), Json(req)).await).await
    }

    async fn get(org: &str, user: &str, params: &str) -> Vec<Value> {
        let params: QueryHistoryListParams = parse_params(params);
        let (status, body) =
            parts(list(Path(org.to_string()), headers(user), Query(params)).await).await;
        assert_eq!(status, StatusCode::OK);
        body.as_array().unwrap().clone()
    }

    fn parse_params(params: &str) -> QueryHistoryListParams {
        let uri: axum::http::Uri = format!("/?{params}").parse().unwrap();
        Query::try_from_uri(&uri).unwrap().0
    }

    async fn patch(org: &str, user: &str, id: &str, starred: bool) -> (StatusCode, Value) {
        let path = Path((org.to_string(), id.to_string()));
        let req = Json(QueryHistoryStarRequest { starred });
        parts(star(path, headers(user), req).await).await
    }

    async fn remove(org: &str, user: &str, id: &str) -> StatusCode {
        let path = Path((org.to_string(), id.to_string()));
        parts(delete(path, headers(user)).await).await.0
    }

    #[tokio::test]
    async fn test_another_users_entry_is_not_found() {
        setup().await;
        let (a, b) = (user(), user());
        let (status, entry) = post("default", &a, "up", json!({"chart": "line"})).await;
        assert_eq!(status, StatusCode::OK);
        let id = entry["id"].as_str().unwrap();

        assert_eq!(
            patch("default", &b, id, true).await.0,
            StatusCode::NOT_FOUND
        );
        assert_eq!(remove("default", &b, id).await, StatusCode::NOT_FOUND);
        assert_eq!(remove("other", &a, id).await, StatusCode::NOT_FOUND);
        assert!(get("default", &b, "").await.is_empty());
        assert_eq!(get("default", &a, "").await[0]["starred"], false);

        let (status, starred) = patch("default", &a, id, true).await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(starred["starred"], true);
        assert_eq!(remove("default", &a, id).await, StatusCode::OK);
        assert_eq!(remove("default", &a, id).await, StatusCode::NOT_FOUND);
    }

    #[tokio::test]
    async fn test_rerun_updates_the_latest_entry_context() {
        setup().await;
        let a = user();
        post("default", &a, "up", json!({"chart": "line"})).await;
        post("default", &a, "up", json!({"chart": "bar"})).await;
        let listed = get("default", &a, "").await;
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0]["context"]["chart"], "bar");
    }

    #[tokio::test]
    async fn test_oversized_query_or_context_is_rejected() {
        setup().await;
        let a = user();
        let long_query = "x".repeat(MAX_QUERY_BYTES + 1);
        assert_eq!(
            post("default", &a, &long_query, json!({})).await.0,
            StatusCode::BAD_REQUEST
        );
        let big = json!({"d": "x".repeat(MAX_CONTEXT_BYTES)});
        assert_eq!(
            post("default", &a, "up", big).await.0,
            StatusCode::BAD_REQUEST
        );
        let max_query = "x".repeat(MAX_QUERY_BYTES);
        assert_eq!(
            post("default", &a, &max_query, json!({})).await.0,
            StatusCode::OK
        );
        assert_eq!(get("default", &a, "").await.len(), 1);
    }

    #[tokio::test]
    async fn test_blank_query_is_rejected() {
        setup().await;
        let a = user();
        for query in ["", "   ", "\n\t "] {
            assert_eq!(
                post("default", &a, query, json!({})).await.0,
                StatusCode::BAD_REQUEST,
                "{query:?}"
            );
        }
        assert!(get("default", &a, "").await.is_empty());
    }

    #[tokio::test]
    async fn test_list_applies_filters() {
        setup().await;
        let a = user();
        for query in ["up", "rate(http_total[5m])", "sum(http_total)"] {
            post("default", &a, query, json!({})).await;
        }
        let queries = |rows: Vec<Value>| {
            rows.iter()
                .map(|e| e["query"].as_str().unwrap().to_string())
                .collect::<Vec<_>>()
        };
        assert_eq!(
            queries(get("default", &a, "q=http_total&limit=1").await),
            vec!["sum(http_total)"]
        );
        assert_eq!(
            queries(get("default", &a, "q=http_total&offset=1").await),
            vec!["rate(http_total[5m])"]
        );
        assert!(get("default", &a, "starred=true").await.is_empty());
    }

    #[test]
    fn test_list_limit_defaults_to_50_and_caps_at_200() {
        assert_eq!(list_limit(None), 50);
        assert_eq!(list_limit(Some(10)), 10);
        assert_eq!(list_limit(Some(500)), 200);
        assert_eq!(list_limit(Some(0)), 1);
    }
}
