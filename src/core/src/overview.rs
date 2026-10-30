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
    collections::{BTreeMap, HashMap, HashSet},
    sync::LazyLock,
};

use common::meta::stream::Stream;
use config::{
    get_config,
    meta::{
        alerts::{
            alert::{Alert, ListAlertsParams},
            state::AlertState,
        },
        pipeline::Pipeline,
        self_reporting::ai_chat::is_protected_ai_chat_stream,
        stream::StreamType,
    },
    utils::time::now_micros,
};
use dashmap::DashMap;
use infra::db::get_orm_client_ro;
use serde::Serialize;
use stream::try_get_streams;

const DEFAULT_TOP_N: usize = 5;
const MAX_TOP_N: usize = 20;
/// User-facing stream types; derived and internal streams are left out.
const OVERVIEW_STREAM_TYPES: [StreamType; 4] = [
    StreamType::Logs,
    StreamType::Metrics,
    StreamType::Traces,
    StreamType::EnrichmentTables,
];

/// Stats refresh lags ingestion, so a shorter gap would flag streams that are still writing.
const QUIET_AFTER_MICROS: i64 = 3_600 * 1_000_000;
/// Streams silent longer than this are treated as abandoned, not newly quiet.
const QUIET_FORGOTTEN_AFTER_MICROS: i64 = 7 * 24 * 3_600 * 1_000_000;
const DAY_MICROS: i64 = 24 * 3_600 * 1_000_000;

const ALERT_ID_CHUNK: usize = 500;
const CACHE_MAX_ENTRIES: usize = 1024;
const ALERT_STATE_KEYS: [&str; 9] = [
    "firing",
    "pending",
    "normal",
    "succeeded",
    "error",
    "skipped",
    "notify_failed",
    "suppressed",
    "never_evaluated",
];
const ALERT_LEVEL_KEYS: [&str; 5] = ["ok", "warning", "critical", "no_data", "unclassified"];

/// Entries are keyed per caller so one user's visible set is never served to another.
static CACHE: LazyLock<DashMap<CacheKey, Overview>> = LazyLock::new(DashMap::new);

#[derive(Clone, Debug, Hash, PartialEq, Eq)]
struct CacheKey {
    org_id: String,
    user_id: String,
    top_n: usize,
}

/// What the caller may see; a stream type or pipeline list that is absent is unrestricted.
#[derive(Clone, Debug, Default)]
pub struct OverviewScope {
    pub user_id: String,
    pub stream_grants: HashMap<StreamType, Vec<String>>,
    pub pipeline_grants: Option<Vec<String>>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum SectionStatus {
    Ok,
    Error,
    Locked,
    Forbidden,
}

#[derive(Clone, Debug, Serialize)]
pub struct Section<T> {
    pub status: SectionStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<T>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    /// Why a section is locked, so the UI can pick the right message.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
}

impl<T> Section<T> {
    fn ok(data: T) -> Self {
        Self {
            status: SectionStatus::Ok,
            data: Some(data),
            error: None,
            reason: None,
        }
    }

    fn error(message: &str) -> Self {
        Self {
            status: SectionStatus::Error,
            data: None,
            error: Some(message.to_string()),
            reason: None,
        }
    }

    fn forbidden() -> Self {
        Self {
            status: SectionStatus::Forbidden,
            data: None,
            error: None,
            reason: None,
        }
    }

    #[cfg(any(not(feature = "enterprise"), feature = "cloud", test))]
    fn locked(reason: &str) -> Self {
        Self {
            status: SectionStatus::Locked,
            data: None,
            error: None,
            reason: Some(reason.to_string()),
        }
    }

