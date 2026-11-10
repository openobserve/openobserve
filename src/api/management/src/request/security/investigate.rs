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

use std::collections::{BTreeMap, HashSet};

use axum::{Json, extract::Path, response::Response};
use config::{
    meta::{
        search::{Query as SearchQuery, Request as SearchRequest},
        stream::StreamType,
    },
    utils::json::Value,
};
use futures::{StreamExt, stream};
use o2_enterprise::enterprise::security::investigate::{
    EntityKind, StreamPlan, count,
    cross_stream::{
        HuntQuery, HuntRow, HuntSort, hunt_count_sql, hunt_parts, hunt_sql, to_hunt_row,
    },
    entities::{
        ENTITY_LIMIT, EntityRow, RELATED_LIMIT, RelatedValue, RunWindow, ScoredEntity,
        cooccurrence_sql, entity_agg_sql, entity_timeline_sql, merge_entities, merge_related,
        related_sql, run_window, score_entities,
    },
    risk_graph::{
        CASE_LIMIT, GraphCase, GraphInput, NodeCase, PAIR_LIMIT, RiskGraph, build_risk_graph,
        cases_naming,
    },
    ueba::{
        HOURS_LIMIT, IPS_LIMIT, StreamAgg, UebaReport, UebaRun, UebaWindows, add_case_signals,
        assess, hours_sql, ips_sql, ueba_spans,
    },
    validate_plans,
};
use openobserve_api_common::extractors::Headers;
use openobserve_core::auth::UserEmail;
use search_service as SearchService;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use crate::{
    common::meta::http::HttpResponse as MetaHttpResponse,
    request::alerts::history::validate_history_range,
};

/// Searches in flight at once per request; the search service rejects a flood with 429.
const CONCURRENCY: usize = 4;
/// Most hunt rows one page may ask for.
const MAX_HUNT_PAGE: i64 = 500;

/// A window and the stream plans to read it with.
#[derive(Debug, Clone, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct EntitiesRequest {
    /// Microseconds.
    pub start_time: i64,
    pub end_time: i64,
    pub plans: Vec<StreamPlan>,
    /// Large streams to read over the whole window instead of its last hour.
    #[serde(default)]
    pub full_window: Vec<String>,
}

/// The entities of one kind.
#[derive(Debug, Clone, Default, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct EntityKindResult {
    pub rows: Vec<ScoredEntity>,
    /// Some stream hit the row cap, so only the top entities are shown.
    pub capped: bool,
    /// Peer count at which an entity of this kind counts as spread out.
    pub spread_at: f64,
}

/// How one stream's queries went.
#[derive(Debug, Clone, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct StreamRunStatus {
    pub stream: String,
    pub failed: bool,
    /// The engine answered with part of the data or a function errored.
    pub partial: bool,
    #[serde(flatten)]
    pub window: RunWindow,
}

#[derive(Debug, Clone, Default, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct EntitiesResponse {
    pub user: EntityKindResult,
    pub ip: EntityKindResult,
    pub host: EntityKindResult,
    pub streams: Vec<StreamRunStatus>,
}

#[derive(Debug, Clone, Default, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct EntityGraphResponse {
    #[serde(flatten)]
    pub graph: RiskGraph,
    /// Streams whose queries failed.
    pub failed_streams: Vec<String>,
}

/// One entity's activity and counterparts.
#[derive(Debug, Clone, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct EntityDetailRequest {
    pub start_time: i64,
    pub end_time: i64,
    /// Plans of the streams the entity appears in.
    pub plans: Vec<StreamPlan>,
    #[serde(default)]
    pub full_window: Vec<String>,
    pub kind: EntityKind,
    /// The entity's raw spellings; each matches exactly.
    pub values: Vec<String>,
    /// Histogram bucket, such as `1 hour`.
    pub interval: String,
}

