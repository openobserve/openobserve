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

//! AI data health: checks that make LLM pages look empty or numbers look wrong (unpriced
//! models, spans without agent identity, zero-duration spans, spans without a session id),
//! plus the per-model unpriced / approximate listing behind Model Pricing's Unpriced tab.
//!
//! The checks run on request against the trace stream and are cached in memory for
//! [`CACHE_TTL_MICROS`] per (org, stream, scope, window rounded to the minute): Insights loads
//! them on every visit, and a short cache keeps refreshes cheap without a scheduled job or a
//! results stream. A stream whose schema lacks a column is handled per check, never an error.

use std::{
    collections::HashMap,
    sync::{LazyLock, Mutex},
};

use axum::{extract::Path, response::Response};
use config::{
    meta::{
        model_pricing::{COST_STATUS_COLUMN, CostStatus},
        search::{Query as SearchQuery, Request as SearchRequest, RequestEncoding},
        stream::StreamType,
    },
    utils::{json, time::now_micros},
};
use serde::{Deserialize, Serialize};
use utoipa::{IntoParams, ToSchema};

use crate::common::meta::http::HttpResponse as MetaHttpResponse;

const CACHE_TTL_MICROS: i64 = 60 * 1_000_000;
const CACHE_MAX_ENTRIES: usize = 512;
const WINDOW_QUANTUM_MICROS: i64 = 60 * 1_000_000;
const MAX_SAMPLES: usize = 3;
const MAX_MODELS: usize = 20;
const MAX_UNPRICED_ROWS: usize = 100;

const LLM_SPAN_COLUMN: &str = "gen_ai_operation_name";
const AGENT_NAME_COLUMN: &str = "gen_ai_agent_name";
const AGENT_ID_COLUMN: &str = "gen_ai_agent_id";
const AGENT_ENV_COLUMN: &str = "gen_ai_agent_env";
const AGENT_VERSION_COLUMN: &str = "gen_ai_agent_version";
const SESSION_COLUMN: &str = "gen_ai_conversation_id";
const TOKENS_COLUMN: &str = "gen_ai_usage_total_tokens";
const COST_COLUMN: &str = "gen_ai_usage_cost";

#[derive(Debug, Clone, Deserialize, IntoParams)]
#[into_params(parameter_in = Query)]
pub struct DataHealthQuery {
    /// Trace stream to check.
    pub stream_name: String,
    /// Window start, microseconds.
    pub start_time: i64,
    /// Window end, microseconds.
    pub end_time: i64,
    /// Only spans of this agent name (`gen_ai_agent_name`); ignored when `agent_id` is set.
    #[serde(default)]
    pub agent: Option<String>,
    /// Only spans of this agent id (`gen_ai_agent_id`). Agents that emit only an id are
    /// listed with the id as their name, so the id is the filter that matches their spans.
    #[serde(default)]
    pub agent_id: Option<String>,
    /// Only spans of this environment (`gen_ai_agent_env`).
    #[serde(default)]
    pub env: Option<String>,
    /// Only spans of this agent version (`gen_ai_agent_version`).
    #[serde(default)]
    pub version: Option<String>,
    /// Skip the short server-side cache.
    #[serde(default)]
    pub refresh: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum CheckStatus {
    Pass,
    Warning,
    Error,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum CheckId {
    UnpricedModels,
    MissingAgentIdentity,
    ZeroDurationSpans,
    MissingSessionId,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, ToSchema)]
pub struct ModelUsage {
    pub model: String,
    pub spans: i64,
    pub tokens: i64,
}

#[derive(Debug, Clone, PartialEq, Serialize, ToSchema)]
pub struct HealthCheck {
    pub id: CheckId,
    pub status: CheckStatus,
    /// LLM spans the problem touches.
    pub affected: i64,
    /// LLM spans checked.
    pub total: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub models: Option<Vec<ModelUsage>>,
    /// Up to three recent trace ids with the problem.
    pub samples: Vec<String>,
}

#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct DataHealthResponse {
    /// When the checks ran, microseconds.
    pub checked_at: i64,
    pub checks: Vec<HealthCheck>,
}

