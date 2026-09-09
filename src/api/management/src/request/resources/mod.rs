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

mod matching;
mod sources;

use std::time::Instant;

use axum::{
    extract::{Path, Query},
    http::HeaderMap,
    response::Response,
};
use common::meta::http::HttpResponse as MetaHttpResponse;
use futures::future::join_all;

use crate::models::resources::{
    DEFAULT_LIMIT, MAX_LIMIT, ResourceType, SearchResourcesQuery, SearchResourcesResponse,
};

/// Absent means every type; unknown names are ignored; duplicates collapse.
pub fn parse_types(types: Option<&str>) -> Vec<ResourceType> {
    let Some(types) = types else {
        return ResourceType::ALL.to_vec();
    };
    let mut out: Vec<ResourceType> = Vec::new();
    for kind in types.split(',').filter_map(ResourceType::parse) {
        if !out.contains(&kind) {
            out.push(kind);
        }
    }
    out
}

/// SearchResources - Search org resources by name, id or description for the command palette.
#[utoipa::path(
    get,
    path = "/{org_id}/resources/_search",
    context_path = "/api",
    tag = "Resources",
    operation_id = "SearchResources",
    summary = "Search org resources by name",
    description = "Finds dashboards, alerts, streams, saved views, functions, pipelines, users, service accounts and synthetic checks whose name, id or description matches the query. Returns at most `limit` rows per type, scored exact > id > prefix > word start > substring, with the same per-type permission filtering as the corresponding list endpoints. An empty query returns the alphabetical head of each requested type.",
    security(
        ("Authorization" = [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        SearchResourcesQuery,
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = SearchResourcesResponse),
        (status = 400, description = "Invalid limit", content_type = "application/json", body = ()),
        (status = 401, description = "Unauthorized", content_type = "application/json", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Resources", "operation": "list"})),
        ("x-o2-mcp" = json!({"description": "Search dashboards, alerts, streams, saved views, functions, pipelines, users and synthetic checks by name or id", "category": "search"}))
    )
)]
pub async fn search(
    Path(org_id): Path<String>,
    Query(query): Query<SearchResourcesQuery>,
    headers: HeaderMap,
) -> Response {
    let Some(user_id) = headers
        .get("user_id")
        .and_then(|v| v.to_str().ok())
        .map(str::to_owned)
    else {
        return MetaHttpResponse::unauthorized("User ID not found in request headers");
    };
    let limit = query.limit.unwrap_or(DEFAULT_LIMIT);
    if !(1..=MAX_LIMIT).contains(&limit) {
        return MetaHttpResponse::bad_request(format!("limit must be between 1 and {MAX_LIMIT}"));
    }
    let types = parse_types(query.types.as_deref());
    let q = matching::fold(&query.q);
    let started = Instant::now();
    let ctx = sources::SourceContext {
        org_id: &org_id,
        user_id: &user_id,
        q: &q,
        limit,
    };
    let ctx = &ctx;
    let results = join_all(
        types
            .iter()
            .map(|kind| async move { (*kind, sources::fetch(ctx, *kind).await) }),
    )
    .await;

    let mut hits = Vec::new();
    let mut truncated = Vec::new();
    for (kind, result) in results {
        // One failing source must not hide the others; the palette degrades per type.
        let rows = match result {
            Ok(rows) => rows,
            Err(e) => {
                log::warn!("[RESOURCES] {kind:?} search failed for org {org_id}: {e}");
                continue;
            }
        };
        let (ranked, cut) = matching::rank(rows, &q, limit as usize);
        if cut {
            truncated.push(kind);
        }
        hits.extend(ranked);
    }
    MetaHttpResponse::json(SearchResourcesResponse {
        hits,
        truncated,
        took_ms: started.elapsed().as_millis() as u64,
    })
}

#[cfg(test)]
mod tests {
    use axum::http::StatusCode;

    use super::*;

    fn headers(user_id: Option<&str>) -> HeaderMap {
        let mut headers = HeaderMap::new();
        if let Some(user_id) = user_id {
            headers.insert("user_id", user_id.parse().unwrap());
        }
        headers
    }

    fn query(types: Option<&str>, limit: Option<u64>) -> SearchResourcesQuery {
        SearchResourcesQuery {
            q: "x".to_owned(),
            types: types.map(str::to_owned),
            limit,
        }
    }

    #[test]
    fn parse_types_defaults_dedupes_and_ignores_unknown() {
        assert_eq!(parse_types(None), ResourceType::ALL.to_vec());
        assert_eq!(
            parse_types(Some("alert, stream,alert,bogus")),
            vec![ResourceType::Alert, ResourceType::Stream]
        );
        assert!(parse_types(Some("bogus")).is_empty());
    }

    #[tokio::test]
    async fn search_requires_the_user_header() {
        let resp = search(
            Path("default".to_owned()),
            Query(query(None, None)),
            headers(None),
        )
        .await;
        // MetaHttpResponse::unauthorized maps to 403 with a 401 body, like the other handlers.
        assert_eq!(resp.status(), StatusCode::FORBIDDEN);
    }

    #[tokio::test]
    async fn search_rejects_a_limit_outside_the_range() {
        for limit in [0, 101] {
            let resp = search(
                Path("default".to_owned()),
                Query(query(None, Some(limit))),
                headers(Some("root@example.com")),
            )
            .await;
            assert_eq!(resp.status(), StatusCode::BAD_REQUEST, "limit={limit}");
        }
    }

    #[tokio::test]
    async fn search_with_no_known_types_returns_an_empty_result() {
        let resp = search(
            Path("default".to_owned()),
            Query(query(Some("bogus"), None)),
            headers(Some("root@example.com")),
        )
        .await;
        assert_eq!(resp.status(), StatusCode::OK);
        let body = axum::body::to_bytes(resp.into_body(), usize::MAX)
            .await
            .unwrap();
        let payload: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(payload["hits"].as_array().unwrap().len(), 0);
        assert_eq!(payload["truncated"].as_array().unwrap().len(), 0);
    }
}
