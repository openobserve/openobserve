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

use std::{
    collections::HashMap,
    sync::{Arc, LazyLock, Mutex},
};

use axum::{
    Json,
    extract::Path,
    http::StatusCode,
    response::{IntoResponse, Response},
};
use config::{
    meta::{
        function::Transform,
        pipeline::Pipeline,
        search::{Query as SearchQuery, Request as SearchRequest},
        stream::{SecuritySourceSetting, StreamType, UpdateStreamSettings},
    },
    utils::time::now_micros,
};
use o2_enterprise::enterprise::security::{
    ocsf::severity::{SeveritySql, severity_sql},
    sources::{
        activity::{
            ACTIVITY_LOOKBACK_US, Activity, needs_recount_for, record_recount, with_recent_count,
        },
        attach::{
            AttachConfig, AttachError, AttachErrorCode, AttachPlan, DetachPlan, DetachSkip,
            ExtendPlan, FunctionPlan, StreamForChecks, attached_setting, detach_target,
            detached_setting, entity_program, find_pack, function_name, new_pipeline, offered_pack,
            our_node, pick_winner, pipeline_id, plan_attach, plan_detach, plan_extend,
            plan_function, pre_attach_checks, realtime_pipelines_for, setting_function_name,
        },
        catalog::{SourceType, source_types},
        classify::{Classification, best_match, is_security_source},
        listing::{SourceListing, StreamInput, build_listing},
        selection::{
            ClassifyCandidate, ClassifyMemo, StreamRef, StreamVerdict, classify_queue,
            judge_stream, unmatched_verdict, verdict_update,
        },
    },
};
use openobserve_api_common::extractors::Headers;
use openobserve_core::{
    auth::{UserEmail, check_permissions},
    background_access::StreamReadCheck,
    pipeline as pipeline_service,
    pipeline::db::PipelineError,
};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use utoipa::ToSchema;

use super::security_allowed;
use crate::common::meta::http::HttpResponse as MetaHttpResponse;

const SAMPLE_ROWS: i64 = 30;
/// A day, so a source that is quiet this hour still classifies from its rows.
const SAMPLE_WINDOW_US: i64 = 24 * 3_600_000_000;
const CONCURRENCY: usize = 2;

/// What this node last learned per (org, stream), so a classify pass skips settled streams.
static CLASSIFY_MEMO: LazyLock<Mutex<HashMap<(String, String), ClassifyMemo>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));
/// One attach or detach per stream at a time on this node.
static STREAM_LOCKS: LazyLock<Mutex<HashMap<String, Arc<tokio::sync::Mutex<()>>>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

#[derive(Debug, Default, Deserialize, ToSchema)]
pub struct ClassifyRequest {
    /// Streams to classify now; empty lets the server pick the ones that need it.
    #[serde(default)]
    pub streams: Vec<String>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct ClassifyResult {
    pub stream: String,
    pub verdict: StreamVerdict,
    pub sampled: bool,
    /// False when the stored verdict stands under the stability rule.
    pub stored: bool,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct ClassifyResponse {
    pub classified: Vec<ClassifyResult>,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct MatchRequest {
    pub fields: Vec<String>,
    #[serde(default)]
    #[schema(value_type = Option<Object>)]
    pub sample: Option<Map<String, Value>>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct MatchResponse {
    pub classification: Option<Classification>,
    pub is_security: bool,
    /// The severity every Events query reads; absent when the fields say nothing about it.
    pub severity: Option<SeveritySql>,
}

#[derive(Debug, Default, Deserialize, ToSchema)]
pub struct AttachRequest {
    /// Defaults to the full pack for the stream's source type, else the entity pack.
    #[serde(default)]
    pub pack_id: Option<String>,
    #[serde(default)]
    pub pack_version: Option<u32>,
    /// Runs every check and returns the plan without writing anything.
    #[serde(default)]
    pub dry_run: bool,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct AttachResponse {
    pub setting: SecuritySourceSetting,
    pub pipeline_id: String,
    pub pipeline_created: bool,
    pub plan: AttachPlan,
    pub dry_run: bool,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct DetachResponse {
    pub setting: Option<SecuritySourceSetting>,
    /// Set when the recorded pipeline was left alone because it no longer belongs to the stream.
    pub skipped: Option<DetachSkip>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct SourcesResponse {
    #[serde(flatten)]
    pub listing: SourceListing,
    /// False when the caller may read no logs stream, so an empty list is a missing grant.
    pub streams_readable: bool,
}

/// ListSecuritySources
#[utoipa::path(
    get,
    path = "/{org_id}/security/sources",
    context_path = "/api",
    tag = "Security",
    operation_id = "ListSecuritySources",
    summary = "List Security sources",
    description = "Every log stream the caller can read with its classifier verdict, source type, health and OCSF pack, plus the pack records that disagree with the pipelines",
    security(("Authorization" = [])),
    params(("org_id" = String, Path, description = "Organization name")),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = SourcesResponse),
        (status = 403, description = "Forbidden", content_type = "application/json", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Security", "operation": "list"})),
        ("x-o2-mcp" = json!({"enabled": false}))
    ),
)]
pub async fn list_sources(
    Path(org_id): Path<String>,
    Headers(user_email): Headers<UserEmail>,
) -> Response {
    let user_id = user_email.user_id;
    if let Err(denied) = require(&org_id, &user_id, "GET").await {
        return denied;
    }
    let (streams, streams_readable) = match readable_streams(&org_id, &user_id).await {
        Ok(found) => found,
        Err(denied) => return denied,
    };
    let now = now_micros();
    let recount: Vec<&str> = streams
        .iter()
        .filter(|s| {
            o2_enterprise::enterprise::security::sources::selection::source_reason(
                s.settings.security.as_ref(),
            )
            .is_some()
                && needs_recount_for(&org_id, &s.name, activity_of(s), now)
        })
        .map(|s| s.name.as_str())
        .collect();
    let mut counts: HashMap<String, Activity> = HashMap::new();
    for chunk in recount.chunks(CONCURRENCY) {
        let counted = futures::future::join_all(
            chunk
                .iter()
                .map(|name| recent_activity(&org_id, &user_id, name, now)),
        )
        .await;
        for (name, activity) in chunk.iter().zip(counted) {
            if let Some(activity) = activity {
                record_recount(&org_id, name, activity, now);
                counts.insert(name.to_string(), activity);
            }
        }
    }
    let inputs: Vec<StreamInput<'_>> = streams
        .iter()
        .map(|s| {
            let stats = activity_of(s);
            StreamInput {
                name: &s.name,
                setting: s.settings.security.as_ref(),
                activity: counts
                    .get(&s.name)
                    .and_then(|c| with_recent_count(stats, c.doc_num, c.doc_time_max))
                    .unwrap_or(stats),
            }
        })
        .collect();
    let pipelines = readable_pipelines(&org_id, &user_id).await;
    Json(SourcesResponse {
        listing: build_listing(&org_id, &inputs, pipelines.as_deref(), now),
        streams_readable,
    })
    .into_response()
}

/// ListSecuritySourceTypes
#[utoipa::path(
    get,
    path = "/{org_id}/security/sources/types",
    context_path = "/api",
    tag = "Security",
    operation_id = "ListSecuritySourceTypes",
    summary = "List the Security source types",
    description = "The built-in source-type catalog: field fingerprints, Sigma logsources and OCSF field maps; holds no org data",
    security(("Authorization" = [])),
    params(("org_id" = String, Path, description = "Organization name")),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = Vec<SourceType>),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Security", "operation": "list"})),
        ("x-o2-mcp" = json!({"enabled": false}))
    ),
)]
pub async fn list_source_types(
    Path(org_id): Path<String>,
    Headers(user_email): Headers<UserEmail>,
) -> Response {
    if let Err(denied) = require(&org_id, &user_email.user_id, "GET").await {
        return denied;
    }
    Json(source_types()).into_response()
}

