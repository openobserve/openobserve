// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

use axum::{extract::Path, response::Response};
use db::authz::{remove_ownership, set_ownership};
use openobserve_api_common::extractors::Headers;
use openobserve_core::{
    auth::{UserEmail, is_ofga_object_visible},
    llm_evaluations::datasets::{self, DatasetError},
};

use crate::{
    common::meta::{authz::Authz, http::HttpResponse as MetaHttpResponse},
    models::datasets::{
        CreateDatasetRequestBody, DatasetResponseBody, ListDatasetsResponseBody,
        UpdateDatasetRequestBody,
    },
};

fn dataset_error_response(value: DatasetError) -> Response {
    match value {
        DatasetError::Database(err) => {
            log::error!("[Dataset] internal error: {err}");
            MetaHttpResponse::internal_error("Internal server error")
        }
        DatasetError::MissingName => MetaHttpResponse::bad_request("Dataset name cannot be empty"),
        DatasetError::NotFound => MetaHttpResponse::not_found("Dataset not found"),
        error @ (DatasetError::DuplicateName | DatasetError::InUse | DatasetError::NotEmpty) => {
            MetaHttpResponse::conflict(error)
        }
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
    }
}
