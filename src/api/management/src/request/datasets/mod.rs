// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

use axum::{
    extract::{Multipart, Path, Query},
    response::Response,
};
use db::authz::{remove_ownership, set_ownership};
use openobserve_api_common::extractors::Headers;
use openobserve_core::{
    auth::{UserEmail, is_ofga_object_visible},
    llm_evaluations::datasets::{self, DatasetError, ImportDatasetItem},
};

use crate::{
    common::meta::{authz::Authz, http::HttpResponse as MetaHttpResponse},
    models::datasets::{
        CreateDatasetRequestBody, DatasetItemResponseBody, DatasetItemVersionsResponseBody,
        DatasetResponseBody, ImportDatasetItemsResponseBody, ListDatasetItemsQuery,
        ListDatasetItemsResponseBody, ListDatasetsResponseBody,
        PushAnnotationQueueItemToDatasetRequestBody, PushDatasetItemRequestBody,
        PushDatasetItemResponseBody, UpdateDatasetItemRequestBody, UpdateDatasetRequestBody,
    },
    request::annotation_queues::ensure_annotation_queue_score_configs_visible,
};

const MAX_DATASET_IMPORT_BYTES: usize = 10 * 1024 * 1024;

fn dataset_error_response(value: DatasetError) -> Response {
    match value {
        DatasetError::Database(err) => {
            log::error!("[Dataset] internal error: {err}");
            MetaHttpResponse::internal_error("Internal server error")
        }
        error @ (DatasetError::ReviewLookup(_)
        | DatasetError::VersionOverflow
        | DatasetError::MalformedItem(_)) => {
            log::error!("[Dataset] internal error: {error}");
            MetaHttpResponse::internal_error("Internal server error")
        }
        error @ (DatasetError::MissingName
        | DatasetError::MissingDatasetId
        | DatasetError::MissingItemInput
        | DatasetError::MissingExpectedOutput
        | DatasetError::MissingSourceStream
        | DatasetError::InvalidTraceStartTime
        | DatasetError::InvalidPageSize
        | DatasetError::InvalidTelemetryReference(_)
        | DatasetError::UnsupportedQueueItemScope) => {
            MetaHttpResponse::bad_request(error.to_string())
        }
        DatasetError::NotFound => MetaHttpResponse::not_found("Dataset not found"),
        DatasetError::ItemNotFound => MetaHttpResponse::not_found("Dataset Item not found"),
        DatasetError::QueueNotFound => MetaHttpResponse::not_found("Annotation Queue not found"),
        DatasetError::QueueItemNotFound => {
            MetaHttpResponse::not_found("Annotation Queue Item not found")
        }
        DatasetError::ReviewSubmissionNotFound => {
            MetaHttpResponse::not_found("Complete review submission not found")
        }
        error @ (DatasetError::DuplicateName | DatasetError::InUse | DatasetError::NotEmpty) => {
            MetaHttpResponse::conflict(error)
        }
        error @ (DatasetError::QueueItemNotReviewed | DatasetError::InconsistentReviewSource) => {
            MetaHttpResponse::conflict(error)
        }
    }
}

/// ListDatasetItems
#[utoipa::path(
    get,
    path = "/{org_id}/datasets/{dataset_id}/items",
    context_path = "/api",
    tag = "Datasets",
    operation_id = "ListDatasetItems",
    summary = "List the current Dataset Item snapshot",
    description = "Returns the latest immutable row for every logical Dataset Item, excluding soft-deleted items unless include_deleted=true.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("dataset_id" = String, Path, description = "Dataset ID"),
        ListDatasetItemsQuery,
    ),
    responses(
        (status = 200, body = inline(ListDatasetItemsResponseBody)),
        (status = 400, description = "Invalid page size", body = ()),
        (status = 404, description = "Dataset not found", body = ()),
    ),
    extensions(("x-o2-ratelimit" = json!({"module": "Datasets", "operation": "list"}))),
)]
pub async fn list_dataset_items(
    Path((org_id, dataset_id)): Path<(String, String)>,
    Query(query): Query<ListDatasetItemsQuery>,
) -> Response {
    match datasets::list_items(&org_id, &dataset_id, query.into()).await {
        Ok(page) => MetaHttpResponse::json(ListDatasetItemsResponseBody::from(page)),
        Err(err) => dataset_error_response(err),
    }
}