/// MatchSecuritySource
#[utoipa::path(
    post,
    path = "/{org_id}/security/sources/match",
    context_path = "/api",
    tag = "Security",
    operation_id = "MatchSecuritySource",
    summary = "Classify fields as a source type",
    description = "The best source type for a field list and an optional sample row the caller already holds; reads and stores nothing",
    security(("Authorization" = [])),
    params(("org_id" = String, Path, description = "Organization name")),
    request_body(content = MatchRequest, content_type = "application/json"),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = MatchResponse),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Security", "operation": "get"})),
        ("x-o2-mcp" = json!({"enabled": false}))
    ),
)]
pub async fn match_source(
    Path(org_id): Path<String>,
    Headers(user_email): Headers<UserEmail>,
    Json(req): Json<MatchRequest>,
) -> Response {
    if let Err(denied) = require(&org_id, &user_email.user_id, "GET").await {
        return denied;
    }
    let classification = best_match(&req.fields, req.sample.as_ref());
    let is_security = is_security_source(classification.as_ref());
    let severity = severity_sql(classification.as_ref().map(|c| c.source), &req.fields);
    Json(MatchResponse {
        classification,
        is_security,
        severity,
    })
    .into_response()
}

/// ClassifySecuritySources
#[utoipa::path(
    post,
    path = "/{org_id}/security/sources/classify",
    context_path = "/api",
    tag = "Security",
    operation_id = "ClassifySecuritySources",
    summary = "Classify streams and store the verdicts",
    description = "Samples each stream's last day with the caller's permissions, classifies it, and stores the verdict when it beats the stored one by the stability margin",
    security(("Authorization" = [])),
    params(("org_id" = String, Path, description = "Organization name")),
    request_body(content = ClassifyRequest, content_type = "application/json"),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = ClassifyResponse),
        (status = 403, description = "Forbidden", content_type = "application/json", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Security", "operation": "update"})),
        ("x-o2-mcp" = json!({"enabled": false}))
    ),
)]
pub async fn classify_sources(
    Path(org_id): Path<String>,
    Headers(user_email): Headers<UserEmail>,
    body: Option<Json<ClassifyRequest>>,
) -> Response {
    let user_id = user_email.user_id;
    if let Err(denied) = require(&org_id, &user_id, "POST").await {
        return denied;
    }
    let wanted = body.map(|Json(b)| b.streams).unwrap_or_default();
    let streams = match readable_streams(&org_id, &user_id).await {
        Ok((streams, _)) => streams,
        Err(denied) => return denied,
    };
    let now = now_micros();
    let memo = CLASSIFY_MEMO.lock().unwrap().clone();
    let candidates: Vec<ClassifyCandidate<'_>> = streams
        .iter()
        .filter(|s| wanted.is_empty() || wanted.contains(&s.name))
        .map(|s| ClassifyCandidate {
            stream: StreamRef {
                name: &s.name,
                setting: s.settings.security.as_ref(),
            },
            created_at: s.stats.created_at,
            doc_num: s.stats.doc_num,
            memo: if wanted.is_empty() {
                memo.get(&(org_id.clone(), s.name.clone())).copied()
            } else {
                None
            },
        })
        .collect();
    let queue: Vec<&common::meta::stream::Stream> = classify_queue(&org_id, &candidates, now)
        .into_iter()
        .filter_map(|name| streams.iter().find(|s| s.name == name))
        .collect();
    let mut classified: Vec<ClassifyResult> = Vec::with_capacity(queue.len());
    for chunk in queue.chunks(CONCURRENCY) {
        let results = futures::future::join_all(
            chunk
                .iter()
                .map(|stream| classify_one(&org_id, &user_id, stream, now)),
        )
        .await;
        classified.extend(results.into_iter().flatten());
    }
    Json(ClassifyResponse { classified }).into_response()
}

