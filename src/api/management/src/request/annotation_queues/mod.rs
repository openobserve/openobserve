// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

use axum::{
    extract::{Path, Query},
    response::Response,
};
use db::authz::{remove_ownership, set_ownership};
use openobserve_api_common::extractors::Headers;
use openobserve_core::{
    auth::{UserEmail, is_ofga_object_visible},
    llm_evaluations::annotation_queues::{
        self, AnnotationQueueError, ListAnnotationQueueItemsFilter,
    },
    self_reporting::llm_scores_writer,
};

use crate::{
    common::meta::{authz::Authz, http::HttpResponse as MetaHttpResponse},
    models::{
        annotation_queues::{
            AnnotationQueueItemDetailResponseBody, AnnotationQueueItemResponseBody,
            AnnotationQueueItemSelectionRequestBody, AnnotationQueueResponseBody,
            ArchiveAnnotationQueueItemsResponseBody, ClearAnnotationQueueItemsResponseBody,
            CreateAnnotationQueueRequestBody, EnqueueAnnotationQueueItemRequestBody,
            ListAnnotationQueueItemsQuery, ListAnnotationQueueItemsResponseBody,
            ListAnnotationQueuesResponseBody, ListQueueReviewsResponseBody,
            ReviewAnnotationQueueItemRequestBody, UpdateAnnotationQueueRequestBody,
        },
        annotations::AnnotateResponseBody,
    },
};

fn annotation_queue_error_response(value: AnnotationQueueError) -> Response {
    match value {
        AnnotationQueueError::Database(err) => {
            log::error!("[AnnotationQueue] internal error: {err}");
            MetaHttpResponse::internal_error("Internal server error")
        }
        AnnotationQueueError::Publish(err) => {
            log::error!("[AnnotationQueue] failed to publish review Scores: {err}");
            MetaHttpResponse::internal_error("Failed to publish review Scores")
        }
        AnnotationQueueError::Search(err) => {
            log::error!("[AnnotationQueue] failed to query Workbench Scores: {err}");
            MetaHttpResponse::internal_error("Failed to query Workbench Scores")
        }
        AnnotationQueueError::MalformedReviewScore(err) => {
            log::error!("[AnnotationQueue] malformed review Score: {err}");
            MetaHttpResponse::internal_error("Malformed review Score")
        }
        AnnotationQueueError::MalformedMachineScore(err) => {
            log::error!("[AnnotationQueue] malformed machine Score: {err}");
            MetaHttpResponse::internal_error("Malformed machine Score")
        }
        AnnotationQueueError::QueueItemSourceStreamNotFound => {
            log::error!("[AnnotationQueue] Queue Item has no machine Score source stream");
            MetaHttpResponse::internal_error("Queue Item source stream not found")
        }
        AnnotationQueueError::AmbiguousQueueItemSourceStream => {
            log::error!("[AnnotationQueue] Queue Item resolves to multiple source streams");
            MetaHttpResponse::internal_error("Queue Item source stream is ambiguous")
        }
        AnnotationQueueError::Hydration(err) => {
            log::error!("[AnnotationQueue] failed to hydrate Queue Item: {err}");
            MetaHttpResponse::internal_error("Failed to hydrate Queue Item")
        }
        error @ (AnnotationQueueError::MissingName
        | AnnotationQueueError::MissingScoreConfigs
        | AnnotationQueueError::DuplicateScoreConfigRowIds
        | AnnotationQueueError::TargetDatasetNotFound
        | AnnotationQueueError::InvalidQueueItemStatus(_)
        | AnnotationQueueError::InvalidQueueItemScope(_)
        | AnnotationQueueError::InvalidQueueId
        | AnnotationQueueError::InvalidQueueItemReference(_)
        | AnnotationQueueError::QueueItemRefTypeNotAllowed(_)
        | AnnotationQueueError::MissingQueueItemIds
        | AnnotationQueueError::InvalidQueueItemIds
        | AnnotationQueueError::DuplicateQueueItemIds
        | AnnotationQueueError::Annotation(_)) => MetaHttpResponse::bad_request(error),
        error @ AnnotationQueueError::InvalidScoreConfigRowIds(_) => {
            MetaHttpResponse::bad_request(error)
        }
        error @ AnnotationQueueError::DuplicateLogicalScoreConfig { .. } => {
            MetaHttpResponse::bad_request(error)
        }
        AnnotationQueueError::NotFound => MetaHttpResponse::not_found("Annotation Queue not found"),
        AnnotationQueueError::QueueItemNotFound => {
            MetaHttpResponse::not_found("Annotation Queue Item not found")
        }
        error @ (AnnotationQueueError::DuplicateName
        | AnnotationQueueError::StaleBindings
        | AnnotationQueueError::ArchivedQueueItem
        | AnnotationQueueError::QueueItemAlreadyQueued) => MetaHttpResponse::conflict(error),
    }
}