    fn from_result<E: std::fmt::Display>(result: Result<T, E>, what: &str) -> Self {
        match result {
            Ok(data) => Self::ok(data),
            Err(e) => {
                log::error!("[overview] failed to load {what}: {e}");
                Self::error(&format!("failed to load {what}"))
            }
        }
    }
}

#[derive(Clone, Debug, Serialize)]
pub struct Overview {
    pub streams: Section<StreamsData>,
    pub alerts: Section<AlertsData>,
    pub pipelines: Section<PipelinesData>,
    pub limits: Section<LimitsData>,
    pub generated_at: i64,
    pub cached: bool,
}

impl Overview {
    fn has_error(&self) -> bool {
        self.streams.status == SectionStatus::Error
            || self.alerts.status == SectionStatus::Error
            || self.pipelines.status == SectionStatus::Error
            || self.limits.status == SectionStatus::Error
    }
}

#[derive(Clone, Debug, Serialize)]
pub struct StreamsData {
    pub total_streams: u64,
    pub total_storage_size_mb: f64,
    pub by_type: Vec<StreamTypeSummary>,
    /// User streams that stopped writing between one hour and seven days ago.
    pub quiet_count: usize,
    /// Oldest-silent first, capped at `top`.
    pub quiet: Vec<QuietStream>,
    /// Schema versions created in the last 24 hours across the visible user streams.
    pub schema_changes_24h: u64,
    /// Pending compaction jobs for the org; `None` when the lookup fails.
    pub compaction_pending: Option<i64>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct QuietStream {
    pub name: String,
    pub stream_type: String,
    pub last_write: i64,
}

#[derive(Clone, Debug, Serialize)]
pub struct StreamTypeSummary {
    pub stream_type: String,
    pub count: u64,
    pub doc_num: i64,
    pub storage_size_mb: f64,
    pub compressed_size_mb: f64,
    pub top: Vec<TopStream>,
}

#[derive(Clone, Debug, Serialize)]
pub struct TopStream {
    pub name: String,
    pub doc_num: i64,
    pub storage_size_mb: f64,
}

#[derive(Clone, Debug, Serialize)]
pub struct AlertsData {
    pub total: u64,
    pub enabled: u64,
    pub disabled: u64,
    /// Enabled rules by the outcome of their last evaluation.
    pub by_state: BTreeMap<String, u64>,
    /// Enabled rules by the severity level of their last classification.
    pub by_level: BTreeMap<String, u64>,
    /// Same count as `by_state.error`; do not add the two together.
    pub failed_evaluation: u64,
    /// Oldest-firing first, capped at `top`.
    pub firing: Vec<FiringAlert>,
    /// Same keys as `by_level`, counting only firing rules, uncapped.
    pub firing_by_level: BTreeMap<String, u64>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct FiringAlert {
    pub name: String,
    pub stream: String,
    pub level: Option<String>,
    pub since: i64,
}

#[derive(Clone, Debug, Serialize)]
pub struct PipelinesData {
    pub total: u64,
    pub enabled: u64,
    pub disabled: u64,
    /// Pipelines that still have an error row the retention cleanup has not removed.
    pub errored: u64,
}

/// Deployment-wide license ingestion figures, not per org.
#[derive(Clone, Debug, Serialize)]
pub struct LimitsData {
    pub scope: &'static str,
    pub ingestion_used_percent: f64,
    pub expired: bool,
    pub days_over_limit: u8,
    pub used_today_gb: Option<f64>,
    pub limit_today_gb: Option<f64>,
    pub allowed_days: Option<u32>,
    /// Next UTC midnight, when the daily ingestion counter resets.
    pub resets_at: i64,
}

pub fn normalize_top_n(requested: Option<usize>) -> usize {
    requested.unwrap_or(DEFAULT_TOP_N).clamp(1, MAX_TOP_N)
}

/// Microsecond timestamp of the next UTC midnight after `now`.
pub fn next_utc_midnight_micros(now: i64) -> i64 {
    (now.div_euclid(DAY_MICROS) + 1) * DAY_MICROS
}

/// Resolves which streams and pipelines the caller may see; errors when the grant lookup fails.
pub async fn resolve_scope(org_id: &str, user_id: &str) -> Result<OverviewScope, anyhow::Error> {
    let stream_lookups = futures::future::try_join_all(OVERVIEW_STREAM_TYPES.map(|stream_type| {
        let resource = stream_type.to_string();
        async move { list_grants(org_id, user_id, &resource).await }
    }));
    let (stream_results, pipeline_grants) =
        tokio::try_join!(stream_lookups, list_grants(org_id, user_id, "pipelines"))?;
    let stream_grants = OVERVIEW_STREAM_TYPES
        .into_iter()
        .zip(stream_results)
        .filter_map(|(stream_type, grants)| grants.map(|g| (stream_type, g)))
        .collect();
    Ok(OverviewScope {
        user_id: user_id.to_string(),
        stream_grants,
        pipeline_grants,
    })
}

/// Overview when grants cannot be resolved; alerts still load on their own permission check.
pub async fn scope_unavailable(org_id: &str, user_id: &str, top_n: usize) -> Overview {
    Overview {
        streams: Section::error("failed to resolve permissions"),
        alerts: Section::from_result(load_alerts(org_id, user_id, top_n).await, "alerts"),
        pipelines: Section::error("failed to resolve permissions"),
        limits: limits_section().await,
        generated_at: now_micros(),
        cached: false,
    }
}

/// Returns a fresh cached overview for the caller, so a hit can skip the permission lookups.
pub fn cached_overview(org_id: &str, user_id: &str, top_n: usize) -> Option<Overview> {
    let ttl_micros = (get_config().limit.overview_cache_ttl as i64).saturating_mul(1_000_000);
    if ttl_micros <= 0 {
        return None;
    }
    let key = CacheKey {
        org_id: org_id.to_string(),
        user_id: user_id.to_string(),
        top_n,
    };
    let hit = CACHE.get(&key)?;
    if now_micros() - hit.generated_at >= ttl_micros {
        return None;
    }
    let mut overview = hit.clone();
    overview.cached = true;
    Some(overview)
}

/// Builds the overview and caches it per caller when every section loaded.
pub async fn get_overview(org_id: &str, scope: &OverviewScope, top_n: usize) -> Overview {
    let ttl_micros = (get_config().limit.overview_cache_ttl as i64).saturating_mul(1_000_000);
    let overview = build_overview(org_id, scope, top_n).await;
    if ttl_micros > 0 && !overview.has_error() {
        let key = CacheKey {
            org_id: org_id.to_string(),
            user_id: scope.user_id.clone(),
            top_n,
        };
        cache_put(key, overview.clone(), ttl_micros);
    }
    overview
}

async fn list_grants(
    org_id: &str,
    user_id: &str,
    resource: &str,
) -> Result<Option<Vec<String>>, anyhow::Error> {
    crate::authz::list_objects_for_user(org_id, user_id, "GET", &ofga_object_type(resource)).await
}

async fn build_overview(org_id: &str, scope: &OverviewScope, top_n: usize) -> Overview {
    let (streams, alerts, pipelines) = tokio::join!(
        async {
            if streams_forbidden(scope) {
                return Section::forbidden();
            }
            Section::from_result(load_streams(org_id, scope, top_n).await, "streams")
        },
        async { Section::from_result(load_alerts(org_id, &scope.user_id, top_n).await, "alerts") },
        async {
            if scope.pipeline_grants.as_ref().is_some_and(Vec::is_empty) {
                return Section::forbidden();
            }
            let loaded = load_pipelines(org_id, scope.pipeline_grants.clone()).await;
            Section::from_result(loaded, "pipelines")
        },
    );
    Overview {
        streams,
        alerts,
        pipelines,
        limits: limits_section().await,
        generated_at: now_micros(),
        cached: false,
    }
}

fn streams_forbidden(scope: &OverviewScope) -> bool {
    OVERVIEW_STREAM_TYPES
        .iter()
        .all(|t| scope.stream_grants.get(t).is_some_and(Vec::is_empty))
}

fn cache_put(key: CacheKey, overview: Overview, ttl_micros: i64) {
    if CACHE.len() >= CACHE_MAX_ENTRIES {
        let now = now_micros();
        CACHE.retain(|_, v| now - v.generated_at < ttl_micros);
        if CACHE.len() >= CACHE_MAX_ENTRIES {
            CACHE.clear();
        }
    }
    CACHE.insert(key, overview);
}

#[cfg(feature = "enterprise")]
fn ofga_object_type(name: &str) -> String {
    use o2_openfga::meta::mapping::OFGA_MODELS;

    OFGA_MODELS
        .get(name)
        .map_or(name, |model| model.key)
        .to_string()
}

#[cfg(not(feature = "enterprise"))]
fn ofga_object_type(name: &str) -> String {
    name.to_string()
}

async fn load_streams(
    org_id: &str,
    scope: &OverviewScope,
    top_n: usize,
) -> Result<StreamsData, anyhow::Error> {
    let mut streams = Vec::new();
    for stream_type in OVERVIEW_STREAM_TYPES {
        let grants = scope.stream_grants.get(&stream_type).cloned();
        streams.extend(try_get_streams(org_id, Some(stream_type), false, grants).await?);
    }
    let now = now_micros();
    let schema_changes_24h = count_schema_changes(org_id, &streams, now - DAY_MICROS).await;
    let mut data = build_streams_data(streams, top_n, now);
    data.schema_changes_24h = schema_changes_24h;
    data.compaction_pending = pending_compaction(org_id).await;
    Ok(data)
}

/// Counts cached schema versions started since `since`; the cache lookup never hits the db.
async fn count_schema_changes(org_id: &str, streams: &[Stream], since: i64) -> u64 {
    let mut total = 0;
    for s in streams.iter().filter(|s| is_quiet_candidate(s)) {
        total += infra::schema::count_cached_versions_since(org_id, s.stream_type, &s.name, since)
            .await as u64;
    }
    total
}

async fn pending_compaction(org_id: &str) -> Option<i64> {
    match infra::file_list::get_pending_jobs_count().await {
        Ok(counts) => Some(sum_pending_for_org(&counts, org_id)),
        Err(e) => {
            log::warn!("[overview] failed to load pending compaction jobs: {e}");
            None
        }
    }
}

fn sum_pending_for_org(counts: &HashMap<String, HashMap<String, i64>>, org_id: &str) -> i64 {
    counts
        .get(org_id)
        .map_or(0, |by_type| by_type.values().sum())
}

/// User data streams only; enrichment tables and protected internal streams are left out.
fn is_quiet_candidate(stream: &Stream) -> bool {
    matches!(
        stream.stream_type,
        StreamType::Logs | StreamType::Metrics | StreamType::Traces
    ) && !is_protected_ai_chat_stream(&stream.name)
}

fn quiet_streams(streams: &[Stream], now: i64, top_n: usize) -> (usize, Vec<QuietStream>) {
    let mut quiet: Vec<QuietStream> = streams
        .iter()
        .filter(|s| is_quiet_candidate(s))
        .filter(|s| {
            let last = s.stats.doc_time_max;
            last < now - QUIET_AFTER_MICROS && last > now - QUIET_FORGOTTEN_AFTER_MICROS
        })
        .map(|s| QuietStream {
            name: s.name.clone(),
            stream_type: s.stream_type.to_string(),
            last_write: s.stats.doc_time_max,
        })
        .collect();
    quiet.sort_by(|a, b| {
        a.last_write
            .cmp(&b.last_write)
            .then_with(|| a.name.cmp(&b.name))
    });
    let count = quiet.len();
    quiet.truncate(top_n);
    (count, quiet)
}

fn build_streams_data(streams: Vec<Stream>, top_n: usize, now: i64) -> StreamsData {
    let mut by_type = Vec::with_capacity(OVERVIEW_STREAM_TYPES.len());
    for stream_type in OVERVIEW_STREAM_TYPES {
        let mut of_type: Vec<&Stream> = streams
            .iter()
            .filter(|s| s.stream_type == stream_type && !is_protected_ai_chat_stream(&s.name))
            .collect();
        of_type.sort_by(|a, b| {
            b.stats
                .storage_size
                .total_cmp(&a.stats.storage_size)
                .then_with(|| a.name.cmp(&b.name))
        });
        by_type.push(StreamTypeSummary {
            stream_type: stream_type.to_string(),
            count: of_type.len() as u64,
            doc_num: of_type.iter().map(|s| s.stats.doc_num).sum(),
            storage_size_mb: of_type
                .iter()
                .fold(0.0, |acc, s| acc + s.stats.storage_size),
            compressed_size_mb: of_type
                .iter()
                .fold(0.0, |acc, s| acc + s.stats.compressed_size),
            top: of_type
                .iter()
                .take(top_n)
                .map(|s| TopStream {
                    name: s.name.clone(),
                    doc_num: s.stats.doc_num,
                    storage_size_mb: s.stats.storage_size,
                })
                .collect(),
        });
    }
    let (quiet_count, quiet) = quiet_streams(&streams, now, top_n);
    StreamsData {
        total_streams: by_type.iter().map(|t| t.count).sum(),
        total_storage_size_mb: by_type.iter().fold(0.0, |acc, t| acc + t.storage_size_mb),
        by_type,
        quiet_count,
        quiet,
        schema_changes_24h: 0,
        compaction_pending: None,
    }
}

async fn load_alerts(
    org_id: &str,
    user_id: &str,
    top_n: usize,
) -> Result<AlertsData, anyhow::Error> {
    let conn = get_orm_client_ro().await;
    let alerts: Vec<Alert> =
        crate::alerts::alert::list_v2(conn, Some(user_id), ListAlertsParams::new(org_id))
            .await?
            .into_iter()
            .map(|(_, alert)| alert)
            .collect();
    let ids: Vec<String> = alerts
        .iter()
        .filter(|a| a.enabled)
        .filter_map(|a| a.id.map(|id| id.to_string()))
        .collect();
    let mut states = Vec::with_capacity(ids.len());
    for chunk in ids.chunks(ALERT_ID_CHUNK) {
        states.extend(infra::table::alert_states::get_rollups(chunk).await?);
    }
    Ok(build_alerts_data(&alerts, &states, top_n))
}

fn build_alerts_data(alerts: &[Alert], states: &[AlertState], top_n: usize) -> AlertsData {
    let by_id: HashMap<String, &AlertState> =
        states.iter().map(|s| (s.alert_id.clone(), s)).collect();
    let mut by_state: BTreeMap<String, u64> = ALERT_STATE_KEYS
        .iter()
        .map(|k| (k.to_string(), 0))
        .collect();
    let mut by_level = zeroed_levels();
    let mut firing_by_level = zeroed_levels();
    let mut firing = Vec::new();
    let mut enabled = 0;
    let mut failed_evaluation = 0;
    for alert in alerts.iter().filter(|a| a.enabled) {
        enabled += 1;
        let state = alert.id.and_then(|id| by_id.get(&id.to_string()).copied());
        let outcome = state.and_then(|s| s.last_outcome.as_ref());
        let state_key = outcome.map_or("never_evaluated".to_string(), |o| o.to_string());
        *by_state.entry(state_key).or_insert(0) += 1;
        let level_key = state
            .and_then(|s| s.level)
            .map_or("unclassified".to_string(), |l| l.to_string());
        if let Some(state) =
            state.filter(|s| s.last_outcome.as_ref().is_some_and(|o| o.is_firing()))
        {
            *firing_by_level.entry(level_key.clone()).or_insert(0) += 1;
            firing.push(FiringAlert {
                name: alert.name.clone(),
                stream: alert.stream_name.clone(),
                level: Some(level_key.clone()),
                since: state.since.or(state.last_outcome_at).unwrap_or(0),
            });
        }
        *by_level.entry(level_key).or_insert(0) += 1;
        if outcome.is_some_and(|o| o.as_str() == "error") {
            failed_evaluation += 1;
        }
    }
    firing.sort_by(|a, b| a.since.cmp(&b.since).then_with(|| a.name.cmp(&b.name)));
    firing.truncate(top_n);
    AlertsData {
        total: alerts.len() as u64,
        enabled,
        disabled: alerts.len() as u64 - enabled,
        by_state,
        by_level,
        failed_evaluation,
        firing,
        firing_by_level,
    }
}

fn zeroed_levels() -> BTreeMap<String, u64> {
    ALERT_LEVEL_KEYS
        .iter()
        .map(|k| (k.to_string(), 0))
        .collect()
}

async fn load_pipelines(
    org_id: &str,
    grants: Option<Vec<String>>,
) -> Result<PipelinesData, anyhow::Error> {
    let pipelines = crate::pipeline::list_user_pipelines(org_id, grants).await?;
    let errored: HashSet<String> = db::pipeline_errors::list_by_org(org_id)
        .await?
        .into_iter()
        .map(|e| e.pipeline_id)
        .collect();
    Ok(build_pipelines_data(&pipelines, &errored))
}

fn build_pipelines_data(pipelines: &[Pipeline], errored: &HashSet<String>) -> PipelinesData {
    let enabled = pipelines.iter().filter(|p| p.enabled).count() as u64;
    PipelinesData {
        total: pipelines.len() as u64,
        enabled,
        disabled: pipelines.len() as u64 - enabled,
        errored: pipelines
            .iter()
            .filter(|p| p.enabled && errored.contains(&p.id))
            .count() as u64,
    }
}

#[cfg(all(feature = "enterprise", not(feature = "cloud")))]
async fn limits_section() -> Section<LimitsData> {
    use o2_enterprise::enterprise::license::{
        ingestion_limit_exceeded_count, ingestion_used, license_expired, license_status,
    };

    let decision = license_status().await.decision;
    Section::ok(LimitsData {
        scope: "deployment",
        ingestion_used_percent: ingestion_used() * 100.0,
        expired: license_expired().await,
        days_over_limit: ingestion_limit_exceeded_count(),
        used_today_gb: Some(decision.used_today_gb),
        limit_today_gb: decision.limit_today_gb,
        allowed_days: Some(decision.allowed_days),
        resets_at: next_utc_midnight_micros(now_micros()),
    })
}

#[cfg(any(not(feature = "enterprise"), feature = "cloud"))]
async fn limits_section() -> Section<LimitsData> {
    Section::locked("not available in this edition")
}

#[cfg(test)]
mod tests {
    use arrow_schema::{DataType, Field, Schema};
    use config::meta::{
        alerts::level::AlertLevel, pipeline::Pipeline, self_reporting::usage::RunOutcome,
        stream::StreamStats,
    };
    use infra::schema::{STREAM_SCHEMAS_LATEST, SchemaCache, insert_latest};