/// Events in one histogram bucket.
#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct TimelineBucket {
    /// The histogram key as the engine returned it.
    #[schema(value_type = Object)]
    pub key: Value,
    pub ok: f64,
    pub failed: f64,
}

#[derive(Debug, Clone, Default, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct EntityDetailResponse {
    pub timeline: Vec<TimelineBucket>,
    pub related: BTreeMap<String, Vec<RelatedValue>>,
    pub failed_streams: Vec<String>,
    /// SIEM cases naming the entity under any spelling, open ones first.
    pub cases: Vec<NodeCase>,
}

/// The current window, the baseline before it, and the plans to read them with.
#[derive(Debug, Clone, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct UebaRequest {
    #[serde(flatten)]
    pub windows: UebaWindows,
    pub plans: Vec<StreamPlan>,
    #[serde(default)]
    pub full_window: Vec<String>,
}

/// One page of a hunt over every planned source.
#[derive(Debug, Clone, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct EventSearchRequest {
    pub start_time: i64,
    pub end_time: i64,
    pub plans: Vec<StreamPlan>,
    pub query: HuntQuery,
    #[serde(default)]
    pub sort: HuntSort,
    #[serde(default)]
    pub from: i64,
    #[serde(default = "default_hunt_size")]
    pub size: i64,
    /// Also count matches per source; a page or sort change can skip it.
    #[serde(default = "default_true")]
    pub count: bool,
}

#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct SourceCount {
    pub stream: String,
    pub n: f64,
}

#[derive(Debug, Clone, Default, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct EventSearchResponse {
    pub rows: Vec<HuntRow>,
    /// Matches over every counted source; absent when not counted.
    pub total: Option<f64>,
    /// Sources with matches, busiest first.
    pub per_source: Vec<SourceCount>,
    /// Sources that could not be counted; their rows may still be in the page.
    pub uncounted: Vec<String>,
    /// False when no planned source has a column to search.
    pub searchable: bool,
}

struct Answer {
    hits: Vec<Value>,
    partial: bool,
}

fn default_hunt_size() -> i64 {
    50
}

fn default_true() -> bool {
    true
}

/// ListSecurityEntities
#[utoipa::path(
    post,
    path = "/{org_id}/security/entities",
    context_path = "/api",
    tag = "Security",
    operation_id = "ListSecurityEntities",
    summary = "Users, IPs and hosts across the Security sources",
    description = "Counts every user, source IP and host in the planned streams over the window, folds each identity's spellings into one row, and flags failures, spread and public addresses; searches run with the caller's own permissions",
    security(("Authorization" = [])),
    params(("org_id" = String, Path, description = "Organization name")),
    request_body(content = EntitiesRequest, content_type = "application/json"),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = EntitiesResponse),
        (status = 400, description = "Bad Request", content_type = "application/json"),
        (status = 403, description = "Forbidden", content_type = "application/json"),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Security", "operation": "list"})),
        ("x-o2-mcp" = json!({"enabled": false}))
    ),
)]
pub async fn list_entities(
    Path(org_id): Path<String>,
    Headers(user_email): Headers<UserEmail>,
    Json(req): Json<EntitiesRequest>,
) -> Response {
    let user_id = user_email.user_id;
    if let Err(resp) = guard(&org_id, &user_id, req.start_time, req.end_time, &req.plans).await {
        return resp;
    }
    let cases = siem_cases(&org_id).await;
    let (response, _) = entities(&org_id, &user_id, &req, &cases).await;
    MetaHttpResponse::json(response)
}