/// EnqueueAnnotationQueueItem
#[utoipa::path(
    post,
    path = "/{org_id}/annotation_queues/{queue_id}/items",
    context_path = "/api",
    tag = "AnnotationQueues",
    operation_id = "EnqueueAnnotationQueueItem",
    summary = "Add a discovered item to an Annotation Queue",
    description = "Adds a discovered span, trace, or session to one Annotation Queue. Returns a conflict when the same reference is already in the Queue.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("queue_id" = String, Path, description = "Destination Annotation Queue ID"),
    ),
    request_body(content = inline(EnqueueAnnotationQueueItemRequestBody), description = "Discovered item reference"),
    responses(
        (status = 200, body = inline(AnnotationQueueItemResponseBody)),
        (status = 400, description = "Bad Request", body = ()),
        (status = 404, description = "Annotation Queue not found", body = ()),
        (status = 409, description = "Item is already queued in this Annotation Queue", body = ()),
    ),
    extensions(("x-o2-ratelimit" = json!({"module": "AnnotationQueues", "operation": "create"}))),
)]
pub async fn enqueue_annotation_queue_item(
    Path((org_id, queue_id)): Path<(String, String)>,
    axum::Json(body): axum::Json<EnqueueAnnotationQueueItemRequestBody>,
) -> Response {
    match annotation_queues::enqueue_item(&org_id, &queue_id, body.into()).await {
        Ok(item) => MetaHttpResponse::json(AnnotationQueueItemResponseBody::from(item)),
        Err(err) => annotation_queue_error_response(err),
    }
}

/// GetAnnotationQueueItem
#[utoipa::path(
    get,
    path = "/{org_id}/annotation_queues/{queue_id}/items/{queue_item_id}",
    context_path = "/api",
    tag = "AnnotationQueues",
    operation_id = "GetAnnotationQueueItem",
    summary = "Get one hydrated Annotation Queue Item",
    description = "Uses the Queue Item's stored trace start time through now to load its latest machine Scores, resolve the source trace stream, and hydrate its business input, output, and trace context.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("queue_id" = String, Path, description = "Annotation Queue ID"),
        ("queue_item_id" = String, Path, description = "Annotation Queue Item ID"),
    ),
    responses(
        (status = 200, body = inline(AnnotationQueueItemDetailResponseBody)),
        (status = 404, description = "Queue or Queue Item not found", body = ()),
        (status = 500, description = "Score lookup or source hydration failed", body = ()),
    ),
    extensions(("x-o2-ratelimit" = json!({"module": "AnnotationQueues", "operation": "get"}))),
)]
pub async fn get_annotation_queue_item(
    Path((org_id, queue_id, queue_item_id)): Path<(String, String, String)>,
) -> Response {
    match annotation_queues::get_item_detail(&org_id, &queue_id, &queue_item_id).await {
        Ok(item) => MetaHttpResponse::json(AnnotationQueueItemDetailResponseBody::from(item)),
        Err(err) => annotation_queue_error_response(err),
    }
}

