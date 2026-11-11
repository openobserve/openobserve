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

//! The engine's ports, implemented over `core`: enterprise cannot depend on search, ingest or kv.

use std::{
    collections::{BTreeSet, HashMap},
    sync::Arc,
    time::Duration,
};

use async_trait::async_trait;
use config::{
    META_ORG_ID,
    cluster::LOCAL_NODE,
    ider,
    meta::{
        search::{Query, Request},
        stream::{StreamParams, StreamPartition, StreamSettings, StreamStats, StreamType},
        triggers::{Trigger, TriggerModule},
    },
};
use infra::errors::{DbError, Error as InfraError};
use o2_enterprise::enterprise::autoobserve::{
    contract::DAY_US,
    engine::MAX_HOOK_TIMEOUT,
    job::MODULE_KEY,
    ports::{
        AiPermit, AiUsagePort, KvWritePort, Ports, QueryRejected, SearchPage, SearchPort,
        StreamSinkPort, StreamStat, StreamStatsPort, TriggerPort, stats_refresh_us,
    },
};
use serde_json::Value;

/// The stream types the engine reads; the rest are internal bookkeeping.
const STREAM_TYPES: [StreamType; 6] = [
    StreamType::Logs,
    StreamType::Metrics,
    StreamType::Traces,
    StreamType::EnrichmentTables,
    StreamType::Metadata,
    StreamType::Index,
];
/// The longest engine read (a 28-day window) plus a week; it also bounds a deleted org's rows.
const META_RETENTION_DAYS: i64 = 35;
/// Every engine read filters one `org_id`, so it opens one bucket of files, not every org's.
const ORG_BUCKETS: u64 = 32;

pub struct SearchAdapter;

#[async_trait]
impl SearchPort for SearchAdapter {
    async fn sql(
        &self,
        org: &str,
        sql: &str,
        range: (i64, i64),
        page: (i64, i64),
    ) -> anyhow::Result<SearchPage> {
        self.sql_within(org, sql, range, page, MAX_HOOK_TIMEOUT)
            .await
    }

    async fn sql_within(
        &self,
        org: &str,
        sql: &str,
        range: (i64, i64),
        page: (i64, i64),
        timeout: Duration,
    ) -> anyhow::Result<SearchPage> {
        match search(org, StreamType::Logs, sql, range, page, timeout).await {
            // The engine's own streams do not exist until their first write.
            Err(InfraError::ErrorCode(infra::errors::ErrorCodes::SearchStreamNotFound(_))) => {
                Ok(SearchPage::default())
            }
            other => other.map_err(rejected_or_failed),
        }
    }

    async fn sql_on(
        &self,
        org: &str,
        stream_type: &str,
        sql: &str,
        range: (i64, i64),
        page: (i64, i64),
    ) -> anyhow::Result<SearchPage> {
        let stream_type = stream_type_of(stream_type)?;
        search(org, stream_type, sql, range, page, MAX_HOOK_TIMEOUT)
            .await
            .map_err(rejected_or_failed)
    }

    /// A deleted org's id can be taken again, and only the creation time tells the two apart.
    async fn org_since(&self, org: &str) -> anyhow::Result<i64> {
        let record = infra::table::organizations::find(org).await?;
        Ok(record.map_or(0, |r| r.created_at))
    }

    async fn promql(
        &self,
        org: &str,
        query: &str,
        start_us: i64,
        end_us: i64,
        step_secs: i64,
    ) -> anyhow::Result<Value> {
        let req = promql_service::MetricsQueryRequest {
            query: query.to_string(),
            start: start_us,
            end: end_us,
            step: step_secs.saturating_mul(1_000_000),
            query_exemplars: false,
            use_cache: None,
            search_type: None,
            search_event_context: None,
            regions: vec![],
            clusters: vec![],
        };
        let trace_id = ider::generate_trace_id();
        let timeout = MAX_HOOK_TIMEOUT.as_secs() as i64;
        // Region-local, like every other engine read.
        let resp = promql_service::search::search(&trace_id, org, &req, "", timeout, false).await?;
        if !resp.warnings.is_empty() {
            anyhow::bail!("partial PromQL result: {}", resp.warnings.join(", "));
        }
        Ok(serde_json::to_value(resp.value)?)
    }
}

/// Engine rows land in `_meta` with an `org_id` field, so the customer org is never billed.
pub struct MetaSink;

