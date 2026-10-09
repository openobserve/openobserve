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

//! Suggested values of one dimension from the inventory, the registry and a search (P2-2).

use std::{
    cmp::Reverse,
    collections::{BTreeMap, HashMap, HashSet},
    future::Future,
    time::Duration,
};

use config::meta::{
    correlation::FieldAlias,
    downtimes::{DimensionCondition, TargetModule, ValueSuggestion, ValuesRequest, ValuesResponse},
    oncall::routing::pair_matches,
    stream::StreamType,
};
use futures::StreamExt;
use o2_enterprise::enterprise::{
    downtimes::scope::and_eq_pairs,
    oncall::routing::normalize_value,
    service_streams::{meta::ServiceMetadata, storage::ServiceStorage},
};

use super::{DowntimeError, matching::Inventory};

/// The suggestion list stops here, and the search runs only while fewer values are known.
pub const MAX_VALUES: usize = 50;
/// Streams searched at the same time; the rest wait for a slot under the same deadline.
pub const MAX_SEARCH_STREAMS: usize = 10;
const VALUES_WINDOW_MICROS: i64 = 3_600 * 1_000_000;
const VALUES_DEADLINE: Duration = Duration::from_secs(2);
const VALUES_ROWS_PER_STREAM: usize = 100;
/// Stream types whose schemas can carry a dimension column.
const SEARCHED_TYPES: [StreamType; 3] = [StreamType::Logs, StreamType::Metrics, StreamType::Traces];
/// Modules whose items carry an identity; synthetics have none.
const IDENTITY_MODULES: [TargetModule; 3] = [
    TargetModule::Alerts,
    TargetModule::AnomalyDetections,
    TargetModule::Slos,
];

/// Where a value was seen; the order is the ranking order.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum Source {
    Inventory,
    Registry,
    Search,
}

impl Source {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Inventory => "inventory",
            Self::Registry => "registry",
            Self::Search => "search",
        }
    }
}

/// One value as one source reported it, normalized.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Found {
    pub value: String,
    pub source: Source,
    pub items: usize,
    pub last_seen: Option<i64>,
    /// `<type>/<name>` of the streams behind the value.
    pub streams: Vec<String>,
}

/// What a search reads: the dimension, the narrowing pairs, its window, deadline and row cap.
#[derive(Clone, Copy, Debug)]
pub struct SearchPlan<'a> {
    pub key: &'a str,
    pub pairs: &'a [(String, String)],
    /// Normalized; empty searches without a value filter.
    pub prefix: &'a str,
    pub window_micros: i64,
    pub deadline: Duration,
    pub rows_per_stream: usize,
}

/// A stream of the org with those of its columns a search could need.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct KnownStream {
    pub stream_type: StreamType,
    pub stream: String,
    pub columns: HashSet<String>,
}

/// One stream to search, with the raw column behind each semantic dimension.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct StreamQuery {
    pub stream_type: StreamType,
    pub stream: String,
    pub sql: String,
}

pub async fn values(
    org: &str,
    user_id: &str,
    req: &ValuesRequest,
) -> Result<ValuesResponse, DowntimeError> {
    let groups = db::system_settings::get_semantic_field_groups(org).await;
    ensure_dimension(&groups, &req.key)?;
    let pairs = narrowing_pairs(req.condition.as_ref(), &req.key);
    let prefix = normalize_value(&req.prefix);
    let inventory = super::inventory::cached(org).await?;
    let records = registry_records(org, &pairs).await?;
    let mut known = inventory_values(&inventory, &req.key, &pairs);
    known.extend(registry_values(&records, &req.key, &pairs));
    let may_search = !is_priority(org, &req.key).await?;
    let plan = SearchPlan {
        key: &req.key,
        pairs: &pairs,
        prefix: &prefix,
        window_micros: VALUES_WINDOW_MICROS,
        deadline: VALUES_DEADLINE,
        rows_per_stream: VALUES_ROWS_PER_STREAM,
    };
    let (records, groups) = (&records, &groups);
    let search = move || async move {
        let streams = stream_columns(org, groups, &plan).await;
        let queries = stream_queries(records, groups, &streams, &plan);
        search_values(org, user_id, queries, &plan).await
    };
    Ok(answer(&prefix, known, may_search, search).await)
}

/// Filters the known values by the prefix and searches only when allowed and still short.
pub async fn answer<S, Fut>(
    prefix: &str,
    known: Vec<Found>,
    may_search: bool,
    search: S,
) -> ValuesResponse
where
    S: FnOnce() -> Fut,
    Fut: Future<Output = (Vec<Found>, bool)>,
{
    let mut found: Vec<Found> = known
        .into_iter()
        .filter(|f| f.value.contains(prefix))
        .collect();
    let mut partial = false;
    if may_search && distinct(&found) < MAX_VALUES {
        let (hits, timed_out) = search().await;
        found.extend(hits.into_iter().filter(|f| f.value.contains(prefix)));
        partial = timed_out;
    }
    ValuesResponse {
        values: merge_and_rank(found, prefix),
        partial,
    }
}

