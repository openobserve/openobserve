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

mod permissions;
#[cfg(feature = "enterprise")]
mod rbac;

use std::time::Instant;

use axum::{
    Json,
    extract::{Path, Query, rejection::QueryRejection},
    http::{StatusCode, header},
    response::{IntoResponse, Response},
};
use openobserve_api_common::extractors::Headers;
use openobserve_core::{
    auth::UserEmail,
    resources::{self, SearchError},
};
use serde::Serialize;

use crate::models::resources::SearchParams;

#[derive(Serialize)]
struct SearchFailure {
    code: &'static str,
    message: String,
}

#[utoipa::path(
    get,
    path = "/{org_id}/resources/_search",
    context_path = "/api",
    tag = "Resources",
    operation_id = "ResourceSearch",
    summary = "Search resource names and identities in the current organization",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("q" = Option<String>, Query, description = "Name or stable identity, at most 256 normalized Unicode characters"),
        ("types" = Option<String>, Query, description = "Comma-separated resource types"),
        ("limit" = Option<usize>, Query, description = "Per-type limit, default 20, maximum 100"),
        ("offset" = Option<usize>, Query, description = "Hits to skip, for one explicit resource type, at most 10000")
    ),
    responses(
        (status = 200, description = "Resource summaries and per-source completeness", body = config::meta::resources::SearchResponse),
        (status = 400, description = "Invalid search parameters"),
        (status = 401, description = "Authentication required"),
        (status = 403, description = "Organization access denied"),
        (status = 429, description = "Search capacity exhausted"),
        (status = 503, description = "Search unavailable")
    ),
    extensions(("x-o2-mcp" = json!({"enabled": false})), ("x-o2-ratelimit" = json!({"module": "Resources", "operation": "list"}))),
)]
pub async fn search(
    Path(org): Path<String>,
    Headers(subject): Headers<UserEmail>,
    params: Result<Query<SearchParams>, QueryRejection>,
) -> Response {
    let start = Instant::now();
    let params = match params {
        Ok(Query(params)) => params,
        Err(_) => {
            return failure(
                StatusCode::BAD_REQUEST,
                "invalid_query",
                "Invalid search parameters",
            );
        }
    };
    let explicit_types = params.types.is_some();
    let mut query = match params.into_query() {
        Ok(query) => query,
        Err(error) => return failure(StatusCode::BAD_REQUEST, "invalid_query", error),
    };
    if !db::user::is_root_user(&subject.user_id)
        && openobserve_core::users::get_user(Some(&org), &subject.user_id)
            .await
            .is_none()
    {
        return failure(
            StatusCode::FORBIDDEN,
            "forbidden",
            "Organization access denied",
        );
    }
    if !explicit_types {
        query.types.retain(|kind| permissions::enabled(*kind));
    }
    let access = permissions::resolve(&org, &subject.user_id, &query.types).await;
    match resources::search(&org, query, access).await {
        Ok(mut result) => {
            result.took_ms = start.elapsed().as_millis().min(u128::from(u64::MAX)) as u64;
            ([(header::CACHE_CONTROL, "private, no-store")], Json(result)).into_response()
        }
        Err(SearchError::InvalidQuery(error)) => {
            failure(StatusCode::BAD_REQUEST, "invalid_query", error)
        }
        Err(SearchError::Overloaded) => failure(
            StatusCode::TOO_MANY_REQUESTS,
            "overloaded",
            "Search capacity exhausted",
        ),
        Err(SearchError::ServiceUnavailable) => failure(
            StatusCode::SERVICE_UNAVAILABLE,
            "unavailable",
            "Search unavailable",
        ),
    }
}

fn failure(status: StatusCode, code: &'static str, message: impl Into<String>) -> Response {
    (
        status,
        [(header::CACHE_CONTROL, "private, no-store")],
        Json(SearchFailure {
            code,
            message: message.into(),
        }),
    )
        .into_response()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn invalid_query_does_not_read_user_or_resource_metadata() {
        let response = search(
            Path("unknown-org".to_owned()),
            Headers(UserEmail {
                user_id: "unknown-user@example.invalid".to_owned(),
            }),
            Ok(Query(SearchParams::default())),
        )
        .await;
        assert_eq!(response.status(), StatusCode::BAD_REQUEST);
        assert_eq!(
            response.headers()[header::CACHE_CONTROL],
            "private, no-store"
        );
        let bytes = axum::body::to_bytes(response.into_body(), 4096)
            .await
            .unwrap();
        let value: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(value["code"], "invalid_query");
    }
}