/// GetSecurityEntityGraph
#[utoipa::path(
    post,
    path = "/{org_id}/security/entities/graph",
    context_path = "/api",
    tag = "Security",
    operation_id = "GetSecurityEntityGraph",
    summary = "Risk graph of the Security entities",
    description = "Links users, IPs and hosts that appear in the same stored events or are named by the same SIEM case, and scores each from the cases naming it, its failed events and a capped share of its neighbours' detections",
    security(("Authorization" = [])),
    params(("org_id" = String, Path, description = "Organization name")),
    request_body(content = EntitiesRequest, content_type = "application/json"),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = EntityGraphResponse),
        (status = 400, description = "Bad Request", content_type = "application/json"),
        (status = 403, description = "Forbidden", content_type = "application/json"),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Security", "operation": "get"})),
        ("x-o2-mcp" = json!({"enabled": false}))
    ),
)]
pub async fn get_entity_graph(
    Path(org_id): Path<String>,
    Headers(user_email): Headers<UserEmail>,
    Json(req): Json<EntitiesRequest>,
) -> Response {
    let user_id = user_email.user_id;
    if let Err(resp) = guard(&org_id, &user_id, req.start_time, req.end_time, &req.plans).await {
        return resp;
    }
    let all_cases = siem_cases(&org_id).await;
    let ((table, rows), (pairs, pair_failed)) = futures::join!(
        entities(&org_id, &user_id, &req, &all_cases),
        cooccurrence(&org_id, &user_id, &req),
    );
    let cases: Vec<GraphCase> = all_cases
        .into_iter()
        .filter(|c| c.last_alert_at >= req.start_time)
        .collect();
    let mut failed: HashSet<String> = table
        .streams
        .iter()
        .filter(|s| s.failed)
        .map(|s| s.stream.clone())
        .collect();
    failed.extend(pair_failed);
    let graph = build_risk_graph(&GraphInput {
        rows: rows.iter().map(|(k, r)| (*k, r.as_slice())).collect(),
        cooccurrence: pairs
            .iter()
            .map(|(s, h)| (s.as_str(), h.as_slice()))
            .collect(),
        cases: &cases,
        limit: None,
    });
    let mut failed_streams: Vec<String> = failed.into_iter().collect();
    failed_streams.sort();
    MetaHttpResponse::json(EntityGraphResponse {
        graph,
        failed_streams,
    })
}

/// GetSecurityEntityDetail
#[utoipa::path(
    post,
    path = "/{org_id}/security/entities/detail",
    context_path = "/api",
    tag = "Security",
    operation_id = "GetSecurityEntityDetail",
    summary = "One Security entity's activity and counterparts",
    description = "Events over time, split into ok and failed, and the top related users, IPs and hosts of one entity across every spelling of it",
    security(("Authorization" = [])),
    params(("org_id" = String, Path, description = "Organization name")),
    request_body(content = EntityDetailRequest, content_type = "application/json"),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = EntityDetailResponse),
        (status = 400, description = "Bad Request", content_type = "application/json"),
        (status = 403, description = "Forbidden", content_type = "application/json"),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Security", "operation": "get"})),
        ("x-o2-mcp" = json!({"enabled": false}))
    ),
)]
pub async fn get_entity_detail(
    Path(org_id): Path<String>,
    Headers(user_email): Headers<UserEmail>,
    Json(req): Json<EntityDetailRequest>,
) -> Response {
    let user_id = user_email.user_id;
    if let Err(resp) = guard(&org_id, &user_id, req.start_time, req.end_time, &req.plans).await {
        return resp;
    }
    if let Err(msg) = validate_detail(&req) {
        return MetaHttpResponse::bad_request(msg);
    }
    MetaHttpResponse::json(entity_detail(&org_id, &user_id, &req).await)
}

