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

//! The values of a finer dimension that co-occur with a condition (D16, section 7.1).

use std::collections::{BTreeMap, HashMap};

use config::meta::{
    downtimes::{ResourceValue, ResourcesRequest, ResourcesResponse},
    stream::StreamType,
};
use o2_enterprise::enterprise::{
    downtimes::scope::and_eq_pairs,
    oncall::routing::normalize_value,
    service_streams::{meta::ServiceMetadata, storage::ServiceStorage},
};

use super::DowntimeError;

pub const MAX_RESOURCES: usize = 500;
const SEARCH_WINDOW_MICROS: i64 = 24 * 3_600 * 1_000_000;
const SEARCH_TIMEOUT_SECS: i64 = 10;

/// One stream to search, with the raw column behind each semantic dimension.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct StreamQuery {
    pub stream_type: StreamType,
    pub stream: String,
    pub sql: String,
}

pub async fn resources(
    org: &str,
    req: &ResourcesRequest,
) -> Result<ResourcesResponse, DowntimeError> {
    let groups = db::system_settings::get_semantic_field_groups(org).await;
    if !groups.iter().any(|g| g.id == req.refine_by) {
        return Err(DowntimeError::BadRequest(format!(
            "`{}` is not a dimension of this organization.",
            req.refine_by
        )));
    }
    let pairs = lookup_pairs(req)?;
    let records = ServiceStorage::list_by_all_dimensions(org, &pairs)
        .await
        .map_err(|e| DowntimeError::Internal(e.to_string()))?;
    let authoritative = ServiceStorage::get_priority_dimensions(org)
        .await
        .map_err(|e| DowntimeError::Internal(e.to_string()))?
        .contains(&req.refine_by);
    let (values, source) = if authoritative {
        (registry_values(&records, &req.refine_by), "registry")
    } else {
        let queries = stream_queries(&records, &pairs, &req.refine_by);
        (search_values(org, &queries).await, "search")
    };
    Ok(respond(&req.refine_by, values, source))
}

/// The `=` pairs of the And spine, values normalized as stored; none is a 400.
pub fn lookup_pairs(req: &ResourcesRequest) -> Result<Vec<(String, String)>, DowntimeError> {
    let pairs: Vec<(String, String)> = and_eq_pairs(&req.condition)
        .into_iter()
        .map(|(k, v)| (k, normalize_value(&v)))
        .collect();
    if pairs.is_empty() {
        return Err(DowntimeError::BadRequest(
            "Add at least one = condition before refining by resource.".to_string(),
        ));
    }
    Ok(pairs)
}

/// One value per record, newest `last_seen` wins.
pub fn registry_values(records: &[ServiceMetadata], refine_by: &str) -> Vec<ResourceValue> {
    let mut by_value: HashMap<String, ResourceValue> = HashMap::new();
    for record in records {
        let Some(value) = record.all_dimensions.get(refine_by) else {
            continue;
        };
        merge(
            &mut by_value,
            ResourceValue {
                value: value.clone(),
                last_seen: record.last_seen,
                streams: stream_names(record),
            },
        );
    }
    by_value.into_values().collect()
}

/// One query per stream of the kept records; a stream with no column for `refine_by` is skipped.
pub fn stream_queries(
    records: &[ServiceMetadata],
    pairs: &[(String, String)],
    refine_by: &str,
) -> Vec<StreamQuery> {
    let mut queries: Vec<StreamQuery> = Vec::new();
    for record in records {
        let mapping = &record.field_name_mapping;
        let Some(column) = mapping.get(refine_by) else {
            continue;
        };
        let Some(filters) = pairs
            .iter()
            .map(|(key, value)| mapping.get(key).map(|raw| equality(raw, value)))
            .collect::<Option<Vec<String>>>()
        else {
            continue;
        };
        for (stream_type, stream) in streams_of(record) {
            let query = StreamQuery {
                sql: distinct_values_sql(&stream, column, &filters),
                stream_type,
                stream,
            };
            if !queries.contains(&query) {
                queries.push(query);
            }
        }
    }
    queries
}