impl MetaSink {
    /// The engine's own streams go through its `_meta` writer token; a routed gate stream does not.
    async fn append_via(
        transport: &dyn crate::ingestion::feature_writer::WriterTransport,
        stream: &str,
        rows: Vec<Value>,
    ) -> anyhow::Result<()> {
        use crate::ingestion::feature_writer::FeatureWriter;
        if rows.is_empty() {
            return Ok(());
        }
        if FeatureWriter::AutoObserve.allows(stream) {
            Self::write_engine_rows(transport, stream, &rows).await?;
        } else {
            let params = StreamParams::new(META_ORG_ID, stream, StreamType::Logs);
            crate::self_reporting::ingest_internal_logs(rows, params).await?;
        }
        if let Err(e) = keep_bounded(stream, bound_retention).await {
            log::warn!("[autoobserve] setting {stream} retention failed: {e}");
        }
        Ok(())
    }

    async fn write_engine_rows(
        transport: &dyn crate::ingestion::feature_writer::WriterTransport,
        stream: &str,
        rows: &[Value],
    ) -> anyhow::Result<()> {
        use crate::{
            ingestion::feature_writer::{self, FeatureWriter},
            traces::service_graph::v4::writer::{chunk, max_request_bytes},
        };
        // Looked up on every append, so a disable or a rotation applies to the next one.
        let token = feature_writer::token(FeatureWriter::AutoObserve, META_ORG_ID).await?;
        let chunks = chunk(rows, max_request_bytes());
        let total = chunks.len();
        for (index, data) in chunks.into_iter().enumerate() {
            if let Err(e) = feature_writer::write(transport, &token, stream, data).await {
                log::error!("[autoobserve] {stream} chunk {index} of {total} was not written: {e}");
                return Err(e.into());
            }
        }
        Ok(())
    }
}

#[async_trait]
impl StreamSinkPort for MetaSink {
    async fn append(&self, stream: &str, rows: Vec<Value>) -> anyhow::Result<()> {
        Self::append_via(
            &crate::ingestion::feature_writer::GrpcTransport,
            stream,
            rows,
        )
        .await
    }
}

/// Through `db::kv`, the one path that replicates and reaches the cluster coordinator.
pub struct KvAdapter;

#[async_trait]
impl KvWritePort for KvAdapter {
    async fn set(&self, org: &str, key: &str, value: Vec<u8>) -> anyhow::Result<()> {
        crate::kv::set(org, key, bytes::Bytes::from(value)).await
    }

    async fn delete(&self, org: &str, key: &str) -> anyhow::Result<()> {
        crate::kv::delete(org, key).await
    }

    async fn compare_and_set(
        &self,
        org: &str,
        key: &str,
        expected: Option<&[u8]>,
        value: Vec<u8>,
    ) -> anyhow::Result<bool> {
        crate::kv::compare_and_set(org, key, expected, bytes::Bytes::from(value)).await
    }

    async fn compare_and_delete(
        &self,
        org: &str,
        key: &str,
        expected: &[u8],
    ) -> anyhow::Result<bool> {
        crate::kv::compare_and_delete(org, key, expected).await
    }
    async fn compare_and_mutate_guarded(
        &self,
        org: &str,
        key: &str,
        expected: Option<&[u8]>,
        value: Option<Vec<u8>>,
        guard_key: &str,
        guard: &[u8],
    ) -> anyhow::Result<bool> {
        crate::kv::compare_and_mutate_guarded(org, key, expected, value, guard_key, guard).await
    }

    fn spans_regions(&self) -> bool {
        o2_enterprise::enterprise::common::config::get_config()
            .super_cluster
            .enabled
    }
}

/// Reads the node's stats and schema caches; no query runs.
#[derive(Default)]
pub struct StreamStatsAdapter {
    /// Every org's engine streams from one walk of the schema cache at the start of the pass.
    index: parking_lot::RwLock<Option<Arc<OrgIndex>>>,
}

#[async_trait]
impl StreamStatsPort for StreamStatsAdapter {
    async fn streams(&self, org: &str) -> anyhow::Result<Vec<StreamStat>> {
        let indexed = self.index.read().clone();
        let listed = match indexed {
            Some(index) => index.get(org).cloned().unwrap_or_default(),
            None => {
                let schemas = infra::schema::STREAM_SCHEMAS_LATEST.read().await;
                org_streams(schemas.keys(), org)
            }
        };
        Ok(listed
            .into_iter()
            .map(|(stream_type, name)| {
                let stats = infra::cache::stats::get_stream_stats(org, &name, stream_type);
                stream_stat(name, stream_type, &stats)
            })
            .collect())
    }

