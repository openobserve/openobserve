// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

//! Playground APIs.
//!
//! Three of these endpoints deliberately persist nothing. Run calls a provider
//! and streams the answer back; Score calls a judge and returns the verdict.
//! Neither writes to `_llm_scores` and neither writes to the trace stream —
//! recording a draft would pollute the very analytics the Playground exists to
//! help a person improve. Sharing a snapshot is the only endpoint here that
//! stores anything.

use axum::{
    body::Body,
    extract::{Path, Query, rejection::JsonRejection},
    http::{HeaderValue, StatusCode, header::RETRY_AFTER},
    response::Response,
};
use db::authz::{remove_ownership, set_ownership};
use futures::StreamExt;
use openobserve_api_common::extractors::Headers;
use openobserve_core::{
    auth::{UserEmail, is_ofga_object_visible},
    llm_evaluations::{
        experiment_runner::render_prompt,
        playground::{self, PlaygroundError},
        provider::{
            PreparedProvider, ProviderChatMessage, ProviderChatParams, ProviderStreamStartError,
            RawProviderConfig,
        },
        provider_stream::ProviderChatDelta,
        sync_scoring::{self, SyncScoringError},
    },
};
use serde_json::{Value, json};

use crate::{
    common::meta::{authz::Authz, http::HttpResponse as MetaHttpResponse},
    models::playground::{
        ListPlaygroundSnapshotsQuery, ListPlaygroundSnapshotsResponseBody, PlaygroundColumnBody,
        PlaygroundRunRequestBody, PlaygroundScoreRequestBody, PlaygroundScoreResponseBody,
        PlaygroundSnapshotDiffResponseBody, PlaygroundSnapshotResponseBody,
        ProviderModelsResponseBody, SharePlaygroundSnapshotRequestBody,
    },
};

/// FGA object type for everything under `/playground`.
const PLAYGROUND_RESOURCE: &str = "playground";

const DEFAULT_LIST_SIZE: u64 = 50;
const MAX_LIST_SIZE: u64 = 200;

fn playground_error_response(error: PlaygroundError) -> Response {
    match error {
        PlaygroundError::NotFound => MetaHttpResponse::not_found("Playground snapshot not found"),
        PlaygroundError::NoParent => MetaHttpResponse::bad_request(
            "Playground snapshot was not forked from another snapshot",
        ),
        error @ (PlaygroundError::PayloadTooLarge { .. }
        | PlaygroundError::TooManyColumns { .. }
        | PlaygroundError::TooManyRows { .. }
        | PlaygroundError::PayloadNotAnObject
        | PlaygroundError::MalformedPayload(_)) => MetaHttpResponse::bad_request(error.to_string()),
        PlaygroundError::InfraError(error) => {
            log::error!("[Playground] infrastructure error: {error}");
            MetaHttpResponse::internal_error("Internal server error")
        }
        PlaygroundError::DbError(error) => {
            log::error!("[Playground] database error: {error}");
            MetaHttpResponse::internal_error("Internal server error")
        }
    }
}

fn provider_stream_start_error_response(error: ProviderStreamStartError) -> Response {
    let retry_after = error
        .retry_after()
        .and_then(|value| HeaderValue::from_str(value).ok());
    let mut response = match error.http_status() {
        400 => MetaHttpResponse::bad_request(error.to_string()),
        429 => MetaHttpResponse::too_many_requests(error.to_string()),
        502 => MetaHttpResponse::bad_gateway(error.to_string()),
        504 => MetaHttpResponse::error_with_header(StatusCode::GATEWAY_TIMEOUT, error.to_string()),
        _ => MetaHttpResponse::internal_error("Internal server error"),
    };
    if let Some(value) = retry_after {
        response.headers_mut().insert(RETRY_AFTER, value);
    }
    response
}

fn json_rejection_response(error: JsonRejection) -> Response {
    MetaHttpResponse::error_with_header(error.status(), error.body_text())
}