/// ListDatasets
#[utoipa::path(
    get,
    path = "/{org_id}/datasets",
    context_path = "/api",
    tag = "Datasets",
    operation_id = "ListDatasets",
    summary = "List Datasets",
    security(("Authorization" = [])),
    params(("org_id" = String, Path, description = "Organization name")),
    responses((status = 200, body = inline(ListDatasetsResponseBody))),
    extensions(("x-o2-ratelimit" = json!({"module": "Datasets", "operation": "list"}))),
)]
pub async fn list_datasets(
    Path(org_id): Path<String>,
    Headers(user): Headers<UserEmail>,
) -> Response {
    let permitted_objects = match openobserve_api_common::auth::validator::list_objects_for_user(
        &org_id,
        &user.user_id,
        "GET",
        "dataset",
    )
    .await
    {
        Ok(list) => list,
        Err(err) => return MetaHttpResponse::forbidden(err.to_string()),
    };
    match datasets::list(&org_id).await {
        Ok(datasets) => {
            let datasets: Vec<_> = datasets
                .into_iter()
                .filter(|dataset| {
                    is_ofga_object_visible(
                        &org_id,
                        "dataset",
                        &dataset.id,
                        permitted_objects.as_deref(),
                    )
                })
                .collect();
            MetaHttpResponse::json(ListDatasetsResponseBody::from(datasets))
        }
        Err(err) => dataset_error_response(err),
    }
}

/// CreateDataset
#[utoipa::path(
    post,
    path = "/{org_id}/datasets",
    context_path = "/api",
    tag = "Datasets",
    operation_id = "CreateDataset",
    summary = "Create a Dataset",
    security(("Authorization" = [])),
    params(("org_id" = String, Path, description = "Organization name")),
    request_body(content = inline(CreateDatasetRequestBody), description = "Dataset payload"),
    responses(
        (status = 200, body = inline(DatasetResponseBody)),
        (status = 400, description = "Bad Request", body = ()),
        (status = 409, description = "Conflict", body = ()),
    ),
    extensions(("x-o2-ratelimit" = json!({"module": "Datasets", "operation": "create"}))),
)]
pub async fn create_dataset(
    Path(org_id): Path<String>,
    Headers(user): Headers<UserEmail>,
    axum::Json(body): axum::Json<CreateDatasetRequestBody>,
) -> Response {
    match datasets::create(&org_id, &user.user_id, body.into()).await {
        Ok(dataset) => {
            set_ownership(&org_id, "datasets", Authz::new(&dataset.id)).await;
            MetaHttpResponse::json(DatasetResponseBody::from(dataset))
        }
        Err(err) => dataset_error_response(err),
    }
}

/// GetDataset
#[utoipa::path(
    get,
    path = "/{org_id}/datasets/{dataset_id}",
    context_path = "/api",
    tag = "Datasets",
    operation_id = "GetDataset",
    summary = "Get a Dataset",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("dataset_id" = String, Path, description = "Dataset ID"),
    ),
    responses(
        (status = 200, body = inline(DatasetResponseBody)),
        (status = 404, description = "Not Found", body = ()),
    ),
    extensions(("x-o2-ratelimit" = json!({"module": "Datasets", "operation": "get"}))),
)]
pub async fn get_dataset(Path((org_id, dataset_id)): Path<(String, String)>) -> Response {
    match datasets::get(&org_id, &dataset_id).await {
        Ok(dataset) => MetaHttpResponse::json(DatasetResponseBody::from(dataset)),
        Err(err) => dataset_error_response(err),
    }
}

/// UpdateDataset
#[utoipa::path(
    put,
    path = "/{org_id}/datasets/{dataset_id}",
    context_path = "/api",
    tag = "Datasets",
    operation_id = "UpdateDataset",
    summary = "Update a Dataset",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("dataset_id" = String, Path, description = "Dataset ID"),
    ),
    request_body(content = inline(UpdateDatasetRequestBody), description = "Dataset payload"),
    responses(
        (status = 200, body = inline(DatasetResponseBody)),
        (status = 400, description = "Bad Request", body = ()),
        (status = 404, description = "Not Found", body = ()),
        (status = 409, description = "Conflict", body = ()),
    ),
    extensions(("x-o2-ratelimit" = json!({"module": "Datasets", "operation": "update"}))),
)]
pub async fn update_dataset(
    Path((org_id, dataset_id)): Path<(String, String)>,
    Headers(user): Headers<UserEmail>,
    axum::Json(body): axum::Json<UpdateDatasetRequestBody>,
) -> Response {
    match datasets::update(&org_id, &dataset_id, &user.user_id, body.into()).await {
        Ok(dataset) => MetaHttpResponse::json(DatasetResponseBody::from(dataset)),
        Err(err) => dataset_error_response(err),
    }
}

