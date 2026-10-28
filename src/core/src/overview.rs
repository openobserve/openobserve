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
    /// Microseconds since the epoch.
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
}

/// Clamps the requested top-N to `1..=MAX_TOP_N`, defaulting to `DEFAULT_TOP_N`.
pub fn normalize_top_n(requested: Option<usize>) -> usize {
    requested.unwrap_or(DEFAULT_TOP_N).clamp(1, MAX_TOP_N)
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

/// Overview for a caller whose grants could not be resolved; each scoped section reports an error.
pub async fn scope_unavailable() -> Overview {
    Overview {
        streams: Section::error("failed to resolve permissions"),
        alerts: Section::error("failed to resolve permissions"),
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
        async { Section::from_result(load_alerts(org_id, &scope.user_id).await, "alerts") },
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

/// True when the caller holds an empty grant list for every overview stream type.
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
    Ok(build_streams_data(streams, top_n))
}

fn build_streams_data(streams: Vec<Stream>, top_n: usize) -> StreamsData {
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
            storage_size_mb: of_type.iter().map(|s| s.stats.storage_size).sum(),
            compressed_size_mb: of_type.iter().map(|s| s.stats.compressed_size).sum(),
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
    StreamsData {
        total_streams: by_type.iter().map(|t| t.count).sum(),
        total_storage_size_mb: by_type.iter().map(|t| t.storage_size_mb).sum(),
        by_type,
    }
}

async fn load_alerts(org_id: &str, user_id: &str) -> Result<AlertsData, anyhow::Error> {
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
    Ok(build_alerts_data(&alerts, &states))
}

fn build_alerts_data(alerts: &[Alert], states: &[AlertState]) -> AlertsData {
    let by_id: HashMap<String, &AlertState> =
        states.iter().map(|s| (s.alert_id.clone(), s)).collect();
    let mut by_state: BTreeMap<String, u64> = ALERT_STATE_KEYS
        .iter()
        .map(|k| (k.to_string(), 0))
        .collect();
    let mut by_level: BTreeMap<String, u64> = ALERT_LEVEL_KEYS
        .iter()
        .map(|k| (k.to_string(), 0))
        .collect();
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
        *by_level.entry(level_key).or_insert(0) += 1;
        if outcome.is_some_and(|o| o.as_str() == "error") {
            failed_evaluation += 1;
        }
    }
    AlertsData {
        total: alerts.len() as u64,
        enabled,
        disabled: alerts.len() as u64 - enabled,
        by_state,
        by_level,
        failed_evaluation,
    }
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
        errored: pipelines.iter().filter(|p| errored.contains(&p.id)).count() as u64,
    }
}

#[cfg(feature = "enterprise")]
async fn limits_section() -> Section<LimitsData> {
    use o2_enterprise::enterprise::license::{
        get_license, ingestion_limit_exceeded_count, ingestion_used, license_expired,
    };

    if get_license().await.is_none() {
        return Section::locked("no license loaded");
    }
    Section::ok(LimitsData {
        scope: "deployment",
        ingestion_used_percent: ingestion_used() * 100.0,
        expired: license_expired().await,
        days_over_limit: ingestion_limit_exceeded_count(),
    })
}

#[cfg(not(feature = "enterprise"))]
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
        let data = build_streams_data(streams, 2);
        assert_eq!(data.total_streams, 4);
        assert_eq!(data.total_storage_size_mb, 17.0);
        let logs = &data.by_type[0];
        assert_eq!(logs.stream_type, "logs");
        assert_eq!(logs.count, 3);
        assert_eq!(logs.doc_num, 150);
        let top: Vec<&str> = logs.top.iter().map(|t| t.name.as_str()).collect();
        assert_eq!(top, vec!["big", "mid"]);
        assert_eq!(data.by_type[2].count, 0);
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
        let data = build_alerts_data(&[a1, a2, a3, a4], &states);
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
        let errored: HashSet<String> = ["p2".to_string(), "hidden".to_string()].into();
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

    #[cfg(not(feature = "enterprise"))]
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
}
