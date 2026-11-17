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

//! The trace service whose spans carry a record's own dimensions, so correlation can name it.

use std::{
    collections::{BTreeMap, BTreeSet, HashMap, HashSet},
    num::NonZeroUsize,
    sync::{LazyLock, Mutex},
    time::{Duration, Instant},
};

use arrow_schema::DataType;
use config::{
    meta::{
        correlation::{FieldAlias, ServiceIdentityConfig},
        search,
        service_identity::{service_key, service_key_spellings},
        stream::StreamType,
    },
    utils::{
        json,
        sql::{quote_identifier, quote_sql_string},
    },
};
use lru::LruCache;

/// The identity config's implicit service dimension, the one notion shared with discovery.
pub const SERVICE_DIMENSION: &str = "service";
// The dry run resolved every sampled record from its last hour of spans.
const WINDOW_US: i64 = 3_600_000_000;
const TIMEOUT: Duration = Duration::from_secs(5);
const HIT_TTL: Duration = Duration::from_secs(600);
// Spans can land after the record's first log, so an empty answer is retried soon.
const MISS_TTL: Duration = Duration::from_secs(30);
const CACHE_SIZE: NonZeroUsize = NonZeroUsize::new(4_096).unwrap();
const MAX_SERVICES: usize = 50;

static CACHE: LazyLock<Mutex<Lookups>> =
    LazyLock::new(|| Mutex::new(Lookups(LruCache::new(CACHE_SIZE))));

/// Org, record dimensions, candidate keys, streams read, window, the service, location and
/// evidence alias lists and the record's complete identity sets, so any regrouping misses.
type CacheKey = (
    String,
    Vec<(String, String)>,
    Vec<String>,
    Vec<String>,
    (i64, i64),
    [Mapping; 3],
    Vec<Vec<String>>,
);
type Mapping = Vec<(String, Vec<String>)>;
/// A stream's scalar fields with the type each is compared by.
type Fields = Vec<(String, Kind)>;

/// How a record value is compared with a field.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Kind {
    Text,
    Integer,
    Float,
    Other,
}

impl Kind {
    /// `None` for a field no record value can equal, such as a list or a struct.
    fn of(kind: &DataType) -> Option<Self> {
        match kind {
            DataType::Utf8 | DataType::LargeUtf8 | DataType::Utf8View => Some(Self::Text),
            _ if kind.is_integer() => Some(Self::Integer),
            _ if kind.is_numeric() => Some(Self::Float),
            DataType::Boolean => Some(Self::Other),
            _ => None,
        }
    }
}

/// Where tier B looks: the candidates' trace streams and the correlation window.
pub struct Scope<'a> {
    pub org: &'a str,
    /// Only streams the caller may read; the cache keys on them as the caller's permission scope.
    pub streams: &'a [String],
    pub window: (i64, i64),
}

/// Recent lookups with the time each was read.
struct Lookups(LruCache<CacheKey, (Instant, Option<String>)>);

impl Lookups {
    fn get(&mut self, key: &CacheKey, now: Instant) -> Option<Option<String>> {
        let (at, service) = self.0.get(key)?;
        if now.duration_since(*at) < ttl(service.as_ref()) {
            return Some(service.clone());
        }
        self.0.pop(key);
        None
    }

    /// A late empty answer never replaces a record that a concurrent lookup resolved.
    fn put(&mut self, key: CacheKey, now: Instant, service: Option<String>) {
        let resolved = |(at, held): &(Instant, Option<String>)| {
            held.is_some() && now.duration_since(*at) < HIT_TTL
        };
        if service.is_none() && self.0.peek(&key).is_some_and(resolved) {
            return;
        }
        self.0.put(key, (now, service));
    }
}

/// A record's semantic dimensions: where it runs (the sets' `distinguish_by`) and the rest.
#[derive(Debug, Default)]
struct Record {
    location: Vec<(String, String)>,
    evidence: Vec<(String, String)>,
    /// The identity sets the record carries entirely, as indices into `location`.
    sets: Vec<Vec<usize>>,
}