    async fn refresh_us(&self) -> Option<i64> {
        // Other roles never reload the stats cache, so their counts never move.
        let reloads = LOCAL_NODE.is_ingester()
            || LOCAL_NODE.is_querier()
            || LOCAL_NODE.is_compactor()
            || LOCAL_NODE.is_scheduler();
        if !reloads {
            return None;
        }
        let orgs = db::schema::list_organizations_from_cache().await.len();
        let waits = cache_waits(
            orgs,
            o2_enterprise::enterprise::common::config::get_config()
                .super_cluster
                .enabled,
        );
        let cfg = config::get_config();
        let (wal, stats) = (
            cfg.limit.max_file_retention_time,
            cfg.limit.calculate_stats_interval,
        );
        Some(stats_refresh_us(wal, stats, waits))
    }

    async fn begin_pass(&self) {
        let index = {
            let schemas = infra::schema::STREAM_SCHEMAS_LATEST.read().await;
            org_index(schemas.keys())
        };
        *self.index.write() = Some(Arc::new(index));
    }

    async fn has_field(
        &self,
        org: &str,
        stream_type: &str,
        stream: &str,
        field: &str,
    ) -> anyhow::Result<bool> {
        let schema =
            infra::schema::get_stream_schema_from_cache(org, stream, stream_type_of(stream_type)?)
                .await;
        Ok(schema.is_some_and(|s| s.field_with_name(field).is_ok()))
    }
}

/// Each org's engine streams, by type then name.
type OrgIndex = HashMap<String, Vec<(StreamType, String)>>;

/// No reason text is generated until AI metering is wired to the engine, so every ask is refused.
pub struct NoAiUsage;

#[async_trait]
impl AiUsagePort for NoAiUsage {
    async fn authorize(&self, _org: &str) -> anyhow::Result<AiPermit> {
        Ok(AiPermit::Refused(
            "AI usage metering is not connected to the engine".to_string(),
        ))
    }
}

/// The region's one engine row, kept in `infra::scheduler`, which never replicates.
pub struct EngineTrigger;

#[async_trait]
impl TriggerPort for EngineTrigger {
    async fn get(&self) -> anyhow::Result<Option<Trigger>> {
        match infra::scheduler::get(META_ORG_ID, TriggerModule::AutoObserve, MODULE_KEY).await {
            Ok(trigger) => Ok(Some(trigger)),
            Err(InfraError::DbError(DbError::KeyNotExists(_))) => Ok(None),
            Err(e) => Err(e.into()),
        }
    }

    async fn push(&self, trigger: Trigger) -> anyhow::Result<()> {
        Ok(infra::scheduler::push(trigger).await?)
    }

    async fn update(&self, trigger: Trigger) -> anyhow::Result<()> {
        Ok(infra::scheduler::update_trigger(trigger, false).await?)
    }
}

pub fn ports() -> Ports {
    Ports {
        search: Arc::new(SearchAdapter),
        sink: Arc::new(MetaSink),
        kv: Arc::new(KvAdapter),
        stream_stats: Arc::new(StreamStatsAdapter::default()),
        ai_usage: Arc::new(NoAiUsage),
        investigation: Some(Arc::new(super::incidents::IncidentInvestigation)),
        triggers: Arc::new(EngineTrigger),
    }
}

pub(crate) async fn org_streams_now(org: &str) -> Vec<(StreamType, String)> {
    let schemas = infra::schema::STREAM_SCHEMAS_LATEST.read().await;
    org_streams(schemas.keys(), org)
}

async fn search(
    org: &str,
    stream_type: StreamType,
    sql: &str,
    range: (i64, i64),
    page: (i64, i64),
    timeout: Duration,
) -> Result<SearchPage, InfraError> {
    let req = engine_request(sql, range, page, timeout);
    let trace_id = ider::generate_trace_id();
    let resp = search_service::search(&trace_id, org, stream_type, None, &req).await?;
    Ok(SearchPage {
        hits: resp.hits,
        is_partial: resp.is_partial,
    })
}

/// Every engine read is region-local, and the querier stops it at the caller's budget.
fn engine_request(sql: &str, range: (i64, i64), page: (i64, i64), timeout: Duration) -> Request {
    Request {
        query: Query {
            sql: sql.to_string(),
            start_time: range.0,
            end_time: range.1,
            from: page.0,
            size: page.1,
            ..Default::default()
        },
        regions: vec!["local".to_string()],
        clusters: vec!["local".to_string()],
        // Zero means the querier's own `query_timeout`, far past any engine budget.
        timeout: timeout.as_secs().max(1) as i64,
        use_cache: false,
        ..Default::default()
    }
}