    use super::*;

    fn stream(name: &str, stream_type: StreamType, size: f64, docs: i64) -> Stream {
        Stream {
            name: name.to_string(),
            storage_type: "disk".to_string(),
            stream_type,
            stats: StreamStats {
                storage_size: size,
                compressed_size: size / 2.0,
                doc_num: docs,
                ..Default::default()
            },
            schema: vec![],
            uds_schema: vec![],
            settings: Default::default(),
            metrics_meta: None,
            total_fields: 0,
            pattern_associations: vec![],
            is_derived: None,
        }
    }

    fn alert(id: &str, enabled: bool) -> Alert {
        serde_json::from_value(serde_json::json!({"id": id, "enabled": enabled})).unwrap()
    }

    fn state(alert: &Alert, outcome: Option<RunOutcome>, level: Option<AlertLevel>) -> AlertState {
        let mut s = AlertState::empty(&alert.id.unwrap().to_string(), "");
        s.last_outcome = outcome;
        s.level = level;
        s
    }

    fn pipeline(id: &str, enabled: bool) -> Pipeline {
        Pipeline {
            id: id.to_string(),
            version: 0,
            enabled,
            org: String::new(),
            name: id.to_string(),
            description: String::new(),
            source: Default::default(),
            kind: Default::default(),
            nodes: vec![],
            edges: vec![],
        }
    }