/// ReviewAnnotationQueueItem
#[utoipa::path(
    post,
    path = "/{org_id}/annotation_queues/{queue_id}/items/{queue_item_id}/reviews",
    context_path = "/api",
    tag = "AnnotationQueues",
    operation_id = "ReviewAnnotationQueueItem",
    summary = "Submit one complete N/N Workbench review",
    description = "Validates exact pinned Score Config coverage, writes the immutable review to _llm_scores, and then advances the QueueItem workflow projection to reviewed.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("queue_id" = String, Path, description = "Annotation Queue ID"),
        ("queue_item_id" = String, Path, description = "Annotation Queue Item ID"),
    ),
    request_body(content = inline(ReviewAnnotationQueueItemRequestBody), description = "Complete N/N review"),
    responses(
        (status = 200, body = inline(AnnotateResponseBody)),
        (status = 400, description = "Incomplete or invalid review", body = ()),
        (status = 404, description = "Queue or Queue Item not found", body = ()),
        (status = 409, description = "Stale bindings or archived Queue Item", body = ()),
    ),
    extensions(("x-o2-ratelimit" = json!({"module": "AnnotationQueues", "operation": "update"}))),
)]
pub async fn review_annotation_queue_item(
    Path((org_id, queue_id, queue_item_id)): Path<(String, String, String)>,
    Headers(user): Headers<UserEmail>,
    axum::Json(body): axum::Json<ReviewAnnotationQueueItemRequestBody>,
) -> Response {
    match annotation_queues::submit_review(
        &org_id,
        &queue_id,
        &queue_item_id,
        &user.user_id,
        body.into(),
        |publish_org_id, records| async move {
            llm_scores_writer::publish(&publish_org_id, &records).await
        },
    )
    .await
    {
        Ok(prepared) => MetaHttpResponse::json(AnnotateResponseBody::from(&prepared)),
        Err(err) => annotation_queue_error_response(err),
    }
}

/// ListAnnotationQueueItemReviews
#[utoipa::path(
    get,
    path = "/{org_id}/annotation_queues/{queue_id}/items/{queue_item_id}/reviews",
    context_path = "/api",
    tag = "AnnotationQueues",
    operation_id = "ListAnnotationQueueItemReviews",
    summary = "List complete Workbench reviews from _llm_scores",
    description = "Reads the authoritative annotation Score events, collapses idempotent retries, groups them by review submission ID, and omits incomplete N/N groups.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("queue_id" = String, Path, description = "Annotation Queue ID"),
        ("queue_item_id" = String, Path, description = "Annotation Queue Item ID"),
    ),
    responses(
        (status = 200, description = "Complete review submissions"),
        (status = 404, description = "Queue or Queue Item not found", body = ()),
    ),
    extensions(("x-o2-ratelimit" = json!({"module": "AnnotationQueues", "operation": "list"}))),
)]
pub async fn list_annotation_queue_item_reviews(
    Path((org_id, queue_id, queue_item_id)): Path<(String, String, String)>,
) -> Response {
    match annotation_queues::list_reviews(&org_id, &queue_id, &queue_item_id).await {
        Ok(list) => MetaHttpResponse::json(ListQueueReviewsResponseBody { list }),
        Err(err) => annotation_queue_error_response(err),
    }
}