/// Confirm the caller may see this snapshot.
///
/// `method` is the permission the route already resolved to, not the HTTP
/// verb, so a route that maps a POST onto `PUT` must pass `PUT` here or it
/// would deny a caller the middleware already admitted.
async fn require_snapshot_visibility(
    org_id: &str,
    snapshot_id: &str,
    user_id: &str,
    method: &str,
) -> Result<(), Response> {
    match openobserve_api_common::auth::validator::list_objects_for_user(
        org_id,
        user_id,
        method,
        PLAYGROUND_RESOURCE,
    )
    .await
    {
        Ok(permitted) => {
            if is_ofga_object_visible(
                org_id,
                PLAYGROUND_RESOURCE,
                snapshot_id,
                permitted.as_deref(),
            ) {
                Ok(())
            } else {
                // Answered as "not found" so a hidden snapshot cannot be
                // probed for existence.
                Err(MetaHttpResponse::not_found("Playground snapshot not found"))
            }
        }
        Err(error) => Err(MetaHttpResponse::forbidden(error.to_string())),
    }
}

/// Confirm the caller may use this provider.
///
/// The Playground routes authorize against `playground`, so without this a
/// caller granted the Playground could spend through any provider in the
/// organization, including ones they cannot otherwise see. An unusable
/// reference is answered as a denial rather than a 404, so provider ids cannot
/// be probed through it.
async fn require_provider_visibility(
    org_id: &str,
    provider_id: &str,
    user_id: &str,
) -> Result<(), Response> {
    match openobserve_api_common::auth::validator::list_objects_for_user(
        org_id, user_id, "GET", "provider",
    )
    .await
    {
        Ok(permitted) => {
            if is_ofga_object_visible(org_id, "provider", provider_id, permitted.as_deref()) {
                Ok(())
            } else {
                Err(MetaHttpResponse::forbidden(
                    "Not allowed to use this provider",
                ))
            }
        }
        Err(error) => Err(MetaHttpResponse::forbidden(error.to_string())),
    }
}

/// Confirm the caller may use every scorer before resolving or invoking any of
/// them. Hidden scorers are reported as absent so their ids cannot be probed.
async fn require_scorer_visibility(
    org_id: &str,
    scorer_ids: &[String],
    user_id: &str,
) -> Result<(), Response> {
    let permitted = openobserve_api_common::auth::validator::list_objects_for_user(
        org_id, user_id, "GET", "scorer",
    )
    .await
    .map_err(|error| MetaHttpResponse::forbidden(error.to_string()))?;

    if let Some(hidden_id) = scorer_ids.iter().find(|scorer_id| {
        !is_ofga_object_visible(org_id, "scorer", scorer_id, permitted.as_deref())
    }) {
        return Err(MetaHttpResponse::not_found(format!(
            "Scorer '{hidden_id}' not found"
        )));
    }
    Ok(())
}

/// Confirm the caller may use every provider referenced by an LLM judge
/// scorer. The permission lookup is shared across the whole batch.
async fn require_scorer_provider_visibility(
    org_id: &str,
    scorers: &[infra::table::scorers::Scorer],
    user_id: &str,
) -> Result<(), Response> {
    let provider_ids = scorers
        .iter()
        .filter(|scorer| scorer.scorer_type == infra::table::scorers::ScorerType::LlmJudge)
        .filter_map(|scorer| scorer.params.get("provider_id").and_then(Value::as_str))
        .collect::<std::collections::HashSet<_>>();
    if provider_ids.is_empty() {
        return Ok(());
    }

    let permitted = openobserve_api_common::auth::validator::list_objects_for_user(
        org_id, user_id, "GET", "provider",
    )
    .await
    .map_err(|error| MetaHttpResponse::forbidden(error.to_string()))?;

    if provider_ids.iter().any(|provider_id| {
        !is_ofga_object_visible(org_id, "provider", provider_id, permitted.as_deref())
    }) {
        return Err(MetaHttpResponse::forbidden(
            "Not allowed to use a provider configured by this scorer",
        ));
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Snapshots
// ---------------------------------------------------------------------------

#[utoipa::path(
    post,
    path = "/{org_id}/playground/snapshots",
    context_path = "/api",
    tag = "Playground",
    operation_id = "SharePlaygroundSnapshot",
    security(("Authorization" = [])),
    params(("org_id" = String, Path, description = "Organization name")),
    request_body(content = inline(SharePlaygroundSnapshotRequestBody)),
    responses(
        (status = 200, body = inline(PlaygroundSnapshotResponseBody)),
        (status = 400, description = "Payload is malformed or over a workbench limit", body = ()),
    ),
)]
pub async fn share_playground_snapshot(
    Path(org_id): Path<String>,
    Headers(user): Headers<UserEmail>,
    body: Result<axum::Json<SharePlaygroundSnapshotRequestBody>, JsonRejection>,
) -> Response {
    let axum::Json(body) = match body {
        Ok(body) => body,
        Err(error) => return json_rejection_response(error),
    };
    match playground::create(
        &org_id,
        &user.user_id,
        body.payload,
        body.parent_snapshot_id,
    )
    .await
    {
        Ok(snapshot) => {
            set_ownership(&org_id, "playground", Authz::new(&snapshot.id)).await;
            MetaHttpResponse::json(PlaygroundSnapshotResponseBody::from(snapshot))
        }
        Err(error) => playground_error_response(error),
    }
}