    #[test]
    fn test_normalize_top_n() {
        assert_eq!(normalize_top_n(None), DEFAULT_TOP_N);
        assert_eq!(normalize_top_n(Some(0)), 1);
        assert_eq!(normalize_top_n(Some(7)), 7);
        assert_eq!(normalize_top_n(Some(500)), MAX_TOP_N);
    }

    #[test]
    fn test_streams_section_totals_and_top_n_per_type() {
        let streams = vec![
            stream("small", StreamType::Logs, 1.0, 10),
            stream("big", StreamType::Logs, 9.0, 90),
            stream("mid", StreamType::Logs, 5.0, 50),
            stream("m1", StreamType::Metrics, 2.0, 20),
            stream("internal", StreamType::Index, 100.0, 1),
        ];
        let data = build_streams_data(streams, 2, now_micros());
        assert_eq!(data.total_streams, 4);
        assert_eq!(data.total_storage_size_mb, 17.0);
        let logs = &data.by_type[0];
        assert_eq!(logs.stream_type, "logs");
        assert_eq!(logs.count, 3);
        assert_eq!(logs.doc_num, 150);
        let top: Vec<&str> = logs.top.iter().map(|t| t.name.as_str()).collect();
        assert_eq!(top, vec!["big", "mid"]);
        assert_eq!(data.by_type[2].count, 0);
        assert!(data.by_type[2].storage_size_mb.is_sign_positive());
        assert!(data.by_type[2].compressed_size_mb.is_sign_positive());
    }

