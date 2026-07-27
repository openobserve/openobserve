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

use axum::{
    extract::{Path, Query},
    response::Response,
};
use db::authz::{remove_ownership, set_ownership};
#[cfg(feature = "enterprise")]
use openobserve_core::auth::{UserEmail, is_ofga_object_visible};

#[cfg(feature = "enterprise")]
use crate::handler::http::extractors::Headers;
use crate::{
    common::meta::{authz::Authz, http::HttpResponse as MetaHttpResponse},
    handler::http::models::scorers::{
        ListScorerVersionsResponseBody, ListScorersQuery, ListScorersResponseBody,
        LlmJudgeOutputSchemaRequestBody, LlmJudgeOutputSchemaResponseBody, ScorerRequestBody,
        ScorerResponseBody, ScorerTestRequestBody, ScorerTestResponseBody, ScorerUpdateRequestBody,
    },
    service::llm_evaluations::scorers::{
        llm_judge::ScoreConfigInfo,
        registry::{self as scorers, ScorerError},
        schema_derivation::derive_output_schema,
    },
};

fn scorer_error_response(value: ScorerError) -> Response {
    match value {
        ScorerError::InfraError(err) => {
            log::error!("[Scorer] internal error: {err}");
            MetaHttpResponse::internal_error("Internal server error")
        }
        ScorerError::MissingName => MetaHttpResponse::bad_request("Scorer name cannot be empty"),
        ScorerError::NotFound => MetaHttpResponse::not_found("Scorer not found"),
        ScorerError::InvalidScorerType(_)
        | ScorerError::ScorerTypeImmutable
        | ScorerError::ProducesScoreConfigIdImmutable
        | ScorerError::ScoreConfigVersionNotFound
        | ScorerError::InvalidOutputSchema(_)
        | ScorerError::InvalidProviderConfig(_) => MetaHttpResponse::bad_request(value),
        ScorerError::DuplicateName => MetaHttpResponse::conflict(value),
        ScorerError::InUseByEvalJob => MetaHttpResponse::conflict(value),
    }
}

/// ListScorers
#[utoipa::path(
    get,
    path = "/{org_id}/scorers",
    context_path = "/api",
    tag = "Scorers",
    operation_id = "ListScorers",
    summary = "List scorers",
    description = "Lists scorers in the organization. Filterable by scorer_type query parameter.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("scorerType" = Option<String>, Query, description = "Filter by scorer_type (llm_judge or remote)"),
    ),
    responses(
        (status = 200, body = inline(ListScorersResponseBody)),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Scorers", "operation": "list"})),
    ),
)]
pub async fn list_scorers(
    Path(org_id): Path<String>,
    Query(query): Query<ListScorersQuery>,
    #[cfg(feature = "enterprise")] Headers(user_email): Headers<UserEmail>,
) -> Response {
    #[cfg(feature = "enterprise")]
    let permitted_objects = {
        match crate::handler::http::auth::validator::list_objects_for_user(
            &org_id,
            &user_email.user_id,
            "GET",
            "scorer",
        )
        .await
        {
            Ok(list) => list,
            Err(e) => return MetaHttpResponse::forbidden(e.to_string()),
        }
    };
    match scorers::list_scorers(&org_id, query.scorer_type.as_ref()).await {
        Ok(list) => {
            let list: Vec<infra::table::scorers::Scorer> = list
                .into_iter()
                .filter(|scorer| {
                    is_ofga_object_visible(
                        &org_id,
                        "scorer",
                        &scorer.entity_id,
                        permitted_objects.as_deref(),
                    )
                })
                .collect();
            let body: ListScorersResponseBody = list.into();
            MetaHttpResponse::json(body)
        }
        Err(err) => scorer_error_response(err),
    }
}