/// How a check selects affected spans on a given stream schema.
#[derive(Debug, Clone, PartialEq, Eq)]
enum Pred {
    /// The column the check reads is absent, so no span can have the problem.
    Never,
    /// The column that would prove the span healthy is absent, so every span has it.
    Always,
    Sql(String),
}

/// Columns of the stream schema the checks read.
struct Columns(std::collections::HashSet<String>);

impl Columns {
    fn from_schema(schema: &arrow_schema::Schema) -> Self {
        Self(schema.fields().iter().map(|f| f.name().clone()).collect())
    }

    fn has(&self, name: &str) -> bool {
        self.0.contains(name)
    }

    fn model_column(&self) -> Option<&'static str> {
        ["gen_ai_response_model", "gen_ai_request_model"]
            .into_iter()
            .find(|c| self.has(c))
    }

    fn tokens_expr(&self) -> &'static str {
        if self.has(TOKENS_COLUMN) {
            "COALESCE(SUM(gen_ai_usage_total_tokens), 0)"
        } else {
            "0"
        }
    }
}

const CHECK_IDS: [CheckId; 4] = [
    CheckId::UnpricedModels,
    CheckId::MissingAgentIdentity,
    CheckId::ZeroDurationSpans,
    CheckId::MissingSessionId,
];

fn quote_str(value: &str) -> String {
    format!("'{}'", value.replace('\'', "''"))
}

fn quote_ident(value: &str) -> String {
    format!("\"{}\"", value.replace('"', "\"\""))
}

fn blank(column: &str) -> String {
    format!("({column} IS NULL OR {column} = '')")
}

fn check_pred(id: CheckId, cols: &Columns) -> Pred {
    match id {
        CheckId::UnpricedModels if cols.has(COST_STATUS_COLUMN) => Pred::Sql(format!(
            "{COST_STATUS_COLUMN} = {}",
            quote_str(CostStatus::Unpriced.as_str())
        )),
        CheckId::UnpricedModels => Pred::Never,
        CheckId::MissingAgentIdentity => {
            let present: Vec<String> = [AGENT_NAME_COLUMN, AGENT_ID_COLUMN]
                .into_iter()
                .filter(|c| cols.has(c))
                .map(blank)
                .collect();
            if present.is_empty() {
                Pred::Always
            } else {
                Pred::Sql(present.join(" AND "))
            }
        }
        CheckId::ZeroDurationSpans if cols.has("duration") => Pred::Sql("duration = 0".into()),
        CheckId::ZeroDurationSpans => Pred::Never,
        CheckId::MissingSessionId if cols.has(SESSION_COLUMN) => Pred::Sql(blank(SESSION_COLUMN)),
        CheckId::MissingSessionId => Pred::Always,
    }
}

fn non_empty(value: &Option<String>) -> Option<&str> {
    value.as_deref().filter(|v| !v.is_empty())
}

/// The LLM-span and scope predicates every check query shares; `None` when the stream has no
/// LLM spans in scope at all (a scope column or the operation column is absent).
///
/// The agent is matched on `gen_ai_agent_id` when an id is given, else on its name, as the
/// Insights panels do.
fn base_where(cols: &Columns, query: &DataHealthQuery) -> Option<String> {
    if !cols.has(LLM_SPAN_COLUMN) {
        return None;
    }
    let agent = match non_empty(&query.agent_id) {
        Some(id) => (AGENT_ID_COLUMN, Some(id)),
        None => (AGENT_NAME_COLUMN, non_empty(&query.agent)),
    };
    let mut preds = vec![format!("{LLM_SPAN_COLUMN} IS NOT NULL")];
    for (column, value) in [
        agent,
        (AGENT_ENV_COLUMN, non_empty(&query.env)),
        (AGENT_VERSION_COLUMN, non_empty(&query.version)),
    ] {
        let Some(value) = value else {
            continue;
        };
        if !cols.has(column) {
            return None;
        }
        preds.push(format!("{column} = {}", quote_str(value)));
    }
    Some(preds.join(" AND "))
}