/// AttachSecuritySourcePack
#[utoipa::path(
    post,
    path = "/{org_id}/security/sources/{stream_name}/attach",
    context_path = "/api",
    tag = "Security",
    operation_id = "AttachSecuritySourcePack",
    summary = "Attach an OCSF pack to a stream",
    description = "Creates the pack's function and adds it to the stream's realtime pipeline, or creates one, with the caller's own function and pipeline permissions, then records the pack on the stream; with dry_run it only returns the plan",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("stream_name" = String, Path, description = "Logs stream name"),
    ),
    request_body(content = AttachRequest, content_type = "application/json"),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = AttachResponse),
        (status = 403, description = "Missing Security, function or pipeline permission", content_type = "application/json", body = AttachError),
        (status = 409, description = "Blocked or conflicting pipeline", content_type = "application/json", body = AttachError),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Security", "operation": "update"})),
        ("x-o2-mcp" = json!({"enabled": false}))
    ),
)]
pub async fn attach_pack(
    Path((org_id, stream_name)): Path<(String, String)>,
    Headers(user_email): Headers<UserEmail>,
    body: Option<Json<AttachRequest>>,
) -> Response {
    let user_id = user_email.user_id;
    if let Err(denied) = require(&org_id, &user_id, "POST").await {
        return denied;
    }
    let req = body.map(|Json(b)| b).unwrap_or_default();
    let lock = stream_lock(&org_id, &stream_name);
    let _guard = lock.lock().await;
    match attach(&org_id, &user_id, &stream_name, req).await {
        Ok(res) => Json(res).into_response(),
        Err(resp) => resp,
    }
}

/// DetachSecuritySourcePack
#[utoipa::path(
    post,
    path = "/{org_id}/security/sources/{stream_name}/detach",
    context_path = "/api",
    tag = "Security",
    operation_id = "DetachSecuritySourcePack",
    summary = "Detach a stream's OCSF pack",
    description = "Removes the pack's node from the stream's pipeline, or deletes the pipeline the SIEM created for it, with the caller's own pipeline permissions, then clears the pack record",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("stream_name" = String, Path, description = "Logs stream name"),
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = DetachResponse),
        (status = 403, description = "Missing Security or pipeline permission", content_type = "application/json", body = AttachError),
        (status = 404, description = "No pack attached", content_type = "application/json", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Security", "operation": "delete"})),
        ("x-o2-mcp" = json!({"enabled": false}))
    ),
)]
pub async fn detach_pack(
    Path((org_id, stream_name)): Path<(String, String)>,
    Headers(user_email): Headers<UserEmail>,
) -> Response {
    let user_id = user_email.user_id;
    if let Err(denied) = require(&org_id, &user_id, "DELETE").await {
        return denied;
    }
    let lock = stream_lock(&org_id, &stream_name);
    let _guard = lock.lock().await;
    match detach(&org_id, &user_id, &stream_name).await {
        Ok(res) => Json(res).into_response(),
        Err(resp) => resp,
    }
}

async fn require(org_id: &str, user_id: &str, method: &str) -> Result<(), Response> {
    if security_allowed(org_id, user_id, method).await {
        o2_enterprise::enterprise::security::audit::mark();
        Ok(())
    } else {
        Err(MetaHttpResponse::forbidden(
            "Security sources need the Security permission",
        ))
    }
}

fn stream_lock(org_id: &str, stream: &str) -> Arc<tokio::sync::Mutex<()>> {
    STREAM_LOCKS
        .lock()
        .unwrap()
        .entry(format!("{org_id}/{stream}"))
        .or_default()
        .clone()
}

fn activity_of(stream: &common::meta::stream::Stream) -> Activity {
    Activity {
        doc_num: stream.stats.doc_num,
        doc_time_max: stream.stats.doc_time_max,
    }
}

fn quote_ident(name: &str) -> String {
    format!("\"{}\"", name.replace('"', "\"\""))
}

fn attach_error(status: StatusCode, err: AttachError) -> Response {
    (status, Json(err)).into_response()
}

fn denied(code: AttachErrorCode, message: &str) -> Response {
    attach_error(StatusCode::FORBIDDEN, AttachError::new(code, message))
}

fn conflict(err: AttachError) -> Response {
    let status = match err.code {
        AttachErrorCode::PermissionDenied | AttachErrorCode::PipelineNoAccess => {
            StatusCode::FORBIDDEN
        }
        AttachErrorCode::UnknownPack => StatusCode::BAD_REQUEST,
        _ => StatusCode::CONFLICT,
    };
    attach_error(status, err)
}

/// The logs streams the caller may read, with settings and stats, and whether it may read any.
async fn readable_streams(
    org_id: &str,
    user_id: &str,
) -> Result<(Vec<common::meta::stream::Stream>, bool), Response> {
    use o2_openfga::meta::mapping::OFGA_MODELS;

    let key = OFGA_MODELS.get("logs").map_or("logs", |model| model.key);
    let permitted =
        openobserve_api_common::auth::validator::list_objects_for_user(org_id, user_id, "GET", key)
            .await
            .map_err(|e| MetaHttpResponse::forbidden(e.to_string()))?;
    // With list_only_permitted off the list above is every stream, so ask what the caller holds.
    let readable = match &permitted {
        Some(names) => any_stream_readable(Some(names)),
        None => db::authz::list_permitted_objects(org_id, user_id, "GET", key)
            .await
            .map_or(true, |held| any_stream_readable(held.as_deref())),
    };
    let unfiltered = permitted.is_none();
    let mut streams: Vec<common::meta::stream::Stream> =
        stream::get_streams(org_id, Some(StreamType::Logs), false, permitted)
            .await
            .into_iter()
            .filter(|s| {
                !config::meta::self_reporting::ai_chat::is_protected_ai_chat_stream(&s.name)
            })
            .collect();
    // An unfiltered list would hand out doc counts and verdicts of streams a search refuses.
    if unfiltered {
        let denied =
            super::unreadable_streams(org_id, user_id, streams.iter().map(|s| s.name.as_str()))
                .await;
        let before = streams.len();
        streams.retain(|s| !denied.contains(&s.name));
        let readable = still_readable(readable, before, streams.len());
        return Ok((streams, readable));
    }
    Ok((streams, readable))
}