impl Record {
    /// Keys fold to their semantic group; the service and dimensions no group knows are left out.
    fn of(
        dims: &HashMap<String, String>,
        identity: &ServiceIdentityConfig,
        groups: &[FieldAlias],
    ) -> Self {
        let location: HashSet<&str> = identity
            .sets
            .iter()
            .flat_map(|set| set.distinguish_by.iter().map(String::as_str))
            .collect();
        let mut by_group = BTreeMap::new();
        let sorted: BTreeMap<&String, &String> = dims.iter().collect();
        for (key, value) in sorted {
            let value = value.trim();
            let Some(group) = group_of(key, groups) else {
                continue;
            };
            if value.is_empty() || group == SERVICE_DIMENSION {
                continue;
            }
            by_group
                .entry(group.to_string())
                .or_insert_with(|| value.to_string());
        }
        let mut record = Self::default();
        for (group, value) in by_group {
            if location.contains(group.as_str()) {
                record.location.push((group, value));
            } else {
                record.evidence.push((group, value));
            }
        }
        let position = |dim: &String| record.location.iter().position(|(g, _)| g == dim);
        record.sets = identity
            .sets
            .iter()
            .filter(|set| !set.distinguish_by.is_empty())
            .filter_map(|set| set.distinguish_by.iter().map(position).collect())
            .collect();
        record
    }

    /// The location dims a stream is held to, given which groups it has a field for: those of
    /// every complete set it carries, else all of them when no set is complete; `None` rejects it.
    fn constrained(&self, carries: impl Fn(&str) -> bool) -> Option<Vec<usize>> {
        let has = |dim: &usize| carries(&self.location[*dim].0);
        if self.sets.is_empty() {
            let all: Vec<usize> = (0..self.location.len()).collect();
            return all.iter().all(has).then_some(all);
        }
        // Sets are alternatives: a stream may lack another set's fields, never all of its own.
        let held: BTreeSet<usize> = self
            .sets
            .iter()
            .filter(|set| set.iter().all(has))
            .flatten()
            .copied()
            .collect();
        (!held.is_empty()).then(|| held.into_iter().collect())
    }

    fn cache_entries(&self) -> Vec<(String, String)> {
        self.location
            .iter()
            .chain(&self.evidence)
            .cloned()
            .collect()
    }

    /// Each complete set's location dim ids, in set and `distinguish_by` order.
    fn set_ids(&self) -> Vec<Vec<String>> {
        self.sets
            .iter()
            .map(|set| {
                set.iter()
                    .map(|dim| self.location[*dim].0.clone())
                    .collect()
            })
            .collect()
    }
}

/// The reads a lookup makes, so tests can stand in for the search engine.
trait TraceSource {
    /// Each of `streams` with its scalar fields.
    async fn schemas(&self, streams: &[String]) -> anyhow::Result<Vec<(String, Fields)>>;
    async fn search(
        &self,
        stream: &str,
        sql: String,
        window: (i64, i64),
    ) -> anyhow::Result<Vec<json::Value>>;
}

/// The org's own trace streams, read in process across every region.
struct Live<'a>(&'a str);

impl TraceSource for Live<'_> {
    async fn schemas(&self, streams: &[String]) -> anyhow::Result<Vec<(String, Fields)>> {
        let mut out = Vec::new();
        for stream in streams {
            let schema = infra::schema::get(self.0, stream, StreamType::Traces).await?;
            let fields = schema
                .fields()
                .iter()
                .filter_map(|f| Some((f.name().clone(), Kind::of(f.data_type())?)))
                .collect();
            out.push((stream.clone(), fields));
        }
        Ok(out)
    }

    async fn search(
        &self,
        _stream: &str,
        sql: String,
        (start_time, end_time): (i64, i64),
    ) -> anyhow::Result<Vec<json::Value>> {
        let request = search::Request {
            query: search::Query {
                sql,
                start_time,
                end_time,
                size: MAX_SERVICES as i64 + 1,
                ..Default::default()
            },
            use_cache: false,
            regions: vec![],
            clusters: vec![],
            ..Default::default()
        };
        let trace_id = config::ider::generate_trace_id();
        let response =
            crate::search::search(&trace_id, self.0, StreamType::Traces, None, &request).await?;
        anyhow::ensure!(!response.is_partial, "partial record trace search");
        Ok(response.hits)
    }
}

/// Whether the record has a dimension besides its location and service for spans to vote on.
pub fn has_instance_dims(
    dims: &HashMap<String, String>,
    identity: &ServiceIdentityConfig,
    groups: &[FieldAlias],
) -> bool {
    !Record::of(dims, identity, groups).evidence.is_empty()
}

/// The request's correlation window capped to its last hour, else the hour before `now`.
pub fn window(start: Option<i64>, end: Option<i64>, now: i64) -> (i64, i64) {
    match (start, end) {
        (Some(start), Some(end)) if start < end => (start.max(end - WINDOW_US), end),
        _ => (now - WINDOW_US, now),
    }
}

