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
use db::authz::set_ownership;
use openobserve_api_common::extractors::Headers;
use openobserve_core::{
    auth::{UserEmail, is_ofga_object_visible},
    llm_evaluations::experiments::{self, ExperimentError},
};

use crate::{
    common::meta::{authz::Authz, http::HttpResponse as MetaHttpResponse},
    models::experiments::{
        CreateExperimentRequestBody, CreateExperimentResponseBody, ExperimentDetailResponseBody,
        ExperimentPreviewQuery, ExperimentPreviewResponseBody, ExperimentResponseBody,
        ExperimentResultsResponseBody, ListExperimentsResponseBody,
    },
};

fn experiment_error_response(error: ExperimentError) -> Response {
    match error {
        ExperimentError::Database(error) => {
            log::error!("[Experiment] database error: {error}");
            MetaHttpResponse::internal_error("Internal server error")
        }
        ExperimentError::Infra(error) => {
            log::error!("[Experiment] infrastructure error: {error}");
            MetaHttpResponse::internal_error("Internal server error")
        }
        ExperimentError::MalformedStoredDefinition(error) => {
            log::error!("[Experiment] malformed stored definition: {error}");
            MetaHttpResponse::internal_error("Internal server error")
        }
        ExperimentError::NotFound => MetaHttpResponse::not_found("Experiment not found"),
        ExperimentError::Dataset(
            openobserve_core::llm_evaluations::datasets::DatasetError::NotFound,
        ) => MetaHttpResponse::not_found("Dataset not found"),
        ExperimentError::IdempotencyConflict => MetaHttpResponse::conflict(error),
        error => MetaHttpResponse::bad_request(error.to_string()),
    }
}

#[utoipa::path(
    post,
    path = "/{org_id}/experiments/preview",
    context_path = "/api",
    tag = "Experiments",
    operation_id = "PreviewExperiment",
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ExperimentPreviewQuery,
    ),
    request_body(content = inline(CreateExperimentRequestBody)),
    responses(
        (status = 200, body = inline(ExperimentPreviewResponseBody)),
        (status = 400, description = "Invalid Experiment definition", body = ()),
        (status = 404, description = "Dataset or scorer not found", body = ()),
    ),
)]
pub async fn preview_experiment(
    Path(org_id): Path<String>,
    Query(query): Query<ExperimentPreviewQuery>,
    axum::Json(body): axum::Json<CreateExperimentRequestBody>,
) -> Response {
    match experiments::preview(&org_id, body.into(), query.sample_size).await {
        Ok(preview) => MetaHttpResponse::json(ExperimentPreviewResponseBody::from(preview)),
        Err(error) => experiment_error_response(error),
    }
}

#[utoipa::path(
    post,
    path = "/{org_id}/experiments",
    context_path = "/api",
    tag = "Experiments",
    operation_id = "CreateExperiment",
    params(("org_id" = String, Path, description = "Organization name")),
    request_body(content = inline(CreateExperimentRequestBody)),
    responses(
        (status = 200, body = inline(CreateExperimentResponseBody)),
        (status = 400, description = "Invalid Experiment definition", body = ()),
        (status = 409, description = "Idempotency conflict", body = ()),
    ),
)]
pub async fn create_experiment(
    Path(org_id): Path<String>,
    Headers(user): Headers<UserEmail>,
    axum::Json(body): axum::Json<CreateExperimentRequestBody>,
) -> Response {
    match experiments::create(&org_id, &user.user_id, body.into()).await {
        Ok(result) => {
            set_ownership(&org_id, "experiments", Authz::new(&result.experiment.id)).await;
            MetaHttpResponse::json(CreateExperimentResponseBody::from(result))
        }
        Err(error) => experiment_error_response(error),
    }
}

#[utoipa::path(
    get,
    path = "/{org_id}/experiments",
    context_path = "/api",
    tag = "Experiments",
    operation_id = "ListExperiments",
    params(("org_id" = String, Path, description = "Organization name")),
    responses((status = 200, body = inline(ListExperimentsResponseBody))),
)]
pub async fn list_experiments(
    Path(org_id): Path<String>,
    Headers(user): Headers<UserEmail>,
) -> Response {
    let permitted_objects = match openobserve_api_common::auth::validator::list_objects_for_user(
        &org_id,
        &user.user_id,
        "GET",
        "experiment",
    )
    .await
    {
        Ok(list) => list,
        Err(error) => return MetaHttpResponse::forbidden(error.to_string()),
    };
    match experiments::list(&org_id).await {
        Ok(experiments) => MetaHttpResponse::json(ListExperimentsResponseBody {
            list: experiments
                .into_iter()
                .filter(|experiment| {
                    is_ofga_object_visible(
                        &org_id,
                        "experiment",
                        &experiment.id,
                        permitted_objects.as_deref(),
                    )
                })
                .map(ExperimentResponseBody::from)
                .collect(),
        }),
        Err(error) => experiment_error_response(error),
    }
}

#[utoipa::path(
    get,
    path = "/{org_id}/experiments/{experiment_id}",
    context_path = "/api",
    tag = "Experiments",
    operation_id = "GetExperiment",
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("experiment_id" = String, Path, description = "Experiment ID"),
        ExperimentPreviewQuery,
    ),
    responses(
        (status = 200, body = inline(ExperimentDetailResponseBody)),
        (status = 404, description = "Experiment not found", body = ()),
    ),
)]
pub async fn get_experiment(
    Path((org_id, experiment_id)): Path<(String, String)>,
    Query(query): Query<ExperimentPreviewQuery>,
) -> Response {
    let experiment = match experiments::get(&org_id, &experiment_id).await {
        Ok(experiment) => experiment,
        Err(error) => return experiment_error_response(error),
    };
    let preview = match experiments::preview_existing(&org_id, &experiment, query.sample_size).await
    {
        Ok(preview) => preview,
        Err(error) => return experiment_error_response(error),
    };
    if let Err(error) =
        openobserve_core::self_reporting::llm_scores_schema::ensure_llm_scores_stream_initialized(
            &org_id,
        )
        .await
    {
        log::error!("[Experiment] failed to initialize score stream for {experiment_id}: {error}");
        return MetaHttpResponse::internal_error("Failed to load Experiment results");
    }
    let results =
        match openobserve_core::llm_evaluations::experiment_runner::results(&experiment).await {
            Ok(results) => ExperimentResultsResponseBody {
                executions: results
                    .executions
                    .into_iter()
                    .filter_map(|record| serde_json::to_value(record).ok())
                    .collect(),
                scores: results.scores,
            },
            Err(error) => {
                log::error!("[Experiment] failed to load results for {experiment_id}: {error}");
                return MetaHttpResponse::internal_error("Failed to load Experiment results");
            }
        };
    MetaHttpResponse::json(ExperimentDetailResponseBody {
        experiment: experiment.into(),
        preview: preview.into(),
        results,
    })
}