/// Only a 400 fails the same way on every retry; 408, 409 and 429 are worth retrying.
fn rejected_or_failed(e: InfraError) -> anyhow::Error {
    match &e {
        InfraError::ErrorCode(code) if code.http_status() == 400 => {
            QueryRejected(code.to_string()).into()
        }
        _ => anyhow::anyhow!("search failed: {e}"),
    }
}

fn stream_type_of(s: &str) -> anyhow::Result<StreamType> {
    STREAM_TYPES
        .into_iter()
        .find(|t| t.as_str() == s)
        .ok_or_else(|| QueryRejected(format!("unknown stream type {s}")).into())
}

/// Leaves an operator's explicit retention and partitions alone; returns whether it changed any.
fn engine_settings(settings: &mut StreamSettings) -> bool {
    let retention = settings.data_retention == 0;
    if retention {
        settings.data_retention = META_RETENTION_DAYS;
    }
    let partition = settings.partition_keys.is_empty();
    if partition {
        settings
            .partition_keys
            .push(StreamPartition::new_hash("org_id", ORG_BUCKETS));
    }
    retention || partition
}

/// The settings cache decides, not a node-local flag: deleting a stream drops its settings.
async fn keep_bounded<'a, F, Fut>(stream: &'a str, bound: F) -> anyhow::Result<()>
where
    F: FnOnce(&'a str) -> Fut,
    Fut: Future<Output = anyhow::Result<()>>,
{
    let key = format!("{META_ORG_ID}/{}/{stream}", StreamType::Logs);
    let cached = infra::schema::get_stream_settings_atomic(&key);
    if cached.is_some_and(|s| !engine_settings(&mut (*s).clone())) {
        return Ok(());
    }
    bound(stream).await
}

/// After a write, so the stream exists; `save_stream_settings` refuses a stream that does not.
async fn bound_retention(stream: &str) -> anyhow::Result<()> {
    let mut settings = infra::schema::get_settings(META_ORG_ID, stream, StreamType::Logs)
        .await
        .map(|s| (*s).clone())
        .unwrap_or_default();
    if engine_settings(&mut settings) {
        schema::save_stream_settings(META_ORG_ID, stream, StreamType::Logs, settings).await?;
    }
    Ok(())
}

/// One org's streams when no pass has indexed them, still in a single walk.
fn org_streams<'a>(keys: impl Iterator<Item = &'a String>, org: &str) -> Vec<(StreamType, String)> {
    let prefix = format!("{org}/");
    org_index(keys.filter(|k| k.starts_with(&prefix)))
        .remove(org)
        .unwrap_or_default()
}

/// Each org's engine streams, from schema keys `{org}/{type}/{name}` visited once.
fn org_index<'a>(keys: impl Iterator<Item = &'a String>) -> OrgIndex {
    let mut found: HashMap<String, BTreeSet<(usize, String)>> = HashMap::new();
    for key in keys {
        let mut parts = key.split('/');
        let (Some(org), Some(kind), Some(name)) = (parts.next(), parts.next(), parts.next()) else {
            continue;
        };
        if let Some(i) = STREAM_TYPES.iter().position(|t| t.as_str() == kind) {
            found
                .entry(org.to_string())
                .or_default()
                .insert((i, name.to_string()));
        }
    }
    found
        .into_iter()
        .map(|(org, streams)| {
            let streams = streams
                .into_iter()
                .map(|(i, name)| (STREAM_TYPES[i], name))
                .collect();
            (org, streams)
        })
        .collect()
}

/// Docs a day over the stream's whole span, at least one day, so a fresh stream is not inflated.
fn stream_stat(name: String, stream_type: StreamType, stats: &StreamStats) -> StreamStat {
    let positive = |t: i64| (t > 0).then_some(t);
    let (min, max) = (positive(stats.doc_time_min), positive(stats.doc_time_max));
    let docs_per_day = match (stats.doc_num, min, max) {
        (n, Some(a), Some(b)) if n > 0 => {
            Some(n as f64 / ((b - a).max(DAY_US) as f64 / DAY_US as f64))
        }
        _ => None,
    };
    StreamStat {
        name,
        stream_type: stream_type.as_str().to_string(),
        doc_time_max: max,
        docs_per_day,
        doc_num: positive(stats.doc_num),
    }
}

/// A super cluster's remotes each sleep 100 ms per batch of 10 orgs; one cluster sleeps per org.
fn cache_waits(orgs: usize, super_cluster: bool) -> usize {
    if super_cluster {
        orgs.div_ceil(10)
    } else {
        orgs
    }
}

#[cfg(test)]
mod tests {
    use std::cell::Cell;

    use arrow_schema::{DataType, Field, Schema};
    use config::meta::stream::{FileKey, FileMeta};
    use infra::{errors::ErrorCodes, schema::SchemaCache};
    use o2_enterprise::enterprise::autoobserve::decision_log::engine_reads;