/// CreateScorer
#[utoipa::path(
    post,
    path = "/{org_id}/scorers",
    context_path = "/api",
    tag = "Scorers",
    operation_id = "CreateScorer",
    summary = "Create scorer (v1)",
    description = "Creates a new scorer at version 1.",
    security(("Authorization" = [])),
    params(("org_id" = String, Path, description = "Organization name")),
    request_body(content = inline(ScorerRequestBody), description = "Scorer payload"),
    responses(
        (status = 200, body = inline(ScorerResponseBody)),
        (status = 400, description = "Bad Request", body = ()),
        (status = 409, description = "Conflict", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Scorers", "operation": "create"})),
    ),
)]
pub async fn create_scorer(
    Path(org_id): Path<String>,
    axum::Json(body): axum::Json<ScorerRequestBody>,
) -> Response {
    let scorer: infra::table::scorers::Scorer = body.into();
    match scorers::save_scorer(&org_id, scorer).await {
        Ok(s) => {
            set_ownership(&org_id, "scorers", Authz::new(&s.entity_id)).await;
            let resp: ScorerResponseBody = s.into();
            MetaHttpResponse::json(resp)
        }
        Err(err) => scorer_error_response(err),
    }
}

/// GetScorer
#[utoipa::path(
    get,
    path = "/{org_id}/scorers/{entity_id}",
    context_path = "/api",
    tag = "Scorers",
    operation_id = "GetScorer",
    summary = "Get latest scorer by entity id",
    description = "Retrieves the latest active version of a scorer by stable entity id.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("entity_id" = String, Path, description = "Scorer stable entity id"),
    ),
    responses(
        (status = 200, body = inline(ScorerResponseBody)),
        (status = 404, description = "Not Found", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Scorers", "operation": "get"})),
    ),
)]
pub async fn get_scorer(Path((org_id, entity_id)): Path<(String, String)>) -> Response {
    match scorers::get_scorer(&org_id, &entity_id).await {
        Ok(s) => {
            let resp: ScorerResponseBody = s.into();
            MetaHttpResponse::json(resp)
        }
        Err(err) => scorer_error_response(err),
    }
}

/// ListScorerVersions
#[utoipa::path(
    get,
    path = "/{org_id}/scorers/{entity_id}/versions",
    context_path = "/api",
    tag = "Scorers",
    operation_id = "ListScorerVersions",
    summary = "List all versions of a scorer",
    description = "Lists every historical version of a scorer by stable entity id, ordered by version descending.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("entity_id" = String, Path, description = "Scorer stable entity id"),
    ),
    responses(
        (status = 200, body = inline(ListScorerVersionsResponseBody)),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Scorers", "operation": "list_versions"})),
    ),
)]
pub async fn list_scorer_versions(Path((org_id, entity_id)): Path<(String, String)>) -> Response {
    match scorers::get_scorer_versions(&org_id, &entity_id).await {
        Ok(versions) => {
            let body: ListScorerVersionsResponseBody = versions.into();
            MetaHttpResponse::json(body)
        }
        Err(err) => scorer_error_response(err),
    }
}

/// UpdateScorer
#[utoipa::path(
    put,
    path = "/{org_id}/scorers/{entity_id}",
    context_path = "/api",
    tag = "Scorers",
    operation_id = "UpdateScorer",
    summary = "Update scorer (version bump)",
    description = "Creates a new immutable version of the scorer. scorer_type and produces_score_config_id are immutable across versions.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("entity_id" = String, Path, description = "Scorer stable entity id"),
    ),
    request_body(content = inline(ScorerUpdateRequestBody), description = "Scorer payload"),
    responses(
        (status = 200, body = inline(ScorerResponseBody)),
        (status = 404, description = "Not Found", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Scorers", "operation": "update"})),
    ),
)]
pub async fn update_scorer(
    Path((org_id, entity_id)): Path<(String, String)>,
    axum::Json(body): axum::Json<ScorerUpdateRequestBody>,
) -> Response {
    let scorer: infra::table::scorers::Scorer = body.into();
    match scorers::update_scorer(&org_id, &entity_id, scorer).await {
        Ok(s) => {
            let resp: ScorerResponseBody = s.into();
            MetaHttpResponse::json(resp)
        }
        Err(err) => scorer_error_response(err),
    }
}