/// Whether any stream survived the read check; an org without streams keeps the grant's answer.
fn still_readable(readable: bool, before: usize, after: usize) -> bool {
    readable && (before == 0 || after > 0)
}

/// `None` is an unrestricted read; a list grants only the streams it names.
fn any_stream_readable(permitted: Option<&[String]>) -> bool {
    permitted.is_none_or(|names| !names.is_empty())
}

/// The org's pipelines the caller may read, as JSON; `None` when they may read none.
async fn readable_pipelines(org_id: &str, user_id: &str) -> Option<Vec<Value>> {
    use o2_openfga::meta::mapping::OFGA_MODELS;

    let key = OFGA_MODELS
        .get("pipelines")
        .map_or("pipelines", |model| model.key);
    let permitted =
        openobserve_api_common::auth::validator::list_objects_for_user(org_id, user_id, "GET", key)
            .await
            .ok()?;
    let list = pipeline_service::list_user_pipelines(org_id, permitted)
        .await
        .ok()?;
    Some(
        list.iter()
            .filter_map(|p| serde_json::to_value(p).ok())
            .collect(),
    )
}

/// Readable or not, so an unreadable realtime pipeline is never mistaken for none.
async fn all_pipelines(org_id: &str) -> Result<Vec<Value>, Response> {
    let list = pipeline_service::list_user_pipelines(org_id, None)
        .await
        .map_err(Response::from)?;
    Ok(list
        .iter()
        .filter_map(|p| serde_json::to_value(p).ok())
        .collect())
}

async fn can(org_id: &str, user_id: &str, object_type: &str, method: &str, id: &str) -> bool {
    check_permissions(
        id,
        org_id,
        user_id,
        object_type,
        method,
        None,
        id == org_id,
        false,
        true,
    )
    .await
}

/// Runs `sql` over the stream with the caller's permissions; `None` when it cannot be read.
async fn search_rows(
    org_id: &str,
    user_id: &str,
    stream: &str,
    sql: String,
    start_time: i64,
    end_time: i64,
    size: i64,
) -> Option<Vec<Value>> {
    search_service::check_search_allowed(org_id, Some((stream, StreamType::Logs))).ok()?;
    super::guard_stream_reads(org_id, user_id, [stream])
        .await
        .ok()?;
    let req = SearchRequest {
        query: SearchQuery {
            sql,
            start_time,
            end_time,
            from: 0,
            size,
            track_total_hits: false,
            ..Default::default()
        },
        regions: vec![],
        clusters: vec![],
        timeout: 0,
        use_cache: false,
        ..Default::default()
    };
    let trace_id = config::ider::generate_trace_id();
    search_service::search(
        &trace_id,
        org_id,
        StreamType::Logs,
        Some(user_id.to_string()),
        &req,
    )
    .await
    .ok()
    .map(|res| res.hits)
}

async fn recent_activity(org_id: &str, user_id: &str, stream: &str, now: i64) -> Option<Activity> {
    let sql = format!(
        "SELECT COUNT(*) AS zo_n, MAX(_timestamp) AS zo_last FROM {}",
        quote_ident(stream)
    );
    let hits = search_rows(
        org_id,
        user_id,
        stream,
        sql,
        now - ACTIVITY_LOOKBACK_US,
        now,
        1,
    )
    .await?;
    let row = hits.first()?;
    Some(Activity {
        doc_num: row.get("zo_n").and_then(Value::as_i64).unwrap_or(0),
        doc_time_max: row.get("zo_last").and_then(Value::as_i64).unwrap_or(0),
    })
}

async fn classify_one(
    org_id: &str,
    user_id: &str,
    stream: &common::meta::stream::Stream,
    now: i64,
) -> Option<ClassifyResult> {
    let schema = infra::schema::get(org_id, &stream.name, StreamType::Logs)
        .await
        .ok()?;
    let fields: Vec<String> = schema.fields().iter().map(|f| f.name().clone()).collect();
    let sql = format!("SELECT * FROM {}", quote_ident(&stream.name));
    let samples: Vec<Map<String, Value>> = search_rows(
        org_id,
        user_id,
        &stream.name,
        sql,
        now - SAMPLE_WINDOW_US,
        now,
        SAMPLE_ROWS,
    )
    .await
    .unwrap_or_default()
    .into_iter()
    .filter_map(|row| match row {
        Value::Object(map) => Some(map),
        _ => None,
    })
    .collect();
    let sampled = !samples.is_empty();
    let verdict = judge_stream(&fields, &samples).unwrap_or_else(unmatched_verdict);
    CLASSIFY_MEMO.lock().unwrap().insert(
        (org_id.to_string(), stream.name.clone()),
        ClassifyMemo {
            created_at: stream.stats.created_at,
            sampled,
            at: now,
        },
    );
    let current = infra::schema::get_settings(org_id, &stream.name, StreamType::Logs)
        .await
        .and_then(|s| s.security.clone());
    let stored = match verdict_update(current.as_ref(), &verdict) {
        Some(update) => store_setting(org_id, user_id, &stream.name, update)
            .await
            .is_ok(),
        None => false,
    };
    Some(ClassifyResult {
        stream: stream.name.clone(),
        verdict,
        sampled,
        stored,
    })
}

/// Refuses a setting write before any side effect; the route's own Security grant authorized it.
async fn check_setting(
    org_id: &str,
    user_id: &str,
    stream_name: &str,
    setting: &SecuritySourceSetting,
) -> Result<(), Response> {
    let update = UpdateStreamSettings {
        security: Some(Some(setting.clone())),
        ..Default::default()
    };
    super::streams::guard_settings_update(org_id, user_id, stream_name, StreamType::Logs, &update)
        .await?;
    o2_enterprise::enterprise::security::sources::validate(setting)
        .map_err(MetaHttpResponse::bad_request)
}