    #[test]
    fn test_alerts_section_counts_by_state_level_and_failures() {
        let a1 = alert("2Z8rVTbWbyUjb3hIibV02e0sqHW", true);
        let a2 = alert("2Z8rVTbWbyUjb3hIibV02e0sqHX", true);
        let a3 = alert("2Z8rVTbWbyUjb3hIibV02e0sqHY", true);
        let a4 = alert("2Z8rVTbWbyUjb3hIibV02e0sqHZ", false);
        let states = vec![
            state(&a1, Some(RunOutcome::Firing), Some(AlertLevel::Critical)),
            state(&a2, Some(RunOutcome::Error), None),
            state(&a4, Some(RunOutcome::Firing), Some(AlertLevel::Warning)),
        ];
        let data = build_alerts_data(&[a1, a2, a3, a4], &states, 5);
        assert_eq!((data.total, data.enabled, data.disabled), (4, 3, 1));
        assert_eq!(data.by_state["firing"], 1);
        assert_eq!(data.by_state["error"], 1);
        assert_eq!(data.by_state["never_evaluated"], 1);
        assert_eq!(data.by_level["critical"], 1);
        assert_eq!(data.by_level["unclassified"], 2);
        assert_eq!(data.failed_evaluation, 1);
    }

    #[test]
    fn test_pipelines_section_counts_errored_among_given_pipelines() {
        let pipelines = vec![
            pipeline("p1", true),
            pipeline("p2", false),
            pipeline("p3", true),
        ];
        let errored: HashSet<String> =
            ["p1".to_string(), "p2".to_string(), "hidden".to_string()].into();
        let data = build_pipelines_data(&pipelines, &errored);
        assert_eq!(
            (data.total, data.enabled, data.disabled, data.errored),
            (3, 2, 1, 1)
        );
    }