/// DeleteScorer
#[utoipa::path(
    delete,
    path = "/{org_id}/scorers/{entity_id}",
    context_path = "/api",
    tag = "Scorers",
    operation_id = "DeleteScorer",
    summary = "Deactivate scorer",
    description = "Soft-deletes the scorer by deactivating all its versions.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("entity_id" = String, Path, description = "Scorer stable entity id"),
    ),
    responses(
        (status = 200, description = "Deactivated", body = String),
        (status = 404, description = "Not Found", body = ()),
        (status = 409, description = "Conflict", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Scorers", "operation": "delete"})),
    ),
)]
pub async fn delete_scorer(Path((org_id, entity_id)): Path<(String, String)>) -> Response {
    match scorers::delete_scorer(&org_id, &entity_id).await {
        Ok(()) => {
            remove_ownership(&org_id, "scorers", Authz::new(&entity_id)).await;
            MetaHttpResponse::ok("Scorer deactivated")
        }
        Err(err) => scorer_error_response(err),
    }
}

/// TestScorer
#[utoipa::path(
    post,
    path = "/{org_id}/scorers/test",
    context_path = "/api",
    tag = "Scorers",
    operation_id = "TestScorer",
    summary = "Test-run a scorer",
    description = "Tests an inline scorer config with provided input variable values. Runs the scorer synchronously and returns the evaluation result.",
    security(("Authorization" = [])),
    params(("org_id" = String, Path, description = "Organization name")),
    request_body(content = inline(ScorerTestRequestBody), description = "Template and input variables to evaluate"),
    responses(
        (status = 200, body = inline(ScorerTestResponseBody)),
        (status = 400, description = "Bad Request", body = ()),
        (status = 404, description = "Not Found", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Scorers", "operation": "test"})),
    ),
)]
pub async fn test_scorer(
    Path(org_id): Path<String>,
    axum::Json(body): axum::Json<ScorerTestRequestBody>,
) -> Response {
    match run_scorer_test(&org_id, &body).await {
        Ok(resp) => MetaHttpResponse::json(resp),
        Err(err) => scorer_error_response(err),
    }
}

/// PreviewLlmJudgeOutputSchema
#[utoipa::path(
    post,
    path = "/{org_id}/scorers/llm_judge/output_schema",
    context_path = "/api",
    tag = "Scorers",
    operation_id = "PreviewLlmJudgeOutputSchema",
    summary = "Preview derived LLM Judge output schema",
    description = "Derives the LLM Judge structured output schema from the selected score config and extra metadata fields.",
    security(("Authorization" = [])),
    params(("org_id" = String, Path, description = "Organization name")),
    request_body(content = inline(LlmJudgeOutputSchemaRequestBody), description = "Schema derivation inputs"),
    responses(
        (status = 200, body = inline(LlmJudgeOutputSchemaResponseBody)),
        (status = 400, description = "Bad Request", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Scorers", "operation": "preview_llm_judge_output_schema"})),
    ),
)]
pub async fn preview_llm_judge_output_schema(
    Path(org_id): Path<String>,
    axum::Json(body): axum::Json<LlmJudgeOutputSchemaRequestBody>,
) -> Response {
    match derive_llm_judge_output_schema(&org_id, &body).await {
        Ok(output_schema) => {
            MetaHttpResponse::json(LlmJudgeOutputSchemaResponseBody { output_schema })
        }
        Err(err) => scorer_error_response(err),
    }
}

async fn derive_llm_judge_output_schema(
    org_id: &str,
    body: &LlmJudgeOutputSchemaRequestBody,
) -> Result<serde_json::Value, ScorerError> {
    let score_config = score_config_info_for_schema_request(org_id, body).await?;
    let schema = derive_output_schema(
        score_config.data_type,
        score_config.numeric_range.as_ref(),
        score_config.categories.as_ref(),
        &body.extra_metadata_fields,
        body.include_reasoning.unwrap_or(true),
    )
    .map_err(|err| ScorerError::InvalidOutputSchema(err.to_string()))?;

    Ok(schema.json_schema)
}