pub fn ensure_dimension(groups: &[FieldAlias], key: &str) -> Result<(), DowntimeError> {
    if groups.iter().any(|g| g.id == key) {
        Ok(())
    } else {
        Err(DowntimeError::BadRequest(format!(
            "`{key}` is not a dimension of this organization."
        )))
    }
}

/// The `=` pairs of the And spine without the edited key or an empty value, normalized.
pub fn narrowing_pairs(condition: Option<&DimensionCondition>, key: &str) -> Vec<(String, String)> {
    condition
        .map(and_eq_pairs)
        .unwrap_or_default()
        .into_iter()
        .filter(|(k, v)| k != key && !v.trim().is_empty())
        .map(|(k, v)| (k, normalize_value(&v)))
        .collect()
}

pub async fn registry_records(
    org: &str,
    pairs: &[(String, String)],
) -> Result<Vec<ServiceMetadata>, DowntimeError> {
    ServiceStorage::list_by_all_dimensions(org, pairs)
        .await
        .map_err(|e| DowntimeError::Internal(e.to_string()))
}

/// The registry answers a priority dimension itself, so no search runs for one.
pub async fn is_priority(org: &str, key: &str) -> Result<bool, DowntimeError> {
    Ok(ServiceStorage::get_priority_dimensions(org)
        .await
        .map_err(|e| DowntimeError::Internal(e.to_string()))?
        .iter()
        .any(|d| d == key))
}

/// One value per `dims[key]` of the items that carry every pair, with how many carry it.
pub fn inventory_values(
    inventory: &Inventory,
    key: &str,
    pairs: &[(String, String)],
) -> Vec<Found> {
    let mut counts: BTreeMap<String, usize> = BTreeMap::new();
    for module in IDENTITY_MODULES {
        for item in inventory.items(module) {
            let Some(value) = item.dims.get(key) else {
                continue;
            };
            let carries = pairs.iter().all(|(k, want)| {
                item.dims
                    .get(k)
                    .is_some_and(|actual| pair_matches(want, &normalize_value(actual)))
            });
            if carries {
                *counts.entry(normalize_value(value)).or_default() += 1;
            }
        }
    }
    counts
        .into_iter()
        .map(|(value, items)| Found {
            value,
            source: Source::Inventory,
            items,
            last_seen: None,
            streams: vec![],
        })
        .collect()
}

/// One value per record that carries every pair; `service` falls back to the service name.
pub fn registry_values(
    records: &[ServiceMetadata],
    key: &str,
    pairs: &[(String, String)],
) -> Vec<Found> {
    records
        .iter()
        .filter(|record| ServiceStorage::matches_all_dimensions(record, pairs))
        .filter_map(|record| {
            let value = record.all_dimensions.get(key).or_else(|| {
                (key == "service" && !record.service_name.is_empty())
                    .then_some(&record.service_name)
            })?;
            Some(Found {
                value: normalize_value(value),
                source: Source::Registry,
                items: 0,
                last_seen: (record.last_seen > 0).then_some(record.last_seen),
                streams: stream_names(record),
            })
        })
        .collect()
}

/// Every log, metric and trace stream of the org, with the group fields it carries.
pub async fn stream_columns(
    org: &str,
    groups: &[FieldAlias],
    plan: &SearchPlan<'_>,
) -> BTreeMap<String, KnownStream> {
    let wanted = wanted_fields(groups, plan);
    let prefix = format!("{org}/");
    let mut streams = BTreeMap::new();
    for (key, schema) in infra::schema::STREAM_SCHEMAS_LATEST.read().await.iter() {
        let Some((kind, stream)) = key.strip_prefix(&prefix).and_then(|k| k.split_once('/')) else {
            continue;
        };
        let stream_type = StreamType::from(kind);
        if !SEARCHED_TYPES.contains(&stream_type) {
            continue;
        }
        let columns: HashSet<String> = wanted
            .iter()
            .filter(|f| schema.contains_field(f))
            .cloned()
            .collect();
        if columns.is_empty() {
            continue;
        }
        streams.insert(
            format!("{stream_type}/{stream}"),
            KnownStream {
                stream_type,
                stream: stream.to_string(),
                columns,
            },
        );
    }
    streams
}