/// ScoreSecurityUsers
#[utoipa::path(
    post,
    path = "/{org_id}/security/ueba",
    context_path = "/api",
    tag = "Security",
    operation_id = "ScoreSecurityUsers",
    summary = "Per-user behaviour scores against each user's own baseline",
    description = "Scores every user active in the current window against their own baseline window: volume, new IPs, failure jumps, unusual hours and first sightings, with peer outliers while a baseline builds and the signals withheld when the data behind them is incomplete",
    security(("Authorization" = [])),
    params(("org_id" = String, Path, description = "Organization name")),
    request_body(content = UebaRequest, content_type = "application/json"),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = UebaReport),
        (status = 400, description = "Bad Request", content_type = "application/json"),
        (status = 403, description = "Forbidden", content_type = "application/json"),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Security", "operation": "get"})),
        ("x-o2-mcp" = json!({"enabled": false}))
    ),
)]
pub async fn score_users(
    Path(org_id): Path<String>,
    Headers(user_email): Headers<UserEmail>,
    Json(req): Json<UebaRequest>,
) -> Response {
    let user_id = user_email.user_id;
    let w = req.windows;
    if let Err(resp) = guard(
        &org_id,
        &user_id,
        w.baseline_start,
        w.current_end,
        &req.plans,
    )
    .await
    {
        return resp;
    }
    if !(w.baseline_start <= w.current_start && w.current_start < w.current_end) {
        return MetaHttpResponse::bad_request(
            "the baseline must end where the current window starts",
        );
    }
    MetaHttpResponse::json(ueba(&org_id, &user_id, &req).await)
}

/// SearchSecurityEvents
#[utoipa::path(
    post,
    path = "/{org_id}/security/events/search",
    context_path = "/api",
    tag = "Security",
    operation_id = "SearchSecurityEvents",
    summary = "Hunt for a user, IP or host across every Security source",
    description = "Projects each planned source onto common columns, matches a user however each source spells them, and pages and sorts the union on the server, with match counts per source",
    security(("Authorization" = [])),
    params(("org_id" = String, Path, description = "Organization name")),
    request_body(content = EventSearchRequest, content_type = "application/json"),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = EventSearchResponse),
        (status = 400, description = "Bad Request", content_type = "application/json"),
        (status = 403, description = "Forbidden", content_type = "application/json"),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Security", "operation": "list"})),
        ("x-o2-mcp" = json!({"enabled": false}))
    ),
)]
pub async fn search_events(
    Path(org_id): Path<String>,
    Headers(user_email): Headers<UserEmail>,
    Json(req): Json<EventSearchRequest>,
) -> Response {
    let user_id = user_email.user_id;
    if let Err(resp) = guard(&org_id, &user_id, req.start_time, req.end_time, &req.plans).await {
        return resp;
    }
    if req.from < 0 || !(1..=MAX_HUNT_PAGE).contains(&req.size) {
        return MetaHttpResponse::bad_request(format!(
            "from must not be negative and size must be 1 to {MAX_HUNT_PAGE}"
        ));
    }
    match hunt(&org_id, &user_id, &req).await {
        Ok(response) => MetaHttpResponse::json(response),
        Err(e) => MetaHttpResponse::bad_request(e),
    }
}

/// Refuses callers without Security read or read on each planned stream, a closed search gate, or
/// bad input.
async fn guard(
    org_id: &str,
    user_id: &str,
    start_time: i64,
    end_time: i64,
    plans: &[StreamPlan],
) -> Result<(), Response> {
    if !super::security_allowed(org_id, user_id, "GET").await {
        return Err(MetaHttpResponse::forbidden(
            "Security investigation needs the Security permission",
        ));
    }
    if let Err(e) = SearchService::check_org_search_allowed(org_id) {
        return Err(MetaHttpResponse::too_many_requests(e.to_string()));
    }
    validate_history_range(start_time, end_time).map_err(MetaHttpResponse::bad_request)?;
    validate_plans(plans).map_err(MetaHttpResponse::bad_request)?;
    super::guard_stream_reads(org_id, user_id, plans.iter().map(|p| p.stream.as_str())).await
}

/// A bucket size the histogram function takes, such as `5 minute` or `1 hour`.
fn valid_interval(interval: &str) -> bool {
    let Some((n, unit)) = interval.split_once(' ') else {
        return false;
    };
    let unit = unit.strip_suffix('s').unwrap_or(unit);
    !n.is_empty()
        && n.len() <= 6
        && n.bytes().all(|b| b.is_ascii_digit())
        && matches!(unit, "second" | "minute" | "hour" | "day" | "week")
}