/// ArchiveAnnotationQueueItems
#[utoipa::path(
    post,
    path = "/{org_id}/annotation_queues/{queue_id}/items/archive",
    context_path = "/api",
    tag = "AnnotationQueues",
    operation_id = "ArchiveAnnotationQueueItems",
    summary = "Archive selected Annotation Queue Items",
    description = "Soft-removes selected Queue Items from the active workflow by setting archivedAt. Existing review Scores in _llm_scores are retained.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("queue_id" = String, Path, description = "Annotation Queue ID"),
    ),
    request_body(content = inline(AnnotationQueueItemSelectionRequestBody), description = "Selected Queue Item IDs"),
    responses(
        (status = 200, body = inline(ArchiveAnnotationQueueItemsResponseBody)),
        (status = 400, description = "Bad Request", body = ()),
        (status = 404, description = "Annotation Queue not found", body = ()),
    ),
    extensions(("x-o2-ratelimit" = json!({"module": "AnnotationQueues", "operation": "update"}))),
)]
pub async fn archive_annotation_queue_items(
    Path((org_id, queue_id)): Path<(String, String)>,
    axum::Json(body): axum::Json<AnnotationQueueItemSelectionRequestBody>,
) -> Response {
    match annotation_queues::archive_items(&org_id, &queue_id, body.into()).await {
        Ok(archived_count) => {
            MetaHttpResponse::json(ArchiveAnnotationQueueItemsResponseBody { archived_count })
        }
        Err(err) => annotation_queue_error_response(err),
    }
}

/// ClearAnnotationQueueItems
#[utoipa::path(
    delete,
    path = "/{org_id}/annotation_queues/{queue_id}/items",
    context_path = "/api",
    tag = "AnnotationQueues",
    operation_id = "ClearAnnotationQueueItems",
    summary = "Clear selected Annotation Queue Items",
    description = "Permanently removes selected QueueItem workflow rows. Existing immutable review Scores in _llm_scores are retained.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("queue_id" = String, Path, description = "Annotation Queue ID"),
    ),
    request_body(content = inline(AnnotationQueueItemSelectionRequestBody), description = "Selected Queue Item IDs"),
    responses(
        (status = 200, body = inline(ClearAnnotationQueueItemsResponseBody)),
        (status = 400, description = "Bad Request", body = ()),
        (status = 404, description = "Annotation Queue not found", body = ()),
    ),
    extensions(("x-o2-ratelimit" = json!({"module": "AnnotationQueues", "operation": "delete"}))),
)]
pub async fn clear_annotation_queue_items(
    Path((org_id, queue_id)): Path<(String, String)>,
    axum::Json(body): axum::Json<AnnotationQueueItemSelectionRequestBody>,
) -> Response {
    match annotation_queues::clear_items(&org_id, &queue_id, body.into()).await {
        Ok(cleared_count) => {
            MetaHttpResponse::json(ClearAnnotationQueueItemsResponseBody { cleared_count })
        }
        Err(err) => annotation_queue_error_response(err),
    }
}

/// ListAnnotationQueueItems
#[utoipa::path(
    get,
    path = "/{org_id}/annotation_queues/items",
    context_path = "/api",
    tag = "AnnotationQueues",
    operation_id = "ListAnnotationQueueItems",
    summary = "List Annotation Queue Items",
    description = "Lists queue memberships across every visible Annotation Queue in the organization. Each membership is returned independently, even when queues reference the same target.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ListAnnotationQueueItemsQuery,
    ),
    responses(
        (status = 200, body = inline(ListAnnotationQueueItemsResponseBody)),
        (status = 400, description = "Bad Request", body = ()),
    ),
    extensions(("x-o2-ratelimit" = json!({"module": "AnnotationQueues", "operation": "list"}))),
)]
pub async fn list_annotation_queue_items(
    Path(org_id): Path<String>,
    Headers(user): Headers<UserEmail>,
    Query(query): Query<ListAnnotationQueueItemsQuery>,
) -> Response {
    let filter = match ListAnnotationQueueItemsFilter::try_from((
        query.queue_id,
        query.queue_status,
        query.scope,
    )) {
        Ok(filter) => filter,
        Err(err) => return annotation_queue_error_response(err),
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
        Err(err) => return MetaHttpResponse::forbidden(err.to_string()),
    };

    match annotation_queues::list_items(&org_id, filter).await {
        Ok(items) => {
            let items: Vec<_> = items
                .into_iter()
                .filter(|item| {
                    is_ofga_object_visible(
                        &org_id,
                        "annotation_queue",
                        &item.queue_id,
                        permitted_objects.as_deref(),
                    )
                })
                .collect();
            MetaHttpResponse::json(ListAnnotationQueueItemsResponseBody::from(items))
        }
        Err(err) => annotation_queue_error_response(err),
    }
}

