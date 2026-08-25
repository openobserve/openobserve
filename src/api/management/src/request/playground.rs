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
    extract::{Path, Query},
    http::StatusCode,
    response::Response,
};
use db::authz::{remove_ownership, set_ownership};
use futures::StreamExt;
use openobserve_api_common::extractors::Headers;
use o2_enterprise::enterprise::llm_evaluations::{
    eval_jobs::{
        hydration,
        tasks::{EvaluationQueryWindow, EvaluationTargetScope},
    },
    playground_seed,
};
use openobserve_core::{
    auth::{UserEmail, is_ofga_object_visible},
    llm_evaluations::{
        experiment_runner::render_prompt,
        playground::{self, PlaygroundError},
        provider::{PreparedProvider, ProviderChatMessage, ProviderChatParams, RawProviderConfig},
        provider_stream::ProviderChatDelta,
        sync_scoring::{self, SyncScoringError},
    },
};
use serde_json::{Value, json};

use crate::{
    common::meta::{authz::Authz, http::HttpResponse as MetaHttpResponse},
    models::playground::{
        ListPlaygroundSnapshotsQuery, ListPlaygroundSnapshotsResponseBody, PlaygroundColumnBody,
        PlaygroundMessageBody, PlaygroundRunRequestBody, PlaygroundScoreRequestBody,
        PlaygroundScoreResponseBody, PlaygroundSnapshotDiffResponseBody,
        PlaygroundSnapshotResponseBody, ProviderModelsResponseBody, SeedFromSpanRequestBody,
        SeedFromSpanResponseBody, SeededColumnBody, SharePlaygroundSnapshotRequestBody,
    },
};

/// FGA object type for everything under `/playground`.
const PLAYGROUND_RESOURCE: &str = "playground";

const DEFAULT_LIST_SIZE: u64 = 50;
const MAX_LIST_SIZE: u64 = 200;