    use super::*;

    #[test]
    fn every_engine_search_is_region_local_and_bounded_by_the_hook_budget() {
        let req = engine_request("SELECT 1", (10, 20), (0, 100), MAX_HOOK_TIMEOUT);
        assert_eq!(req.regions, vec!["local".to_string()]);
        assert_eq!(req.clusters, vec!["local".to_string()]);
        assert_eq!(req.timeout, MAX_HOOK_TIMEOUT.as_secs() as i64);
        assert!(req.timeout > 0);
        assert!(!req.use_cache);
        assert_eq!(
            (
                req.query.sql.as_str(),
                req.query.start_time,
                req.query.end_time,
                req.query.from,
                req.query.size
            ),
            ("SELECT 1", 10, 20, 0, 100)
        );
    }

    #[test]
    fn a_callers_budget_reaches_the_querier_and_never_rounds_to_unbounded() {
        let req = engine_request("SELECT 1", (10, 20), (0, 100), Duration::from_secs(10));
        assert_eq!(req.timeout, 10);
        let req = engine_request("SELECT 1", (10, 20), (0, 100), Duration::from_millis(300));
        assert_eq!(req.timeout, 1, "zero would mean the querier's default");
    }

    #[test]
    fn engine_streams_get_a_bounded_retention_and_an_org_partition_unless_set() {
        let mut unset = StreamSettings::default();
        assert!(engine_settings(&mut unset));
        assert_eq!(unset.data_retention, META_RETENTION_DAYS);
        assert_eq!(
            unset.partition_keys,
            vec![StreamPartition::new_hash("org_id", ORG_BUCKETS)]
        );
        assert!(!engine_settings(&mut unset));
        let operator = vec![StreamPartition::new("cluster")];
        let mut chosen = StreamSettings {
            data_retention: 400,
            partition_keys: operator.clone(),
            ..Default::default()
        };
        assert!(!engine_settings(&mut chosen));
        assert_eq!(
            (chosen.data_retention, chosen.partition_keys),
            (400, operator)
        );
    }

    /// Plans each SQL the engine builds as search does, then opens files with what the plan kept.
    #[tokio::test]
    async fn every_engine_read_is_planned_onto_its_orgs_bucket_only() {
        infra::db_init().await.unwrap();
        let mut settings = StreamSettings::default();
        engine_settings(&mut settings);
        let key = &settings.partition_keys[0];
        let bucket = |org: &str| key.get_partition_value(org);
        let other = (0..100)
            .map(|i| format!("org{i}"))
            .find(|o| bucket(o) != bucket("acme"))
            .unwrap();
        let ints = ["_timestamp", "day", "window_end"];
        let texts = [
            "org_id",
            "cluster",
            "row_kind",
            "service_id",
            "suggestion_id",
            "kind",
            "subject_kind",
            "status",
            "entity_type",
            "decision_kind",
            "decision_id",
            "alert_id",
            "group_key",
            "monitor_kind",
            "monitor_id",
            "answered",
            "not_assessed",
        ];
        let fields: Vec<Field> = ints
            .iter()
            .map(|f| Field::new(*f, DataType::Int64, true))
            .chain(texts.iter().map(|f| Field::new(*f, DataType::Utf8, true)))
            .collect();
        let schema = Schema::new(fields);
        let reads = engine_reads("acme", "c1");
        assert_eq!(reads.len(), 25, "a read added or dropped: {reads:?}");
        for sql in reads {
            let stream = sql.split('"').nth(1).unwrap().to_string();
            infra::schema::merge(META_ORG_ID, &stream, StreamType::Logs, &schema, Some(1))
                .await
                .unwrap();
            let req = engine_request(&sql, (0, DAY_US), (0, 1_000), MAX_HOOK_TIMEOUT);
            let planned =
                ::search::sql::Sql::new(&req.query.into(), META_ORG_ID, StreamType::Logs, None)
                    .await
                    .unwrap();
            let equal: Vec<(String, String)> =
                planned.equal_items.values().flatten().cloned().collect();
            assert!(
                equal.contains(&("org_id".to_string(), "acme".to_string())),
                "the planner kept no org filter for {sql}"
            );
            let file = |org: &str| {
                let path = format!(
                    "files/{META_ORG_ID}/logs/{stream}/2026/11/01/10/{}/a.parquet",
                    key.get_partition_key(org)
                );
                FileKey::new(0, String::new(), path, FileMeta::default(), false)
            };
            let opens = |f: FileKey| {
                let (keys, equal, stream) =
                    (settings.partition_keys.clone(), equal.clone(), &stream);
                async move {
                    search_service::match_file(
                        META_ORG_ID,
                        StreamType::Logs,
                        stream,
                        None,
                        &f,
                        &keys,
                        &equal,
                    )
                    .await
                }
            };
            assert!(opens(file("acme")).await, "{sql}");
            assert!(!opens(file(&other)).await, "{sql} opened {other}'s bucket");
        }
    }