/// The streams of the freshest records first, then every other stream whose own columns answer.
pub fn stream_queries(
    records: &[ServiceMetadata],
    groups: &[FieldAlias],
    streams: &BTreeMap<String, KnownStream>,
    plan: &SearchPlan<'_>,
) -> Vec<StreamQuery> {
    let mut fresh: Vec<&ServiceMetadata> = records.iter().collect();
    fresh.sort_by_key(|record| Reverse(record.last_seen));
    let mut queries: Vec<StreamQuery> = Vec::new();
    for record in fresh {
        for (stream_type, stream) in streams_of(record) {
            let columns = streams
                .get(&format!("{stream_type}/{stream}"))
                .map(|s| &s.columns);
            let mapping = &record.field_name_mapping;
            if let Some(query) = stream_query(stream_type, &stream, mapping, groups, columns, plan)
                && !queries.contains(&query)
            {
                queries.push(query);
            }
        }
    }
    let unmapped = HashMap::new();
    for known in streams.values() {
        let searched = queries
            .iter()
            .any(|q| q.stream_type == known.stream_type && q.stream == known.stream);
        if searched {
            continue;
        }
        let columns = Some(&known.columns);
        if let Some(query) = stream_query(
            known.stream_type,
            &known.stream,
            &unmapped,
            groups,
            columns,
            plan,
        ) {
            queries.push(query);
        }
    }
    queries
}

/// Skips streams the caller may not search, since their values would leak; true when incomplete.
pub async fn search_values(
    org: &str,
    user_id: &str,
    queries: Vec<StreamQuery>,
    plan: &SearchPlan<'_>,
) -> (Vec<Found>, bool) {
    let end = config::utils::time::now_micros();
    let start = end - plan.window_micros;
    let timeout_secs = plan.deadline.as_secs().max(1) as i64;
    let rows = plan.rows_per_stream;
    run_parallel(queries, plan.deadline, move |query| async move {
        if !may_search(org, user_id, &query).await {
            return (vec![], false);
        }
        match run_search(org, &query, start, end, rows, timeout_secs).await {
            Ok((hits, partial)) => (
                hits.iter()
                    .filter_map(|hit| hit_value(hit, &query))
                    .collect(),
                partial,
            ),
            Err(e) => {
                log::warn!(
                    "[DOWNTIMES] values search on {}/{} failed: {e}",
                    query.stream_type,
                    query.stream
                );
                (vec![], true)
            }
        }
    })
    .await
}

/// Runs the queries ten at a time and keeps what answered before the deadline; true if incomplete.
pub async fn run_parallel<F, Fut>(
    queries: Vec<StreamQuery>,
    deadline: Duration,
    run: F,
) -> (Vec<Found>, bool)
where
    F: FnMut(StreamQuery) -> Fut,
    Fut: Future<Output = (Vec<Found>, bool)>,
{
    let until = tokio::time::Instant::now() + deadline;
    let mut pending = futures::stream::iter(queries)
        .map(run)
        .buffer_unordered(MAX_SEARCH_STREAMS);
    let mut found = Vec::new();
    let mut partial = false;
    loop {
        match tokio::time::timeout_at(until, pending.next()).await {
            Ok(Some((hits, cut))) => {
                found.extend(hits);
                partial |= cut;
            }
            Ok(None) => return (found, partial),
            Err(_) => return (found, true),
        }
    }
}

/// One entry per value: the first source, the inventory's count, the newest sighting, all streams.
pub fn merge(found: Vec<Found>) -> Vec<Found> {
    let mut by_value: HashMap<String, Found> = HashMap::new();
    for f in found {
        match by_value.get_mut(&f.value) {
            Some(known) => {
                known.source = known.source.min(f.source);
                known.items += f.items;
                known.last_seen = known.last_seen.max(f.last_seen);
                for stream in f.streams {
                    if !known.streams.contains(&stream) {
                        known.streams.push(stream);
                    }
                }
            }
            None => {
                by_value.insert(f.value.clone(), f);
            }
        }
    }
    by_value.into_values().collect()
}

/// Section 5: source, then prefix before substring, then newest, then the value; cut at 50.
pub fn merge_and_rank(found: Vec<Found>, prefix: &str) -> Vec<ValueSuggestion> {
    let mut merged = merge(found);
    merged.sort_by(|a, b| {
        a.source
            .cmp(&b.source)
            .then_with(|| (!a.value.starts_with(prefix)).cmp(&!b.value.starts_with(prefix)))
            .then_with(|| b.last_seen.cmp(&a.last_seen))
            .then_with(|| a.value.cmp(&b.value))
    });
    merged.truncate(MAX_VALUES);
    merged
        .into_iter()
        .map(|f| ValueSuggestion {
            value: f.value,
            source: f.source.as_str().to_string(),
            items: f.items,
            last_seen: f.last_seen,
        })
        .collect()
}