fn playground_error_response(error: PlaygroundError) -> Response {
    match error {
        PlaygroundError::NotFound => {
            MetaHttpResponse::not_found("Playground snapshot not found")
        }
        PlaygroundError::NoParent => MetaHttpResponse::bad_request(
            "Playground snapshot was not forked from another snapshot",
        ),
        error @ (PlaygroundError::PayloadTooLarge { .. }
        | PlaygroundError::TooManyColumns { .. }
        | PlaygroundError::TooManyRows { .. }
        | PlaygroundError::PayloadNotAnObject
        | PlaygroundError::MalformedPayload(_)) => {
            MetaHttpResponse::bad_request(error.to_string())
        }
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
            if is_ofga_object_visible(org_id, PLAYGROUND_RESOURCE, snapshot_id, permitted.as_deref())
            {
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

// ---------------------------------------------------------------------------
// Snapshots
// ---------------------------------------------------------------------------

#[utoipa::path(
    post,
    path = "/{org_id}/playground/snapshots",
    context_path = "/api",
    tag = "Playground",
    operation_id = "SharePlaygroundSnapshot",
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
    axum::Json(body): axum::Json<SharePlaygroundSnapshotRequestBody>,
) -> Response {
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

    let size = query.size.unwrap_or(DEFAULT_LIST_SIZE).clamp(1, MAX_LIST_SIZE);
    match playground::list(&org_id, query.from.unwrap_or(0), size).await {
        Ok(mut page) => {
            page.snapshots.retain(|snapshot| {
                is_ofga_object_visible(
                    &org_id,
                    PLAYGROUND_RESOURCE,
                    &snapshot.id,
                    permitted.as_deref(),
                )
            });
            MetaHttpResponse::json(ListPlaygroundSnapshotsResponseBody::from(page))
        }
        Err(error) => playground_error_response(error),
    }
}

#[utoipa::path(
    get,
    path = "/{org_id}/playground/snapshots/{snapshot_id}",
    context_path = "/api",
    tag = "Playground",
    operation_id = "GetPlaygroundSnapshot",
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
async fn load_provider(
    org_id: &str,
    provider_id: &str,
) -> Result<PreparedProvider, Response> {
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

    PreparedProvider::parse(RawProviderConfig::from(&provider)).map_err(|error| {
        MetaHttpResponse::bad_request(format!("Provider is not usable: {error}"))
    })
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
                Some(Value::String(text)) => render_prompt(text, input).map_err(|error| {
                    MetaHttpResponse::bad_request(format!(
                        "Message for role '{}' could not be rendered: {error}",
                        message.role
                    ))
                })?,
                Some(other) => other.to_string(),
                None => String::new(),
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
fn split_params(column: &PlaygroundColumnBody) -> (f64, u32, serde_json::Map<String, Value>) {
    let mut extra = column.params.clone();
    let temperature = extra
        .remove("temperature")
        .and_then(|value| value.as_f64())
        .unwrap_or(0.0);
    let max_tokens = extra
        .remove("max_tokens")
        .or_else(|| extra.remove("maxTokens"))
        .and_then(|value| value.as_u64())
        .unwrap_or(0) as u32;

    if let Some(tools) = &column.tools {
        extra.insert("tools".to_string(), tools.clone());
    }
    if let Some(response_format) = &column.response_format {
        extra.insert("response_format".to_string(), response_format.clone());
    }
    (temperature, max_tokens, extra)
}

#[utoipa::path(
    post,
    path = "/{org_id}/playground/run",
    context_path = "/api",
    tag = "Playground",
    operation_id = "RunPlaygroundCell",
    params(("org_id" = String, Path, description = "Organization name")),
    request_body(content = inline(PlaygroundRunRequestBody)),
    responses(
        (status = 200, description = "Server-Sent Events carrying the model's answer", body = ()),
        (status = 400, description = "Column or row is not runnable", body = ()),
        (status = 404, description = "Provider not found", body = ()),
    ),
)]
pub async fn run_playground_cell(
    Path(org_id): Path<String>,
    Headers(user): Headers<UserEmail>,
    axum::Json(body): axum::Json<PlaygroundRunRequestBody>,
) -> Response {
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

    let (temperature, max_tokens, extra) = split_params(&body.column);
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
            return MetaHttpResponse::bad_request(error.to_string());
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
    params(("org_id" = String, Path, description = "Organization name")),
    request_body(content = inline(PlaygroundScoreRequestBody)),
    responses(
        (status = 200, body = inline(PlaygroundScoreResponseBody)),
        (status = 404, description = "A referenced scorer does not exist", body = ()),
    ),
)]
pub async fn score_playground_cell(
    Path(org_id): Path<String>,
    axum::Json(body): axum::Json<PlaygroundScoreRequestBody>,
) -> Response {
    let scorer_ids = body.scorer_ids.clone();
    match sync_scoring::score_all(&org_id, &scorer_ids, &body.into()).await {
        Ok(results) => MetaHttpResponse::json(PlaygroundScoreResponseBody {
            results: results.into_iter().map(Into::into).collect(),
        }),
        Err(SyncScoringError::ScorerNotFound(id)) => {
            MetaHttpResponse::not_found(format!("Scorer '{id}' not found"))
        }
        Err(SyncScoringError::InfraError(error)) => {
            log::error!("[Playground] scoring failed: {error}");
            MetaHttpResponse::internal_error("Internal server error")
        }
    }
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
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("provider_id" = String, Path, description = "Provider id"),
    ),
    responses(
        (status = 200, body = inline(ProviderModelsResponseBody)),
        (status = 404, description = "Provider not found", body = ()),
        (status = 502, description = "The provider could not be reached", body = ()),
    ),
)]
pub async fn list_provider_models(
    Path((org_id, provider_id)): Path<(String, String)>,
) -> Response {
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

// ---------------------------------------------------------------------------
// Seeding from a trace
// ---------------------------------------------------------------------------

/// Spans read from one trace while looking for the requested one.
const MAX_TRACE_SPANS: usize = 500;

#[utoipa::path(
    post,
    path = "/{org_id}/playground/seed_from_span",
    context_path = "/api",
    tag = "Playground",
    operation_id = "SeedPlaygroundFromSpan",
    params(("org_id" = String, Path, description = "Organization name")),
    request_body(content = inline(SeedFromSpanRequestBody)),
    responses(
        (status = 200, body = inline(SeedFromSpanResponseBody)),
        (status = 400, description = "The search window is invalid", body = ()),
        (status = 404, description = "No such span in that trace and window", body = ()),
    ),
)]
pub async fn seed_playground_from_span(
    Path(org_id): Path<String>,
    axum::Json(body): axum::Json<SeedFromSpanRequestBody>,
) -> Response {
    // The whole trace is fetched and the span picked out of it: hydration keys
    // span scope on `span_id` alone, so asking for the trace is what actually
    // guarantees the span belongs to the trace the caller named.
    let rows = match hydration::hydrate_target(
        &org_id,
        &body.stream,
        "traces",
        EvaluationTargetScope::Trace,
        &body.trace_id,
        EvaluationQueryWindow {
            start_us: body.start_time,
            end_us: body.end_time,
            ingest_cutoff_us: None,
        },
        MAX_TRACE_SPANS,
    )
    .await
    {
        Ok(rows) => rows,
        Err(error) => {
            log::warn!("[Playground] seed hydration failed for trace {}: {error}", body.trace_id);
            return MetaHttpResponse::bad_request(error.to_string());
        }
    };

    let Some(row) = playground_seed::find_span(&rows, &body.span_id) else {
        return MetaHttpResponse::not_found(
            "Span not found in that trace and time range",
        );
    };

    let seed = playground_seed::seed_from_span_row(row);

    let providers = infra::table::providers::get_all_by_org(&org_id)
        .await
        .unwrap_or_default();
    let matched = playground_seed::match_provider(&providers, seed.column.model.as_deref());

    MetaHttpResponse::json(SeedFromSpanResponseBody {
        column: SeededColumnBody {
            messages: seed
                .column
                .messages
                .into_iter()
                .map(|message| PlaygroundMessageBody {
                    role: message.role,
                    content: message.content,
                })
                .collect(),
            model: seed.column.model,
            provider_id: matched.map(|provider| provider.id.clone()),
            params: seed.column.params,
            tools: seed.column.tools,
        },
        original_output: seed.original_output,
        provider_matched: matched.is_some(),
    })
}