    #[tokio::test]
    async fn a_pass_lists_every_orgs_streams_from_one_walk() {
        let run = config::utils::time::now_micros();
        let (a, b) = (format!("ao_walk_a_{run}"), format!("ao_walk_b_{run}"));
        let keys = [
            format!("{a}/logs/app"),
            format!("{a}/metrics/cpu"),
            format!("{a}/traces/svc"),
            format!("{a}/file_list/internal"),
            format!("{b}/logs/web"),
            format!("{a}x/logs/neighbour"),
        ];
        {
            let mut w = infra::schema::STREAM_SCHEMAS_LATEST.write().await;
            for key in &keys {
                w.insert(key.clone(), SchemaCache::new(Schema::empty()));
            }
        }
        let names = |listed: Vec<StreamStat>| -> Vec<(String, String)> {
            listed
                .into_iter()
                .map(|s| (s.stream_type, s.name))
                .collect()
        };
        let unindexed = StreamStatsAdapter::default();
        let expected_a = vec![
            ("logs".to_string(), "app".to_string()),
            ("metrics".to_string(), "cpu".to_string()),
            ("traces".to_string(), "svc".to_string()),
        ];
        assert_eq!(names(unindexed.streams(&a).await.unwrap()), expected_a);
        let adapter = StreamStatsAdapter::default();
        adapter.begin_pass().await;
        {
            let mut w = infra::schema::STREAM_SCHEMAS_LATEST.write().await;
            for key in &keys {
                w.remove(key);
            }
        }
        assert_eq!(
            names(adapter.streams(&a).await.unwrap()),
            expected_a,
            "answered from the pass's index, not by walking the cache again"
        );
        assert_eq!(
            names(adapter.streams(&b).await.unwrap()),
            vec![("logs".to_string(), "web".to_string())]
        );
        assert!(unindexed.streams(&a).await.unwrap().is_empty());
        let visited = Cell::new(0);
        let index = org_index(keys.iter().inspect(|_| visited.set(visited.get() + 1)));
        assert_eq!(
            visited.get(),
            keys.len(),
            "every org from one visit per key"
        );
        assert_eq!(index.len(), 3);
    }

    #[test]
    fn a_client_error_is_a_rejection_and_anything_else_a_failure() {
        let rejected = rejected_or_failed(InfraError::ErrorCode(ErrorCodes::SearchSQLNotValid(
            "bad".to_string(),
        )));
        assert!(rejected.downcast_ref::<QueryRejected>().is_some());
        let timeout = rejected_or_failed(InfraError::ErrorCode(ErrorCodes::SearchTimeout(
            "slow".to_string(),
        )));
        assert!(timeout.downcast_ref::<QueryRejected>().is_none());
        let other = rejected_or_failed(InfraError::Message("querier down".to_string()));
        assert!(other.downcast_ref::<QueryRejected>().is_none());
        let throttled = rejected_or_failed(InfraError::ErrorCode(ErrorCodes::RatelimitExceeded(
            "busy".to_string(),
        )));
        assert!(throttled.downcast_ref::<QueryRejected>().is_none());
    }

    #[test]
    fn only_the_engine_stream_types_parse() {
        assert_eq!(stream_type_of("metrics").unwrap(), StreamType::Metrics);
        assert_eq!(
            stream_type_of("enrichment_tables").unwrap(),
            StreamType::EnrichmentTables
        );
        let unknown = stream_type_of("file_list").unwrap_err();
        assert!(unknown.downcast_ref::<QueryRejected>().is_some());
    }

    #[tokio::test]
    async fn a_node_reloading_the_stats_cache_reports_both_jobs_as_its_refresh() {
        let cfg = config::get_config();
        let (wal, stats) = (
            cfg.limit.max_file_retention_time,
            cfg.limit.calculate_stats_interval,
        );
        // Other tests in this binary write streams, so the org count can grow during the call.
        let before = db::schema::list_organizations_from_cache().await.len();
        let refresh = StreamStatsAdapter::default().refresh_us().await;
        let after = db::schema::list_organizations_from_cache().await.len();
        assert!(
            (before..=after).any(|orgs| refresh == Some(stats_refresh_us(wal, stats, orgs))),
            "{refresh:?} for {before}..={after} orgs"
        );
    }