    #[test]
    fn test_section_serialization_carries_status_and_omits_empty_fields() {
        let locked = serde_json::to_value(Section::<PipelinesData>::locked("no license")).unwrap();
        assert_eq!(
            locked,
            serde_json::json!({"status": "locked", "reason": "no license"})
        );
        let err = serde_json::to_value(Section::<PipelinesData>::error("boom")).unwrap();
        assert_eq!(err, serde_json::json!({"status": "error", "error": "boom"}));
    }

    #[cfg(any(not(feature = "enterprise"), feature = "cloud"))]
    #[tokio::test]
    async fn test_limits_locked_without_enterprise() {
        let limits = limits_section().await;
        assert_eq!(limits.status, SectionStatus::Locked);
        assert_eq!(
            limits.reason.as_deref(),
            Some("not available in this edition")
        );
    }

    #[tokio::test]
    async fn test_permitted_list_is_honoured_without_a_stream_type() {
        let org = "overview_no_type_org";
        seed_stream(org, StreamType::Logs, "visible", 1.0).await;
        seed_stream(org, StreamType::Logs, "hidden", 2.0).await;
        seed_stream(org, StreamType::Metrics, "hidden_metric", 3.0).await;
        let permitted = Some(vec!["logs:visible".to_string()]);
        let streams = try_get_streams(org, None, false, permitted).await.unwrap();
        let names: Vec<&str> = streams.iter().map(|s| s.name.as_str()).collect();
        assert_eq!(names, vec!["visible"]);
    }

    #[test]
    fn test_streams_forbidden_only_when_every_type_has_empty_grants() {
        let none: HashMap<StreamType, Vec<String>> =
            OVERVIEW_STREAM_TYPES.iter().map(|t| (*t, vec![])).collect();
        let mut scope = OverviewScope {
            user_id: "u".to_string(),
            stream_grants: none,
            pipeline_grants: None,
        };
        assert!(streams_forbidden(&scope));
        scope
            .stream_grants
            .insert(StreamType::Logs, vec!["logs:app".to_string()]);
        assert!(!streams_forbidden(&scope));
        scope.stream_grants.remove(&StreamType::Logs);
        assert!(!streams_forbidden(&scope));
    }