pub fn respond(dimension: &str, mut values: Vec<ResourceValue>, source: &str) -> ResourcesResponse {
    values.sort_by(|a, b| b.last_seen.cmp(&a.last_seen).then(a.value.cmp(&b.value)));
    let total = values.len();
    values.truncate(MAX_RESOURCES);
    ResourcesResponse {
        dimension: dimension.to_string(),
        values,
        total,
        source: source.to_string(),
    }
}

async fn search_values(org: &str, queries: &[StreamQuery]) -> Vec<ResourceValue> {
    let mut by_value: HashMap<String, ResourceValue> = HashMap::new();
    let end = config::utils::time::now_micros();
    for query in queries {
        match run_search(org, query, end - SEARCH_WINDOW_MICROS, end).await {
            Ok(hits) => {
                for hit in hits {
                    if let Some(value) = hit_value(&hit, query) {
                        merge(&mut by_value, value);
                    }
                }
            }
            Err(e) => log::warn!(
                "[DOWNTIMES] resources search on {}/{} failed: {e}",
                query.stream_type,
                query.stream
            ),
        }
    }
    by_value.into_values().collect()
}

async fn run_search(
    org: &str,
    query: &StreamQuery,
    start_time: i64,
    end_time: i64,
) -> Result<Vec<serde_json::Value>, anyhow::Error> {
    let req = config::meta::search::Request {
        query: config::meta::search::Query {
            sql: query.sql.clone(),
            from: 0,
            size: MAX_RESOURCES as i64,
            start_time,
            end_time,
            ..Default::default()
        },
        encoding: config::meta::search::RequestEncoding::Empty,
        regions: vec![],
        clusters: vec![],
        timeout: SEARCH_TIMEOUT_SECS,
        search_type: None,
        search_event_context: None,
        use_cache: false,
        clear_cache: false,
        local_mode: None,
        agent_options: None,
    };
    let trace_id = config::ider::generate();
    let resp = crate::search::search(&trace_id, org, query.stream_type, None, &req).await?;
    Ok(resp.hits)
}

fn hit_value(hit: &serde_json::Value, query: &StreamQuery) -> Option<ResourceValue> {
    let value = match hit.get("value")? {
        serde_json::Value::String(s) => s.clone(),
        serde_json::Value::Null => return None,
        other => other.to_string(),
    };
    Some(ResourceValue {
        value: normalize_value(&value),
        last_seen: hit.get("last_seen").and_then(|v| v.as_i64()).unwrap_or(0),
        streams: vec![format!("{}/{}", query.stream_type, query.stream)],
    })
}

fn merge(by_value: &mut HashMap<String, ResourceValue>, found: ResourceValue) {
    match by_value.get_mut(&found.value) {
        Some(known) => {
            known.last_seen = known.last_seen.max(found.last_seen);
            for stream in found.streams {
                if !known.streams.contains(&stream) {
                    known.streams.push(stream);
                }
            }
        }
        None => {
            by_value.insert(found.value.clone(), found);
        }
    }
}