fn counts_sql(stream: &str, base: &str, preds: &[Pred]) -> String {
    let mut selects = vec!["COUNT(*) AS total".to_string()];
    for (i, pred) in preds.iter().enumerate() {
        if let Pred::Sql(p) = pred {
            selects.push(format!("SUM(CASE WHEN {p} THEN 1 ELSE 0 END) AS c{i}"));
        }
    }
    format!(
        "SELECT {} FROM {} WHERE {base}",
        selects.join(", "),
        quote_ident(stream)
    )
}

fn samples_sql(stream: &str, base: &str, pred: &Pred) -> String {
    let filter = match pred {
        Pred::Sql(p) => format!(" AND {p}"),
        _ => String::new(),
    };
    format!(
        "SELECT trace_id, MAX(_timestamp) AS ts FROM {} WHERE {base}{filter} \
         GROUP BY trace_id ORDER BY ts DESC LIMIT {MAX_SAMPLES}",
        quote_ident(stream)
    )
}

fn unpriced_models_sql(stream: &str, base: &str, pred: &str, cols: &Columns) -> Option<String> {
    let model = cols.model_column()?;
    Some(format!(
        "SELECT {model} AS model, COUNT(*) AS spans, {} AS tokens FROM {} \
         WHERE {base} AND {pred} GROUP BY {model} ORDER BY tokens DESC LIMIT {MAX_MODELS}",
        cols.tokens_expr(),
        quote_ident(stream)
    ))
}

fn status_for(id: CheckId, affected: i64) -> CheckStatus {
    match (id, affected) {
        (_, 0) => CheckStatus::Pass,
        (CheckId::UnpricedModels, _) => CheckStatus::Error,
        _ => CheckStatus::Warning,
    }
}

/// Affected count of check `i` from the counts row.
fn affected_from(pred: &Pred, row: &json::Value, i: usize, total: i64) -> i64 {
    match pred {
        Pred::Never => 0,
        Pred::Always => total,
        Pred::Sql(_) => row.get(format!("c{i}")).map_or(0, json::get_int_value),
    }
}

fn all_pass(total: i64) -> Vec<HealthCheck> {
    CHECK_IDS
        .iter()
        .map(|&id| HealthCheck {
            id,
            status: CheckStatus::Pass,
            affected: 0,
            total,
            models: (id == CheckId::UnpricedModels).then(Vec::new),
            samples: vec![],
        })
        .collect()
}

/// The search window after the stream's max query range is applied.
struct Window {
    start: i64,
    end: i64,
    /// The note the search attaches when the start was moved; empty when it was not.
    range_error: String,
}

impl Window {
    async fn for_stream(org_id: &str, user_id: &str, stream: &str, start: i64, end: i64) -> Self {
        let max_hours = search_service::query_range::get_max_query_range(
            &[stream.to_string()],
            org_id,
            user_id,
            StreamType::Traces,
        )
        .await;
        Self::clamped(start, end, max_hours)
    }

    fn clamped(start: i64, end: i64, max_hours: i64) -> Self {
        let max_micros = max_hours * 3600 * 1_000_000;
        if max_hours > 0 && end - start > max_micros {
            Self {
                start: end - max_micros,
                end,
                range_error: format!(
                    "Query duration is modified due to query range restriction of {max_hours} hours"
                ),
            }
        } else {
            Self {
                start,
                end,
                range_error: String::new(),
            }
        }
    }

    /// Whether a response is missing data. The search also flags a window clamped to the max
    /// query range as partial, with only the range note in `function_error`; its hits are
    /// complete for the clamped window, so that alone is not a failure.
    fn is_real_partial(&self, resp: &config::meta::search::Response) -> bool {
        resp.is_partial
            && (self.range_error.is_empty()
                || resp.function_error.iter().any(|e| *e != self.range_error))
    }
}

