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
    llm_evaluations::discovery::{self, DiscoveryError, ListDiscoveryItems},
};

use crate::{
    common::meta::http::HttpResponse as MetaHttpResponse,
    models::discovery::{ListDiscoveryItemsQuery, ListDiscoveryItemsResponseBody},
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
        error @ (DiscoveryError::Search(_) | DiscoveryError::MalformedSearchResponse(_)) => {
            log::error!("[Discovery] {error}");
            MetaHttpResponse::internal_error("Discovery query failed")
        }
    }
}

fn visible_queue_ids(
    org_id: &str,
    permitted_objects: Option<Vec<String>>,
) -> Option<HashSet<String>> {
    let permitted_objects = permitted_objects?;
    if permitted_objects.contains(&format!("annotation_queue:_all_{org_id}")) {
        return None;
    }

    Some(
        permitted_objects
            .into_iter()
            .filter_map(|object| object.strip_prefix("annotation_queue:").map(str::to_string))
            .collect(),
    )
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
        (status = 400, description = "Invalid filter, time range, or page size", body = ()),
        (status = 403, description = "Unable to resolve visible Annotation Queues", body = ()),
        (status = 500, description = "Discovery query failed", body = ()),
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

    let permitted_objects = match openobserve_api_common::auth::validator::list_objects_for_user(
        &org_id,
        &user.user_id,
        "GET",
        "annotation_queue",
    )
    .await
    {
        Ok(list) => list,
        Err(error) => return MetaHttpResponse::forbidden(error.to_string()),
    };
    let visible_queue_ids = visible_queue_ids(&org_id, permitted_objects);

    match discovery::list(&org_id, request, visible_queue_ids.as_ref()).await {
        Ok(page) => MetaHttpResponse::json(ListDiscoveryItemsResponseBody::from(page)),
        Err(error) => discovery_error_response(error),
    }
}

#[cfg(test)]
mod tests {
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

    #[test]
    fn resolves_explicit_and_organization_wide_queue_visibility() {
        assert_eq!(
            visible_queue_ids(
                "org-1",
                Some(vec![
                    "annotation_queue:queue-1".to_string(),
                    "dataset:dataset-1".to_string(),
                ]),
            ),
            Some(HashSet::from(["queue-1".to_string()]))
        );
        assert_eq!(
            visible_queue_ids(
                "org-1",
                Some(vec!["annotation_queue:_all_org-1".to_string()]),
            ),
            None
        );
        assert_eq!(visible_queue_ids("org-1", None), None);
    }
}