fn validate_detail(req: &EntityDetailRequest) -> Result<(), &'static str> {
    if !valid_interval(&req.interval) {
        return Err("interval must look like `1 hour`");
    }
    if req.values.is_empty() || req.values.len() > 100 {
        return Err("values must name 1 to 100 spellings");
    }
    Ok(())
}

/// One search under the caller's own permissions.
async fn run_sql(
    org_id: &str,
    user_id: &str,
    sql: String,
    (start_time, end_time): (i64, i64),
    from: i64,
    size: i64,
) -> Result<Answer, String> {
    let req = SearchRequest {
        query: SearchQuery {
            sql,
            start_time,
            end_time,
            from,
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
    SearchService::search(
        &trace_id,
        org_id,
        StreamType::Logs,
        Some(user_id.to_string()),
        &req,
    )
    .await
    .map(|res| Answer {
        partial: res.is_partial || !res.function_error.is_empty(),
        hits: res.hits,
    })
    .map_err(|e| e.to_string())
}

/// Runs `(tag, sql, window)` jobs a few at a time, keeping each answer with its tag.
async fn run_all<T>(
    org_id: &str,
    user_id: &str,
    jobs: Vec<(T, String, (i64, i64))>,
) -> Vec<(T, Result<Answer, String>)> {
    stream::iter(jobs)
        .map(|(tag, sql, window)| async move {
            (tag, run_sql(org_id, user_id, sql, window, 0, -1).await)
        })
        .buffered(CONCURRENCY)
        .collect()
        .await
}

fn window_of(req: &EntitiesRequest, plan: &StreamPlan) -> RunWindow {
    let full = req.full_window.contains(&plan.stream);
    run_window(plan, req.start_time, req.end_time, full)
}

/// The entity table, and the merged rows per kind the graph reuses.
async fn entities(
    org_id: &str,
    user_id: &str,
    req: &EntitiesRequest,
    cases: &[GraphCase],
) -> (EntitiesResponse, Vec<(EntityKind, Vec<EntityRow>)>) {
    let windows: Vec<RunWindow> = req.plans.iter().map(|p| window_of(req, p)).collect();
    let mut jobs = Vec::new();
    for (i, plan) in req.plans.iter().enumerate() {
        for kind in EntityKind::ALL {
            if let Some(sql) = entity_agg_sql(plan, kind, ENTITY_LIMIT) {
                jobs.push(((i, kind), sql, (windows[i].start_time, windows[i].end_time)));
            }
        }
    }
    let answers = run_all(org_id, user_id, jobs).await;
    let mut statuses: Vec<StreamRunStatus> = req
        .plans
        .iter()
        .zip(&windows)
        .map(|(plan, window)| StreamRunStatus {
            stream: plan.stream.clone(),
            failed: false,
            partial: false,
            window: *window,
        })
        .collect();
    let mut hits: Vec<(usize, EntityKind, Vec<Value>)> = Vec::new();
    for ((i, kind), answer) in answers {
        match answer {
            Ok(a) => {
                statuses[i].partial |= a.partial;
                hits.push((i, kind, a.hits));
            }
            Err(e) => {
                log::warn!("[SIEM] entity query on {} failed: {e}", req.plans[i].stream);
                statuses[i].failed = true;
            }
        }
    }
    let mut response = EntitiesResponse {
        streams: statuses,
        ..Default::default()
    };
    let mut merged = Vec::new();
    for kind in EntityKind::ALL {
        let per: Vec<(&StreamPlan, &[Value])> = hits
            .iter()
            .filter(|(_, k, _)| *k == kind)
            .map(|(i, _, h)| (&req.plans[*i], h.as_slice()))
            .collect();
        let capped = per.iter().any(|(_, h)| h.len() >= ENTITY_LIMIT);
        let rows = merge_entities(&per, Some(kind));
        let (scored, spread_at) = score_entities(kind, rows.clone(), cases);
        let result = EntityKindResult {
            rows: scored,
            capped,
            spread_at,
        };
        match kind {
            EntityKind::User => response.user = result,
            EntityKind::Ip => response.ip = result,
            EntityKind::Host => response.host = result,
        }
        merged.push((kind, rows));
    }
    (response, merged)
}

/// Co-occurrence hits per stream, and the streams whose query failed.
async fn cooccurrence(
    org_id: &str,
    user_id: &str,
    req: &EntitiesRequest,
) -> (Vec<(String, Vec<Value>)>, Vec<String>) {
    let jobs = req
        .plans
        .iter()
        .filter_map(|plan| {
            let sql = cooccurrence_sql(plan, PAIR_LIMIT)?;
            let w = window_of(req, plan);
            Some((plan.stream.clone(), sql, (w.start_time, w.end_time)))
        })
        .collect();
    let mut pairs = Vec::new();
    let mut failed = Vec::new();
    for (stream, answer) in run_all(org_id, user_id, jobs).await {
        match answer {
            Ok(a) => pairs.push((stream, a.hits)),
            Err(_) => failed.push(stream),
        }
    }
    (pairs, failed)
}

/// The most recent SIEM cases, newest first.
async fn siem_cases(org_id: &str) -> Vec<GraphCase> {
    let incidents = match openobserve_core::alerts::incidents::list_incidents_filtered(
        org_id,
        None,
        infra::table::alert_incidents::CaseFilter::OnlyCases,
        CASE_LIMIT,
        0,
    )
    .await
    {
        Ok((incidents, _)) => incidents,
        Err(e) => {
            log::warn!("[SIEM] listing cases for the risk graph failed: {e}");
            return Vec::new();
        }
    };
    incidents
        .into_iter()
        .map(|i| GraphCase {
            id: i.id,
            title: i.title,
            severity: serde_json::to_value(i.severity)
                .ok()
                .and_then(|v| v.as_str().map(str::to_string)),
            group_values: i.group_values,
            status: Some(i.status.to_string()),
            last_alert_at: i.last_alert_at,
        })
        .collect()
}

async fn entity_detail(
    org_id: &str,
    user_id: &str,
    req: &EntityDetailRequest,
) -> EntityDetailResponse {
    enum Job {
        Timeline,
        Related(EntityKind),
    }
    let mut jobs = Vec::new();
    for (i, plan) in req.plans.iter().enumerate() {
        let full = req.full_window.contains(&plan.stream);
        let w = run_window(plan, req.start_time, req.end_time, full);
        let window = (w.start_time, w.end_time);
        if let Some(sql) = entity_timeline_sql(plan, req.kind, &req.values, &req.interval) {
            jobs.push(((i, Job::Timeline), sql, window));
        }
        for other in EntityKind::ALL.into_iter().filter(|k| *k != req.kind) {
            if let Some(sql) = related_sql(plan, req.kind, &req.values, other, RELATED_LIMIT) {
                jobs.push(((i, Job::Related(other)), sql, window));
            }
        }
    }
    let mut buckets: Vec<TimelineBucket> = Vec::new();
    let mut related: BTreeMap<EntityKind, Vec<Value>> = BTreeMap::new();
    let mut failed: HashSet<String> = HashSet::new();
    for ((i, job), answer) in run_all(org_id, user_id, jobs).await {
        let Ok(answer) = answer else {
            failed.insert(req.plans[i].stream.clone());
            continue;
        };
        match job {
            Job::Timeline => {
                for hit in answer.hits {
                    let key = hit.get("zo_ts").cloned().unwrap_or(Value::Null);
                    if key.is_null() {
                        continue;
                    }
                    let n = count(hit.get("zo_n"));
                    let f = count(hit.get("zo_fail"));
                    match buckets.iter_mut().find(|b| b.key == key) {
                        Some(b) => {
                            b.ok += n - f;
                            b.failed += f;
                        }
                        None => buckets.push(TimelineBucket {
                            key,
                            ok: n - f,
                            failed: f,
                        }),
                    }
                }
            }
            Job::Related(other) => related.entry(other).or_default().extend(answer.hits),
        }
    }
    let mut failed_streams: Vec<String> = failed.into_iter().collect();
    failed_streams.sort();
    let cases = cases_naming(req.kind, &req.values, &siem_cases(org_id).await);
    EntityDetailResponse {
        timeline: buckets,
        related: EntityKind::ALL
            .into_iter()
            .filter(|k| *k != req.kind)
            .map(|k| {
                let hits = related.remove(&k).unwrap_or_default();
                (
                    k.as_str().to_string(),
                    merge_related(k, &hits, RELATED_LIMIT),
                )
            })
            .collect(),
        failed_streams,
        cases,
    }
}

async fn ueba(org_id: &str, user_id: &str, req: &UebaRequest) -> UebaReport {
    #[derive(Clone, Copy, PartialEq)]
    enum Agg {
        Hours,
        Ips,
    }
    let w = &req.windows;
    let mut runs: Vec<UebaRun> = Vec::new();
    let mut jobs = Vec::new();
    for plan in &req.plans {
        let Some(hours) = hours_sql(plan, HOURS_LIMIT) else {
            continue;
        };
        let ips = ips_sql(plan, IPS_LIMIT);
        let full = req.full_window.contains(&plan.stream);
        let spans = ueba_spans(plan, w, full);
        let at = runs.len();
        let agg = |stream: &str| StreamAgg {
            stream: stream.to_string(),
            failure_known: plan.failure.is_some(),
            ..Default::default()
        };
        runs.push(UebaRun {
            stream: plan.stream.clone(),
            limited_rows: spans.limited_rows,
            now: agg(&plan.stream),
            base: agg(&plan.stream),
            ..Default::default()
        });
        for (is_now, span) in [(true, spans.now), (false, spans.base)] {
            jobs.push(((at, is_now, Agg::Hours), hours.clone(), span));
            if let Some(ips) = &ips {
                jobs.push(((at, is_now, Agg::Ips), ips.clone(), span));
            }
        }
    }
    for ((at, is_now, agg), answer) in run_all(org_id, user_id, jobs).await {
        let run = &mut runs[at];
        let answer = match answer {
            Ok(a) => a,
            Err(e) => {
                log::warn!("[SIEM] UEBA query on {} failed: {e}", run.stream);
                run.failed = true;
                continue;
            }
        };
        let cap = if agg == Agg::Hours {
            HOURS_LIMIT
        } else {
            IPS_LIMIT
        };
        let cut = answer.hits.len() >= cap || answer.partial;
        if is_now {
            run.now_cut |= cut;
        } else if agg == Agg::Hours {
            run.has_history |= !answer.hits.is_empty();
            run.base_cut_hours |= cut;
        } else {
            run.base_cut_ips |= cut;
        }
        let target = if is_now { &mut run.now } else { &mut run.base };
        match agg {
            Agg::Hours => target.hours = answer.hits,
            Agg::Ips => target.ips = answer.hits,
        }
    }
    let mut report = assess(&runs, w);
    add_case_signals(&mut report, &siem_cases(org_id).await);
    report
}

async fn hunt(
    org_id: &str,
    user_id: &str,
    req: &EventSearchRequest,
) -> Result<EventSearchResponse, String> {
    let Some(sql) = hunt_sql(&req.plans, &req.query, &req.sort) else {
        return Ok(EventSearchResponse::default());
    };
    let window = (req.start_time, req.end_time);
    let counts = async {
        if !req.count {
            return None;
        }
        let jobs = hunt_parts(&req.plans, &req.query)
            .into_iter()
            .map(|(plan, w)| (plan.stream.clone(), hunt_count_sql(plan, &w), window))
            .collect();
        Some(run_all(org_id, user_id, jobs).await)
    };
    let (page, counts) = futures::join!(
        run_sql(org_id, user_id, sql, window, req.from, req.size),
        counts
    );
    let page = page?;
    let mut response = EventSearchResponse {
        rows: page
            .hits
            .iter()
            .enumerate()
            .map(|(i, h)| to_hunt_row(h, i))
            .collect(),
        searchable: true,
        ..Default::default()
    };
    if let Some(counts) = counts {
        let mut total = 0.0;
        for (stream, answer) in counts {
            match answer {
                Ok(a) => {
                    let n = count(a.hits.first().and_then(|h| h.get("zo_n")));
                    total += n;
                    if n > 0.0 {
                        response.per_source.push(SourceCount { stream, n });
                    }
                }
                Err(_) => response.uncounted.push(stream),
            }
        }
        response.per_source.sort_by(|a, b| b.n.total_cmp(&a.n));
        response.total = Some(total);
    }
    Ok(response)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn caller() -> Headers<UserEmail> {
        Headers(UserEmail {
            user_id: format!("{}@example.com", config::ider::uuid()),
        })
    }

    #[test]
    fn test_intervals_are_limited_to_histogram_units() {
        assert!(valid_interval("1 hour"));
        assert!(valid_interval("30 minutes"));
        assert!(!valid_interval("1 hour') --"));
        assert!(!valid_interval("hour"));
        assert!(!valid_interval("1 fortnight"));
    }

    #[test]
    fn test_detail_needs_a_value_and_a_sane_interval() {
        let req = |interval: &str, values: Vec<String>| EntityDetailRequest {
            start_time: 1,
            end_time: 2,
            plans: vec![],
            full_window: vec![],
            kind: EntityKind::User,
            values,
            interval: interval.to_string(),
        };
        assert!(validate_detail(&req("1 hour", vec!["dave".into()])).is_ok());
        assert!(validate_detail(&req("1 hour", vec![])).is_err());
        assert!(validate_detail(&req("1;drop", vec!["dave".into()])).is_err());
    }

    #[tokio::test]
    async fn test_callers_without_the_security_grant_are_refused() {
        let body = EntitiesRequest {
            start_time: 1,
            end_time: 2,
            plans: vec![],
            full_window: vec![],
        };
        let org = || Path("org".to_string());
        let resp = list_entities(org(), caller(), Json(body.clone())).await;
        assert_eq!(resp.status(), axum::http::StatusCode::FORBIDDEN);
        let resp = get_entity_graph(org(), caller(), Json(body)).await;
        assert_eq!(resp.status(), axum::http::StatusCode::FORBIDDEN);
        let ueba: UebaRequest = serde_json::from_value(serde_json::json!({
            "currentStart": 2, "currentEnd": 3, "baselineStart": 1, "plans": []
        }))
        .unwrap();
        let resp = score_users(org(), caller(), Json(ueba)).await;
        assert_eq!(resp.status(), axum::http::StatusCode::FORBIDDEN);
        let hunt: EventSearchRequest = serde_json::from_value(serde_json::json!({
            "startTime": 1, "endTime": 2, "plans": [], "query": {"kind": "user", "value": "dave"}
        }))
        .unwrap();
        let resp = search_events(org(), caller(), Json(hunt)).await;
        assert_eq!(resp.status(), axum::http::StatusCode::FORBIDDEN);
        let detail: EntityDetailRequest = serde_json::from_value(serde_json::json!({
            "startTime": 1, "endTime": 2, "plans": [], "kind": "ip", "values": ["1.2.3.4"], "interval": "1 hour"
        }))
        .unwrap();
        let resp = get_entity_detail(org(), caller(), Json(detail)).await;
        assert_eq!(resp.status(), axum::http::StatusCode::FORBIDDEN);
    }
}