/// Stores a stream's security setting with the same checks, stamp and audit as a settings update.
async fn store_setting(
    org_id: &str,
    user_id: &str,
    stream_name: &str,
    setting: SecuritySourceSetting,
) -> Result<SecuritySourceSetting, Response> {
    check_setting(org_id, user_id, stream_name, &setting).await?;
    let (stored, change) = crate::request::stream::plan_security_setting(
        org_id,
        stream_name,
        StreamType::Logs,
        user_id,
        Some(setting),
    )
    .await?;
    let update = UpdateStreamSettings {
        security: Some(stored.clone()),
        ..Default::default()
    };
    let resp = stream::update_stream_settings(org_id, stream_name, StreamType::Logs, update)
        .await
        .map_err(MetaHttpResponse::internal_error)?;
    if resp.status() != StatusCode::OK {
        return Err(resp);
    }
    if let Some(change) = change {
        crate::request::stream::audit_security_change(org_id, stream_name, user_id, change).await;
    }
    Ok(stored.unwrap_or_default())
}

fn new_id() -> String {
    uuid::Uuid::new_v4().to_string()
}

async fn attach(
    org_id: &str,
    user_id: &str,
    stream_name: &str,
    req: AttachRequest,
) -> Result<AttachResponse, Response> {
    let Some(settings) = infra::schema::get_settings(org_id, stream_name, StreamType::Logs).await
    else {
        return Err(MetaHttpResponse::not_found("Stream not found"));
    };
    let current = settings.security.clone();
    let source_type = current
        .as_ref()
        .map(|s| s.source_type.clone())
        .unwrap_or_default();
    let pack = match (req.pack_id.as_deref(), req.pack_version) {
        (Some(id), Some(version)) => find_pack(id, version),
        (Some(id), None) => o2_enterprise::enterprise::security::ocsf::packs()
            .iter()
            .filter(|p| p.manifest.id == id)
            .max_by_key(|p| p.manifest.version),
        _ => offered_pack(&source_type),
    }
    .ok_or_else(|| {
        conflict(AttachError::new(
            AttachErrorCode::UnknownPack,
            "Unknown OCSF pack",
        ))
    })?;

    for (object_type, method) in [
        ("functions", "POST"),
        ("pipelines", "POST"),
        ("pipelines", "PUT"),
    ] {
        if !can(org_id, user_id, object_type, method, org_id).await {
            return Err(denied(
                AttachErrorCode::PermissionDenied,
                "You need permission to edit functions and pipelines for this stream.",
            ));
        }
    }

    let checks = StreamForChecks {
        flatten_level: settings.flatten_level,
        defined_schema_fields: Some(settings.defined_schema_fields.clone()),
    };
    let cfg = AttachConfig {
        global_flatten_level: config::get_config().limit.ingest_flatten_level as i64,
        ..Default::default()
    };
    let pipelines = all_pipelines(org_id).await?;
    let existing = realtime_pipelines_for(&pipelines, stream_name)
        .first()
        .map(|p| (*p).clone());
    let blocks = pre_attach_checks(&checks, existing.as_ref(), &cfg);
    if !blocks.is_empty() {
        return Err(conflict(AttachError {
            blocks,
            ..AttachError::new(
                AttachErrorCode::Blocked,
                "This stream cannot take a pack as configured.",
            )
        }));
    }
    if let Some(pipeline) = existing.as_ref()
        && !can(org_id, user_id, "pipelines", "PUT", pipeline_id(pipeline)).await
    {
        return Err(denied(
            AttachErrorCode::PipelineNoAccess,
            "This stream has a pipeline you don't have access to.",
        ));
    }

    // The pipeline id is unknown until it is created; a fresh one validates as the real one will.
    let planned_pipeline = existing
        .as_ref()
        .map_or_else(config::ider::generate, |p| pipeline_id(p).to_string());
    let planned = attached_setting(
        current.as_ref(),
        pack,
        &source_type,
        &planned_pipeline,
        existing.is_none(),
        true,
        now_micros(),
    );
    check_setting(org_id, user_id, stream_name, &planned).await?;

    let name = function_name(pack, stream_name);
    let program = entity_program(&pack.vrl, stream_name);
    let stored = db::functions::get(org_id, &name)
        .await
        .ok()
        .map(|f| f.function);
    let plan = plan_attach(
        pack,
        stream_name,
        stored.as_deref(),
        existing.as_ref(),
        &checks,
        &cfg,
    )
    .map_err(conflict)?;
    if req.dry_run {
        return Ok(AttachResponse {
            setting: planned,
            pipeline_id: plan.pipeline_id.clone(),
            pipeline_created: existing.is_none(),
            plan,
            dry_run: true,
        });
    }
    ensure_function(org_id, user_id, &name, &program).await?;

    let check = StreamReadCheck { org_id, user_id };
    let (pipeline_id, created) = match existing {
        Some(pipeline) => (pipeline_id(&pipeline).to_string(), false),
        None => create_pipeline(org_id, stream_name, pack, &name, &check).await?,
    };
    if !created {
        extend_pipeline(
            org_id,
            &pipeline_id,
            pack,
            &checks,
            stream_name,
            &cfg,
            &check,
        )
        .await?;
    }
    let setting = attached_setting(
        current.as_ref(),
        pack,
        &source_type,
        &pipeline_id,
        created,
        true,
        now_micros(),
    );
    let setting = store_setting(org_id, user_id, stream_name, setting).await?;
    Ok(AttachResponse {
        setting,
        pipeline_id,
        pipeline_created: created,
        plan,
        dry_run: false,
    })
}