#[utoipa::path(
    get,
    path = "/{org_id}/playground/snapshots",
    context_path = "/api",
    tag = "Playground",
    operation_id = "ListPlaygroundSnapshots",
    security(("Authorization" = [])),
    params(("org_id" = String, Path, description = "Organization name"), ListPlaygroundSnapshotsQuery),
    responses((status = 200, body = inline(ListPlaygroundSnapshotsResponseBody))),
)]
pub async fn list_playground_snapshots(
    Path(org_id): Path<String>,
    Query(query): Query<ListPlaygroundSnapshotsQuery>,
    Headers(user): Headers<UserEmail>,
) -> Response {
    let permitted = match openobserve_api_common::auth::validator::list_objects_for_user(
        &org_id,
        &user.user_id,
        "GET",
        PLAYGROUND_RESOURCE,
    )
    .await
    {
        Ok(permitted) => permitted,
        Err(error) => return MetaHttpResponse::forbidden(error.to_string()),
    };

    let size = query
        .size
        .unwrap_or(DEFAULT_LIST_SIZE)
        .clamp(1, MAX_LIST_SIZE);
    let all_object = format!("{PLAYGROUND_RESOURCE}:_all_{org_id}");
    let visible_ids = permitted.as_ref().and_then(|objects| {
        if objects.contains(&all_object) {
            None
        } else {
            let prefix = format!("{PLAYGROUND_RESOURCE}:");
            Some(
                objects
                    .iter()
                    .filter_map(|object| object.strip_prefix(&prefix).map(str::to_string))
                    .collect::<Vec<_>>(),
            )
        }
    });
    match playground::list_visible(
        &org_id,
        query.from.unwrap_or(0),
        size,
        visible_ids.as_deref(),
    )
    .await
    {
        Ok(page) => MetaHttpResponse::json(ListPlaygroundSnapshotsResponseBody::from(page)),
        Err(error) => playground_error_response(error),
    }
}

#[utoipa::path(
    get,
    path = "/{org_id}/playground/snapshots/{snapshot_id}",
    context_path = "/api",
    tag = "Playground",
    operation_id = "GetPlaygroundSnapshot",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("snapshot_id" = String, Path, description = "Snapshot id"),
    ),
    responses(
        (status = 200, body = inline(PlaygroundSnapshotResponseBody)),
        (status = 404, description = "Snapshot not found", body = ()),
    ),
)]
pub async fn get_playground_snapshot(
    Path((org_id, snapshot_id)): Path<(String, String)>,
    Headers(user): Headers<UserEmail>,
) -> Response {
    if let Err(response) =
        require_snapshot_visibility(&org_id, &snapshot_id, &user.user_id, "GET").await
    {
        return response;
    }
    match playground::get(&org_id, &snapshot_id).await {
        Ok(snapshot) => MetaHttpResponse::json(PlaygroundSnapshotResponseBody::from(snapshot)),
        Err(error) => playground_error_response(error),
    }
}