/// The candidate whose spans in the `scope` streams the record's dimensions single out.
pub async fn service_for_record(
    scope: &Scope<'_>,
    dims: &HashMap<String, String>,
    identity: &ServiceIdentityConfig,
    groups: &[FieldAlias],
    candidates: &[String],
) -> Option<String> {
    let record = Record::of(dims, identity, groups);
    vote(&CACHE, &Live(scope.org), scope, &record, candidates, groups).await
}

/// [`resolve`], cached per window, stream set and alias mapping.
async fn vote(
    cache: &Mutex<Lookups>,
    source: &impl TraceSource,
    scope: &Scope<'_>,
    record: &Record,
    candidates: &[String],
    groups: &[FieldAlias],
) -> Option<String> {
    if candidates.is_empty() || record.evidence.is_empty() {
        return None;
    }
    let mut streams = scope.streams.to_vec();
    if streams.is_empty() {
        return None;
    }
    streams.sort();
    let keys: BTreeSet<String> = candidates.iter().map(|name| service_key(name)).collect();
    let window = scope.window;
    let mapping = |ids: &mut dyn Iterator<Item = &str>| -> Mapping {
        ids.filter_map(|id| groups.iter().find(|g| g.id == id))
            .map(|g| (g.id.clone(), g.fields.clone()))
            .collect()
    };
    let mapping = [
        mapping(&mut std::iter::once(SERVICE_DIMENSION)),
        mapping(&mut record.location.iter().map(|(id, _)| id.as_str())),
        mapping(&mut record.evidence.iter().map(|(id, _)| id.as_str())),
    ];
    let key = (
        scope.org.to_string(),
        record.cache_entries(),
        keys.into_iter().collect(),
        streams.clone(),
        window,
        mapping,
        record.set_ids(),
    );
    let started = Instant::now();
    if let Some(held) = cache
        .lock()
        .expect("record services cache")
        .get(&key, started)
    {
        return held;
    }
    let org = scope.org;
    let (service, searches) =
        resolve(org, record, candidates, &streams, window, groups, source).await?;
    log::debug!(
        "[correlation] record lookup org={org} searches={searches} service={service:?} took={:?}",
        started.elapsed()
    );
    cache
        .lock()
        .expect("record services cache")
        .put(key, Instant::now(), service.clone());
    service
}

/// [`lookup`] under the timeout; `None` after a failure, which is logged and never cached.
async fn resolve(
    org: &str,
    record: &Record,
    candidates: &[String],
    streams: &[String],
    window: (i64, i64),
    groups: &[FieldAlias],
    source: &impl TraceSource,
) -> Option<(Option<String>, usize)> {
    let read = lookup(record, candidates, streams, window, groups, source);
    match tokio::time::timeout(TIMEOUT, read).await {
        Ok(Ok(found)) => Some(found),
        Ok(Err(e)) => {
            log::warn!("[correlation] record lookup failed org={org}: {e}");
            None
        }
        Err(_) => {
            log::warn!("[correlation] record lookup timed out org={org} after {TIMEOUT:?}");
            None
        }
    }
}

/// Per record dimension, the candidates whose spans show it in any stream; see [`decisive`].
async fn lookup(
    record: &Record,
    candidates: &[String],
    streams: &[String],
    window: (i64, i64),
    groups: &[FieldAlias],
    source: &impl TraceSource,
) -> anyhow::Result<(Option<String>, usize)> {
    let keys: BTreeSet<String> = candidates.iter().map(|name| service_key(name)).collect();
    let schemas = source.schemas(streams).await?;
    let searches: Vec<_> = schemas
        .iter()
        .filter_map(|(stream, fields)| {
            let (sql, counted) = stream_sql(record, &keys, groups, stream, fields)?;
            Some(async move { anyhow::Ok((counted, source.search(stream, sql, window).await?)) })
        })
        .collect();
    let count = searches.len();
    let mut shown = vec![BTreeSet::new(); record.evidence.len()];
    let pages = futures::future::try_join_all(searches).await?;
    // A full page may hide a candidate that also shows a dimension, so nobody is named.
    if pages.iter().any(|(_, hits)| hits.len() > MAX_SERVICES) {
        return Ok((None, count));
    }
    for (counted, hits) in pages {
        for hit in hits {
            let Some(service) = hit.get("service").and_then(json::Value::as_str) else {
                continue;
            };
            for (column, dim) in counted.iter().enumerate() {
                let hits = hit.get(format!("d{column}")).and_then(json::Value::as_f64);
                if hits.is_some_and(|n| n > 0.0) {
                    shown[*dim].insert(service_key(service));
                }
            }
        }
    }
    let Some(winner) = decisive(shown, &keys) else {
        return Ok((None, count));
    };
    let service = candidates
        .iter()
        .find(|name| service_key(name) == winner)
        .cloned();
    Ok((service, count))
}

