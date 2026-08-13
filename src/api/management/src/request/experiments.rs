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
        CloneExperimentRequestBody, CreateExperimentRequestBody, CreateExperimentResponseBody,
        ExperimentDetailQuery, ExperimentDetailResponseBody, ExperimentPreviewQuery,
        ExperimentPreviewResponseBody, ExperimentResponseBody, ExperimentResultPaginationBody,
        ExperimentResultsResponseBody, ExperimentRowDetailResponseBody,
        ExperimentRowNavigationBody, ExperimentRowSnapshotBody, ListExperimentsResponseBody,
        PinnedExperimentScorerBody, experiment_aggregate_summary, experiment_result_slots,
        experiment_result_summary, experiment_row_result_summary,
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
        ExperimentError::IdempotencyConflict
        | ExperimentError::InvalidLifecycleTransition { .. }
        | ExperimentError::ConcurrentLifecycleUpdate => MetaHttpResponse::conflict(error),
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
        ExperimentDetailQuery,
    ),
    responses(
        (status = 200, body = inline(ExperimentDetailResponseBody)),
        (status = 404, description = "Experiment not found", body = ()),
    ),
)]
pub async fn get_experiment(
    Path((org_id, experiment_id)): Path<(String, String)>,
    Query(query): Query<ExperimentDetailQuery>,
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
    let result_page = query.result_page.unwrap_or(1);
    let result_page_size = query
        .result_page_size
        .unwrap_or(openobserve_core::llm_evaluations::experiment_runner::DEFAULT_RESULT_PAGE_SIZE);
    if result_page == 0
        || result_page_size == 0
        || result_page_size
            > openobserve_core::llm_evaluations::experiment_runner::MAX_RESULT_PAGE_SIZE
    {
        return MetaHttpResponse::bad_request("Invalid Experiment result pagination");
    }
    let results = match openobserve_core::llm_evaluations::experiment_runner::results_page(
        &experiment,
        result_page,
        result_page_size,
    )
    .await
    {
        Ok(results) => {
            let executions = results
                .executions
                .into_iter()
                .filter_map(|record| serde_json::to_value(record).ok())
                .collect::<Vec<_>>();
            let scores = results.scores;
            let summary_executions = results
                .summary_executions
                .into_iter()
                .filter_map(|record| serde_json::to_value(record).ok())
                .collect::<Vec<_>>();
            let summary_scores = results.summary_scores;
            let scorers = experiment
                .scorers
                .iter()
                .cloned()
                .map(PinnedExperimentScorerBody::from)
                .collect::<Vec<_>>();
            let (task_progress, scoring_progress, skip_summary, score_summaries) =
                experiment_result_summary(
                    &preview.applicability.clone().into(),
                    &scorers,
                    &summary_executions,
                    &summary_scores,
                );
            let aggregate_summary = experiment_aggregate_summary(
                &summary_executions,
                &task_progress,
                &scoring_progress,
            );
            let slots = experiment_result_slots(results.slots, &executions, &scores, &scorers);
            ExperimentResultsResponseBody {
                executions,
                scores,
                slots,
                pagination: ExperimentResultPaginationBody {
                    page: results.page,
                    page_size: results.page_size,
                    total_slots: results.total_slots,
                    has_more: results.has_more,
                },
                task_progress,
                scoring_progress,
                skip_summary,
                score_summaries,
                aggregate_summary,
            }
        }
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

/// Load one pinned dataset row and every trial's current execution and score evidence.
#[utoipa::path(
    get,
    path = "/{org_id}/experiments/{experiment_id}/rows/{row_id}",
    context_path = "/api",
    tag = "Experiments",
    operation_id = "GetExperimentRowDetail",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("experiment_id" = String, Path, description = "Experiment ID"),
        ("row_id" = String, Path, description = "Pinned dataset row ID"),
    ),
    responses(
        (status = 200, description = "Pinned row detail", body = ExperimentRowDetailResponseBody),
        (status = 404, description = "Experiment or pinned row not found"),
    )
)]
pub async fn get_experiment_row(
    Path((org_id, experiment_id, row_id)): Path<(String, String, String)>,
) -> Response {
    let experiment = match experiments::get(&org_id, &experiment_id).await {
        Ok(experiment) => experiment,
        Err(error) => return experiment_error_response(error),
    };
    if let Err(error) =
        openobserve_core::self_reporting::llm_scores_schema::ensure_llm_scores_stream_initialized(
            &org_id,
        )
        .await
    {
        log::error!(
            "[Experiment] failed to initialize score stream for row {row_id} in {experiment_id}: {error}"
        );
        return MetaHttpResponse::internal_error("Failed to load Experiment row");
    }
    let row = match openobserve_core::llm_evaluations::experiment_runner::row_result(
        &experiment,
        &row_id,
    )
    .await
    {
        Ok(Some(row)) => row,
        Ok(None) => return MetaHttpResponse::not_found("Experiment row not found"),
        Err(error) => {
            log::error!("[Experiment] failed to load row {row_id} for {experiment_id}: {error}");
            return MetaHttpResponse::internal_error("Failed to load Experiment row");
        }
    };
    let executions = row
        .executions
        .into_iter()
        .filter_map(|record| serde_json::to_value(record).ok())
        .collect::<Vec<_>>();
    let scorers = experiment
        .scorers
        .iter()
        .cloned()
        .map(PinnedExperimentScorerBody::from)
        .collect::<Vec<_>>();
    let (_, _, _, score_summaries) =
        experiment_row_result_summary(row.slots.len(), &scorers, &executions, &row.scores);
    let first_slot = row
        .slots
        .first()
        .expect("a resolved Experiment row always contains at least one trial");
    let response = ExperimentRowDetailResponseBody {
        experiment_id: experiment.id,
        snapshot: ExperimentRowSnapshotBody {
            dataset_id: experiment.dataset_id,
            dataset_version: experiment.dataset_version,
        },
        navigation: ExperimentRowNavigationBody {
            row_index: row.row_index,
            total_rows: row.total_rows,
            previous_row_id: row.previous_row_id,
            next_row_id: row.next_row_id,
        },
        row_id: first_slot.row_id.clone(),
        logical_id: first_slot.logical_id.clone(),
        input: first_slot.input.clone(),
        expected_output: first_slot.expected_output.clone(),
        trials: experiment_result_slots(row.slots, &executions, &row.scores, &scorers),
        score_summaries,
    };
    MetaHttpResponse::json(response)
}

