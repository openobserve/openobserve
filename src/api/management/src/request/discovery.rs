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

use std::collections::HashSet;

use axum::{
    extract::{Path, Query},
    response::Response,
};
use openobserve_api_common::extractors::Headers;
use openobserve_core::{
    auth::UserEmail,
    http::map_error_to_http_response,
    llm_evaluations::discovery::{self, DiscoveryError, ListDiscoveryItems},
};

use crate::{
    common::meta::http::HttpResponse as MetaHttpResponse,
    models::discovery::{ListDiscoveryItemsQuery, ListDiscoveryItemsResponseBody},
    request::annotation_queues::visible_annotation_queues_for_user,
};

fn discovery_error_response(error: DiscoveryError) -> Response {
    match error {
        error @ (DiscoveryError::InvalidQueueStatus(_)
        | DiscoveryError::InvalidTimeRange
        | DiscoveryError::InvalidPageSize) => MetaHttpResponse::bad_request(error),
        DiscoveryError::Infra(error) => {
            log::error!("[Discovery] score-config database error: {error}");
            MetaHttpResponse::internal_error("Internal server error")
        }
        DiscoveryError::Database(error) => {
            log::error!("[Discovery] queue database error: {error}");
            MetaHttpResponse::internal_error("Internal server error")
        }
        DiscoveryError::Search(error) => {
            log::error!("[Discovery] {error}");
            match error.downcast_ref::<infra::errors::Error>() {
                Some(error) => map_error_to_http_response(error, None),
                None => MetaHttpResponse::internal_error("Discovery query failed"),
            }
        }
        error @ DiscoveryError::MalformedSearchResponse(_) => {
            log::error!("[Discovery] {error}");
            MetaHttpResponse::internal_error("Discovery query failed")
        }
    }
}

/// ListDiscoveryItems
#[utoipa::path(
    get,
    path = "/{org_id}/discovery",
    context_path = "/api",
    tag = "Discovery",
    operation_id = "ListDiscoveryItems",
    summary = "List unhealthy scored LLM targets",
    description = "Resolves the latest score evaluation and score dimension, applies the current active Score Config thresholds, derives issue or multiple quality, applies visible queue memberships, returns exact totals for every native scope, pages the requested scope, and hydrates scope-specific context for that page.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ListDiscoveryItemsQuery,
    ),
    responses(
        (status = 200, body = inline(ListDiscoveryItemsResponseBody)),
        (status = 400, description = "Invalid discovery request or search query", content_type = "application/json", body = MetaHttpResponse),
        (status = 403, description = "Unable to resolve visible Annotation Queues", content_type = "application/json", body = MetaHttpResponse),
        (status = 408, description = "Discovery query timed out", content_type = "application/json", body = MetaHttpResponse),
        (status = 429, description = "Discovery query cancelled or rate limited", content_type = "application/json", body = MetaHttpResponse),
        (status = 500, description = "Discovery query failed", content_type = "application/json", body = MetaHttpResponse),
        (status = 503, description = "Discovery query service unavailable", content_type = "application/json", body = MetaHttpResponse),
    ),
    extensions(("x-o2-ratelimit" = json!({"module": "Discovery", "operation": "list"}))),
)]
pub async fn list_discovery_items(
    Path(org_id): Path<String>,
    Headers(user): Headers<UserEmail>,
    Query(query): Query<ListDiscoveryItemsQuery>,
) -> Response {
    let request = match ListDiscoveryItems::try_from(query) {
        Ok(request) => request,
        Err(error) => return discovery_error_response(error),
    };

    let visible_queue_ids: HashSet<String> =
        match visible_annotation_queues_for_user(&org_id, &user.user_id).await {
            Ok(queues) => queues.into_iter().map(|queue| queue.id).collect(),
            Err(response) => return response,
        };

    match discovery::list(&org_id, request, Some(&visible_queue_ids)).await {
        Ok(page) => MetaHttpResponse::json(ListDiscoveryItemsResponseBody::from(page)),
        Err(error) => discovery_error_response(error),
    }
}

#[cfg(test)]
mod tests {
    use infra::errors::{Error as InfraError, ErrorCodes};

    use super::*;

    #[test]
    fn maps_client_errors_to_bad_request() {
        assert_eq!(
            discovery_error_response(DiscoveryError::InvalidQueueStatus("open".to_string()))
                .status()
                .as_u16(),
            400
        );
        assert_eq!(
            discovery_error_response(DiscoveryError::InvalidTimeRange)
                .status()
                .as_u16(),
            400
        );
    }

    #[tokio::test]
    async fn forwards_structured_search_errors() {
        let response = discovery_error_response(DiscoveryError::Search(anyhow::anyhow!(
            InfraError::ErrorCode(ErrorCodes::SearchTimeout("query timed out".to_string())),
        )));

        assert_eq!(response.status().as_u16(), 408);
        assert_eq!(response.headers().get("X-Error-Message").unwrap(), "20010");

        let body = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        let body: MetaHttpResponse = serde_json::from_slice(&body).unwrap();
        assert_eq!(body.code, 20010);
        assert_eq!(body.message, "Search query timed out");
        assert_eq!(body.error_detail.as_deref(), Some("query timed out"));
    }

    #[tokio::test]
    async fn hides_unstructured_search_errors() {
        let response = discovery_error_response(DiscoveryError::Search(anyhow::anyhow!(
            "executor failed with private details"
        )));

        assert_eq!(response.status().as_u16(), 500);

        let body = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        let body: MetaHttpResponse = serde_json::from_slice(&body).unwrap();
        assert_eq!(body.code, 500);
        assert_eq!(body.message, "Discovery query failed");
    }
}