/// The candidate most single-candidate dimensions name, a tie going to the one most dimensions
/// show; shared dimensions only break ties, so noise can't outvote an id.
fn decisive(shown: Vec<BTreeSet<String>>, keys: &BTreeSet<String>) -> Option<String> {
    let matched: Vec<Vec<&String>> = shown
        .iter()
        .map(|m| m.intersection(keys).collect())
        .collect();
    let alone = matched.iter().filter_map(|m| match m.as_slice() {
        [only] => Some(*only),
        _ => None,
    });
    let tied = leaders(alone);
    let winner = match tied[..] {
        [] => return None,
        [only] => only,
        _ => {
            let shown = matched
                .iter()
                .flatten()
                .copied()
                .filter(|key| tied.contains(key));
            let [only] = leaders(shown)[..] else {
                return None;
            };
            only
        }
    };
    Some(winner.clone())
}

/// The keys `votes` holds most often.
fn leaders<'a>(votes: impl Iterator<Item = &'a String>) -> Vec<&'a String> {
    let mut count: BTreeMap<&String, usize> = BTreeMap::new();
    for key in votes {
        *count.entry(key).or_default() += 1;
    }
    let top = count.values().max().copied().unwrap_or_default();
    count
        .into_iter()
        .filter(|(_, n)| *n == top)
        .map(|(key, _)| key)
        .collect()
}

fn ttl(service: Option<&String>) -> Duration {
    if service.is_some() { HIT_TTL } else { MISS_TTL }
}

/// The semantic group `key` names: a group id, else the group listing it as a field.
fn group_of<'a>(key: &str, groups: &'a [FieldAlias]) -> Option<&'a str> {
    groups
        .iter()
        .find(|group| group.id == key)
        .or_else(|| {
            groups
                .iter()
                .find(|group| group.fields.iter().any(|f| f == key))
        })
        .map(|group| group.id.as_str())
}

/// One search counting, per candidate service, the spans matching each record dimension the
/// stream carries; `None` when it lacks the service, the record's location or every other one.
fn stream_sql(
    record: &Record,
    keys: &BTreeSet<String>,
    groups: &[FieldAlias],
    stream: &str,
    fields: &[(String, Kind)],
) -> Option<(String, Vec<usize>)> {
    let service = alias_value(groups, SERVICE_DIMENSION, fields)?;
    let alias = |group: &str| alias_value(groups, group, fields);
    // A span without the location value is kept, as discovery keeps a row missing that dimension.
    let mut filters = record
        .constrained(|group| alias(group).is_some())?
        .into_iter()
        .map(|dim| {
            let (group, value) = &record.location[dim];
            let field = alias(group)?;
            let value = quote_sql_string(value);
            Some(format!(
                "({field} = {value} OR {field} IS NULL OR {field} = '')"
            ))
        })
        .collect::<Option<Vec<_>>>()?;
    let (counted, conditions): (Vec<usize>, Vec<String>) = record
        .evidence
        .iter()
        .enumerate()
        .filter_map(|(dim, (group, value))| Some((dim, equals(groups, group, value, fields)?)))
        .unzip();
    if conditions.is_empty() {
        return None;
    }
    let names: BTreeSet<String> = keys
        .iter()
        .flat_map(|key| service_key_spellings(key))
        .collect();
    filters.push(format!(
        "LOWER(TRIM({service})) IN ({})",
        names
            .iter()
            .map(|name| quote_sql_string(name))
            .collect::<Vec<_>>()
            .join(", ")
    ));
    filters.push(format!("({})", conditions.join(" OR ")));
    let columns: Vec<String> = conditions
        .iter()
        .enumerate()
        .map(|(column, condition)| format!("COUNT(CASE WHEN {condition} THEN 1 END) AS d{column}"))
        .collect();
    let sql = format!(
        "SELECT {service} AS service, {} FROM {} WHERE {} GROUP BY {service} LIMIT {}",
        columns.join(", "),
        quote_identifier(stream),
        filters.join(" AND "),
        MAX_SERVICES + 1
    );
    Some((sql, counted))
}