pub fn streams_of(record: &ServiceMetadata) -> Vec<(StreamType, String)> {
    let mut out = BTreeMap::new();
    for info in record
        .streams
        .logs
        .iter()
        .chain(&record.streams.metrics)
        .chain(&record.streams.traces)
    {
        out.insert(
            (info.stream_type.to_string(), info.stream_name.clone()),
            info.stream_type,
        );
    }
    out.into_iter()
        .map(|((_, name), stream_type)| (stream_type, name))
        .collect()
}

fn stream_names(record: &ServiceMetadata) -> Vec<String> {
    streams_of(record)
        .into_iter()
        .map(|(stream_type, name)| format!("{stream_type}/{name}"))
        .collect()
}

fn distinct(found: &[Found]) -> usize {
    found.iter().map(|f| &f.value).collect::<HashSet<_>>().len()
}

/// A raw field name such as `hostname` names its semantic group.
fn group_id<'a>(groups: &'a [FieldAlias], key: &'a str) -> &'a str {
    if groups.iter().any(|g| g.id == key) {
        return key;
    }
    groups
        .iter()
        .find(|g| g.fields.iter().any(|f| f == key))
        .map_or(key, |g| g.id.as_str())
}

fn mapped_column(
    mapping: &HashMap<String, String>,
    groups: &[FieldAlias],
    key: &str,
) -> Option<String> {
    mapping
        .get(group_id(groups, key))
        .or_else(|| mapping.get(key))
        .cloned()
}

/// The record's mapping first, else the first of the group's own fields the stream has.
fn column_for(
    mapping: &HashMap<String, String>,
    groups: &[FieldAlias],
    stream_columns: Option<&HashSet<String>>,
    key: &str,
) -> Option<String> {
    if let Some(raw) = mapped_column(mapping, groups, key) {
        return Some(raw);
    }
    let stream_columns = stream_columns?;
    let id = group_id(groups, key);
    groups
        .iter()
        .filter(|g| g.id == id)
        .flat_map(|g| g.fields.iter().map(String::as_str))
        .chain(std::iter::once(key))
        .find(|field| stream_columns.contains(*field))
        .map(str::to_string)
}

/// The group fields of the key and of every pair key, as a stream schema may name them.
fn wanted_fields(groups: &[FieldAlias], plan: &SearchPlan<'_>) -> HashSet<String> {
    let keys = std::iter::once(plan.key).chain(plan.pairs.iter().map(|(k, _)| k.as_str()));
    let mut wanted = HashSet::new();
    for key in keys {
        let id = group_id(groups, key);
        wanted.insert(key.to_string());
        for group in groups.iter().filter(|g| g.id == id) {
            wanted.extend(group.fields.iter().cloned());
        }
    }
    wanted
}

fn stream_query(
    stream_type: StreamType,
    stream: &str,
    mapping: &HashMap<String, String>,
    groups: &[FieldAlias],
    columns: Option<&HashSet<String>>,
    plan: &SearchPlan<'_>,
) -> Option<StreamQuery> {
    let column_of = |key: &str| column_for(mapping, groups, columns, key);
    let column = column_of(plan.key)?;
    let mut filters = plan
        .pairs
        .iter()
        .map(|(key, value)| column_of(key).map(|raw| equality(&raw, value)))
        .collect::<Option<Vec<String>>>()?;
    if !plan.prefix.is_empty() {
        filters.push(contains(&column, plan.prefix));
    }
    Some(StreamQuery {
        sql: distinct_values_sql(stream, &column, &filters, plan.rows_per_stream),
        stream_type,
        stream: stream.to_string(),
    })
}

async fn may_search(org: &str, user_id: &str, query: &StreamQuery) -> bool {
    let denied = crate::authz::check_stream_permissions(
        &query.stream,
        org,
        user_id,
        &query.stream_type,
        crate::authz::StreamPermissionResourceType::Search,
    )
    .await
    .is_some();
    if denied {
        log::debug!(
            "[DOWNTIMES] values: {user_id} may not search {}/{}; skipped",
            query.stream_type,
            query.stream
        );
    }
    !denied
}

async fn run_search(
    org: &str,
    query: &StreamQuery,
    start_time: i64,
    end_time: i64,
    rows: usize,
    timeout_secs: i64,
) -> Result<(Vec<serde_json::Value>, bool), anyhow::Error> {
    let req = config::meta::search::Request {
        query: config::meta::search::Query {
            sql: query.sql.clone(),
            from: 0,
            size: rows as i64,
            start_time,
            end_time,
            ..Default::default()
        },
        encoding: config::meta::search::RequestEncoding::Empty,
        regions: vec![],
        clusters: vec![],
        timeout: timeout_secs,
        search_type: None,
        search_event_context: None,
        use_cache: false,
        clear_cache: false,
        local_mode: None,
        agent_options: None,
    };
    let trace_id = config::ider::generate();
    let resp = crate::search::search(&trace_id, org, query.stream_type, None, &req).await?;
    Ok((resp.hits, resp.is_partial))
}