#[utoipa::path(
    get,
    path = "/{org_id}/playground/snapshots/{snapshot_id}/diff",
    context_path = "/api",
    tag = "Playground",
    operation_id = "DiffPlaygroundSnapshot",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("snapshot_id" = String, Path, description = "Snapshot id"),
    ),
    responses(
        (status = 200, body = inline(PlaygroundSnapshotDiffResponseBody)),
        (status = 400, description = "Snapshot has no parent to compare against", body = ()),
        (status = 404, description = "Snapshot not found", body = ()),
    ),
)]
pub async fn diff_playground_snapshot(
    Path((org_id, snapshot_id)): Path<(String, String)>,
    Headers(user): Headers<UserEmail>,
) -> Response {
    if let Err(response) =
        require_snapshot_visibility(&org_id, &snapshot_id, &user.user_id, "GET").await
    {
        return response;
    }
    match playground::diff(&org_id, &snapshot_id).await {
        Ok(diff) => MetaHttpResponse::json(PlaygroundSnapshotDiffResponseBody::from(diff)),
        Err(error) => playground_error_response(error),
    }
}

#[utoipa::path(
    delete,
    path = "/{org_id}/playground/snapshots/{snapshot_id}",
    context_path = "/api",
    tag = "Playground",
    operation_id = "DeletePlaygroundSnapshot",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("snapshot_id" = String, Path, description = "Snapshot id"),
    ),
    responses(
        (status = 200, description = "Snapshot deleted", body = ()),
        (status = 404, description = "Snapshot not found", body = ()),
    ),
)]
pub async fn delete_playground_snapshot(
    Path((org_id, snapshot_id)): Path<(String, String)>,
    Headers(user): Headers<UserEmail>,
) -> Response {
    if let Err(response) =
        require_snapshot_visibility(&org_id, &snapshot_id, &user.user_id, "DELETE").await
    {
        return response;
    }
    match playground::delete(&org_id, &snapshot_id).await {
        Ok(()) => {
            remove_ownership(&org_id, "playground", Authz::new(&snapshot_id)).await;
            MetaHttpResponse::ok("Playground snapshot deleted")
        }
        Err(error) => playground_error_response(error),
    }
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

/// Encode one Server-Sent Event.
fn sse(payload: &Value) -> bytes::Bytes {
    bytes::Bytes::from(format!("data: {payload}\n\n"))
}

/// Resolve a provider that belongs to this organization.
async fn load_provider(org_id: &str, provider_id: &str) -> Result<PreparedProvider, Response> {
    let provider = match infra::table::providers::get(provider_id).await {
        Ok(Some(provider)) if provider.org_id == org_id => provider,
        // A provider in another organization is reported as absent rather than
        // forbidden, so its existence cannot be probed.
        Ok(_) => return Err(MetaHttpResponse::not_found("Provider not found")),
        Err(error) => {
            log::error!("[Playground] failed to load provider {provider_id}: {error}");
            return Err(MetaHttpResponse::internal_error("Internal server error"));
        }
    };

    PreparedProvider::parse(RawProviderConfig::from(&provider))
        .map_err(|error| MetaHttpResponse::bad_request(format!("Provider is not usable: {error}")))
}

/// Bind the row's input into each message.
///
/// Only string content is templated. Structured content — multimodal parts and
/// tool results — is passed through as JSON: rendering into it would corrupt
/// the structure, and editing it is out of scope for this release.
fn render_messages(
    column: &PlaygroundColumnBody,
    input: &Value,
) -> Result<Vec<ProviderChatMessage>, Response> {
    column
        .messages
        .iter()
        .map(|message| {
            let content = match &message.content {
                Some(Value::String(text)) => {
                    Value::String(render_prompt(text, input).map_err(|error| {
                        MetaHttpResponse::bad_request(format!(
                            "Message for role '{}' could not be rendered: {error}",
                            message.role
                        ))
                    })?)
                }
                Some(other) => other.clone(),
                None => Value::String(String::new()),
            };
            Ok(ProviderChatMessage {
                role: message.role.clone(),
                content,
            })
        })
        .collect()
}

/// Split the column's params into the fields the provider names explicitly and
/// the rest, which ride through untouched.
fn split_params(
    column: &PlaygroundColumnBody,
) -> Result<(f64, u32, serde_json::Map<String, Value>), String> {
    let mut extra = column.params.clone();
    let temperature = match extra.remove("temperature") {
        None => 0.0,
        Some(value) => value
            .as_f64()
            .filter(|temperature| (0.0..=2.0).contains(temperature))
            .ok_or_else(|| "params.temperature must be a number from 0 to 2".to_string())?,
    };
    let max_tokens_snake = extra.remove("max_tokens");
    let max_tokens_camel = extra.remove("maxTokens");
    if max_tokens_snake.is_some() && max_tokens_camel.is_some() {
        return Err("params must not contain both max_tokens and maxTokens".to_string());
    }
    let max_tokens = match max_tokens_snake.or(max_tokens_camel) {
        None => 0,
        Some(value) => u32::try_from(
            value
                .as_u64()
                .ok_or_else(|| "params.max_tokens must be a non-negative integer".to_string())?,
        )
        .map_err(|_| "params.max_tokens must be no greater than 4294967295".to_string())?,
    };

    if let Some(tools) = &column.tools {
        extra.insert("tools".to_string(), tools.clone());
    }
    if let Some(response_format) = &column.response_format {
        extra.insert("response_format".to_string(), response_format.clone());
    }
    Ok((temperature, max_tokens, extra))
}

#[utoipa::path(
    post,
    path = "/{org_id}/playground/run",
    context_path = "/api",
    tag = "Playground",
    operation_id = "RunPlaygroundCell",
    security(("Authorization" = [])),
    params(("org_id" = String, Path, description = "Organization name")),
    request_body(content = inline(PlaygroundRunRequestBody)),
    responses(
        (status = 200, description = "Server-Sent Events carrying the model's answer", content_type = "text/event-stream"),
        (status = 400, description = "Column or row is not runnable", body = ()),
        (status = 403, description = "Provider is not visible to the caller", body = ()),
        (status = 404, description = "Provider not found", body = ()),
        (status = 429, description = "The provider rate limited the request", body = ()),
        (status = 500, description = "The request could not be started", body = ()),
        (status = 502, description = "The provider failed before streaming", body = ()),
        (status = 504, description = "The provider timed out before streaming", body = ()),
    ),
)]
pub async fn run_playground_cell(
    Path(org_id): Path<String>,
    Headers(user): Headers<UserEmail>,
    body: Result<axum::Json<PlaygroundRunRequestBody>, JsonRejection>,
) -> Response {
    let axum::Json(body) = match body {
        Ok(body) => body,
        Err(error) => return json_rejection_response(error),
    };
    if let Err(response) =
        require_provider_visibility(&org_id, &body.column.provider_id, &user.user_id).await
    {
        return response;
    }

    let provider = match load_provider(&org_id, &body.column.provider_id).await {
        Ok(provider) => provider,
        Err(response) => return response,
    };

    let input = body.row.input.clone().unwrap_or(Value::Null);
    let messages = match render_messages(&body.column, &input) {
        Ok(messages) => messages,
        Err(response) => return response,
    };

    let (temperature, max_tokens, extra) = match split_params(&body.column) {
        Ok(params) => params,
        Err(error) => return MetaHttpResponse::bad_request(error),
    };
    let params = ProviderChatParams {
        org_id: org_id.clone(),
        model: body.column.model.clone(),
        messages: messages.clone(),
        temperature,
        max_tokens,
        timeout_ms: o2_enterprise::enterprise::common::config::get_config()
            .llm_eval_config
            .playground_run_timeout_ms,
        extra,
        timestamp: config::utils::time::now_micros(),
        // Deliberately absent: a Playground run is a draft, and de-duplicating
        // it against an earlier attempt would return a stale answer to someone
        // who just edited their prompt.
        idempotency_key: None,
    };

    // Everything that can fail before the first byte is resolved here, so the
    // caller gets a real status code. Once the stream is open the only channel
    // left is an error frame inside it.
    let stream = match provider.run_chat_stream(&params).await {
        Ok(stream) => stream,
        Err(error) => {
            log::warn!(
                "[Playground] run failed for org={org_id} user={} provider={}: {error}",
                user.user_id,
                body.column.provider_id
            );
            return provider_stream_start_error_response(error);
        }
    };

    let rendered = json!({
        "type": "rendered",
        "messages": messages
            .iter()
            .map(|message| json!({"role": message.role, "content": message.content}))
            .collect::<Vec<_>>(),
    });

    let events = async_stream::stream! {
        // The rendered prompt goes first so the caller can show exactly what
        // was sent, including how the row's variables were bound.
        yield Ok::<bytes::Bytes, std::io::Error>(sse(&rendered));

        let mut stream = Box::pin(stream);
        while let Some(item) = stream.next().await {
            let frame = match item {
                Ok(ProviderChatDelta::Text(text)) => json!({"type": "delta", "content": text}),
                Ok(ProviderChatDelta::ToolCall(call)) => json!({
                    "type": "toolCall",
                    "id": call.id,
                    "name": call.name,
                    "arguments": call.arguments,
                }),
                Ok(ProviderChatDelta::Done(result)) => json!({
                    "type": "done",
                    "model": result.model_used,
                    "latencyMs": result.latency_ms,
                    "usage": {
                        "promptTokens": result.prompt_tokens,
                        "completionTokens": result.completion_tokens,
                        "totalTokens": result.total_tokens,
                        "cost": result.cost,
                    },
                }),
                Err(error) => {
                    yield Ok(sse(&json!({"type": "error", "error": error.to_string()})));
                    break;
                }
            };
            yield Ok(sse(&frame));
        }
    };

    axum::http::Response::builder()
        .status(StatusCode::OK)
        .header(
            axum::http::header::CONTENT_TYPE,
            mime::TEXT_EVENT_STREAM.as_ref(),
        )
        .header(axum::http::header::CACHE_CONTROL, "no-cache")
        .header("X-Accel-Buffering", "no")
        .body(Body::from_stream(events))
        .unwrap_or_else(|_| Response::new(Body::empty()))
}

