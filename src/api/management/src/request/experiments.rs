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
    models::{
        experiment_comparison::{
            DEFAULT_COMPARISON_THRESHOLD, ExperimentComparisonQuery,
            ExperimentComparisonResponseBody,
        },
        experiments::{
            CloneExperimentRequestBody, CreateExperimentRequestBody, CreateExperimentResponseBody,
            ExperimentDetailQuery, ExperimentDetailResponseBody, ExperimentPreviewQuery,
            ExperimentPreviewResponseBody, ExperimentResponseBody, ExperimentResultPaginationBody,
            ExperimentResultsResponseBody, ExperimentRowDetailResponseBody,
            ExperimentRowNavigationBody, ExperimentRowSnapshotBody, ListExperimentsResponseBody,
            PinnedExperimentScorerBody, RetryExperimentSlotRequestBody,
            experiment_aggregate_summary, experiment_result_slots, experiment_result_summary,
            experiment_row_result_summary,
        },
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

fn experiment_is_visible(
    org_id: &str,
    experiment_id: &str,
    permitted_objects: Option<&[String]>,
) -> bool {
    is_ofga_object_visible(org_id, "experiment", experiment_id, permitted_objects)
}

fn validate_comparison_selection(
    baseline_id: &str,
    candidate_id: &str,
    threshold: f64,
) -> Result<(), &'static str> {
    if baseline_id == candidate_id {
        return Err("Select two different Experiments");
    }
    if !threshold.is_finite() || threshold < 0.0 {
        return Err("Comparison threshold must be a finite non-negative number");
    }
    Ok(())
}

fn validate_comparison_dataset(
    baseline_dataset_id: &str,
    candidate_dataset_id: &str,
) -> Result<(), &'static str> {
    if baseline_dataset_id != candidate_dataset_id {
        return Err("Experiments must use the same Dataset");
    }
    Ok(())
}