fn streams_of(record: &ServiceMetadata) -> Vec<(StreamType, String)> {
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

/// A trailing `*` is a prefix, as in ownership rules.
fn equality(column: &str, value: &str) -> String {
    let escaped = value.replace('\'', "''");
    match escaped.strip_suffix('*') {
        Some(prefix) => format!("\"{column}\" LIKE '{prefix}%'"),
        None => format!("\"{column}\" = '{escaped}'"),
    }
}

fn distinct_values_sql(stream: &str, column: &str, filters: &[String]) -> String {
    format!(
        "SELECT \"{column}\" AS value, max(_timestamp) AS last_seen FROM \"{stream}\" WHERE {} GROUP BY \"{column}\" LIMIT {MAX_RESOURCES}",
        filters.join(" AND ")
    )
}

#[cfg(test)]
mod tests {
    use std::collections::{BTreeSet, HashSet};

    use config::meta::{
        downtimes::{DimensionCondition, LogicalOp, PairOperator},
        service_streams::StreamInfo,
    };
    use o2_enterprise::enterprise::service_streams::meta::ServiceStreams;

    use super::*;

    fn eq(key: &str, value: &str) -> DimensionCondition {
        DimensionCondition::Pair {
            key: key.to_string(),
            operator: PairOperator::Eq,
            value: value.to_string(),
        }
    }

    fn record(host: &str, last_seen: i64, stream: &str) -> ServiceMetadata {
        ServiceMetadata {
            service_name: "payments".to_string(),
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
                ("service".to_string(), "payments".to_string()),
                ("host".to_string(), host.to_string()),
            ]),
            field_name_mapping: HashMap::from([
                ("service".to_string(), "service_name".to_string()),
                ("host".to_string(), "hostname".to_string()),
            ]),
        }
    }

    #[test]
    fn a_tree_reduces_to_its_and_eq_pairs_and_one_without_any_is_refused() {
        let req = ResourcesRequest {
            condition: DimensionCondition::Group {
                op: LogicalOp::And,
                items: vec![
                    eq("service", "Payments"),
                    DimensionCondition::Group {
                        op: LogicalOp::Or,
                        items: vec![eq("host", "db-1")],
                    },
                ],
            },
            refine_by: "host".to_string(),
        };
        assert_eq!(
            lookup_pairs(&req).unwrap(),
            vec![("service".to_string(), "payments".to_string())]
        );
        let none = ResourcesRequest {
            condition: DimensionCondition::Pair {
                key: "env".to_string(),
                operator: PairOperator::Ne,
                value: "prod".to_string(),
            },
            refine_by: "host".to_string(),
        };
        assert!(matches!(
            lookup_pairs(&none),
            Err(DowntimeError::BadRequest(_))
        ));
    }

    #[test]
    fn registry_values_are_distinct_and_newest_wins() {
        let records = vec![
            record("db-1", 10, "payments"),
            record("db-1", 30, "payments_audit"),
            record("db-2", 20, "payments"),
        ];
        let resp = respond("host", registry_values(&records, "host"), "registry");
        assert_eq!(resp.total, 2);
        assert_eq!(resp.values[0].value, "db-1");
        assert_eq!(resp.values[0].last_seen, 30);
        assert_eq!(
            resp.values[0].streams.iter().collect::<BTreeSet<_>>(),
            BTreeSet::from([
                &"logs/payments".to_string(),
                &"logs/payments_audit".to_string()
            ])
        );
        assert_eq!(resp.source, "registry");
    }

    #[test]
    fn stream_queries_map_aliases_to_raw_columns_per_stream() {
        let pairs = vec![("service".to_string(), "pay*".to_string())];
        let queries = stream_queries(&[record("db-1", 1, "payments")], &pairs, "host");
        assert_eq!(queries.len(), 1);
        assert_eq!(queries[0].stream, "payments");
        assert_eq!(
            queries[0].sql,
            "SELECT \"hostname\" AS value, max(_timestamp) AS last_seen FROM \"payments\" WHERE \"service_name\" LIKE 'pay%' GROUP BY \"hostname\" LIMIT 500"
        );
        assert!(
            stream_queries(&[record("db-1", 1, "payments")], &pairs, "k8s-pod").is_empty(),
            "a stream without a column for refine_by is skipped"
        );
    }

    #[test]
    fn the_answer_is_capped_at_500_and_says_how_many_there_were() {
        let values = (0..600)
            .map(|i| ResourceValue {
                value: format!("h{i}"),
                last_seen: i,
                streams: vec![],
            })
            .collect();
        let resp = respond("host", values, "search");
        assert_eq!(resp.total, 600);
        assert_eq!(resp.values.len(), MAX_RESOURCES);
        assert_eq!(resp.values[0].value, "h599");
    }

    #[test]
    fn a_quote_in_a_value_is_escaped() {
        assert_eq!(equality("svc", "o'brien"), "\"svc\" = 'o''brien'");
    }
}