/// DeleteDataset
#[utoipa::path(
    delete,
    path = "/{org_id}/datasets/{dataset_id}",
    context_path = "/api",
    tag = "Datasets",
    operation_id = "DeleteDataset",
    summary = "Delete an empty, unused Dataset",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("dataset_id" = String, Path, description = "Dataset ID"),
    ),
    responses(
        (status = 200, description = "Deleted", body = String),
        (status = 404, description = "Not Found", body = ()),
        (status = 409, description = "Conflict", body = ()),
    ),
    extensions(("x-o2-ratelimit" = json!({"module": "Datasets", "operation": "delete"}))),
)]
pub async fn delete_dataset(Path((org_id, dataset_id)): Path<(String, String)>) -> Response {
    match datasets::delete(&org_id, &dataset_id).await {
        Ok(()) => {
            remove_ownership(&org_id, "datasets", Authz::new(&dataset_id)).await;
            MetaHttpResponse::ok("Dataset deleted")
        }
        Err(err) => dataset_error_response(err),
    }
}

/// PushDatasetItem
#[utoipa::path(
    post,
    path = "/{org_id}/datasets/{dataset_id}/items",
    context_path = "/api",
    tag = "Datasets",
    operation_id = "PushDatasetItem",
    summary = "Add a manual or telemetry-backed Dataset Item",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("dataset_id" = String, Path, description = "Dataset ID"),
    ),
    request_body(content = inline(PushDatasetItemRequestBody), description = "Dataset Item payload"),
    responses(
        (status = 200, body = inline(PushDatasetItemResponseBody)),
        (status = 400, description = "Bad Request", body = ()),
        (status = 404, description = "Not Found", body = ()),
    ),
    extensions(("x-o2-ratelimit" = json!({"module": "Datasets", "operation": "update"}))),
)]
pub async fn push_dataset_item(
    Path((org_id, dataset_id)): Path<(String, String)>,
    Headers(user): Headers<UserEmail>,
    axum::Json(body): axum::Json<PushDatasetItemRequestBody>,
) -> Response {
    match datasets::push_item(&org_id, &dataset_id, &user.user_id, body.into()).await {
        Ok(result) => MetaHttpResponse::json(PushDatasetItemResponseBody::from(result)),
        Err(err) => dataset_error_response(err),
    }
}

/// GetDatasetItemVersions
#[utoipa::path(
    get,
    path = "/{org_id}/datasets/{dataset_id}/items/{item_id}",
    context_path = "/api",
    tag = "Datasets",
    operation_id = "GetDatasetItemVersions",
    summary = "Get every version of a Dataset Item",
    description = "Returns every immutable row for one logical Dataset Item in ascending Dataset global-version order, including its tombstone when deleted.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("dataset_id" = String, Path, description = "Dataset ID"),
        ("item_id" = String, Path, description = "Logical Dataset Item ID"),
    ),
    responses(
        (status = 200, body = inline(DatasetItemVersionsResponseBody)),
        (status = 404, description = "Dataset or Dataset Item not found", body = ()),
    ),
    extensions(("x-o2-ratelimit" = json!({"module": "Datasets", "operation": "get"}))),
)]
pub async fn get_dataset_item_versions(
    Path((org_id, dataset_id, item_id)): Path<(String, String, String)>,
) -> Response {
    match datasets::get_item_versions(&org_id, &dataset_id, &item_id).await {
        Ok(items) => MetaHttpResponse::json(DatasetItemVersionsResponseBody::from(items)),
        Err(err) => dataset_error_response(err),
    }
}