    async fn seed_stream(org: &str, stream_type: StreamType, name: &str, size: f64) {
        let schema = Schema::new(vec![Field::new("f", DataType::Utf8, true)]);
        {
            let mut w = STREAM_SCHEMAS_LATEST.write().await;
            insert_latest(
                &mut w,
                format!("{org}/{stream_type}/{name}"),
                SchemaCache::new(schema),
            );
        }
        infra::cache::stats::set_stream_stats(
            org,
            name,
            stream_type,
            StreamStats {
                storage_size: size * config::SIZE_IN_MB,
                compressed_size: size * config::SIZE_IN_MB,
                doc_num: 1,
                ..Default::default()
            },
        );
    }

    #[tokio::test]
    async fn test_restricted_caller_never_sees_hidden_streams() {
        let org = "overview_rbac_org";
        seed_stream(org, StreamType::Logs, "visible", 1.0).await;
        seed_stream(org, StreamType::Logs, "secret", 1000.0).await;
        seed_stream(org, StreamType::Metrics, "secret_metric", 500.0).await;

        let restricted = OverviewScope {
            user_id: "limited@example.com".to_string(),
            stream_grants: HashMap::from([
                (StreamType::Logs, vec!["logs:visible".to_string()]),
                (StreamType::Metrics, vec![]),
            ]),
            pipeline_grants: None,
        };
        let data = load_streams(org, &restricted, 5).await.unwrap();
        assert_eq!(data.total_streams, 1);
        assert_eq!(data.total_storage_size_mb, 1.0);
        let logs = &data.by_type[0];
        assert_eq!((logs.count, logs.storage_size_mb), (1, 1.0));
        let names: Vec<&str> = logs.top.iter().map(|t| t.name.as_str()).collect();
        assert_eq!(names, vec!["visible"]);
        assert_eq!(data.by_type[1].count, 0);
        assert!(data.by_type[1].top.is_empty());

        let unrestricted = OverviewScope {
            user_id: "admin@example.com".to_string(),
            ..Default::default()
        };
        let data = load_streams(org, &unrestricted, 5).await.unwrap();
        assert_eq!(data.total_streams, 3);
        assert_eq!(data.total_storage_size_mb, 1501.0);
    }

    #[tokio::test]
    async fn test_cache_is_keyed_per_caller_and_marks_hits() {
        let org = "overview_cache_org";
        seed_stream(org, StreamType::Logs, "only_for_admin", 7.0).await;
        let admin = OverviewScope {
            user_id: "admin@example.com".to_string(),
            ..Default::default()
        };
        let limited = OverviewScope {
            user_id: "limited@example.com".to_string(),
            stream_grants: HashMap::from([(StreamType::Logs, vec![])]),
            pipeline_grants: None,
        };
        let key = CacheKey {
            org_id: org.to_string(),
            user_id: admin.user_id.clone(),
            top_n: 5,
        };
        let seeded = Overview {
            streams: Section::ok(build_streams_data(
                vec![stream("only_for_admin", StreamType::Logs, 7.0, 1)],
                5,
                now_micros(),
            )),
            alerts: Section::locked("test"),
            pipelines: Section::locked("test"),
            limits: Section::locked("test"),
            generated_at: now_micros(),
            cached: false,
        };
        cache_put(key, seeded, 30 * 1_000_000);

        let hit = cached_overview(org, &admin.user_id, 5).unwrap();
        assert!(hit.cached);
        assert_eq!(hit.streams.data.unwrap().total_streams, 1);
        assert!(cached_overview(org, &limited.user_id, 5).is_none());

        let limited_key = CacheKey {
            org_id: org.to_string(),
            user_id: limited.user_id.clone(),
            top_n: 5,
        };
        assert!(CACHE.get(&limited_key).is_none());
    }

    fn stream_at(name: &str, stream_type: StreamType, doc_time_max: i64) -> Stream {
        let mut s = stream(name, stream_type, 1.0, 1);
        s.stats.doc_time_max = doc_time_max;
        s
    }

    const MIN: i64 = 60 * 1_000_000;

    #[test]
    fn test_quiet_streams_classified_at_boundaries() {
        let now = 100 * DAY_MICROS;
        let streams = vec![
            stream_at("m59", StreamType::Logs, now - 59 * MIN),
            stream_at("m61", StreamType::Logs, now - 61 * MIN),
            stream_at("d6", StreamType::Metrics, now - 6 * DAY_MICROS),
            stream_at("d8", StreamType::Traces, now - 8 * DAY_MICROS),
            stream_at("unknown", StreamType::Logs, 0),
            stream_at("lookup", StreamType::EnrichmentTables, now - 2 * 60 * MIN),
            stream_at("index", StreamType::Index, now - 2 * 60 * MIN),
        ];
        let (count, quiet) = quiet_streams(&streams, now, 1);
        assert_eq!(count, 2);
        assert_eq!(quiet.len(), 1);
        assert_eq!(quiet[0].name, "d6");
        assert_eq!(quiet[0].stream_type, "metrics");
        let (_, all) = quiet_streams(&streams, now, 5);
        let names: Vec<&str> = all.iter().map(|q| q.name.as_str()).collect();
        assert_eq!(names, vec!["d6", "m61"]);
    }