/// ListAnnotationQueues
#[utoipa::path(
    get,
    path = "/{org_id}/annotation_queues",
    context_path = "/api",
    tag = "AnnotationQueues",
    operation_id = "ListAnnotationQueues",
    summary = "List Annotation Queues",
    description = "Lists the Annotation Queues in the organization and their pinned Score Config versions.",
    security(("Authorization" = [])),
    params(("org_id" = String, Path, description = "Organization name")),
    responses((status = 200, body = inline(ListAnnotationQueuesResponseBody))),
    extensions(("x-o2-ratelimit" = json!({"module": "AnnotationQueues", "operation": "list"}))),
)]
pub async fn list_annotation_queues(
    Path(org_id): Path<String>,
    Headers(user): Headers<UserEmail>,
) -> Response {
    let permitted_objects = match openobserve_api_common::auth::validator::list_objects_for_user(
        &org_id,
        &user.user_id,
        "GET",
        "annotation_queue",
    )
    .await
    {
        Ok(list) => list,
        Err(err) => return MetaHttpResponse::forbidden(err.to_string()),
    };
    match annotation_queues::list(&org_id).await {
        Ok(queues) => {
            let queues: Vec<_> = queues
                .into_iter()
                .filter(|queue| {
                    is_ofga_object_visible(
                        &org_id,
                        "annotation_queue",
                        &queue.id,
                        permitted_objects.as_deref(),
                    )
                })
                .collect();
            MetaHttpResponse::json(ListAnnotationQueuesResponseBody::from(queues))
        }
        Err(err) => annotation_queue_error_response(err),
    }
}

/// CreateAnnotationQueue
#[utoipa::path(
    post,
    path = "/{org_id}/annotation_queues",
    context_path = "/api",
    tag = "AnnotationQueues",
    operation_id = "CreateAnnotationQueue",
    summary = "Create an Annotation Queue",
    description = "Creates an Annotation Queue whose rubric is pinned to immutable Score Config row IDs.",
    security(("Authorization" = [])),
    params(("org_id" = String, Path, description = "Organization name")),
    request_body(content = inline(CreateAnnotationQueueRequestBody), description = "Annotation Queue payload"),
    responses(
        (status = 200, body = inline(AnnotationQueueResponseBody)),
        (status = 400, description = "Bad Request", body = ()),
        (status = 409, description = "Conflict", body = ()),
    ),
    extensions(("x-o2-ratelimit" = json!({"module": "AnnotationQueues", "operation": "create"}))),
)]
pub async fn create_annotation_queue(
    Path(org_id): Path<String>,
    Headers(user): Headers<UserEmail>,
    axum::Json(body): axum::Json<CreateAnnotationQueueRequestBody>,
) -> Response {
    match annotation_queues::create(&org_id, &user.user_id, body.into()).await {
        Ok(queue) => {
            set_ownership(&org_id, "annotation_queues", Authz::new(&queue.id)).await;
            MetaHttpResponse::json(AnnotationQueueResponseBody::from(queue))
        }
        Err(err) => annotation_queue_error_response(err),
    }
}

/// GetAnnotationQueue
#[utoipa::path(
    get,
    path = "/{org_id}/annotation_queues/{queue_id}",
    context_path = "/api",
    tag = "AnnotationQueues",
    operation_id = "GetAnnotationQueue",
    summary = "Get an Annotation Queue",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("queue_id" = String, Path, description = "Annotation Queue ID"),
    ),
    responses(
        (status = 200, body = inline(AnnotationQueueResponseBody)),
        (status = 404, description = "Not Found", body = ()),
    ),
    extensions(("x-o2-ratelimit" = json!({"module": "AnnotationQueues", "operation": "get"}))),
)]
pub async fn get_annotation_queue(Path((org_id, queue_id)): Path<(String, String)>) -> Response {
    match annotation_queues::get(&org_id, &queue_id).await {
        Ok(queue) => MetaHttpResponse::json(AnnotationQueueResponseBody::from(queue)),
        Err(err) => annotation_queue_error_response(err),
    }
}