async fn ensure_function(
    org_id: &str,
    user_id: &str,
    name: &str,
    program: &str,
) -> Result<(), Response> {
    let stored = || async {
        db::functions::get(org_id, name)
            .await
            .ok()
            .map(|f| f.function)
    };
    let FunctionPlan::Create { name, program } =
        plan_function(stored().await.as_deref(), name, program).map_err(conflict)?
    else {
        return Ok(());
    };
    let transform = Transform {
        function: program.clone(),
        name: name.clone(),
        params: "row".to_string(),
        num_args: 0,
        trans_type: Some(0),
        streams: None,
    };
    let check = StreamReadCheck { org_id, user_id };
    let resp = openobserve_core::functions::save_function_checked(
        org_id.to_string(),
        transform,
        Some(&check),
    )
    .await
    .map_err(|e| MetaHttpResponse::internal_error(e.to_string()))?;
    if resp.status() == StatusCode::OK {
        return Ok(());
    }
    // A parallel attach may have created it first; that is fine when the text is ours.
    match stored().await {
        Some(after) => plan_function(Some(&after), &name, &program)
            .map(|_| ())
            .map_err(conflict),
        None => Err(resp),
    }
}

async fn create_pipeline(
    org_id: &str,
    stream_name: &str,
    pack: &o2_enterprise::enterprise::security::ocsf::OcsfPack,
    function: &str,
    check: &StreamReadCheck<'_>,
) -> Result<(String, bool), Response> {
    let node = our_node(
        &pack.manifest.id,
        pack.manifest.version,
        function,
        100.0,
        100.0,
        new_id(),
    );
    let mut next = new_id;
    let json = new_pipeline(org_id, stream_name, node, &mut next);
    let mut pipeline: Pipeline = serde_json::from_value(json)
        .map_err(|e| MetaHttpResponse::internal_error(e.to_string()))?;
    pipeline.id = config::ider::generate();
    pipeline.name = pipeline.name.trim().to_lowercase();
    pipeline.org = org_id.to_string();
    let mine = pipeline.id.clone();
    match pipeline_service::save_user_pipeline_checked(pipeline, Some(check)).await {
        Ok(()) => {}
        Err(PipelineError::StreamInUse) => {
            let list = all_pipelines(org_id).await?;
            let found = realtime_pipelines_for(&list, stream_name);
            if found.is_empty() {
                return Err(PipelineError::StreamInUse.into());
            }
            return Ok((pick_winner(&found).to_string(), false));
        }
        Err(e) => return Err(e.into()),
    }
    // The in-use check is read-then-insert, so two parallel creates can both land; keep one.
    let list = all_pipelines(org_id).await?;
    let found = realtime_pipelines_for(&list, stream_name);
    if found.len() > 1 {
        let winner = pick_winner(&found).to_string();
        if winner != mine {
            let _ = pipeline_service::delete_user_pipeline(org_id, &mine).await;
        }
        let created = winner == mine;
        return Ok((winner, created));
    }
    Ok((mine, true))
}

async fn extend_pipeline(
    org_id: &str,
    id: &str,
    pack: &o2_enterprise::enterprise::security::ocsf::OcsfPack,
    checks: &StreamForChecks,
    stream_name: &str,
    cfg: &AttachConfig,
    check: &StreamReadCheck<'_>,
) -> Result<(), Response> {
    for attempt in 0..2 {
        let pipeline = pipeline_service::get_user_pipeline(org_id, id)
            .await
            .map_err(Response::from)?;
        let json = serde_json::to_value(&pipeline)
            .map_err(|e| MetaHttpResponse::internal_error(e.to_string()))?;
        let mut next = new_id;
        let ExtendPlan::Update(json) =
            plan_extend(&json, pack, checks, stream_name, Some(cfg), &mut next)
                .map_err(conflict)?
        else {
            return Ok(());
        };
        let updated: Pipeline = serde_json::from_value(json)
            .map_err(|e| MetaHttpResponse::internal_error(e.to_string()))?;
        match pipeline_service::update_user_pipeline_checked(org_id, updated, Some(check)).await {
            Ok(()) => return Ok(()),
            // A stale version is retried once against the reloaded pipeline, which is re-checked.
            Err(PipelineError::Modified(_)) if attempt == 0 => continue,
            Err(e) => return Err(e.into()),
        }
    }
    Ok(())
}