/// UpdateDatasetItem
#[utoipa::path(
    put,
    path = "/{org_id}/datasets/{dataset_id}/items/{item_id}",
    context_path = "/api",
    tag = "Datasets",
    operation_id = "UpdateDatasetItem",
    summary = "Append a new Dataset Item version",
    description = "Replaces the user-authored fields by appending an immutable row with the same logical Item ID and the next Dataset global version. Source provenance is preserved.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("dataset_id" = String, Path, description = "Dataset ID"),
        ("item_id" = String, Path, description = "Logical Dataset Item ID"),
    ),
    request_body(content = inline(UpdateDatasetItemRequestBody), description = "Replacement Dataset Item fields"),
    responses(
        (status = 200, body = inline(DatasetItemResponseBody)),
        (status = 400, description = "Invalid Dataset Item", body = ()),
        (status = 404, description = "Dataset or Dataset Item not found", body = ()),
    ),
    extensions(("x-o2-ratelimit" = json!({"module": "Datasets", "operation": "update"}))),
)]
pub async fn update_dataset_item(
    Path((org_id, dataset_id, item_id)): Path<(String, String, String)>,
    Headers(user): Headers<UserEmail>,
    axum::Json(body): axum::Json<UpdateDatasetItemRequestBody>,
) -> Response {
    match datasets::update_item(&org_id, &dataset_id, &item_id, &user.user_id, body.into()).await {
        Ok(item) => MetaHttpResponse::json(DatasetItemResponseBody::from(item)),
        Err(err) => dataset_error_response(err),
    }
}

/// DeleteDatasetItem
#[utoipa::path(
    delete,
    path = "/{org_id}/datasets/{dataset_id}/items/{item_id}",
    context_path = "/api",
    tag = "Datasets",
    operation_id = "DeleteDatasetItem",
    summary = "Soft-delete a Dataset Item",
    description = "Appends an immutable tombstone with the same logical Item ID and the next Dataset global version.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("dataset_id" = String, Path, description = "Dataset ID"),
        ("item_id" = String, Path, description = "Logical Dataset Item ID"),
    ),
    responses(
        (status = 200, body = inline(DatasetItemResponseBody)),
        (status = 404, description = "Dataset or Dataset Item not found", body = ()),
    ),
    extensions(("x-o2-ratelimit" = json!({"module": "Datasets", "operation": "delete"}))),
)]
pub async fn delete_dataset_item(
    Path((org_id, dataset_id, item_id)): Path<(String, String, String)>,
    Headers(user): Headers<UserEmail>,
) -> Response {
    match datasets::delete_item(&org_id, &dataset_id, &item_id, &user.user_id).await {
        Ok(item) => MetaHttpResponse::json(DatasetItemResponseBody::from(item)),
        Err(err) => dataset_error_response(err),
    }
}

/// ImportDatasetItems
#[utoipa::path(
    post,
    path = "/{org_id}/datasets/{dataset_id}/items/import",
    context_path = "/api",
    tag = "Datasets",
    operation_id = "ImportDatasetItems",
    summary = "Import Dataset Items from CSV",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("dataset_id" = String, Path, description = "Dataset ID"),
    ),
    responses(
        (status = 200, body = inline(ImportDatasetItemsResponseBody)),
        (status = 400, description = "Bad Request", body = ()),
        (status = 404, description = "Not Found", body = ()),
    ),
    extensions(("x-o2-ratelimit" = json!({"module": "Datasets", "operation": "update"}))),
)]
pub async fn import_dataset_items(
    Path((org_id, dataset_id)): Path<(String, String)>,
    Headers(user): Headers<UserEmail>,
    mut multipart: Multipart,
) -> Response {
    let mut upload = None;
    while let Ok(Some(field)) = multipart.next_field().await {
        if field.name() != Some("file") {
            continue;
        }
        if upload.is_some() {
            return MetaHttpResponse::bad_request("Only one CSV file may be imported at a time");
        }
        let filename = field.file_name().unwrap_or("import.csv").to_string();
        let bytes = match field.bytes().await {
            Ok(bytes) => bytes,
            Err(error) => {
                return MetaHttpResponse::bad_request(format!(
                    "Failed to read CSV upload: {error}"
                ));
            }
        };
        if bytes.len() > MAX_DATASET_IMPORT_BYTES {
            return MetaHttpResponse::bad_request("CSV import exceeds the 10 MiB limit");
        }
        upload = Some((filename, bytes));
    }

    let Some((filename, bytes)) = upload else {
        return MetaHttpResponse::bad_request("CSV file is required in multipart field 'file'");
    };
    let parsed = match parse_dataset_import_csv(&bytes) {
        Ok(parsed) => parsed,
        Err(error) => return MetaHttpResponse::bad_request(error),
    };
    match datasets::import_items(&org_id, &dataset_id, &user.user_id, &filename, parsed.items).await
    {
        Ok(imported_count) => MetaHttpResponse::json(ImportDatasetItemsResponseBody {
            filename,
            imported_count,
            skipped_count: parsed.skipped_count,
        }),
        Err(err) => dataset_error_response(err),
    }
}