async fn run_sql(
    org_id: &str,
    user_id: &str,
    sql: String,
    window: &Window,
    size: usize,
) -> Result<Vec<json::Value>, anyhow::Error> {
    let req = SearchRequest {
        query: SearchQuery {
            sql,
            from: 0,
            size: size as i64,
            start_time: window.start,
            end_time: window.end,
            ..Default::default()
        },
        encoding: RequestEncoding::Empty,
        ..Default::default()
    };
    let trace_id = config::ider::generate_trace_id();
    let resp = search_service::cache::search(
        &trace_id,
        org_id,
        StreamType::Traces,
        Some(user_id.to_string()),
        &req,
        window.range_error.clone(),
        false,
        None,
        false,
    )
    .await?;
    if window.is_real_partial(&resp) {
        anyhow::bail!("partial search result: {}", resp.function_error.join("; "));
    }
    Ok(resp.hits)
}

async fn stream_columns(org_id: &str, stream: &str) -> Option<Columns> {
    infra::schema::get_stream_schema_from_cache(org_id, stream, StreamType::Traces)
        .await
        .map(|s| Columns::from_schema(&s))
}

async fn compute_checks(
    org_id: &str,
    user_id: &str,
    query: &DataHealthQuery,
) -> Result<Vec<HealthCheck>, anyhow::Error> {
    let Some(cols) = stream_columns(org_id, &query.stream_name).await else {
        return Ok(all_pass(0));
    };
    let Some(base) = base_where(&cols, query) else {
        return Ok(all_pass(0));
    };
    let stream = &query.stream_name;
    let window =
        Window::for_stream(org_id, user_id, stream, query.start_time, query.end_time).await;
    let window = &window;
    let preds: Vec<Pred> = CHECK_IDS.iter().map(|&id| check_pred(id, &cols)).collect();

    let rows = run_sql(
        org_id,
        user_id,
        counts_sql(stream, &base, &preds),
        window,
        1,
    )
    .await?;
    let row = rows.into_iter().next().unwrap_or_default();
    let total = row.get("total").map_or(0, json::get_int_value);

    let mut checks: Vec<HealthCheck> = CHECK_IDS
        .iter()
        .zip(&preds)
        .enumerate()
        .map(|(i, (&id, pred))| {
            let affected = affected_from(pred, &row, i, total);
            HealthCheck {
                id,
                status: status_for(id, affected),
                affected,
                total,
                models: (id == CheckId::UnpricedModels).then(Vec::new),
                samples: vec![],
            }
        })
        .collect();

    // Samples for every failing check, plus the unpriced model breakdown, run concurrently.
    let sample_jobs = checks
        .iter()
        .zip(&preds)
        .enumerate()
        .filter(|(_, (c, _))| c.affected > 0)
        .map(|(i, (_, pred))| {
            let sql = samples_sql(stream, &base, pred);
            async move { (i, run_sql(org_id, user_id, sql, window, MAX_SAMPLES).await) }
        })
        .collect::<Vec<_>>();
    let models_sql = match (&preds[0], checks[0].affected > 0) {
        (Pred::Sql(p), true) => unpriced_models_sql(stream, &base, p, &cols),
        _ => None,
    };
    let models_job = async {
        match models_sql {
            Some(sql) => run_sql(org_id, user_id, sql, window, MAX_MODELS)
                .await
                .map(Some),
            None => Ok(None),
        }
    };
    let (samples, models) = tokio::join!(futures::future::join_all(sample_jobs), models_job);

    for (i, hits) in samples {
        checks[i].samples = hits?
            .iter()
            .filter_map(|h| {
                h.get("trace_id")
                    .and_then(|v| v.as_str())
                    .map(str::to_string)
            })
            .collect();
    }
    if let Some(hits) = models? {
        checks[0].models = Some(
            hits.iter()
                .map(|h| ModelUsage {
                    model: h
                        .get("model")
                        .map(json::get_string_value)
                        .unwrap_or_default(),
                    spans: h.get("spans").map_or(0, json::get_int_value),
                    tokens: h.get("tokens").map_or(0, json::get_int_value),
                })
                .collect(),
        );
    }

    // Worst first, so the strip and the skill lead with what matters.
    checks.sort_by_key(|c| match c.status {
        CheckStatus::Error => 0,
        CheckStatus::Warning => 1,
        CheckStatus::Pass => 2,
    });
    Ok(checks)
}