async fn score_config_info_for_schema_request(
    org_id: &str,
    body: &LlmJudgeOutputSchemaRequestBody,
) -> Result<ScoreConfigInfo, ScorerError> {
    let Some(entity_id) = body
        .produces_score_config_id
        .as_deref()
        .filter(|id| !id.is_empty())
    else {
        return Ok(ScoreConfigInfo::default());
    };

    let score_config = match body.produces_score_config_version {
        Some(version) => {
            infra::table::score_configs::get_by_entity_id_and_version(org_id, entity_id, version)
                .await?
        }
        None => infra::table::score_configs::get_by_entity_id(org_id, entity_id).await?,
    };

    score_config
        .as_ref()
        .map(ScoreConfigInfo::from)
        .ok_or(ScorerError::ScoreConfigVersionNotFound)
}

fn scorer_for_test(
    org_id: &str,
    body: &ScorerTestRequestBody,
) -> Result<infra::table::scorers::Scorer, ScorerError> {
    let mut scorer: infra::table::scorers::Scorer = ScorerRequestBody {
        name: body.name.clone(),
        description: body.description.clone(),
        scorer: body.scorer.clone(),
    }
    .into();

    scorer.name = scorer.name.trim().to_string();
    if scorer.name.is_empty() {
        return Err(ScorerError::MissingName);
    }

    scorer.id = "test_scorer".to_string();
    scorer.entity_id = "test_scorer".to_string();
    scorer.org_id = org_id.to_string();
    scorer.version = 1;
    scorer.is_active = true;
    Ok(scorer)
}

async fn score_config_info_for_test_scorer(
    org_id: &str,
    scorer: &mut infra::table::scorers::Scorer,
) -> Result<Option<ScoreConfigInfo>, ScorerError> {
    let Some(entity_id) = scorer
        .produces_score_config_id
        .as_deref()
        .filter(|id| !id.is_empty())
    else {
        return Ok(None);
    };

    let score_config = match scorer.produces_score_config_version {
        Some(version) => {
            infra::table::score_configs::get_by_entity_id_and_version(org_id, entity_id, version)
                .await?
        }
        None => infra::table::score_configs::get_by_entity_id(org_id, entity_id).await?,
    }
    .ok_or(ScorerError::ScoreConfigVersionNotFound)?;

    scorer.produces_score_config_version = Some(score_config.version);
    Ok(Some(ScoreConfigInfo::from(&score_config)))
}