/// PushAnnotationQueueItemToDataset
#[utoipa::path(
    post,
    path = "/{org_id}/annotation_queues/{queue_id}/items/{queue_item_id}/push_to_dataset",
    context_path = "/api",
    tag = "Datasets",
    operation_id = "PushAnnotationQueueItemToDataset",
    summary = "Distill a reviewed Queue Item into a selected Dataset",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("queue_id" = String, Path, description = "Annotation Queue ID"),
        ("queue_item_id" = String, Path, description = "Annotation Queue Item ID"),
    ),
    request_body(
        content = inline(PushAnnotationQueueItemToDatasetRequestBody),
        description = "Selected Dataset and adjudicated Dataset Item payload"
    ),
    responses(
        (status = 200, body = inline(PushDatasetItemResponseBody)),
        (status = 400, description = "Bad Request", body = ()),
        (status = 403, description = "Forbidden", body = ()),
        (status = 404, description = "Not Found", body = ()),
        (status = 409, description = "Conflict", body = ()),
    ),
    extensions(("x-o2-ratelimit" = json!({"module": "Datasets", "operation": "update"}))),
)]
pub async fn push_annotation_queue_item_to_dataset(
    Path((org_id, queue_id, queue_item_id)): Path<(String, String, String)>,
    Headers(user): Headers<UserEmail>,
    axum::Json(body): axum::Json<PushAnnotationQueueItemToDatasetRequestBody>,
) -> Response {
    let dataset_id = body.dataset_id.trim().to_string();
    if dataset_id.is_empty() {
        return dataset_error_response(DatasetError::MissingDatasetId);
    }
    if let Err(response) =
        ensure_annotation_queue_score_configs_visible(&org_id, &user.user_id, &queue_id).await
    {
        return response;
    }
    let permitted_datasets = match openobserve_api_common::auth::validator::list_objects_for_user(
        &org_id,
        &user.user_id,
        "PUT",
        "dataset",
    )
    .await
    {
        Ok(list) => list,
        Err(err) => return MetaHttpResponse::forbidden(err.to_string()),
    };
    if !is_ofga_object_visible(
        &org_id,
        "dataset",
        &dataset_id,
        permitted_datasets.as_deref(),
    ) {
        return MetaHttpResponse::forbidden("Unauthorized Access");
    }
    match datasets::push_queue_item(
        &org_id,
        &queue_id,
        &queue_item_id,
        &user.user_id,
        body.into(),
    )
    .await
    {
        Ok(result) => MetaHttpResponse::json(PushDatasetItemResponseBody::from(result)),
        Err(err) => dataset_error_response(err),
    }
}

struct ParsedDatasetImport {
    items: Vec<ImportDatasetItem>,
    skipped_count: u64,
}

fn parse_dataset_import_csv(bytes: &[u8]) -> Result<ParsedDatasetImport, String> {
    let mut reader = csv::ReaderBuilder::new()
        .has_headers(true)
        .flexible(true)
        .from_reader(bytes);
    let headers = reader
        .headers()
        .map_err(|error| format!("Failed to parse CSV: {error}"))?
        .clone();
    if headers.is_empty() {
        return Err("CSV file is empty".to_string());
    }
    let input_index = header_index(&headers, "input")
        .ok_or_else(|| "CSV header must contain an 'input' column".to_string())?;
    let expected_index = header_index(&headers, "expected_output")
        .ok_or_else(|| "CSV header must contain an 'expected_output' column".to_string())?;
    let tags_index = header_index(&headers, "tags");

    let mut items = Vec::new();
    let mut skipped_count = 0_u64;
    for record in reader.records() {
        let record = record.map_err(|error| format!("Failed to parse CSV: {error}"))?;
        let input = record.get(input_index).unwrap_or("").trim();
        let expected_output = record.get(expected_index).unwrap_or("").trim();
        if input.is_empty() || expected_output.is_empty() {
            skipped_count += 1;
            continue;
        }
        let input = parse_json_or_string(input);
        let expected_output = parse_json_or_string(expected_output);
        if !non_empty_import_value(&input) || !non_empty_import_value(&expected_output) {
            skipped_count += 1;
            continue;
        }
        let tags = tags_index
            .and_then(|index| record.get(index))
            .map(parse_import_tags)
            .unwrap_or_default();
        items.push(ImportDatasetItem {
            input,
            expected_output,
            tags,
        });
    }

    Ok(ParsedDatasetImport {
        items,
        skipped_count,
    })
}