static CACHE: LazyLock<Mutex<HashMap<String, DataHealthResponse>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

fn cache_key(org_id: &str, q: &DataHealthQuery) -> String {
    format!(
        "{org_id}\u{1f}{}\u{1f}{}\u{1f}{}\u{1f}{}\u{1f}{}\u{1f}{}\u{1f}{}",
        q.stream_name,
        q.agent.as_deref().unwrap_or(""),
        q.agent_id.as_deref().unwrap_or(""),
        q.env.as_deref().unwrap_or(""),
        q.version.as_deref().unwrap_or(""),
        q.start_time / WINDOW_QUANTUM_MICROS,
        q.end_time / WINDOW_QUANTUM_MICROS,
    )
}

fn cache_get(key: &str, now: i64) -> Option<DataHealthResponse> {
    let cache = CACHE.lock().unwrap_or_else(|e| e.into_inner());
    cache
        .get(key)
        .filter(|r| now - r.checked_at < CACHE_TTL_MICROS)
        .cloned()
}

fn cache_put(key: String, value: DataHealthResponse) {
    let mut cache = CACHE.lock().unwrap_or_else(|e| e.into_inner());
    let now = value.checked_at;
    cache.retain(|_, r| now - r.checked_at < CACHE_TTL_MICROS);
    if cache.len() >= CACHE_MAX_ENTRIES {
        cache.clear();
    }
    cache.insert(key, value);
}

fn validate_window(start_time: i64, end_time: i64) -> Result<(), &'static str> {
    if start_time <= 0 || end_time <= 0 || start_time >= end_time {
        return Err("start_time and end_time must be positive and start_time < end_time");
    }
    Ok(())
}

#[cfg(feature = "enterprise")]
async fn can_read_traces(org_id: &str, user_id: &str, stream: &str) -> bool {
    openobserve_core::auth::check_permissions(
        stream, org_id, user_id, "traces", "GET", None, false, false, true,
    )
    .await
}

/// GetGenAiDataHealth
///
/// #{"ratelimit_module":"Traces", "ratelimit_module_operation":"list"}#
#[utoipa::path(
    get,
    path = "/{org_id}/gen_ai/data_health",
    context_path = "/api",
    tag = "GenAI Settings",
    operation_id = "GetGenAiDataHealth",
    summary = "AI data health checks",
    description = "Counts LLM spans with no model price, no agent identity, zero duration, or no session id in a trace stream and window. Results are cached for about a minute; pass refresh=true to recompute.",
    params(("org_id" = String, Path, description = "Organization ID"), DataHealthQuery),
    responses(
        (status = 200, description = "Data health checks", body = DataHealthResponse),
        (status = 400, description = "Invalid query"),
        (status = 403, description = "Forbidden"),
        (status = 500, description = "Internal server error")
    ),
    security(("Authorization" = []))
)]
pub async fn get_data_health(
    Path(org_id): Path<String>,
    openobserve_api_common::extractors::Headers(user_email): openobserve_api_common::extractors::Headers<
        openobserve_core::auth::UserEmail,
    >,
    axum::extract::Query(query): axum::extract::Query<DataHealthQuery>,
) -> Response {
    if let Err(e) = validate_window(query.start_time, query.end_time) {
        return MetaHttpResponse::bad_request(e);
    }
    let user_id = &user_email.user_id;
    #[cfg(feature = "enterprise")]
    if !can_read_traces(&org_id, user_id, &query.stream_name).await {
        return MetaHttpResponse::forbidden("Unauthorized Access");
    }

    let key = cache_key(&org_id, &query);
    let now = now_micros();
    if !query.refresh
        && let Some(cached) = cache_get(&key, now)
    {
        return MetaHttpResponse::json(cached);
    }
    match compute_checks(&org_id, user_id, &query).await {
        Ok(checks) => {
            let resp = DataHealthResponse {
                checked_at: now,
                checks,
            };
            cache_put(key, resp.clone());
            MetaHttpResponse::json(resp)
        }
        Err(e) => {
            log::error!(
                "[gen_ai_health] checks failed for {org_id}/{}: {e}",
                query.stream_name
            );
            MetaHttpResponse::internal_error("Failed to run data health checks")
        }
    }
}