    #[test]
    fn a_super_clusters_remotes_wait_once_per_ten_orgs() {
        assert_eq!(
            cache_waits(21_000, false),
            21_000,
            "one cluster waits per org"
        );
        assert_eq!(cache_waits(21_000, true), 2_100);
        assert_eq!(
            cache_waits(21_001, true),
            2_101,
            "a last short batch waits too"
        );
        assert_eq!(cache_waits(0, true), 0);
    }

    #[test]
    fn stream_stats_become_a_daily_rate_over_at_least_a_day() {
        let stats = |min, max, num| StreamStats {
            doc_time_min: min,
            doc_time_max: max,
            doc_num: num,
            ..Default::default()
        };
        let week = stream_stat(
            "app".into(),
            StreamType::Logs,
            &stats(DAY_US, 8 * DAY_US, 700),
        );
        assert_eq!(
            (
                week.stream_type.as_str(),
                week.doc_time_max,
                week.docs_per_day
            ),
            ("logs", Some(8 * DAY_US), Some(100.0))
        );
        let fresh = stream_stat(
            "new".into(),
            StreamType::Logs,
            &stats(DAY_US, DAY_US + 1, 50),
        );
        assert_eq!(fresh.docs_per_day, Some(50.0));
        let empty = stream_stat("idle".into(), StreamType::Traces, &stats(0, 0, 0));
        assert_eq!((empty.doc_time_max, empty.docs_per_day), (None, None));
        assert_eq!((week.doc_num, empty.doc_num), (Some(700), None));
    }

    #[tokio::test]
    async fn ai_is_refused_until_metering_is_connected() {
        let permit = NoAiUsage.authorize("default").await.unwrap();
        assert!(matches!(permit, AiPermit::Refused(_)));
    }

    #[tokio::test]
    async fn the_ports_wire_investigations_to_the_incident_path() {
        use o2_enterprise::enterprise::autoobserve::{
            contract::{ActionKind, ActionRequest},
            ports::ActionRefused,
        };

        let port = ports().investigation.expect("the incident path is wired");
        // Not on a stream, so the incident path answers without opening an incident.
        let request = ActionRequest {
            org: "demo-org".into(),
            entity_type: "stream".into(),
            entity_id: "checkout".into(),
            decision_kind: "stream_silence".into(),
            group_key: String::new(),
            action: ActionKind::Investigate,
            signal_at: 1,
            peers: Vec::new(),
        };
        let e = port.start(&request).await.unwrap_err();
        // ENT defaults incidents on; then the request passes the gate into the incident path.
        let on = crate::alerts::incidents::incidents_enabled();
        assert_eq!(e.downcast_ref::<ActionRefused>().is_some(), !on, "{e}");
        if on {
            assert_eq!(e.to_string(), "the finding is not on a stream");
        }
    }

    /// Deleting a stream drops its cached settings, so the re-created stream is bounded again.
    #[tokio::test]
    async fn a_recreated_engine_stream_is_bounded_again() {
        use std::sync::atomic::{AtomicUsize, Ordering::SeqCst};
        let stream = "_o2_autoobserve_f5_recreated";
        let key = format!("{META_ORG_ID}/{}/{stream}", StreamType::Logs);
        let calls = AtomicUsize::new(0);
        let bound = |_: &str| {
            calls.fetch_add(1, SeqCst);
            let key = key.clone();
            async move {
                let mut settings = StreamSettings::default();
                engine_settings(&mut settings);
                infra::schema::put_stream_settings(key, Arc::new(settings)).await;
                anyhow::Ok(())
            }
        };
        keep_bounded(stream, bound).await.unwrap();
        keep_bounded(stream, bound).await.unwrap();
        assert_eq!(calls.load(SeqCst), 1, "a bounded stream is not saved again");
        infra::schema::remove_stream_settings(&key).await;
        keep_bounded(stream, bound).await.unwrap();
        assert_eq!(
            calls.load(SeqCst),
            2,
            "the re-created stream was never bounded"
        );
        let defaults = Arc::new(StreamSettings::default());
        infra::schema::put_stream_settings(key.clone(), defaults).await;
        keep_bounded(stream, bound).await.unwrap();
        assert_eq!(calls.load(SeqCst), 3, "re-created with default settings");
        infra::schema::remove_stream_settings(&key).await;
    }

    /// Ingests in-process as the ingest handler does once a writer's request passed its scope.
    struct InProcessIngester;