/// `group` equals `value` in the first alias the row sets, compared by that alias's type.
fn equals(
    groups: &[FieldAlias],
    group: &str,
    value: &str,
    fields: &[(String, Kind)],
) -> Option<String> {
    let text = quote_sql_string(value);
    // `None` when the value can't be of the field's type, so it never matches that field.
    let compare = |name: &str, kind: Kind| {
        let field = quote_identifier(name);
        match kind {
            Kind::Text => Some(format!("{field} = {text}")),
            Kind::Integer => {
                let number = value.parse::<i64>().ok()?;
                Some(format!("CAST({field} AS BIGINT) = {number}"))
            }
            Kind::Float => {
                let number = value.parse::<f64>().ok().filter(|n| n.is_finite())?;
                Some(format!("CAST({field} AS DOUBLE) = {number:?}"))
            }
            Kind::Other => Some(format!("CAST({field} AS VARCHAR) = {text}")),
        }
    };
    match aliases(groups, group, fields).as_slice() {
        [] => None,
        [(name, kind)] => compare(name, *kind),
        many => {
            let arms: Vec<(&str, Option<String>)> = many
                .iter()
                .map(|(name, kind)| (*name, compare(name, *kind)))
                .collect();
            if arms.iter().all(|(_, arm)| arm.is_none()) {
                return None;
            }
            // A set alias the value can't match still takes precedence, so its arm is FALSE.
            let arms: Vec<String> = arms
                .into_iter()
                .map(|(name, arm)| {
                    let field = quote_identifier(name);
                    let arm = arm.unwrap_or_else(|| "FALSE".to_string());
                    format!("WHEN {field} IS NOT NULL THEN {arm}")
                })
                .collect();
            Some(format!("CASE {} END", arms.join(" ")))
        }
    }
}

/// The row's value of `group` as text: its first alias in the schema that the row sets.
fn alias_value(groups: &[FieldAlias], group: &str, fields: &[(String, Kind)]) -> Option<String> {
    let present = aliases(groups, group, fields)
        .into_iter()
        .map(|(name, kind)| {
            let field = quote_identifier(name);
            if kind == Kind::Text {
                field
            } else {
                format!("CAST({field} AS VARCHAR)")
            }
        })
        .collect();
    coalesce(present)
}

/// The schema's fields for `group` in alias order, with their types.
fn aliases<'a>(
    groups: &[FieldAlias],
    group: &str,
    fields: &'a [(String, Kind)],
) -> Vec<(&'a str, Kind)> {
    let Some(group) = groups.iter().find(|g| g.id == group) else {
        return Vec::new();
    };
    group
        .fields
        .iter()
        .filter_map(|name| fields.iter().find(|(field, _)| field == name))
        .map(|(name, kind)| (name.as_str(), *kind))
        .collect()
}