// ---------------------------------------------------------------------------
// Score
// ---------------------------------------------------------------------------

#[utoipa::path(
    post,
    path = "/{org_id}/playground/score",
    context_path = "/api",
    tag = "Playground",
    operation_id = "ScorePlaygroundCell",
    security(("Authorization" = [])),
    params(("org_id" = String, Path, description = "Organization name")),
    request_body(content = inline(PlaygroundScoreRequestBody)),
    responses(
        (status = 200, body = inline(PlaygroundScoreResponseBody)),
        (status = 403, description = "A scorer provider is not visible to the caller", body = ()),
        (status = 404, description = "A referenced scorer does not exist", body = ()),
        (status = 500, description = "Scorer resolution failed", body = ()),
    ),
)]
pub async fn score_playground_cell(
    Path(org_id): Path<String>,
    Headers(user): Headers<UserEmail>,
    body: Result<axum::Json<PlaygroundScoreRequestBody>, JsonRejection>,
) -> Response {
    let axum::Json(body) = match body {
        Ok(body) => body,
        Err(error) => return json_rejection_response(error),
    };
    let scorer_ids = body.scorer_ids.clone();
    if let Err(response) = require_scorer_visibility(&org_id, &scorer_ids, &user.user_id).await {
        return response;
    }

    let scorers = match sync_scoring::resolve_all(&org_id, &scorer_ids).await {
        Ok(scorers) => scorers,
        Err(SyncScoringError::ScorerNotFound(id)) => {
            return MetaHttpResponse::not_found(format!("Scorer '{id}' not found"));
        }
        Err(SyncScoringError::InfraError(error)) => {
            log::error!("[Playground] scoring failed: {error}");
            return MetaHttpResponse::internal_error("Internal server error");
        }
    };
    if let Err(response) =
        require_scorer_provider_visibility(&org_id, &scorers, &user.user_id).await
    {
        return response;
    }

    let results = sync_scoring::score_resolved_all(&org_id, &scorers, &body.into()).await;
    MetaHttpResponse::json(PlaygroundScoreResponseBody {
        results: results.into_iter().map(Into::into).collect(),
    })
}