async fn run_scorer_test(
    org_id: &str,
    body: &ScorerTestRequestBody,
) -> Result<ScorerTestResponseBody, ScorerError> {
    use std::collections::HashMap;

    let mut scorer = scorer_for_test(org_id, body)?;
    let score_config_info = score_config_info_for_test_scorer(org_id, &mut scorer).await?;

    let mut attrs: HashMap<String, serde_json::Value> = HashMap::new();
    if let Some(obj) = body.input_variables.as_object() {
        for (k, v) in obj {
            attrs.insert(k.clone(), v.clone());
        }
    }

    let start = std::time::Instant::now();

    match &scorer.scorer_type {
        infra::table::scorers::ScorerType::LlmJudge => {
            let prepared =
                openobserve_core::llm_evaluations::prepared_scorers::PreparedLlmJudgeScorer::prepare_with_score_config_info(
                    org_id,
                    &scorer,
                    score_config_info,
                )
                .await
                .map_err(|e| {
                    ScorerError::InfraError(infra::errors::Error::Message(e.to_string()))
                })?;

            match prepared.run(&attrs).await {
                Ok(output) => {
                    let latency = start.elapsed();
                    Ok(ScorerTestResponseBody {
                        success: true,
                        value_numeric: output.value_numeric,
                        value_categorical: output.value_categorical,
                        value_boolean: output.value_boolean,
                        reasoning: output.reasoning,
                        raw_response: Some(output.raw_response),
                        model_used: Some(output.model_used),
                        latency_ms: latency.as_millis() as i64,
                        prompt_tokens: output.prompt_tokens,
                        completion_tokens: output.completion_tokens,
                        total_tokens: output.total_tokens,
                        error: None,
                        metadata: output.metadata,
                    })
                }
                Err(e) => {
                    let latency = start.elapsed();
                    Ok(ScorerTestResponseBody {
                        success: false,
                        latency_ms: latency.as_millis() as i64,
                        error: Some(format!("{e}")),
                        ..Default::default()
                    })
                }
            }
        }
        infra::table::scorers::ScorerType::Remote => {
            let remote_cfg =
                openobserve_core::llm_evaluations::prepared_scorers::PreparedRemoteScorer::prepare(
                    org_id, &scorer,
                )
                .await
                .map_err(|e| {
                    ScorerError::InfraError(infra::errors::Error::Message(e.to_string()))
                })?;

            match remote_cfg.run(&attrs).await {
                Ok(output) => {
                    let latency = start.elapsed();
                    Ok(ScorerTestResponseBody {
                        success: true,
                        value_numeric: output.value.as_f64(),
                        value_categorical: output.value.as_str().map(|s| s.to_string()),
                        value_boolean: output.value.as_bool(),
                        reasoning: output.reasoning,
                        raw_response: Some(output.raw_response),
                        model_used: None,
                        latency_ms: latency.as_millis() as i64,
                        prompt_tokens: None,
                        completion_tokens: None,
                        total_tokens: None,
                        error: None,
                        metadata: output.metadata,
                    })
                }
                Err(e) => {
                    let latency = start.elapsed();
                    Ok(ScorerTestResponseBody {
                        success: false,
                        latency_ms: latency.as_millis() as i64,
                        error: Some(format!("{e}")),
                        ..Default::default()
                    })
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_scorer_error_conversion() {
        let cases: Vec<(ScorerError, u16)> = vec![
            (ScorerError::MissingName, 400),
            (ScorerError::NotFound, 404),
            (ScorerError::InvalidScorerType("x".to_string()), 400),
            (ScorerError::ScorerTypeImmutable, 400),
            (ScorerError::ProducesScoreConfigIdImmutable, 400),
            (ScorerError::InvalidOutputSchema("bad".to_string()), 400),
            (ScorerError::InvalidProviderConfig("bad".to_string()), 400),
            (ScorerError::DuplicateName, 409),
            (ScorerError::InUseByEvalJob, 409),
        ];
        for (err, expected) in cases {
            let resp = scorer_error_response(err);
            assert_eq!(resp.status().as_u16(), expected);
        }
    }

    #[test]
    fn test_scorer_error_infra_is_500() {
        let err = ScorerError::InfraError(infra::errors::Error::Message("db".to_string()));
        let resp = scorer_error_response(err);
        assert_eq!(resp.status().as_u16(), 500);
    }

    #[test]
    fn test_scorer_for_test_uses_create_payload_fields() {
        let body: ScorerTestRequestBody = serde_json::from_value(serde_json::json!({
            "name": "draft scorer",
            "scorer": {
                "type": "llm_judge",
                "producesScoreConfigId": "scfg-entity-1",
                "producesScoreConfigVersion": 4,
                "template": "Judge {{input}}",
                "params": {
                    "provider_id": "p1"
                }
            },
            "inputVariables": {
                "input": "hello"
            }
        }))
        .unwrap();

        let scorer = scorer_for_test("org1", &body).unwrap();
        assert_eq!(scorer.entity_id, "test_scorer");
        assert_eq!(scorer.name, "draft scorer");
        assert_eq!(
            scorer.produces_score_config_id.as_deref(),
            Some("scfg-entity-1")
        );
        assert_eq!(scorer.produces_score_config_version, Some(4));
        assert_eq!(scorer.params["provider_id"], "p1");
    }

    #[test]
    fn test_scorer_for_test_rejects_empty_name() {
        let body: ScorerTestRequestBody = serde_json::from_value(serde_json::json!({
            "name": " ",
            "scorer": {
                "type": "remote",
                "template": "{\"input\": \"{{input}}\"}",
                "params": {
                    "endpoint": "http://localhost:8000/evaluate",
                    "timeout_ms": 60000
                }
            },
            "inputVariables": {
                "input": "hello"
            }
        }))
        .unwrap();

        let err = scorer_for_test("org1", &body).unwrap_err();
        assert!(matches!(err, ScorerError::MissingName));
    }
}