fn hit_value(hit: &serde_json::Value, query: &StreamQuery) -> Option<Found> {
    let value = match hit.get("value")? {
        serde_json::Value::String(s) => s.clone(),
        serde_json::Value::Null => return None,
        other => other.to_string(),
    };
    Some(Found {
        value: normalize_value(&value),
        source: Source::Search,
        items: 0,
        last_seen: hit.get("last_seen").and_then(|v| v.as_i64()),
        streams: vec![format!("{}/{}", query.stream_type, query.stream)],
    })
}

/// A trailing `*` is a prefix, as in ownership rules.
fn equality(column: &str, value: &str) -> String {
    let escaped = value.replace('\'', "''");
    match escaped.strip_suffix('*') {
        Some(prefix) => format!("\"{column}\" LIKE '{prefix}%'"),
        None => format!("\"{column}\" = '{escaped}'"),
    }
}

/// Wildcards in the needle only widen the hits; the caller filters them again.
fn contains(column: &str, needle: &str) -> String {
    let escaped = needle.replace('\'', "''");
    format!("LOWER(\"{column}\") LIKE '%{escaped}%'")
}

fn distinct_values_sql(stream: &str, column: &str, filters: &[String], rows: usize) -> String {
    let filter = if filters.is_empty() {
        String::new()
    } else {
        format!(" WHERE {}", filters.join(" AND "))
    };
    format!(
        "SELECT \"{column}\" AS value, max(_timestamp) AS last_seen FROM \"{stream}\"{filter} GROUP BY \"{column}\" LIMIT {rows}"
    )
}

#[cfg(test)]
mod tests {
    use std::sync::{
        Arc,
        atomic::{AtomicUsize, Ordering},
    };

    use config::meta::{
        downtimes::{LogicalOp, PairOperator},
        service_streams::StreamInfo,
    };
    use o2_enterprise::enterprise::service_streams::meta::ServiceStreams;

    use super::{super::matching::Item, *};

    fn eq(key: &str, value: &str) -> DimensionCondition {
        DimensionCondition::Pair {
            key: key.to_string(),
            operator: PairOperator::Eq,
            value: value.to_string(),
        }
    }

    fn found(value: &str, source: Source, items: usize, last_seen: Option<i64>) -> Found {
        Found {
            value: value.to_string(),
            source,
            items,
            last_seen,
            streams: vec![],
        }
    }

    fn item(id: &str, dims: &[(&str, &str)]) -> Item {
        Item {
            id: id.to_string(),
            name: id.to_string(),
            dims: dims
                .iter()
                .map(|(k, v)| (k.to_string(), v.to_string()))
                .collect(),
            ..Default::default()
        }
    }

    fn acme_inventory() -> Inventory {
        Inventory {
            alerts: vec![
                item("payments-api-errors", &[("service", "payments-api")]),
                item(
                    "payments-api-latency-node1",
                    &[("service", "payments-api"), ("host", "node-1")],
                ),
                item(
                    "payments-worker-lag",
                    &[("service", "payments-worker"), ("host", "node-4")],
                ),
            ],
            anomalies: vec![item("cpu-anomaly", &[("service", "payments-api")])],
            synthetics: vec![],
            slos: vec![item("checkout-slo", &[("service", "checkout")])],
        }
    }

    fn record(
        service: &str,
        host: &str,
        last_seen: i64,
        stream: &str,
        mapping: &[(&str, &str)],
    ) -> ServiceMetadata {
        ServiceMetadata {
            service_name: service.to_string(),
            streams: ServiceStreams {
                logs: HashSet::from([StreamInfo {
                    stream_name: stream.to_string(),
                    stream_type: StreamType::Logs,
                    filters: HashMap::new(),
                    dropped_dimensions: vec![],
                }]),
                ..Default::default()
            },
            last_seen,
            disambiguation: HashMap::new(),
            set_id: "default".to_string(),
            all_dimensions: HashMap::from([
                ("service".to_string(), service.to_string()),
                ("host".to_string(), host.to_string()),
            ]),
            field_name_mapping: mapping
                .iter()
                .map(|(k, v)| (k.to_string(), v.to_string()))
                .collect(),
        }
    }

    fn host_group() -> Vec<FieldAlias> {
        vec![
            FieldAlias {
                id: "service".to_string(),
                display: "Service".to_string(),
                group: None,
                fields: vec!["service".to_string(), "service_name".to_string()],
                is_workload_type: false,
            },
            FieldAlias {
                id: "host".to_string(),
                display: "Host".to_string(),
                group: None,
                fields: vec!["host".to_string(), "hostname".to_string()],
                is_workload_type: false,
            },
        ]
    }