    #[async_trait]
    impl crate::ingestion::feature_writer::WriterTransport for InProcessIngester {
        async fn send(
            &self,
            request: tonic::Request<proto::cluster_rpc::IngestionRequest>,
        ) -> Result<proto::cluster_rpc::IngestionResponse, tonic::Status> {
            use ingestion_common::{IngestUser, IngestionRequest, SystemJobType};
            let body = request.into_inner();
            let data = body.data.unwrap_or_default().data;
            crate::logs::ingest::ingest(
                0,
                &body.org_id,
                &body.stream_name,
                IngestionRequest::Usage(bytes::Bytes::from(data)),
                IngestUser::SystemJob(SystemJobType::AutoObserve),
                None,
                false,
            )
            .await
            .map_err(|e| tonic::Status::internal(e.to_string()))?;
            Ok(proto::cluster_rpc::IngestionResponse {
                status_code: 200,
                message: "OK".to_string(),
            })
        }
    }

    #[tokio::test]
    async fn meta_sink_writes_autoobserve_streams_with_the_meta_writer_token() {
        use crate::ingestion::feature_writer::tests::{RecordingTransport, meta_store};
        meta_store().await;
        let transport = RecordingTransport::answering(200);
        let row = serde_json::json!({"org_id": "demo-org", "probe": 1});
        MetaSink::append_via(&transport, "_o2_autoobserve_health", vec![row.clone()])
            .await
            .unwrap();
        let sent = transport.credentials();
        assert_eq!(sent.len(), 1);
        let (credentials, org, body) = &sent[0];
        let token = db::org_ingestion_tokens::get_by_name(META_ORG_ID, "_o2_autoobserve")
            .await
            .unwrap()
            .expect("the writer made its _meta token");
        assert_eq!(
            credentials,
            &format!("autoobserve@system.local:{}", token.token)
        );
        assert_eq!(
            (org.as_str(), body.org_id.as_str()),
            (META_ORG_ID, META_ORG_ID)
        );
        assert_eq!(body.stream_name, "_o2_autoobserve_health");
        assert_eq!(
            body.ingestion_type,
            Some(proto::cluster_rpc::IngestionType::Usage as i32)
        );

        let routed = format!("ao_gate_decisions_{}", config::utils::time::now_micros());
        MetaSink::append_via(&transport, &routed, vec![row])
            .await
            .unwrap();
        assert_eq!(
            transport.credentials().len(),
            1,
            "a routed stream used the writer token"
        );
        let schema = infra::schema::get(META_ORG_ID, &routed, StreamType::Logs)
            .await
            .unwrap();
        assert!(
            schema.field_with_name("probe").is_ok(),
            "{routed} kept no row"
        );
    }

    /// The real sink path: the engine's write lands, a user's write to the same stream is refused.
    #[tokio::test]
    async fn a_storage_failure_or_refused_rows_fail_the_engine_append() {
        use crate::ingestion::feature_writer::tests::{RecordingTransport, meta_store};
        meta_store().await;
        for code in [500, 207] {
            let transport = RecordingTransport::answering(code);
            let row = serde_json::json!({"org_id": "demo-org", "probe": 1});
            let appended =
                MetaSink::append_via(&transport, "_o2_autoobserve_health", vec![row]).await;
            assert!(appended.is_err(), "a {code} reply let the engine move on");
        }
    }

    #[tokio::test]
    async fn the_meta_sink_writes_every_engine_stream_and_a_user_cannot() {
        use ingestion_common::{IngestUser, IngestionRequest};
        use o2_enterprise::enterprise::autoobserve::names::{decision_kinds, streams};
        crate::ingestion::feature_writer::tests::meta_store().await;
        let decisions = streams::decisions(decision_kinds::STREAM_SILENCE);
        for stream in streams::ALL.iter().copied().chain([decisions.as_str()]) {
            let row = serde_json::json!({"org_id": "acme", "probe": 1});
            MetaSink::append_via(&InProcessIngester, stream, vec![row.clone()])
                .await
                .unwrap_or_else(|e| panic!("{stream}: {e}"));
            let schema = infra::schema::get(META_ORG_ID, stream, StreamType::Logs)
                .await
                .unwrap();
            assert!(
                schema.field_with_name("probe").is_ok(),
                "{stream} kept no row"
            );
            let body = bytes::Bytes::from(Value::Array(vec![row]).to_string());
            let user = IngestUser::User("someone@example.com".to_string());
            let written = crate::logs::ingest::ingest(
                0,
                META_ORG_ID,
                stream,
                IngestionRequest::JSON(body),
                user,
                None,
                false,
            )
            .await;
            assert!(written.is_err(), "{stream} took a user write");
        }
    }
}