/// UpdateAnnotationQueue
#[utoipa::path(
    put,
    path = "/{org_id}/annotation_queues/{queue_id}",
    context_path = "/api",
    tag = "AnnotationQueues",
    operation_id = "UpdateAnnotationQueue",
    summary = "Update an Annotation Queue",
    description = "Replaces the Queue rubric when the submitted physical Score Config binding set is still current.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("queue_id" = String, Path, description = "Annotation Queue ID"),
    ),
    request_body(content = inline(UpdateAnnotationQueueRequestBody), description = "Annotation Queue payload"),
    responses(
        (status = 200, body = inline(AnnotationQueueResponseBody)),
        (status = 400, description = "Bad Request", body = ()),
        (status = 404, description = "Not Found", body = ()),
        (status = 409, description = "Conflict", body = ()),
    ),
    extensions(("x-o2-ratelimit" = json!({"module": "AnnotationQueues", "operation": "update"}))),
)]
pub async fn update_annotation_queue(
    Path((org_id, queue_id)): Path<(String, String)>,
    Headers(user): Headers<UserEmail>,
    axum::Json(body): axum::Json<UpdateAnnotationQueueRequestBody>,
) -> Response {
    match annotation_queues::update(&org_id, &queue_id, &user.user_id, body.into()).await {
        Ok(queue) => MetaHttpResponse::json(AnnotationQueueResponseBody::from(queue)),
        Err(err) => annotation_queue_error_response(err),
    }
}

/// DeleteAnnotationQueue
#[utoipa::path(
    delete,
    path = "/{org_id}/annotation_queues/{queue_id}",
    context_path = "/api",
    tag = "AnnotationQueues",
    operation_id = "DeleteAnnotationQueue",
    summary = "Delete an Annotation Queue",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("queue_id" = String, Path, description = "Annotation Queue ID"),
    ),
    responses(
        (status = 200, description = "Deleted", body = String),
        (status = 404, description = "Not Found", body = ()),
    ),
    extensions(("x-o2-ratelimit" = json!({"module": "AnnotationQueues", "operation": "delete"}))),
)]
pub async fn delete_annotation_queue(Path((org_id, queue_id)): Path<(String, String)>) -> Response {
    match annotation_queues::delete(&org_id, &queue_id).await {
        Ok(()) => {
            remove_ownership(&org_id, "annotation_queues", Authz::new(&queue_id)).await;
            MetaHttpResponse::ok("Annotation Queue deleted")
        }
        Err(err) => annotation_queue_error_response(err),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_client_and_conflict_errors() {
        assert_eq!(
            annotation_queue_error_response(AnnotationQueueError::DuplicateLogicalScoreConfig {
                entity_id: "config-1".to_string(),
            })
            .status()
            .as_u16(),
            400
        );
        assert_eq!(
            annotation_queue_error_response(AnnotationQueueError::InvalidQueueItemScope(
                "run".to_string(),
            ))
            .status()
            .as_u16(),
            400
        );
        assert_eq!(
            annotation_queue_error_response(AnnotationQueueError::InvalidQueueItemReference(
                "refId cannot be empty".to_string(),
            ))
            .status()
            .as_u16(),
            400
        );
        assert_eq!(
            annotation_queue_error_response(AnnotationQueueError::MissingQueueItemIds)
                .status()
                .as_u16(),
            400
        );
        assert_eq!(
            annotation_queue_error_response(AnnotationQueueError::StaleBindings)
                .status()
                .as_u16(),
            409
        );
        assert_eq!(
            annotation_queue_error_response(AnnotationQueueError::QueueItemAlreadyQueued)
                .status()
                .as_u16(),
            409
        );
    }
}