// ---------------------------------------------------------------------------
// Provider model catalogue
// ---------------------------------------------------------------------------

#[utoipa::path(
    get,
    path = "/{org_id}/providers/{provider_id}/models",
    context_path = "/api",
    tag = "Providers",
    operation_id = "ListProviderModels",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("provider_id" = String, Path, description = "Provider id"),
    ),
    responses(
        (status = 200, body = inline(ProviderModelsResponseBody)),
        (status = 403, description = "Provider is not visible to the caller", body = ()),
        (status = 404, description = "Provider not found", body = ()),
        (status = 502, description = "The provider could not be reached", body = ()),
    ),
)]
pub async fn list_provider_models(
    Path((org_id, provider_id)): Path<(String, String)>,
    Headers(user): Headers<UserEmail>,
) -> Response {
    if let Err(response) = require_provider_visibility(&org_id, &provider_id, &user.user_id).await {
        return response;
    }

    let configured_models = match infra::table::providers::get(&provider_id).await {
        Ok(Some(provider)) if provider.org_id == org_id => provider.available_models.clone(),
        Ok(_) => return MetaHttpResponse::not_found("Provider not found"),
        Err(error) => {
            log::error!("[Playground] failed to load provider {provider_id}: {error}");
            return MetaHttpResponse::internal_error("Internal server error");
        }
    };

    let provider = match load_provider(&org_id, &provider_id).await {
        Ok(provider) => provider,
        Err(response) => return response,
    };

    match provider.list_models().await {
        Ok(models) => MetaHttpResponse::json(ProviderModelsResponseBody {
            models,
            configured_models,
        }),
        Err(error) => {
            // The provider being unreachable is the provider's problem, not
            // ours, so it is reported as an upstream failure.
            log::warn!("[Playground] model listing failed for {provider_id}: {error}");
            MetaHttpResponse::bad_gateway(error.to_string())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::playground::PlaygroundMessageBody;

    fn column(params: Value) -> PlaygroundColumnBody {
        PlaygroundColumnBody {
            provider_id: "provider-1".to_string(),
            model: Some("model-1".to_string()),
            messages: Vec::new(),
            params: params.as_object().cloned().unwrap_or_default(),
            tools: None,
            response_format: None,
        }
    }

    #[test]
    fn playground_params_reject_invalid_or_ambiguous_core_values() {
        assert!(split_params(&column(json!({"temperature": "hot"}))).is_err());
        assert!(split_params(&column(json!({"temperature": 2.1}))).is_err());
        assert!(split_params(&column(json!({"max_tokens": -1}))).is_err());
        assert!(split_params(&column(json!({"max_tokens": 1_u64 << 32}))).is_err());
        assert!(split_params(&column(json!({"max_tokens": 10, "maxTokens": 11}))).is_err());

        let (temperature, max_tokens, extra) = split_params(&column(
            json!({"temperature": 0.7, "maxTokens": 64, "top_p": 0.9}),
        ))
        .unwrap();
        assert_eq!(temperature, 0.7);
        assert_eq!(max_tokens, 64);
        assert_eq!(extra["top_p"], json!(0.9));
    }

    #[test]
    fn structured_message_content_is_not_stringified() {
        let mut column = column(json!({}));
        let structured = json!([
            {"type": "text", "text": "Describe this"},
            {"type": "image_url", "image_url": {"url": "data:image/png;base64,AA=="}}
        ]);
        column.messages = vec![
            PlaygroundMessageBody {
                role: "user".to_string(),
                content: Some(json!("Hello {{name}}")),
            },
            PlaygroundMessageBody {
                role: "user".to_string(),
                content: Some(structured.clone()),
            },
        ];

        let rendered = render_messages(&column, &json!({"name": "Ada"})).unwrap();
        assert_eq!(rendered[0].content, json!("Hello Ada"));
        assert_eq!(rendered[1].content, structured);
    }
}