fn header_index(headers: &csv::StringRecord, expected: &str) -> Option<usize> {
    headers.iter().position(|header| {
        header
            .trim_start_matches('\u{feff}')
            .trim()
            .eq_ignore_ascii_case(expected)
    })
}

fn parse_json_or_string(value: &str) -> serde_json::Value {
    serde_json::from_str(value).unwrap_or_else(|_| serde_json::Value::String(value.to_string()))
}

fn non_empty_import_value(value: &serde_json::Value) -> bool {
    match value {
        serde_json::Value::Null => false,
        serde_json::Value::String(value) => !value.trim().is_empty(),
        serde_json::Value::Array(value) => !value.is_empty(),
        serde_json::Value::Object(value) => !value.is_empty(),
        serde_json::Value::Bool(_) | serde_json::Value::Number(_) => true,
    }
}

fn parse_import_tags(value: &str) -> Vec<String> {
    let value = value.trim();
    if value.is_empty() {
        return Vec::new();
    }
    let tags = serde_json::from_str::<Vec<String>>(value)
        .unwrap_or_else(|_| value.split('|').map(str::to_string).collect());
    let mut seen = std::collections::HashSet::new();
    tags.into_iter()
        .map(|tag| tag.trim().to_string())
        .filter(|tag| !tag.is_empty() && seen.insert(tag.clone()))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_client_and_conflict_errors() {
        assert_eq!(
            dataset_error_response(DatasetError::MissingName)
                .status()
                .as_u16(),
            400
        );
        assert_eq!(
            dataset_error_response(DatasetError::NotEmpty)
                .status()
                .as_u16(),
            409
        );
        assert_eq!(
            dataset_error_response(DatasetError::InvalidPageSize)
                .status()
                .as_u16(),
            400
        );
        assert_eq!(
            dataset_error_response(DatasetError::ItemNotFound)
                .status()
                .as_u16(),
            404
        );
    }

    #[test]
    fn csv_import_accepts_quoted_json_and_skips_missing_goldens() {
        let parsed = parse_dataset_import_csv(
            br#"input,expected_output,tags
"{""question"":""refund?""}","{""answer"":""30 days""}","[""policy"",""reviewed""]"
missing,,bad
"plain, question",plain answer,manual|seed
"#,
        )
        .unwrap();

        assert_eq!(parsed.items.len(), 2);
        assert_eq!(parsed.skipped_count, 1);
        assert_eq!(
            parsed.items[0].input,
            serde_json::json!({"question": "refund?"})
        );
        assert_eq!(parsed.items[0].tags, ["policy", "reviewed"]);
        assert_eq!(parsed.items[1].input, "plain, question");
        assert_eq!(parsed.items[1].tags, ["manual", "seed"]);
    }

    #[test]
    fn csv_import_requires_both_headers_and_valid_utf8() {
        assert!(parse_dataset_import_csv(b"input\nquestion\n").is_err());
        assert!(parse_dataset_import_csv(&[b'i', b'n', b'p', b'u', b't', b',', 0xff]).is_err());
    }

    #[test]
    fn csv_import_supports_newlines_and_escaped_quotes_in_fields() {
        let parsed = parse_dataset_import_csv(
            b"input,expected_output\n\"line 1\nline 2\",\"say \"\"hi\"\"\"\n",
        )
        .unwrap();

        assert_eq!(parsed.items.len(), 1);
        assert_eq!(parsed.items[0].input, "line 1\nline 2");
        assert_eq!(parsed.items[0].expected_output, "say \"hi\"");
    }
}
