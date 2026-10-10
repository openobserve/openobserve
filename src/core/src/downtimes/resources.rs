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

use std::time::Duration;

use config::meta::downtimes::{ResourceValue, ResourcesRequest, ResourcesResponse};
use o2_enterprise::enterprise::{downtimes::scope::and_eq_pairs, oncall::routing::normalize_value};

use super::{
    DowntimeError,
    values::{self, Found, SearchPlan},
};

pub const MAX_RESOURCES: usize = 500;
const SEARCH_WINDOW_MICROS: i64 = 24 * 3_600 * 1_000_000;
const SEARCH_DEADLINE: Duration = Duration::from_secs(5);

pub async fn resources(
    org: &str,
    user_id: &str,
    req: &ResourcesRequest,
) -> Result<ResourcesResponse, DowntimeError> {
    let groups = db::system_settings::get_semantic_field_groups(org).await;
    values::ensure_dimension(&groups, &req.refine_by)?;
    let pairs = lookup_pairs(req)?;
    let records = values::registry_records(org, &pairs).await?;
    if values::is_priority(org, &req.refine_by).await? {
        let found = values::registry_values(&records, &req.refine_by, &pairs);
        return Ok(respond(&req.refine_by, found, "registry"));
    }
    let plan = SearchPlan {
        key: &req.refine_by,
        pairs: &pairs,
        prefix: "",
        window_micros: SEARCH_WINDOW_MICROS,
        deadline: SEARCH_DEADLINE,
        rows_per_stream: MAX_RESOURCES,
    };
    let streams = values::stream_columns(org, &groups, &plan).await;
    let queries = values::stream_queries(&records, &groups, &streams, &plan);
    let (found, timed_out) = values::search_values(org, user_id, queries, &plan).await;
    if timed_out {
        log::warn!(
            "[DOWNTIMES] resources: search for {} in {org} passed its deadline; answering with what returned",
            req.refine_by
        );
    }
    Ok(respond(&req.refine_by, found, "search"))
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

/// One row per value, newest first, capped at `MAX_RESOURCES` with the full count kept.
pub fn respond(dimension: &str, found: Vec<Found>, source: &str) -> ResourcesResponse {
    let mut values: Vec<ResourceValue> = values::merge(found)
        .into_iter()
        .map(|f| ResourceValue {
            value: f.value,
            last_seen: f.last_seen.unwrap_or(0),
            streams: f.streams,
        })
        .collect();
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

#[cfg(test)]
mod tests {
    use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet};

    use config::meta::{
        downtimes::{DimensionCondition, LogicalOp, PairOperator},
        service_streams::StreamInfo,
        stream::StreamType,
    };
    use o2_enterprise::enterprise::service_streams::meta::{ServiceMetadata, ServiceStreams};

    use super::{values::Source, *};

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

    fn plan<'a>(pairs: &'a [(String, String)], key: &'a str) -> SearchPlan<'a> {
        SearchPlan {
            key,
            pairs,
            prefix: "",
            window_micros: SEARCH_WINDOW_MICROS,
            deadline: SEARCH_DEADLINE,
            rows_per_stream: MAX_RESOURCES,
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
        let found = values::registry_values(&records, "host", &[]);
        let resp = respond("host", found, "registry");
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
        let records = [record("db-1", 1, "payments")];
        let queries =
            values::stream_queries(&records, &[], &BTreeMap::new(), &plan(&pairs, "host"));
        assert_eq!(queries.len(), 1);
        assert_eq!(queries[0].stream, "payments");
        assert_eq!(
            queries[0].sql,
            "SELECT \"hostname\" AS value, max(_timestamp) AS last_seen FROM \"payments\" WHERE \"service_name\" LIKE 'pay%' GROUP BY \"hostname\" LIMIT 500"
        );
        assert!(
            values::stream_queries(&records, &[], &BTreeMap::new(), &plan(&pairs, "k8s-pod"))
                .is_empty(),
            "a stream without a column for refine_by is skipped"
        );
    }

    #[test]
    fn the_answer_is_capped_at_500_and_says_how_many_there_were() {
        let found = (0..600)
            .map(|i| Found {
                value: format!("h{i}"),
                source: Source::Search,
                items: 0,
                last_seen: Some(i),
                streams: vec![],
            })
            .collect();
        let resp = respond("host", found, "search");
        assert_eq!(resp.total, 600);
        assert_eq!(resp.values.len(), MAX_RESOURCES);
        assert_eq!(resp.values[0].value, "h599");
    }
}