async fn detach(
    org_id: &str,
    user_id: &str,
    stream_name: &str,
) -> Result<DetachResponse, Response> {
    let current = infra::schema::get_settings(org_id, stream_name, StreamType::Logs)
        .await
        .and_then(|s| s.security.clone());
    let pipelines = all_pipelines(org_id).await?;
    let realtime = realtime_pipelines_for(&pipelines, stream_name)
        .first()
        .map(|p| (*p).clone());
    let Some(target) = detach_target(current.as_ref(), realtime.as_ref()) else {
        return Err(MetaHttpResponse::not_found(
            "No OCSF pack is attached to this stream",
        ));
    };
    if let Some(current) = current.as_ref() {
        check_setting(
            org_id,
            user_id,
            stream_name,
            &detached_setting(current, now_micros()),
        )
        .await?;
    }
    let mut skipped = None;
    if !target.pipeline_id.is_empty() {
        let recorded = pipeline_service::get_user_pipeline(org_id, &target.pipeline_id)
            .await
            .ok()
            .and_then(|p| serde_json::to_value(&p).ok());
        match plan_detach(recorded.as_ref(), &target, stream_name) {
            DetachPlan::Skip(reason) => {
                skipped = Some(DetachSkip {
                    pipeline_id: target.pipeline_id.clone(),
                    reason,
                });
            }
            DetachPlan::DeletePipeline => {
                if !can(org_id, user_id, "pipelines", "DELETE", &target.pipeline_id).await {
                    return Err(denied(
                        AttachErrorCode::PermissionDenied,
                        "You need permission to delete this stream's pipeline.",
                    ));
                }
                pipeline_service::delete_user_pipeline(org_id, &target.pipeline_id)
                    .await
                    .map_err(Response::from)?;
            }
            DetachPlan::Update(json) => {
                if !can(org_id, user_id, "pipelines", "PUT", &target.pipeline_id).await {
                    return Err(denied(
                        AttachErrorCode::PermissionDenied,
                        "You need permission to edit this stream's pipeline.",
                    ));
                }
                let updated: Pipeline = serde_json::from_value(json)
                    .map_err(|e| MetaHttpResponse::internal_error(e.to_string()))?;
                let check = StreamReadCheck { org_id, user_id };
                pipeline_service::update_user_pipeline_checked(org_id, updated, Some(&check))
                    .await
                    .map_err(Response::from)?;
            }
        }
    }
    // An undecided stream with an unrecorded node must not gain a setting it never had.
    let setting = match current.as_ref() {
        Some(current) => Some(
            store_setting(
                org_id,
                user_id,
                stream_name,
                detached_setting(current, now_micros()),
            )
            .await?,
        ),
        None => None,
    };
    let function = setting_function_name(&target, stream_name);
    if can(org_id, user_id, "functions", "DELETE", &function).await {
        // A function another pipeline still uses refuses deletion; detach succeeds either way.
        let _ = openobserve_core::functions::delete_function(org_id, &function).await;
    }
    Ok(DetachResponse { setting, skipped })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_any_stream_readable() {
        assert!(any_stream_readable(None));
        assert!(any_stream_readable(Some(&["logs:okta".to_string()])));
        assert!(!any_stream_readable(Some(&[])));
    }

    #[test]
    fn test_a_caller_left_with_no_stream_reads_none() {
        assert!(still_readable(true, 3, 1));
        assert!(!still_readable(true, 3, 0));
        assert!(still_readable(true, 0, 0));
        assert!(!still_readable(false, 0, 0));
    }

    #[test]
    fn test_sources_response_flattens_the_listing() {
        let body = serde_json::to_value(SourcesResponse {
            listing: SourceListing::default(),
            streams_readable: false,
        })
        .unwrap();
        assert_eq!(body["streams_readable"], false);
        assert!(body["streams"].as_array().unwrap().is_empty());
        assert!(body.get("listing").is_none());
    }

    #[test]
    fn test_quote_ident_escapes_quotes() {
        assert_eq!(quote_ident("web"), "\"web\"");
        assert_eq!(quote_ident("a\"b"), "\"a\"\"b\"");
    }

    #[test]
    fn test_conflict_statuses() {
        let status = |code| conflict(AttachError::new(code, "x")).status();
        assert_eq!(
            status(AttachErrorCode::PipelineNoAccess),
            StatusCode::FORBIDDEN
        );
        assert_eq!(
            status(AttachErrorCode::PermissionDenied),
            StatusCode::FORBIDDEN
        );
        assert_eq!(
            status(AttachErrorCode::UnknownPack),
            StatusCode::BAD_REQUEST
        );
        assert_eq!(status(AttachErrorCode::Blocked), StatusCode::CONFLICT);
        assert_eq!(
            status(AttachErrorCode::FunctionEditedOutside),
            StatusCode::CONFLICT
        );
    }

    #[tokio::test]
    async fn test_a_stranger_cannot_use_the_routes() {
        let stranger = format!("{}@example.com", config::ider::uuid());
        for method in ["GET", "PUT", "POST", "DELETE"] {
            let refused = require("org", &stranger, method).await.unwrap_err();
            assert_eq!(refused.status(), StatusCode::FORBIDDEN);
        }
    }

    #[test]
    fn test_stream_lock_is_shared_per_stream() {
        let a = stream_lock("o", "s");
        let b = stream_lock("o", "s");
        let c = stream_lock("o", "t");
        assert!(Arc::ptr_eq(&a, &b));
        assert!(!Arc::ptr_eq(&a, &c));
    }

    mod end_to_end {
        use common::meta::stream::StreamCreate;
        use config::meta::{
            stream::{StreamField, StreamSettings},
            user::UserRole,
        };

        use super::*;
        use crate::request::security::tests::{grant, meta_store};

        /// A fresh org's logs stream, and a root user whose Security grants are only `security`.
        async fn org_with_stream(security: &[&'static str]) -> (String, String) {
            use common::infra::config::{ORG_USERS, USERS};

            meta_store().await;
            let org = format!("srcs{}", &config::ider::uuid().replace('-', "")[..10]);
            let user = format!("author-{org}@example.com");
            USERS.insert(
                user.clone(),
                infra::table::users::UserRecord {
                    email: user.clone(),
                    first_name: "A".to_string(),
                    last_name: "U".to_string(),
                    password: "hash".to_string(),
                    salt: "salt".to_string(),
                    is_root: false,
                    password_ext: None,
                    user_type: config::meta::user::UserType::Internal,
                    created_at: 0,
                    updated_at: 0,
                    must_reset_password: false,
                    password_reset_reason: None,
                    flagged_at: None,
                    password_updated_at: None,
                },
            );
            for (member_of, role) in [
                (org.as_str(), UserRole::Admin),
                (config::DEFAULT_ORG, UserRole::Root),
            ] {
                ORG_USERS.insert(
                    format!("{member_of}/{user}"),
                    infra::table::org_users::OrgUserRecord::new(
                        member_of, &user, role, "token", None,
                    ),
                );
            }
            grant(&user, security);
            openobserve_core::authz::fake_checker().grant_read(
                &user,
                &openobserve_core::authz::TypedStream {
                    org_id: org.clone(),
                    stream_type: StreamType::Logs,
                    name: "web".to_string(),
                },
            );
            let created = stream::create_stream(
                &org,
                "web",
                StreamType::Logs,
                StreamCreate {
                    fields: vec![StreamField {
                        name: "message".to_string(),
                        r#type: "Utf8".to_string(),
                    }],
                    settings: StreamSettings::default(),
                },
            )
            .await
            .unwrap();
            assert_eq!(created.status(), StatusCode::OK);
            (org, user)
        }

        fn as_user(user: &str) -> Headers<UserEmail> {
            Headers(UserEmail {
                user_id: user.to_string(),
            })
        }

        async fn stored(org: &str) -> Option<SecuritySourceSetting> {
            infra::schema::get_settings(org, "web", StreamType::Logs)
                .await
                .and_then(|s| s.security.clone())
        }

        async fn functions_and_pipelines(org: &str) -> (usize, usize) {
            let functions = db::functions::list(org).await.unwrap_or_default().len();
            let pipelines = all_pipelines(org).await.map(|p| p.len()).unwrap_or(0);
            (functions, pipelines)
        }

        async fn assert_status(resp: Response, want: StatusCode) {
            let status = resp.status();
            let body = axum::body::to_bytes(resp.into_body(), usize::MAX)
                .await
                .unwrap();
            assert_eq!(status, want, "{}", String::from_utf8_lossy(&body));
        }

        fn entity_pack() -> AttachRequest {
            AttachRequest {
                pack_id: Some("entity".to_string()),
                pack_version: None,
                dry_run: false,
            }
        }

        async fn body_json(resp: Response) -> (StatusCode, Value) {
            let status = resp.status();
            let body = axum::body::to_bytes(resp.into_body(), usize::MAX)
                .await
                .unwrap();
            (status, serde_json::from_slice(&body).unwrap_or(Value::Null))
        }

        #[tokio::test]
        async fn test_a_dry_run_returns_the_plan_and_writes_nothing() {
            let (org, user) = org_with_stream(&["GET", "POST"]).await;
            let resp = attach_pack(
                Path((org.clone(), "web".to_string())),
                as_user(&user),
                Some(Json(AttachRequest {
                    dry_run: true,
                    ..entity_pack()
                })),
            )
            .await;
            let (status, body) = body_json(resp).await;
            assert_eq!(status, StatusCode::OK, "{body}");
            assert_eq!(body["dry_run"], true);
            assert_eq!(body["plan"]["pack_id"], "entity");
            assert_eq!(body["plan"]["function_action"], "create");
            assert_eq!(body["plan"]["pipeline_action"], "create");
            assert_eq!(body["plan"]["ocsf_classes"], serde_json::json!([0]));
            assert_eq!(functions_and_pipelines(&org).await, (0, 0));
            assert!(stored(&org).await.is_none_or(|s| s.pack_id.is_empty()));
        }

        #[tokio::test]
        async fn test_detach_reports_a_recorded_pipeline_it_left_alone() {
            let (org, user) = org_with_stream(&["GET", "POST", "DELETE"]).await;
            let attached = attach_pack(
                Path((org.clone(), "web".to_string())),
                as_user(&user),
                Some(Json(entity_pack())),
            )
            .await;
            let (_, attached) = body_json(attached).await;
            let pipeline = attached["pipeline_id"].as_str().unwrap().to_string();
            pipeline_service::delete_user_pipeline(&org, &pipeline)
                .await
                .unwrap();
            let resp = detach_pack(Path((org.clone(), "web".to_string())), as_user(&user)).await;
            let (status, body) = body_json(resp).await;
            assert_eq!(status, StatusCode::OK, "{body}");
            assert_eq!(body["skipped"]["pipeline_id"], pipeline.as_str());
            assert_eq!(body["skipped"]["reason"], "pipeline_missing");
        }

        #[tokio::test]
        async fn test_an_author_without_triage_attaches_and_the_setting_is_stored() {
            let (org, user) = org_with_stream(&["GET", "POST"]).await;
            let resp = attach_pack(
                Path((org.clone(), "web".to_string())),
                as_user(&user),
                Some(Json(entity_pack())),
            )
            .await;
            assert_status(resp, StatusCode::OK).await;
            let setting = stored(&org).await.expect("the attach stored the setting");
            assert_eq!(setting.pack_id, "entity");
            assert_eq!(setting.updated_by, user);
            assert_eq!(functions_and_pipelines(&org).await, (1, 1));
        }

        #[tokio::test]
        async fn test_an_admin_without_triage_detaches() {
            let (org, user) = org_with_stream(&["GET", "POST", "DELETE"]).await;
            let attached = attach_pack(
                Path((org.clone(), "web".to_string())),
                as_user(&user),
                Some(Json(entity_pack())),
            )
            .await;
            assert_status(attached, StatusCode::OK).await;
            grant(&user, &["DELETE"]);
            let resp = detach_pack(Path((org.clone(), "web".to_string())), as_user(&user)).await;
            let (status, body) = body_json(resp).await;
            assert_eq!(status, StatusCode::OK, "{body}");
            assert!(body["skipped"].is_null());
            let setting = stored(&org).await.expect("the detach kept the setting");
            assert!(setting.pack_id.is_empty());
            assert_eq!(functions_and_pipelines(&org).await.1, 0);
        }

        #[tokio::test]
        async fn test_a_refused_setting_leaves_no_function_or_pipeline() {
            let (org, user) = org_with_stream(&["GET", "POST"]).await;
            let invalid = UpdateStreamSettings {
                security: Some(Some(SecuritySourceSetting {
                    confidence: 2.0,
                    ..Default::default()
                })),
                ..Default::default()
            };
            stream::update_stream_settings(&org, "web", StreamType::Logs, invalid)
                .await
                .unwrap();
            let before = functions_and_pipelines(&org).await;
            let resp = attach_pack(
                Path((org.clone(), "web".to_string())),
                as_user(&user),
                Some(Json(entity_pack())),
            )
            .await;
            assert_status(resp, StatusCode::BAD_REQUEST).await;
            assert_eq!(functions_and_pipelines(&org).await, before);
            assert_eq!(before, (0, 0));
        }
    }
}