    #[test]
    fn test_streams_data_serializes_added_fields_when_empty() {
        let data = build_streams_data(vec![], 5, now_micros());
        let v = serde_json::to_value(&data).unwrap();
        assert_eq!(v["quiet_count"], 0);
        assert_eq!(v["quiet"], serde_json::json!([]));
        assert_eq!(v["schema_changes_24h"], 0);
        assert!(v["compaction_pending"].is_null());
    }

    #[test]
    fn test_sum_pending_for_org_adds_stream_types() {
        let counts = HashMap::from([
            (
                "o1".to_string(),
                HashMap::from([("logs".to_string(), 3), ("metrics".to_string(), 4)]),
            ),
            ("o2".to_string(), HashMap::from([("logs".to_string(), 9)])),
        ]);
        assert_eq!(sum_pending_for_org(&counts, "o1"), 7);
        assert_eq!(sum_pending_for_org(&counts, "none"), 0);
    }

    #[tokio::test]
    async fn test_count_schema_changes_counts_recent_versions_of_user_streams() {
        let org = "overview_schema_changes_org";
        let schema = Schema::new(vec![Field::new("f", DataType::Utf8, true)]);
        let now = now_micros();
        {
            let mut w = infra::schema::STREAM_SCHEMAS.write().await;
            w.insert(
                format!("{org}/logs/app"),
                vec![
                    (now - 2 * DAY_MICROS, schema.clone()),
                    (now - 1_000_000, schema.clone()),
                    (now - 2_000_000, schema.clone()),
                ],
            );
            w.insert(
                format!("{org}/enrichment_tables/lookup"),
                vec![(now - 1_000_000, schema)],
            );
        }
        let streams = vec![
            stream("app", StreamType::Logs, 1.0, 1),
            stream("lookup", StreamType::EnrichmentTables, 1.0, 1),
            stream("absent", StreamType::Logs, 1.0, 1),
        ];
        assert_eq!(
            count_schema_changes(org, &streams, now - DAY_MICROS).await,
            2
        );
    }

    #[test]
    fn test_next_utc_midnight_micros() {
        let midnight = 20_000 * DAY_MICROS;
        assert_eq!(next_utc_midnight_micros(midnight), midnight + DAY_MICROS);
        assert_eq!(
            next_utc_midnight_micros(midnight + 5),
            midnight + DAY_MICROS
        );
        assert_eq!(
            next_utc_midnight_micros(midnight + DAY_MICROS - 1),
            midnight + DAY_MICROS
        );
    }

    #[test]
    fn test_firing_alerts_sorted_oldest_first_capped_with_level_counts() {
        let ids = [
            "2Z8rVTbWbyUjb3hIibV02e0sqHA",
            "2Z8rVTbWbyUjb3hIibV02e0sqHB",
            "2Z8rVTbWbyUjb3hIibV02e0sqHC",
            "2Z8rVTbWbyUjb3hIibV02e0sqHD",
        ];
        let alerts: Vec<Alert> = ids
            .iter()
            .enumerate()
            .map(|(i, id)| {
                serde_json::from_value(serde_json::json!({
                    "id": id, "enabled": true, "name": format!("a{i}"), "stream_name": "s"
                }))
                .unwrap()
            })
            .collect();
        let mut states = vec![
            state(
                &alerts[0],
                Some(RunOutcome::Firing),
                Some(AlertLevel::Critical),
            ),
            state(&alerts[1], Some(RunOutcome::NotifyFailed), None),
            state(
                &alerts[2],
                Some(RunOutcome::Firing),
                Some(AlertLevel::Critical),
            ),
            state(&alerts[3], Some(RunOutcome::Normal), Some(AlertLevel::Ok)),
        ];
        states[0].since = Some(300);
        states[1].since = Some(100);
        states[2].since = Some(200);
        let data = build_alerts_data(&alerts, &states, 2);
        let names: Vec<&str> = data.firing.iter().map(|f| f.name.as_str()).collect();
        assert_eq!(names, vec!["a1", "a2"]);
        assert_eq!(data.firing[0].level.as_deref(), Some("unclassified"));
        assert_eq!(data.firing[1].level.as_deref(), Some("critical"));
        assert_eq!(data.firing[0].since, 100);
        assert_eq!(data.firing_by_level["critical"], 2);
        assert_eq!(data.firing_by_level["unclassified"], 1);
        assert_eq!(data.firing_by_level["ok"], 0);
        assert_eq!(data.by_level["ok"], 1);
        let empty = build_alerts_data(&[], &[], 5);
        let v = serde_json::to_value(&empty).unwrap();
        assert_eq!(v["firing"], serde_json::json!([]));
        assert_eq!(v["firing_by_level"]["warning"], 0);
    }
}