/// The first of `values` that the row sets.
fn coalesce(values: Vec<String>) -> Option<String> {
    match values.as_slice() {
        [] => None,
        [one] => Some(one.clone()),
        many => Some(format!("COALESCE({})", many.join(", "))),
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use arrow::{
        array::{ArrayRef, Int64Array, RecordBatch, StringArray},
        compute::cast,
    };
    use arrow_schema::{Field, Schema};
    use config::meta::correlation::IdentitySet;
    use datafusion::prelude::SessionContext;

    use super::*;

    /// Fields the fake streams hold as numbers rather than text.
    const NUMBERS: [(&str, DataType); 2] = [
        ("rack_no", DataType::Int64),
        ("load_avg", DataType::Float64),
    ];

    /// A trace stream as (name, fields, rows); `None` leaves a field unset in that row.
    type Stream = (String, Vec<&'static str>, Vec<Vec<Option<String>>>);

    /// Trace searches run by DataFusion over in-memory streams.
    struct Fake {
        streams: Vec<Stream>,
        fail: bool,
        searched: Mutex<Vec<String>>,
        windows: Mutex<Vec<(i64, i64)>>,
    }

    impl Fake {
        fn new(fail: bool) -> Self {
            Self {
                streams: streams(),
                fail,
                searched: Mutex::default(),
                windows: Mutex::default(),
            }
        }
    }

    impl TraceSource for Fake {
        async fn schemas(&self, streams: &[String]) -> anyhow::Result<Vec<(String, Fields)>> {
            Ok(self
                .streams
                .iter()
                .filter(|(s, ..)| streams.contains(s))
                .map(|(s, f, _)| {
                    let fields = f
                        .iter()
                        .map(|f| (f.to_string(), Kind::of(&kind(f)).unwrap()));
                    (s.clone(), fields.collect())
                })
                .collect())
        }

        async fn search(
            &self,
            stream: &str,
            sql: String,
            window: (i64, i64),
        ) -> anyhow::Result<Vec<json::Value>> {
            self.searched.lock().unwrap().push(stream.into());
            self.windows.lock().unwrap().push(window);
            anyhow::ensure!(!self.fail, "search down");
            let (_, fields, rows) = self.streams.iter().find(|(s, ..)| s == stream).unwrap();
            let schema = Schema::new(
                fields
                    .iter()
                    .map(|f| Field::new(*f, kind(f), true))
                    .collect::<Vec<_>>(),
            );
            let columns: Vec<ArrayRef> = (0..fields.len())
                .map(|i| {
                    let text = StringArray::from_iter(rows.iter().map(|r| r[i].clone()));
                    cast(&text, &kind(fields[i])).unwrap()
                })
                .collect();
            let ctx = SessionContext::new();
            ctx.register_batch(stream, RecordBatch::try_new(Arc::new(schema), columns)?)?;
            let mut hits = Vec::new();
            for batch in ctx.sql(&sql).await?.collect().await? {
                let service = cast(batch.column_by_name("service").unwrap(), &DataType::Utf8)?;
                let service = service.as_any().downcast_ref::<StringArray>().unwrap();
                for row in 0..batch.num_rows() {
                    let mut hit = json::Map::new();
                    hit.insert("service".into(), service.value(row).into());
                    for (i, field) in batch.schema().fields().iter().enumerate().skip(1) {
                        let n = cast(batch.column(i), &DataType::Int64)?;
                        let n = n.as_any().downcast_ref::<Int64Array>().unwrap().value(row);
                        hit.insert(field.name().clone(), n.into());
                    }
                    hits.push(json::Value::Object(hit));
                }
            }
            Ok(hits)
        }
    }

    fn kind(field: &str) -> DataType {
        let number = NUMBERS.iter().find(|(n, _)| *n == field);
        number.map_or(DataType::Utf8, |(_, kind)| kind.clone())
    }

    fn group(id: &str, fields: &[&str]) -> FieldAlias {
        serde_json::from_value(serde_json::json!({"id": id, "display": id, "fields": fields}))
            .unwrap()
    }

    fn identity() -> ServiceIdentityConfig {
        ServiceIdentityConfig {
            sets: vec![IdentitySet {
                id: "k8s".into(),
                label: "Kubernetes".into(),
                distinguish_by: vec!["k8s-cluster".into(), "k8s-namespace".into()],
            }],
            tracked_alias_ids: vec![],
            service_optional: true,
        }
    }

    fn groups() -> Vec<FieldAlias> {
        vec![
            group(SERVICE_DIMENSION, &["service_name"]),
            group("k8s-cluster", &["k8s_cluster", "service_k8s_cluster_name"]),
            group("k8s-namespace", &["service_k8s_namespace_name"]),
            group("k8s-pod-name", &["k8s_pod_name", "service_k8s_pod_name"]),
            // Org-made dimensions, unknown to any code.
            group("rack", &["rack_id", "rack_no"]),
            group("shelf", &["shelf_id"]),
            group("bin", &["bin_id"]),
            group("http-status", &["http_status"]),
            group("load", &["load_avg"]),
        ]
    }

    fn streams() -> Vec<Stream> {
        let fields = vec![
            "service_name",
            "k8s_cluster",
            "service_k8s_cluster_name",
            "service_k8s_namespace_name",
            "service_k8s_pod_name",
            "rack_id",
            "rack_no",
            "http_status",
        ];
        // (service, cluster, pod, rack id, rack no, status); the cluster sits in its later alias.
        let row = |service: &str, cluster: Option<&str>, pod, rack, rack_no, status| {
            [
                Some(service),
                None,
                cluster,
                cluster.map(|_| "obs"),
                pod,
                rack,
                rack_no,
                Some(status),
            ]
            .map(|v| v.map(String::from))
            .to_vec()
        };
        // More services than one page holds; only the first carries the second dimension.
        let crowd = (0..=MAX_SERVICES)
            .map(|i| {
                let bin = (i == 0).then(|| "y".to_string());
                vec![Some(format!("s{i:02}")), Some("x".to_string()), bin]
            })
            .collect();
        vec![
            (
                "traces".into(),
                fields,
                vec![
                    row(
                        "o2-querier",
                        Some("c1"),
                        Some("q-0"),
                        Some("r1"),
                        None,
                        "200",
                    ),
                    row("o2-router", Some("c1"), Some("r-0"), None, None, "500"),
                    row("openobserve", Some("c1"), Some("o-0"), None, None, "500"),
                    row("o2-ingester", None, Some("i-0"), None, None, "200"),
                    row("beta-querier", Some("c2"), Some("q-0"), None, None, "200"),
                    row("ingest", None, None, Some("r12"), None, "200"),
                    row("export", None, None, None, Some("13"), "200"),
                ],
            ),
            (
                // No cluster field: its same-named pod may run in another cluster.
                "edge".into(),
                vec!["service_name", "service_k8s_pod_name"],
                vec![vec![Some("o2-router".into()), Some("q-0".into())]],
            ),
            (
                "crowd".into(),
                vec!["service_name", "shelf_id", "bin_id"],
                crowd,
            ),
            (
                // Only one crowd member shares the first dimension here.
                "shelves".into(),
                vec!["service_name", "shelf_id"],
                vec![vec![Some("s01".into()), Some("x".into())]],
            ),
            (
                "gauges".into(),
                vec!["service_name", "load_avg"],
                vec![
                    vec![Some("export".into()), Some("13".into())],
                    vec![Some("ingest".into()), Some("12.5".into())],
                ],
            ),
        ]
    }

    fn dims(pairs: &[(&str, &str)]) -> HashMap<String, String> {
        pairs
            .iter()
            .map(|(k, v)| (k.to_string(), v.to_string()))
            .collect()
    }

    fn listed() -> Vec<String> {
        ["traces", "edge", "crowd", "shelves", "gauges"]
            .map(String::from)
            .to_vec()
    }

    #[tokio::test]
    async fn the_candidate_every_decisive_record_dimension_names_wins() {
        // (case, record dims, candidates, search fails, want, streams searched)
        type Row = (
            &'static str,
            Vec<(&'static str, &'static str)>,
            Vec<String>,
            bool,
            Option<&'static str>,
            Vec<&'static str>,
        );
        let location = [("k8s-cluster", "c1"), ("k8s-namespace", "obs")];
        let with = |more: &[(&'static str, &'static str)]| [&location[..], more].concat();
        let names = |names: &[&str]| names.iter().map(|n| n.to_string()).collect::<Vec<_>>();
        let o2 = names(&["O2-Querier ", "o2-router", "openobserve", "o2-ingester"]);
        let crowd: Vec<String> = (0..=MAX_SERVICES).map(|i| format!("s{i:02}")).collect();
        let rows: Vec<Row> = vec![
            (
                "the pod's vote beats the service label, a cluster-less stream is skipped",
                with(&[("k8s_pod_name", "q-0"), ("service", "openobserve")]),
                o2.clone(),
                false,
                Some("O2-Querier "),
                vec!["traces"],
            ),
            (
                "a noise dimension other services show does not cancel the instance votes",
                with(&[
                    ("k8s-pod-name", "q-0"),
                    ("rack", "r1"),
                    ("http-status", "500"),
                ]),
                o2.clone(),
                false,
                Some("O2-Querier "),
                vec!["traces"],
            ),
            (
                "a span without the location values still counts",
                with(&[("k8s-pod-name", "i-0")]),
                o2.clone(),
                false,
                Some("o2-ingester"),
                vec!["traces"],
            ),
            (
                "a dimension two candidates show names nobody",
                with(&[("http-status", "500")]),
                o2.clone(),
                false,
                None,
                vec!["traces"],
            ),
            (
                "a custom dimension resolves with no code for it",
                vec![("rack", "r12"), ("unmapped", "x")],
                names(&["ingest", "export"]),
                false,
                Some("ingest"),
                vec!["traces"],
            ),
            (
                "a numeric field votes as text",
                vec![("rack", "13")],
                names(&["ingest", "export"]),
                false,
                Some("export"),
                vec!["traces"],
            ),
            (
                "a float field votes by its number",
                vec![("load", "13")],
                names(&["ingest", "export"]),
                false,
                Some("export"),
                vec!["gauges"],
            ),
            (
                "a stream with more services than one page voids every stream's votes",
                vec![("shelf", "x"), ("bin", "y")],
                crowd,
                false,
                None,
                vec!["crowd", "shelves"],
            ),
            (
                "no instance dimension reads no span",
                with(&[("service", "openobserve")]),
                o2.clone(),
                false,
                None,
                vec![],
            ),
            (
                "a search error names nobody and is not cached",
                with(&[("k8s-pod-name", "q-0")]),
                o2,
                true,
                None,
                vec!["traces"],
            ),
        ];
        let listed = listed();
        for (name, pairs, candidates, fail, want, want_searched) in rows {
            let fake = Fake::new(fail);
            let dims = dims(&pairs);
            let cache = Mutex::new(Lookups(LruCache::new(CACHE_SIZE)));
            let scope = Scope {
                org: "org",
                streams: &listed,
                window: (0, WINDOW_US),
            };
            assert_eq!(
                has_instance_dims(&dims, &identity(), &groups()),
                !want_searched.is_empty(),
                "{name}"
            );
            let record = Record::of(&dims, &identity(), &groups());
            let got = vote(&cache, &fake, &scope, &record, &candidates, &groups()).await;
            assert_eq!(got.as_deref(), want, "{name}");
            let searched = fake.searched.into_inner().unwrap();
            assert_eq!(searched, want_searched, "{name}");
            if fail {
                assert!(cache.into_inner().unwrap().0.is_empty(), "{name}");
            }
        }
    }

    #[test]
    fn the_window_is_the_requests_last_hour_else_the_hour_before_now() {
        let hour = WINDOW_US;
        for (start, end, want) in [
            (Some(10), Some(20), (10, 20)),
            (Some(0), Some(3 * hour), (2 * hour, 3 * hour)),
            (Some(20), Some(10), (5 * hour - hour, 5 * hour)),
            (None, Some(20), (4 * hour, 5 * hour)),
        ] {
            assert_eq!(window(start, end, 5 * hour), want, "{start:?}..{end:?}");
        }
    }

    #[tokio::test]
    async fn a_lookup_is_reused_only_for_its_own_window_and_stream_list() {
        let mut cache = Lookups(LruCache::new(CACHE_SIZE));
        let key: CacheKey = (
            "org".into(),
            vec![("rack".into(), "r12".into())],
            vec!["ingest".into()],
            vec!["traces".into()],
            (0, 1),
            Default::default(),
            vec![],
        );
        let t0 = Instant::now();
        let at = |secs| t0 + Duration::from_secs(secs);
        cache.put(key.clone(), t0, None);
        assert_eq!(cache.get(&key, at(10)), Some(None), "a fresh miss is held");
        assert_eq!(
            cache.get(&key, at(31)),
            None,
            "spans that land later are read"
        );
        cache.put(key.clone(), at(31), Some("ingest".into()));
        cache.put(key.clone(), at(32), None);
        assert_eq!(
            cache.get(&key, at(33)),
            Some(Some("ingest".to_string())),
            "a late empty lookup keeps the resolved record"
        );
        assert_eq!(cache.get(&key, at(32 + 600)), None);

        let cache = Mutex::new(Lookups(LruCache::new(CACHE_SIZE)));
        let record = Record::of(&dims(&[("rack", "r12")]), &identity(), &groups());
        let candidates = ["ingest".to_string(), "export".to_string()];
        let all = listed();
        // A caller who may not read `edge` passes a shorter list.
        let fewer = ["traces", "crowd"].map(String::from).to_vec();
        let span = 300_000_000;
        // (case, window, streams passed, window searched)
        for (case, window, streams, want) in [
            (
                "a first open reads spans",
                (0, span),
                &fewer,
                Some((0, span)),
            ),
            (
                "a reopen of the same window is cached",
                (0, span),
                &fewer,
                None,
            ),
            (
                "another window reads again",
                (3 * span, 4 * span),
                &fewer,
                Some((3 * span, 4 * span)),
            ),
            (
                "a caller who may read more streams reads again",
                (0, span),
                &all,
                Some((0, span)),
            ),
            (
                "the shorter list keeps its own entry",
                (0, span),
                &fewer,
                None,
            ),
        ] {
            let fake = Fake::new(false);
            let scope = Scope {
                org: "org",
                streams,
                window,
            };
            let got = vote(&cache, &fake, &scope, &record, &candidates, &groups()).await;
            assert_eq!(got.as_deref(), Some("ingest"), "{case}");
            let searched = fake.windows.into_inner().unwrap().first().copied();
            assert_eq!(searched, want, "{case}");
        }
    }
}