#[derive(Debug, Clone, Deserialize, IntoParams)]
#[into_params(parameter_in = Query)]
pub struct UnpricedModelsQuery {
    pub stream_name: String,
    pub start_time: i64,
    pub end_time: i64,
}

/// A model whose spans in the window were priced approximately or not at all.
#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct UnpricedModelRow {
    pub model: String,
    pub status: CostStatus,
    pub spans: i64,
    pub tokens: i64,
    /// Cost recorded at ingest (0 for unpriced spans).
    pub cost: f64,
    pub agents: Vec<String>,
}

fn unpriced_list_sql(stream: &str, cols: &Columns) -> Option<String> {
    if !cols.has(COST_STATUS_COLUMN) {
        return None;
    }
    let model = cols.model_column()?;
    let cost = if cols.has(COST_COLUMN) {
        "COALESCE(SUM(gen_ai_usage_cost), 0)"
    } else {
        "0"
    };
    let agents = if cols.has(AGENT_NAME_COLUMN) {
        "array_agg(DISTINCT gen_ai_agent_name) FILTER (WHERE gen_ai_agent_name IS NOT NULL \
         AND gen_ai_agent_name != '')"
    } else {
        "NULL"
    };
    Some(format!(
        "SELECT {model} AS model, {COST_STATUS_COLUMN} AS status, COUNT(*) AS spans, {} AS tokens, \
         {cost} AS cost, {agents} AS agents FROM {} \
         WHERE {COST_STATUS_COLUMN} IS NOT NULL AND {model} IS NOT NULL \
         GROUP BY {model}, {COST_STATUS_COLUMN} ORDER BY tokens DESC LIMIT {MAX_UNPRICED_ROWS}",
        cols.tokens_expr(),
        quote_ident(stream)
    ))
}

fn parse_unpriced_row(hit: &json::Value) -> Option<UnpricedModelRow> {
    let status = match hit.get("status")?.as_str()? {
        "unpriced" => CostStatus::Unpriced,
        "approximate" => CostStatus::Approximate,
        _ => return None,
    };
    let agents = match hit.get("agents") {
        Some(json::Value::Array(items)) => items
            .iter()
            .filter_map(|v| v.as_str().map(str::to_string))
            .collect(),
        // Some engines return the aggregated array as a JSON string.
        Some(json::Value::String(s)) => json::from_str::<Vec<String>>(s).unwrap_or_default(),
        _ => vec![],
    };
    Some(UnpricedModelRow {
        model: hit.get("model")?.as_str()?.to_string(),
        status,
        spans: hit.get("spans").map_or(0, json::get_int_value),
        tokens: hit.get("tokens").map_or(0, json::get_int_value),
        cost: hit.get("cost").map_or(0.0, json::get_float_value),
        agents,
    })
}

/// Models in `stream` that ingest marked unpriced or approximate during the window.
pub async fn unpriced_models(
    org_id: &str,
    user_id: &str,
    query: &UnpricedModelsQuery,
) -> Result<Vec<UnpricedModelRow>, anyhow::Error> {
    let Some(cols) = stream_columns(org_id, &query.stream_name).await else {
        return Ok(vec![]);
    };
    let Some(sql) = unpriced_list_sql(&query.stream_name, &cols) else {
        return Ok(vec![]);
    };
    let window = Window::for_stream(
        org_id,
        user_id,
        &query.stream_name,
        query.start_time,
        query.end_time,
    )
    .await;
    let hits = run_sql(org_id, user_id, sql, &window, MAX_UNPRICED_ROWS).await?;
    Ok(hits.iter().filter_map(parse_unpriced_row).collect())
}