    fn plan<'a>(key: &'a str, pairs: &'a [(String, String)], prefix: &'a str) -> SearchPlan<'a> {
        SearchPlan {
            key,
            pairs,
            prefix,
            window_micros: VALUES_WINDOW_MICROS,
            deadline: VALUES_DEADLINE,
            rows_per_stream: VALUES_ROWS_PER_STREAM,
        }
    }

    fn known(stream: &str, columns: &[&str]) -> (String, KnownStream) {
        (
            format!("logs/{stream}"),
            KnownStream {
                stream_type: StreamType::Logs,
                stream: stream.to_string(),
                columns: columns.iter().map(|c| c.to_string()).collect(),
            },
        )
    }

    fn no_search() -> std::future::Ready<(Vec<Found>, bool)> {
        panic!("the search must not run")
    }

    #[test]
    fn a_value_from_all_three_sources_appears_once_as_inventory_with_the_newest_last_seen() {
        let ranked = merge_and_rank(
            vec![
                found("node-1", Source::Inventory, 1, None),
                found("node-1", Source::Registry, 0, Some(10)),
                found("node-1", Source::Search, 0, Some(30)),
                found("node-2", Source::Registry, 0, Some(20)),
                found("node-9", Source::Search, 0, Some(40)),
            ],
            "",
        );
        assert_eq!(
            ranked[0],
            ValueSuggestion {
                value: "node-1".to_string(),
                source: "inventory".to_string(),
                items: 1,
                last_seen: Some(30),
            }
        );
        let order: Vec<&str> = ranked.iter().map(|v| v.value.as_str()).collect();
        assert_eq!(order, ["node-1", "node-2", "node-9"]);
    }

    #[test]
    fn inside_a_source_a_prefix_match_ranks_before_a_substring_match_then_newest_first() {
        let ranked = merge_and_rank(
            vec![
                found("old-pay", Source::Registry, 0, Some(99)),
                found("pay-b", Source::Registry, 0, Some(1)),
                found("pay-a", Source::Registry, 0, Some(5)),
            ],
            "pay",
        );
        let order: Vec<&str> = ranked.iter().map(|v| v.value.as_str()).collect();
        assert_eq!(order, ["pay-a", "pay-b", "old-pay"]);
        let many = (0..80)
            .map(|i| found(&format!("h{i}"), Source::Search, 0, Some(i)))
            .collect();
        assert_eq!(merge_and_rank(many, "").len(), MAX_VALUES);
    }

    #[tokio::test]
    async fn prefix_pay_lists_the_payments_services_and_not_checkout() {
        let known = inventory_values(&acme_inventory(), "service", &[]);
        let resp = answer("pay", known, false, no_search).await;
        assert_eq!(
            resp.values,
            vec![
                ValueSuggestion {
                    value: "payments-api".to_string(),
                    source: "inventory".to_string(),
                    items: 3,
                    last_seen: None,
                },
                ValueSuggestion {
                    value: "payments-worker".to_string(),
                    source: "inventory".to_string(),
                    items: 1,
                    last_seen: None,
                },
            ]
        );
        assert!(!resp.partial);
    }

    #[test]
    fn narrowing_by_service_drops_the_hosts_of_other_services() {
        let condition = DimensionCondition::Group {
            op: LogicalOp::And,
            items: vec![eq("service", "Payments-API"), eq("host", "")],
        };
        let pairs = narrowing_pairs(Some(&condition), "host");
        assert_eq!(
            pairs,
            vec![("service".to_string(), "payments-api".to_string())]
        );
        let inventory: Vec<String> = inventory_values(&acme_inventory(), "host", &pairs)
            .into_iter()
            .map(|f| f.value)
            .collect();
        assert_eq!(inventory, ["node-1"]);
        let records = vec![
            record("payments-api", "node-1", 1, "app_logs", &[]),
            record("payments-api", "node-2", 2, "app_logs", &[]),
            record("payments-api", "node-3", 3, "app_logs", &[]),
            record("payments-worker", "node-4", 4, "worker_logs", &[]),
        ];
        let mut registry: Vec<String> = registry_values(&records, "host", &pairs)
            .into_iter()
            .map(|f| f.value)
            .collect();
        registry.sort();
        assert_eq!(registry, ["node-1", "node-2", "node-3"]);
    }

    #[test]
    fn the_edited_key_and_or_branches_do_not_narrow() {
        let condition = DimensionCondition::Group {
            op: LogicalOp::And,
            items: vec![
                eq("host", "node-1"),
                DimensionCondition::Group {
                    op: LogicalOp::Or,
                    items: vec![eq("env", "prod")],
                },
            ],
        };
        assert!(narrowing_pairs(Some(&condition), "host").is_empty());
        assert!(narrowing_pairs(None, "host").is_empty());
    }

    #[tokio::test]
    async fn a_search_past_the_deadline_returns_the_other_sources_and_partial() {
        let queries: Vec<StreamQuery> = ["fast", "slow"]
            .into_iter()
            .map(|stream| StreamQuery {
                stream_type: StreamType::Logs,
                stream: stream.to_string(),
                sql: String::new(),
            })
            .collect();
        let search = || {
            run_parallel(queries, Duration::from_millis(50), |query| async move {
                if query.stream == "slow" {
                    tokio::time::sleep(Duration::from_secs(5)).await;
                }
                let hit = found(
                    &format!("{}-host", query.stream),
                    Source::Search,
                    0,
                    Some(1),
                );
                (vec![hit], false)
            })
        };
        let known = vec![
            found("node-1", Source::Inventory, 1, None),
            found("node-2", Source::Registry, 0, Some(2)),
        ];
        let resp = answer("", known, true, search).await;
        assert!(resp.partial);
        let values: Vec<&str> = resp.values.iter().map(|v| v.value.as_str()).collect();
        assert_eq!(values, ["node-1", "node-2", "fast-host"]);
    }

    #[tokio::test]
    async fn no_search_runs_for_a_priority_dimension_or_a_full_list() {
        let resp = answer(
            "",
            vec![found("a", Source::Registry, 0, None)],
            false,
            no_search,
        )
        .await;
        assert_eq!(resp.values.len(), 1);
        let full = (0..MAX_VALUES)
            .map(|i| found(&format!("h{i}"), Source::Registry, 0, None))
            .collect();
        let resp = answer("", full, true, no_search).await;
        assert_eq!(resp.values.len(), MAX_VALUES);
        let calls = Arc::new(AtomicUsize::new(0));
        let counted = calls.clone();
        let search = move || async move {
            counted.fetch_add(1, Ordering::SeqCst);
            (vec![], false)
        };
        answer("", vec![], true, search).await;
        assert_eq!(calls.load(Ordering::SeqCst), 1);
    }

    #[test]
    fn a_stream_with_no_host_mapping_searches_the_groups_own_hostname_column() {
        let pairs = vec![("service".to_string(), "payments-api".to_string())];
        let records = vec![record(
            "payments-api",
            "node-1",
            1,
            "app_logs",
            &[("service", "service_name")],
        )];
        let groups = host_group();
        let streams = BTreeMap::from([known("app_logs", &["service_name", "hostname"])]);
        let queries = stream_queries(&records, &groups, &streams, &plan("host", &pairs, ""));
        assert_eq!(queries.len(), 1);
        assert_eq!(
            queries[0].sql,
            "SELECT \"hostname\" AS value, max(_timestamp) AS last_seen FROM \"app_logs\" WHERE \"service_name\" = 'payments-api' GROUP BY \"hostname\" LIMIT 100"
        );
        let by_alias = stream_queries(&records, &groups, &streams, &plan("hostname", &pairs, "no"));
        assert_eq!(
            by_alias[0].sql,
            "SELECT \"hostname\" AS value, max(_timestamp) AS last_seen FROM \"app_logs\" WHERE \"service_name\" = 'payments-api' AND LOWER(\"hostname\") LIKE '%no%' GROUP BY \"hostname\" LIMIT 100"
        );
        assert!(
            stream_queries(
                &records,
                &groups,
                &BTreeMap::new(),
                &plan("host", &pairs, "")
            )
            .is_empty(),
            "without the stream's columns there is nothing to fall back to"
        );
    }

    #[test]
    fn a_stream_without_a_registry_record_is_searched_through_its_hostname_column() {
        let groups = host_group();
        let streams = BTreeMap::from([
            known("app_logs", &["hostname"]),
            known("audit", &["user"]),
            known("svc_logs", &["service_name", "host"]),
        ]);
        let queries = stream_queries(&[], &groups, &streams, &plan("host", &[], ""));
        let found: Vec<(&str, &str)> = queries
            .iter()
            .map(|q| (q.stream.as_str(), q.sql.as_str()))
            .collect();
        assert_eq!(
            found,
            [
                (
                    "app_logs",
                    "SELECT \"hostname\" AS value, max(_timestamp) AS last_seen FROM \"app_logs\" GROUP BY \"hostname\" LIMIT 100"
                ),
                (
                    "svc_logs",
                    "SELECT \"host\" AS value, max(_timestamp) AS last_seen FROM \"svc_logs\" GROUP BY \"host\" LIMIT 100"
                ),
            ]
        );
        let pairs = vec![("service".to_string(), "payments-api".to_string())];
        let narrowed = stream_queries(&[], &groups, &streams, &plan("host", &pairs, ""));
        assert_eq!(
            narrowed.len(),
            1,
            "app_logs has no service column to narrow by"
        );
        assert_eq!(narrowed[0].stream, "svc_logs");
    }

    #[tokio::test]
    async fn the_orgs_schemas_name_the_streams_and_their_dimension_columns() {
        let schema = |fields: &[&str]| {
            infra::schema::SchemaCache::new(arrow_schema::Schema::new(
                fields
                    .iter()
                    .map(|f| arrow_schema::Field::new(*f, arrow_schema::DataType::Utf8, true))
                    .collect::<Vec<_>>(),
            ))
        };
        {
            let mut cache = infra::schema::STREAM_SCHEMAS_LATEST.write().await;
            cache.insert(
                "g2org/logs/app_logs".to_string(),
                schema(&["hostname", "body"]),
            );
            cache.insert("g2org/logs/audit".to_string(), schema(&["user"]));
            cache.insert(
                "g2org/enrichment_tables/hosts".to_string(),
                schema(&["hostname"]),
            );
            cache.insert("otherorg/logs/app_logs".to_string(), schema(&["hostname"]));
        }
        let streams = stream_columns("g2org", &host_group(), &plan("host", &[], "")).await;
        assert_eq!(
            streams.into_iter().collect::<Vec<_>>(),
            vec![known("app_logs", &["hostname"])]
        );
    }

    #[test]
    fn every_stream_is_queued_freshest_record_first_and_none_twice() {
        let records: Vec<ServiceMetadata> = (0..15)
            .map(|i| record("svc", "h", i, &format!("s{i}"), &[("host", "hostname")]))
            .collect();
        let streams = BTreeMap::from([known("s3", &["hostname"])]);
        let queries = stream_queries(&records, &[], &streams, &plan("host", &[], ""));
        assert_eq!(queries.len(), 15);
        assert_eq!(queries[0].stream, "s14");
        assert!(!queries[0].sql.contains("WHERE"));
    }

    #[tokio::test]
    async fn eleven_streams_all_answer_with_at_most_ten_in_flight() {
        let queries: Vec<StreamQuery> = (0..11)
            .map(|i| StreamQuery {
                stream_type: StreamType::Logs,
                stream: format!("s{i}"),
                sql: String::new(),
            })
            .collect();
        let running = Arc::new(AtomicUsize::new(0));
        let peak = Arc::new(AtomicUsize::new(0));
        let (hits, partial) = run_parallel(queries, Duration::from_secs(5), |query| {
            let (running, peak) = (running.clone(), peak.clone());
            async move {
                let now = running.fetch_add(1, Ordering::SeqCst) + 1;
                peak.fetch_max(now, Ordering::SeqCst);
                tokio::time::sleep(Duration::from_millis(20)).await;
                running.fetch_sub(1, Ordering::SeqCst);
                (
                    vec![found(&query.stream, Source::Search, 0, Some(1))],
                    false,
                )
            }
        })
        .await;
        assert!(!partial);
        assert_eq!(hits.len(), 11);
        assert!(
            hits.iter().any(|f| f.value == "s10"),
            "the eleventh stream answers"
        );
        assert_eq!(peak.load(Ordering::SeqCst), MAX_SEARCH_STREAMS);
    }

    #[tokio::test]
    async fn a_partial_or_failed_stream_search_marks_the_answer_partial() {
        let queries: Vec<StreamQuery> = ["whole", "cut"]
            .into_iter()
            .map(|stream| StreamQuery {
                stream_type: StreamType::Logs,
                stream: stream.to_string(),
                sql: String::new(),
            })
            .collect();
        let (hits, partial) = run_parallel(queries, Duration::from_secs(5), |query| async move {
            let hit = found(&query.stream, Source::Search, 0, Some(1));
            (vec![hit], query.stream == "cut")
        })
        .await;
        assert!(
            partial,
            "a search that answered with is_partial is not a complete answer"
        );
        assert_eq!(hits.len(), 2);
        let search = || async { (vec![found("node-9", Source::Search, 0, Some(1))], true) };
        let resp = answer("", vec![], true, search).await;
        assert!(resp.partial);
        assert_eq!(resp.values[0].value, "node-9");
    }

    #[test]
    fn a_quote_in_a_value_is_escaped() {
        assert_eq!(equality("svc", "o'brien"), "\"svc\" = 'o''brien'");
        assert_eq!(contains("svc", "o'b"), "LOWER(\"svc\") LIKE '%o''b%'");
    }
}