/// Cancel a running Experiment. Repeating the request after cancellation is a no-op.
#[utoipa::path(
    post,
    path = "/{org_id}/experiments/{experiment_id}/cancel",
    context_path = "/api",
    tag = "Experiments",
    operation_id = "CancelExperiment",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("experiment_id" = String, Path, description = "Experiment ID"),
    ),
    responses(
        (status = 200, description = "Experiment cancelled", body = ExperimentResponseBody),
        (status = 404, description = "Experiment not found"),
        (status = 409, description = "Invalid or concurrent lifecycle transition"),
    )
)]
pub async fn cancel_experiment(Path((org_id, experiment_id)): Path<(String, String)>) -> Response {
    match experiments::cancel(&org_id, &experiment_id).await {
        Ok(experiment) => MetaHttpResponse::json(ExperimentResponseBody::from(experiment)),
        Err(error) => experiment_error_response(error),
    }
}

/// Retry an Experiment that failed. Repeating a successful retry request is a no-op.
#[utoipa::path(
    post,
    path = "/{org_id}/experiments/{experiment_id}/retry",
    context_path = "/api",
    tag = "Experiments",
    operation_id = "RetryExperiment",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("experiment_id" = String, Path, description = "Experiment ID"),
    ),
    responses(
        (status = 200, description = "Failed Experiment returned to running", body = ExperimentResponseBody),
        (status = 404, description = "Experiment not found"),
        (status = 409, description = "Invalid or concurrent lifecycle transition"),
    )
)]
pub async fn retry_experiment(Path((org_id, experiment_id)): Path<(String, String)>) -> Response {
    match experiments::retry_failed(&org_id, &experiment_id).await {
        Ok(experiment) => MetaHttpResponse::json(ExperimentResponseBody::from(experiment)),
        Err(error) => experiment_error_response(error),
    }
}

/// Clone a cancelled Experiment into a new pending definition with isolated evidence.
#[utoipa::path(
    post,
    path = "/{org_id}/experiments/{experiment_id}/clone",
    context_path = "/api",
    tag = "Experiments",
    operation_id = "CloneExperiment",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("experiment_id" = String, Path, description = "Cancelled source Experiment ID"),
    ),
    request_body(content = CloneExperimentRequestBody, content_type = "application/json"),
    responses(
        (status = 200, description = "Pending clone created", body = ExperimentResponseBody),
        (status = 404, description = "Experiment not found"),
        (status = 409, description = "Only cancelled Experiments can be cloned"),
    )
)]
pub async fn clone_experiment(
    Path((org_id, experiment_id)): Path<(String, String)>,
    Headers(user): Headers<UserEmail>,
    axum::Json(body): axum::Json<CloneExperimentRequestBody>,
) -> Response {
    match experiments::clone_cancelled(&org_id, &experiment_id, &user.user_id, body.name).await {
        Ok(experiment) => {
            set_ownership(&org_id, "experiments", Authz::new(&experiment.id)).await;
            MetaHttpResponse::json(ExperimentResponseBody::from(experiment))
        }
        Err(error) => experiment_error_response(error),
    }
}