/// Validates the window and, on enterprise, the caller's read access to the stream.
pub async fn authorize_unpriced(
    org_id: &str,
    user_id: &str,
    query: &UnpricedModelsQuery,
) -> Result<(), Response> {
    validate_window(query.start_time, query.end_time).map_err(MetaHttpResponse::bad_request)?;
    #[cfg(feature = "enterprise")]
    if !can_read_traces(org_id, user_id, &query.stream_name).await {
        return Err(MetaHttpResponse::forbidden("Unauthorized Access"));
    }
    #[cfg(not(feature = "enterprise"))]
    let _ = (org_id, user_id);
    Ok(())
}

#[cfg(test)]
mod tests {
    use arrow_schema::{DataType, Field, Schema};

    use super::*;

    fn cols(names: &[&str]) -> Columns {
        Columns::from_schema(&Schema::new(
            names
                .iter()
                .map(|n| Field::new(*n, DataType::Utf8, true))
                .collect::<Vec<_>>(),
        ))
    }

    fn query() -> DataHealthQuery {
        DataHealthQuery {
            stream_name: "default".into(),
            start_time: 1,
            end_time: 2,
            agent: None,
            agent_id: None,
            env: None,
            version: None,
            refresh: false,
        }
    }

    const FULL: &[&str] = &[
        "gen_ai_operation_name",
        "gen_ai_agent_name",
        "gen_ai_agent_id",
        "gen_ai_agent_env",
        "gen_ai_agent_version",
        "gen_ai_conversation_id",
        "gen_ai_response_model",
        "gen_ai_usage_total_tokens",
        "gen_ai_usage_cost",
        "gen_ai_usage_cost_status",
        "duration",
    ];

    #[test]
    fn missing_columns_degrade_per_check() {
        // A stream written before the cost marker, with no agent or session columns.
        let c = cols(&["gen_ai_operation_name", "duration"]);
        assert_eq!(check_pred(CheckId::UnpricedModels, &c), Pred::Never);
        assert_eq!(check_pred(CheckId::MissingAgentIdentity, &c), Pred::Always);
        assert_eq!(check_pred(CheckId::MissingSessionId, &c), Pred::Always);
        assert_eq!(
            check_pred(CheckId::ZeroDurationSpans, &c),
            Pred::Sql("duration = 0".into())
        );
        // Only the present identity column is tested.
        let c = cols(&["gen_ai_operation_name", "gen_ai_agent_name"]);
        assert_eq!(
            check_pred(CheckId::MissingAgentIdentity, &c),
            Pred::Sql("(gen_ai_agent_name IS NULL OR gen_ai_agent_name = '')".into())
        );
    }

    #[test]
    fn counts_sql_only_selects_sql_predicates() {
        let c = cols(&["gen_ai_operation_name", "duration"]);
        let preds: Vec<Pred> = CHECK_IDS.iter().map(|&id| check_pred(id, &c)).collect();
        let base = base_where(&c, &query()).unwrap();
        let sql = counts_sql("default", &base, &preds);
        assert_eq!(
            sql,
            "SELECT COUNT(*) AS total, SUM(CASE WHEN duration = 0 THEN 1 ELSE 0 END) AS c2 \
             FROM \"default\" WHERE gen_ai_operation_name IS NOT NULL"
        );
        let row = json::json!({"total": 10, "c2": 4});
        assert_eq!(affected_from(&preds[0], &row, 0, 10), 0);
        assert_eq!(affected_from(&preds[1], &row, 1, 10), 10);
        assert_eq!(affected_from(&preds[2], &row, 2, 10), 4);
    }

    #[test]
    fn scope_filters_quote_values_and_require_columns() {
        let mut q = query();
        q.agent = Some("o'brien".into());
        q.version = Some("1.2".into());
        let base = base_where(&cols(FULL), &q).unwrap();
        assert_eq!(
            base,
            "gen_ai_operation_name IS NOT NULL AND gen_ai_agent_name = 'o''brien' \
             AND gen_ai_agent_version = '1.2'"
        );
        // Scoped to a version the stream has no column for: nothing is in scope.
        assert!(base_where(&cols(&["gen_ai_operation_name", "gen_ai_agent_name"]), &q).is_none());
        // No LLM spans at all.
        assert!(base_where(&cols(&["duration"]), &query()).is_none());
    }