async fn require_experiment_visibility(
    org_id: &str,
    experiment_id: &str,
    user_id: &str,
    method: &str,
) -> Result<(), Response> {
    let permitted_objects = openobserve_api_common::auth::validator::list_objects_for_user(
        org_id,
        user_id,
        method,
        "experiment",
    )
    .await
    .map_err(|error| MetaHttpResponse::forbidden(error.to_string()))?;
    if !experiment_is_visible(org_id, experiment_id, permitted_objects.as_deref()) {
        return Err(MetaHttpResponse::forbidden("Unauthorized Access"));
    }
    Ok(())
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
            let executions = results.executions;
            let scores = results.scores;
            let summary_executions = results.summary_executions;
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
                executions: executions
                    .into_iter()
                    .filter_map(|record| serde_json::to_value(record).ok())
                    .collect(),
                scores: scores
                    .into_iter()
                    .filter_map(|record| serde_json::to_value(record).ok())
                    .collect(),
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

/// Compare two Experiments over the honest intersection of their pinned rows.
#[utoipa::path(
    get,
    path = "/{org_id}/experiments/compare",
    context_path = "/api",
    tag = "Experiments",
    operation_id = "CompareExperiments",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ExperimentComparisonQuery,
    ),
    responses(
        (status = 200, description = "Baseline/candidate comparison", body = ExperimentComparisonResponseBody),
        (status = 400, description = "Invalid threshold or cross-dataset comparison"),
        (status = 403, description = "One or both Experiments are not accessible"),
        (status = 404, description = "One or both Experiments were not found"),
    )
)]
pub async fn compare_experiments(
    Path(org_id): Path<String>,
    Query(query): Query<ExperimentComparisonQuery>,
    Headers(user): Headers<UserEmail>,
) -> Response {
    let threshold = query.threshold.unwrap_or(DEFAULT_COMPARISON_THRESHOLD);
    if let Err(message) =
        validate_comparison_selection(&query.baseline_id, &query.candidate_id, threshold)
    {
        return MetaHttpResponse::bad_request(message);
    }
    for experiment_id in [&query.baseline_id, &query.candidate_id] {
        if let Err(response) =
            require_experiment_visibility(&org_id, experiment_id, &user.user_id, "GET").await
        {
            return response;
        }
    }
    let baseline = match experiments::get(&org_id, &query.baseline_id).await {
        Ok(experiment) => experiment,
        Err(error) => return experiment_error_response(error),
    };
    let candidate = match experiments::get(&org_id, &query.candidate_id).await {
        Ok(experiment) => experiment,
        Err(error) => return experiment_error_response(error),
    };
    if let Err(message) = validate_comparison_dataset(&baseline.dataset_id, &candidate.dataset_id) {
        return MetaHttpResponse::bad_request(message);
    }
    if let Err(error) =
        openobserve_core::self_reporting::llm_scores_schema::ensure_llm_scores_stream_initialized(
            &org_id,
        )
        .await
    {
        log::error!("[Experiment] failed to initialize score stream for comparison: {error}");
        return MetaHttpResponse::internal_error("Failed to compare Experiments");
    }
    let baseline_slots = match experiments::slot_set_existing(&org_id, &baseline).await {
        Ok(slots) => slots,
        Err(error) => return experiment_error_response(error),
    };
    let candidate_slots = match experiments::slot_set_existing(&org_id, &candidate).await {
        Ok(slots) => slots,
        Err(error) => return experiment_error_response(error),
    };
    let baseline_results =
        match openobserve_core::llm_evaluations::experiment_runner::results(&baseline).await {
            Ok(results) => results,
            Err(error) => {
                log::error!("[Experiment] failed to load baseline comparison evidence: {error}");
                return MetaHttpResponse::internal_error("Failed to compare Experiments");
            }
        };
    let candidate_results =
        match openobserve_core::llm_evaluations::experiment_runner::results(&candidate).await {
            Ok(results) => results,
            Err(error) => {
                log::error!("[Experiment] failed to load candidate comparison evidence: {error}");
                return MetaHttpResponse::internal_error("Failed to compare Experiments");
            }
        };
    use openobserve_core::llm_evaluations::experiment_comparison::{
        CompareExperimentsInput, ComparisonEvidence, compare_experiments,
    };
    MetaHttpResponse::json(ExperimentComparisonResponseBody::from(compare_experiments(
        CompareExperimentsInput {
            baseline_id: baseline.id,
            candidate_id: candidate.id,
            dataset_id: baseline.dataset_id,
            threshold,
            baseline: ComparisonEvidence {
                slots: &baseline_slots,
                executions: &baseline_results.executions,
                scores: &baseline_results.scores,
            },
            candidate: ComparisonEvidence {
                slots: &candidate_slots,
                executions: &candidate_results.executions,
                scores: &candidate_results.scores,
            },
        },
    )))
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
        (status = 403, description = "Experiment is not accessible"),
        (status = 404, description = "Experiment or pinned row not found"),
    )
)]
pub async fn get_experiment_row(
    Path((org_id, experiment_id, row_id)): Path<(String, String, String)>,
    Headers(user): Headers<UserEmail>,
) -> Response {
    if let Err(response) =
        require_experiment_visibility(&org_id, &experiment_id, &user.user_id, "GET").await
    {
        return response;
    }
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
    let executions = row.executions;
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

/// Retry one selected slot whose latest durable execution is an error.
#[utoipa::path(
    post,
    path = "/{org_id}/experiments/{experiment_id}/rows/{row_id}/trials/{trial_index}/retry",
    context_path = "/api",
    tag = "Experiments",
    operation_id = "RetryExperimentSlot",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("experiment_id" = String, Path, description = "Experiment ID"),
        ("row_id" = String, Path, description = "Pinned dataset row ID"),
        ("trial_index" = u32, Path, description = "Zero-based trial index"),
    ),
    request_body(content = RetryExperimentSlotRequestBody, content_type = "application/json"),
    responses(
        (status = 200, description = "Selected slot retry result"),
        (status = 400, description = "Invalid idempotency key"),
        (status = 403, description = "Experiment is not accessible"),
        (status = 404, description = "Experiment, row, or trial not found"),
        (status = 409, description = "Experiment lifecycle or latest slot state disallows retry"),
    )
)]
pub async fn retry_experiment_slot(
    Path((org_id, experiment_id, row_id, trial_index)): Path<(String, String, String, u32)>,
    Headers(user): Headers<UserEmail>,
    axum::Json(body): axum::Json<RetryExperimentSlotRequestBody>,
) -> Response {
    use openobserve_core::llm_evaluations::experiment_runner::ExperimentSlotRetryError;

    if let Err(response) =
        require_experiment_visibility(&org_id, &experiment_id, &user.user_id, "POST").await
    {
        return response;
    }

    match openobserve_core::llm_evaluations::experiment_runner::retry_error_slot(
        &org_id,
        &experiment_id,
        &row_id,
        trial_index,
        &body.idempotency_key,
    )
    .await
    {
        Ok(record) => MetaHttpResponse::json(record),
        Err(ExperimentSlotRetryError::Experiment(error)) => experiment_error_response(error),
        Err(ExperimentSlotRetryError::InvalidIdempotencyKey) => {
            MetaHttpResponse::bad_request("Invalid slot retry idempotency key")
        }
        Err(ExperimentSlotRetryError::RowNotFound | ExperimentSlotRetryError::TrialNotFound) => {
            MetaHttpResponse::not_found("Experiment slot not found")
        }
        Err(
            error @ (ExperimentSlotRetryError::InvalidLifecycle(_)
            | ExperimentSlotRetryError::LatestExecutionNotError),
        ) => MetaHttpResponse::conflict(error),
        Err(ExperimentSlotRetryError::Runtime(error)) => {
            log::error!("[Experiment] failed to retry selected slot: {error}");
            MetaHttpResponse::internal_error("Failed to retry Experiment slot")
        }
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn row_and_retry_visibility_accept_exact_or_org_wildcard_and_reject_other_objects() {
        let exact = vec!["experiment:experiment-1".to_string()];
        let wildcard = vec!["experiment:_all_acme".to_string()];
        let forbidden = vec!["experiment:experiment-2".to_string()];

        assert!(experiment_is_visible("acme", "experiment-1", Some(&exact)));
        assert!(experiment_is_visible(
            "acme",
            "experiment-1",
            Some(&wildcard)
        ));
        assert!(!experiment_is_visible(
            "acme",
            "experiment-1",
            Some(&forbidden)
        ));
    }

    #[test]
    fn comparison_selection_rejects_same_experiment_and_invalid_thresholds() {
        assert_eq!(
            validate_comparison_selection("same", "same", 0.0),
            Err("Select two different Experiments")
        );
        assert!(validate_comparison_selection("baseline", "candidate", 0.25).is_ok());
        assert!(validate_comparison_selection("baseline", "candidate", -0.01).is_err());
        assert!(validate_comparison_selection("baseline", "candidate", f64::NAN).is_err());
    }

    #[test]
    fn comparison_rejects_cross_dataset_pairs() {
        assert!(validate_comparison_dataset("dataset", "dataset").is_ok());
        assert_eq!(
            validate_comparison_dataset("dataset-a", "dataset-b"),
            Err("Experiments must use the same Dataset")
        );
    }
}