    #[test]
    fn agent_id_scopes_on_the_id_column() {
        // An id-only agent is listed with its id as the name; the id is what its spans carry.
        let mut q = query();
        q.agent = Some("a23ca1dd38a1ff350".into());
        q.agent_id = Some("a23ca1dd38a1ff350".into());
        q.env = Some("prod".into());
        assert_eq!(
            base_where(&cols(FULL), &q).unwrap(),
            "gen_ai_operation_name IS NOT NULL AND gen_ai_agent_id = 'a23ca1dd38a1ff350' \
             AND gen_ai_agent_env = 'prod'"
        );
        // An empty id falls back to the name.
        q.agent_id = Some(String::new());
        assert!(
            base_where(&cols(FULL), &q)
                .unwrap()
                .contains("gen_ai_agent_name = 'a23ca1dd38a1ff350'")
        );
        // A stream without the id column has none of that agent's spans.
        q.agent_id = Some("a23ca1dd38a1ff350".into());
        assert!(base_where(&cols(&["gen_ai_operation_name", "gen_ai_agent_name"]), &q).is_none());
    }

    #[test]
    fn a_range_clamp_alone_is_not_a_partial_result() {
        const HOUR: i64 = 3600 * 1_000_000;
        let end = 1_000 * HOUR;
        // Seven days on a stream capped at 24 h: the start moves and the note is set.
        let w = Window::clamped(end - 7 * 24 * HOUR, end, 24);
        assert_eq!((w.start, w.end), (end - 24 * HOUR, end));
        let clamp_only = config::meta::search::Response {
            is_partial: true,
            function_error: vec![w.range_error.clone()],
            ..Default::default()
        };
        assert!(!w.is_real_partial(&clamp_only));
        // A real gap on top of the clamp still fails.
        let mut gap = clamp_only.clone();
        gap.function_error.insert(
            0,
            config::meta::search::PARTIAL_ERROR_RESPONSE_MESSAGE.into(),
        );
        assert!(w.is_real_partial(&gap));
        // Without a clamp every partial result fails.
        let w = Window::clamped(end - HOUR, end, 24);
        assert!(w.range_error.is_empty());
        assert_eq!(w.start, end - HOUR);
        assert!(w.is_real_partial(&clamp_only));
        // No cap configured.
        assert_eq!(Window::clamped(1, end, 0).start, 1);
    }

    #[test]
    fn unpriced_is_an_error_others_warn() {
        assert_eq!(status_for(CheckId::UnpricedModels, 1), CheckStatus::Error);
        assert_eq!(
            status_for(CheckId::MissingAgentIdentity, 5),
            CheckStatus::Warning
        );
        assert_eq!(status_for(CheckId::MissingSessionId, 0), CheckStatus::Pass);
    }

    #[test]
    fn unpriced_list_needs_the_marker_column() {
        assert!(unpriced_list_sql("default", &cols(&["gen_ai_response_model"])).is_none());
        let sql = unpriced_list_sql("default", &cols(FULL)).unwrap();
        assert!(sql.contains("GROUP BY gen_ai_response_model, gen_ai_usage_cost_status"));
        let row = parse_unpriced_row(&json::json!({
            "model": "acme-internal-llm", "status": "unpriced", "spans": 3, "tokens": 900,
            "cost": null, "agents": ["research-agent"]
        }))
        .unwrap();
        assert_eq!(row.status, CostStatus::Unpriced);
        assert_eq!(row.agents, vec!["research-agent".to_string()]);
        assert_eq!(row.cost, 0.0);
    }

    #[test]
    fn cache_key_rounds_the_window_to_the_minute() {
        let mut a = query();
        a.start_time = 120_000_000;
        a.end_time = 180_000_001;
        let mut b = a.clone();
        b.start_time += 1_000_000;
        assert_eq!(cache_key("o", &a), cache_key("o", &b));
        b.agent = Some("x".into());
        assert_ne!(cache_key("o", &a), cache_key("o", &b));
        let mut c = a.clone();
        c.agent_id = Some("x".into());
        assert_ne!(cache_key("o", &a), cache_key("o", &c));
    }
}
