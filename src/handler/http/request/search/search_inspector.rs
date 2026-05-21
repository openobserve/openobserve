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

use axum::{
    Json,
    extract::{Path, Query},
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
};
use config::{
    get_config,
    meta::{
        search::{Query as SearchQuery, SearchEventType},
        stream::StreamType,
    },
    utils::time::now_micros,
};
use hashbrown::HashMap;
use serde_json;
use tracing::{Instrument, Span};

use crate::{
    common::{
        meta::{self},
        utils::{
            auth::UserEmail,
            http::{get_or_create_trace_id, get_use_cache_from_request},
            stream::get_settings_max_query_range,
        },
    },
    handler::http::{
        extractors::Headers,
        request::search::{
            error_utils,
            utils::{StreamPermissionResourceType, check_stream_permissions},
        },
    },
    service::{
        search::{inspector::*, sql::visitor::cipher_key::get_cipher_key_names},
        self_reporting::http_report_metrics,
    },
};

/// GetSearchProfile

#[utoipa::path(
    get,
    path = "/{org_id}/search/profile",
    context_path = "/api",
    tag = "Search",
    operation_id = "GetSearchProfile",
    summary = "Get search performance profile",
    description = "Retrieves detailed performance profiling information for search queries executed within a specified time \
                   range. This includes execution timing, node information, component performance metrics, and resource \
                   usage statistics. Use this to analyze and optimize search performance, troubleshoot slow queries, and \
                   understand query execution patterns across your cluster.",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("trace_id" = Option<String>, Query, description = "trace_id, eg: trace_id=684a4e5dac43429a86a0a2ef9adf62c2"),
        ("start_time" = i64, Query, description = "start time"),
        ("end_time" = i64, Query, description = "end time"),
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = Object, example = json!({
          "sql": "SELECT count(*) FROM \"default\" WHERE match_all('m')",
          "start_time": "1744168877746000",
          "end_time": "1744773677746000",
          "total_duration": 2407,
          "events": [
            {
              "timestamp": "1744773679038683087",
              "node_role": [
                "Ingester"
              ],
              "node_name": "usertest-openobserve-ingester-0",
              "search_role": "follower",
              "region": "us-east-1",
              "cluster": "cluster-0",
              "duration": 0,
              "component": "wal:memtable load",
              "desc": "wal mem search load groups 1, files 6, scan_size 16.01 MB, compressed_size 16.85 MB"
            }]})),
        (status = 400, description = "Failure", content_type = "application/json", body = ()),
        (status = 500, description = "Failure", content_type = "application/json", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Search", "operation": "get"}))
    )
)]
pub async fn get_search_profile(
    Path(_path): Path<String>,
    Query(query): Query<HashMap<String, String>>,
    Headers(user_email): Headers<UserEmail>,
    headers: HeaderMap,
) -> Response {
    let start = std::time::Instant::now();
    let cfg = get_config();

    let (org_id, stream_name) = ("_meta", "default".to_string());
    let mut range_error = String::new();
    let http_span = if cfg.common.should_create_span() {
        tracing::info_span!("/api/{org_id}/{stream_name}/search/profile")
    } else {
        Span::none()
    };

    let trace_id = get_or_create_trace_id(&headers, &http_span);
    let user_id = user_email.user_id;

    let stream_type = StreamType::Traces;

    let Some(query_trace_id) = query.get("trace_id") else {
        return meta::http::HttpResponse::bad_request("trace_id is required");
    };
    let start_time_from_trace_id =
        config::ider::get_start_time_from_trace_id(query_trace_id).unwrap_or(0);

    let start_time = match query.get("start_time") {
        Some(v) if !v.is_empty() => v.parse::<i64>().unwrap_or(0),
        _ => {
            if start_time_from_trace_id > 0 {
                start_time_from_trace_id - 60 * 1_000_000 // minus 1m
            } else {
                0
            }
        }
    };
    let end_time = match query.get("end_time") {
        Some(v) if !v.is_empty() => v.parse::<i64>().unwrap_or(0),
        _ => {
            if start_time_from_trace_id > 0 {
                std::cmp::min(now_micros(), start_time_from_trace_id + 3600 * 1_000_000) // plus 1h
            } else {
                0
            }
        }
    };

    // Validate required parameters
    if start_time == 0 || end_time == 0 {
        return meta::http::HttpResponse::bad_request("start_time/end_time must be valid i64");
    }

    // handle encoding for query and aggs
    let mut req: config::meta::search::Request = config::meta::search::Request {
        query: SearchQuery {
            sql: format!(
                "SELECT _timestamp, events FROM default WHERE trace_id = '{query_trace_id}' ORDER BY start_time"
            ),
            start_time,
            end_time,
            from: 0,
            size: 2500,
            ..Default::default()
        },
        search_type: Some(SearchEventType::UI),
        ..Default::default()
    };

    if let Err(e) = req.decode() {
        return meta::http::HttpResponse::bad_request(e);
    }
    req.use_cache = get_use_cache_from_request(&query);

    // get stream settings
    if let Some(settings) = infra::schema::get_settings(org_id, &stream_name, stream_type).await {
        let max_query_range =
            get_settings_max_query_range(settings.max_query_range, org_id, Some(&user_id)).await;
        if max_query_range > 0
            && (req.query.end_time - req.query.start_time) > max_query_range * 3600 * 1_000_000
        {
            req.query.start_time = req.query.end_time - max_query_range * 3600 * 1_000_000;
            range_error = format!(
                "Query duration is modified due to query range restriction of {max_query_range} hours"
            );
        }
    }

    // Check permissions on stream
    if let Some(res) = check_stream_permissions(
        &stream_name,
        org_id,
        &user_id,
        &stream_type,
        StreamPermissionResourceType::Search,
    )
    .await
    {
        return res;
    }

    let keys_used = match get_cipher_key_names(&req.query.sql) {
        Ok(v) => v,
        Err(e) => {
            return (
                StatusCode::BAD_REQUEST,
                Json(meta::http::HttpResponse::error(StatusCode::BAD_REQUEST, e)),
            )
                .into_response();
        }
    };
    if !keys_used.is_empty() {
        log::info!("keys used : {keys_used:?}");
    }
    for key in keys_used {
        // Check permissions on keys
        {
            use config::meta::user::DBUser;
            use o2_openfga::meta::mapping::OFGA_MODELS;

            use crate::common::{
                infra::config::USERS,
                utils::auth::{AuthExtractor, is_root_user},
            };

            if !is_root_user(&user_id) {
                let user = match USERS
                    .get(&format!("{org_id}/{user_id}"))
                    .and_then(|user_record| {
                        DBUser::from(&(user_record.clone())).get_user(org_id.to_string())
                    }) {
                    Some(user) => user,
                    None => {
                        return meta::http::HttpResponse::forbidden("User not found");
                    }
                };

                if !crate::handler::http::auth::validator::check_permissions(
                    &user_id,
                    AuthExtractor {
                        auth: "".to_string(),
                        method: "GET".to_string(),
                        o2_type: format!(
                            "{}:{}",
                            OFGA_MODELS
                                .get("cipher_keys")
                                .map_or("cipher_keys", |model| model.key),
                            key
                        ),
                        org_id: org_id.to_string(),
                        bypass_check: false,
                        parent_id: "".to_string(),
                        use_all_org: false,
                        use_self_context: false,
                        use_self_parent: true,
                    },
                    user.role,
                    user.is_external,
                )
                .await
                {
                    return crate::common::meta::http::HttpResponse::forbidden(
                        "Unauthorized Access to key",
                    );
                }
                // Check permissions on key ends
            }
        }
    }

    // run search with cache
    let res = crate::service::search::cache::search(
        &trace_id,
        org_id,
        stream_type,
        Some(user_id),
        &req,
        range_error,
        false,
        None,
        false,
    )
    .instrument(http_span)
    .await;
    match res {
        Ok(res) => {
            let mut events = Vec::new();
            let mut si = SearchInspector {
                sql: "".to_string(),
                start_time: "".to_string(),
                end_time: "".to_string(),
                total_duration: 0,
                scan_size: 0,
                scan_records: 0,
                data_records: 0,
                events: vec![],
            };

            let mut search_summary = Vec::new();
            let mut stream_summary = Vec::new();

            for hit in res.hits {
                if let Some(events_str) = hit.get("events")
                    && let Ok(parsed_events) = serde_json::from_str::<Vec<SearchInspectorEvent>>(
                        events_str.as_str().unwrap_or("[]"),
                    )
                {
                    let mut inspectors = vec![];
                    let _: Vec<_> = parsed_events
                        .into_iter()
                        .map(|event| {
                            if let Some(mut fields) =
                                extract_search_inspector_fields(event.name.as_str())
                            {
                                if fields.component == Some("summary".to_string()) {
                                    search_summary.push(fields);
                                } else if fields.component == Some("stream_summary".to_string()) {
                                    stream_summary.push(fields);
                                } else {
                                    fields.timestamp = Some(event._timestamp.to_string());
                                    inspectors.push(fields);
                                }
                            }
                        })
                        .collect();

                    events.extend(inspectors);
                }
            }

            if stream_summary.is_empty() {
                for event in search_summary {
                    si.sql = event.sql.unwrap_or_default();
                    let time_range = event.time_range.unwrap_or_default();
                    si.start_time = if si.start_time.is_empty() {
                        time_range.0
                    } else {
                        si.start_time.clone().min(time_range.0)
                    };
                    si.end_time = si.end_time.clone().max(time_range.1);
                    si.total_duration += event.duration.unwrap_or_default();
                    si.scan_size += event.scan_size.unwrap_or_default();
                    si.scan_records += event.scan_records.unwrap_or_default();
                    si.data_records += event.data_records.unwrap_or_default();
                }
            } else {
                for event in stream_summary {
                    si.sql = event.sql.unwrap_or_default();
                    let time_range = event.time_range.unwrap_or_default();
                    si.start_time = if si.start_time.is_empty() {
                        time_range.0
                    } else {
                        si.start_time.clone().min(time_range.0)
                    };
                    si.end_time = si.end_time.clone().max(time_range.1);
                    si.total_duration += event.duration.unwrap_or_default();
                    si.scan_size += event.scan_size.unwrap_or_default();
                    si.scan_records += event.scan_records.unwrap_or_default();
                    si.data_records += event.data_records.unwrap_or_default();
                }
            }

            si.events = organize_events(events);

            Json(si).into_response()
        }
        Err(err) => {
            let search_type = req
                .search_type
                .map(|t| t.to_string())
                .unwrap_or("".to_string());
            http_report_metrics(
                start,
                org_id,
                stream_type,
                "500",
                "search/profile",
                &search_type,
                "",
            );
            log::error!("[trace_id {trace_id}] search error: {err}");
            error_utils::map_error_to_http_response(&err, Some(trace_id))
        }
    }
}

/// Organize events by cluster and regions
/// When we enable super clsuter, we need to show the events which search_role is super as first
/// level, and the group all the other events by cluster and region and just show the total duration
/// in the first level. Then show the events which search_role is leader as second level, and the
/// group all the other events by cluster and region and node and just show the total duration in
/// the second level. Finally show the events which search_role is follower as third level and sort
/// by _timestamp.
fn organize_events(events: Vec<SearchInspectorFields>) -> Vec<SearchInspectorFields> {
    let is_super_cluster = o2_enterprise::enterprise::common::config::get_config()
        .super_cluster
        .enabled;

    if !is_super_cluster {
        return group_leader_events(events);
    }

    let (super_events, other_events): (Vec<_>, Vec<_>) = events
        .into_iter()
        .partition(|e| e.search_role.as_deref() == Some("super"));

    let mut organized_events: Vec<SearchInspectorFields> = super_events;
    let grouped = group_by_key(
        other_events,
        |e| {
            (
                format_trace_id(e.trace_id.clone()),
                e.cluster.clone().unwrap_or_default(),
                e.region.clone().unwrap_or_default(),
            )
        },
        |mut summary, (trace_id, cluster, region), timestamp, duration, nested| {
            summary.trace_id = Some(trace_id);
            summary.cluster = Some(cluster);
            summary.region = Some(region);
            summary.timestamp = Some(timestamp);
            summary.duration = Some(duration);
            summary.search_role = Some("leader".to_string());
            summary.events = Some(group_leader_events(nested));
            if let Some(events) = summary.events.as_ref()
                && let Some(event) = events
                    .iter()
                    .find(|e| e.component == Some("remote scan streaming".to_string()))
            {
                summary.desc = Some(event.desc.clone().unwrap_or_default());
            }
            summary
        },
    );
    organized_events.extend(grouped);
    organized_events.sort_by(|a, b| a.timestamp.cmp(&b.timestamp));
    organized_events
}

fn group_leader_events(events: Vec<SearchInspectorFields>) -> Vec<SearchInspectorFields> {
    let (leader_events, other_events): (Vec<_>, Vec<_>) = events
        .into_iter()
        .partition(|e| e.search_role.as_deref() == Some("leader"));

    let mut organized_events: Vec<SearchInspectorFields> = leader_events;
    let grouped = group_by_key(
        other_events,
        |e| {
            (
                format_trace_id(e.trace_id.clone()),
                e.node_name.clone().unwrap_or_default(),
            )
        },
        |mut summary, (trace_id, node_name), timestamp, duration, nested| {
            summary.trace_id = Some(trace_id);
            summary.node_name = Some(node_name);
            summary.timestamp = Some(timestamp);
            summary.duration = Some(duration);
            summary.search_role = Some("follower".to_string());
            summary.events = Some(sort_events_by_timestamp(nested));
            if let Some(events) = summary.events.as_ref()
                && let Some(event) = events
                    .iter()
                    .find(|e| e.component == Some("remote scan streaming".to_string()))
            {
                summary.desc = Some(event.desc.clone().unwrap_or_default());
            }
            summary
        },
    );
    organized_events.extend(grouped);
    organized_events.sort_by(|a, b| a.timestamp.cmp(&b.timestamp));
    organized_events
}

fn sort_events_by_timestamp(mut events: Vec<SearchInspectorFields>) -> Vec<SearchInspectorFields> {
    events.sort_by(|a, b| a.timestamp.cmp(&b.timestamp));
    // reset trace_id to None
    events.iter_mut().for_each(|e| {
        e.trace_id = None;
        e.search_role = None;
        e.cluster = None;
        e.region = None;
        e.node_name = None;
    });
    events
}

/// Group events by key, aggregate max timestamp and sum duration per group, then build summary
/// entries via `build_summary`. Keys must implement `Hash + Eq + Clone`.
fn group_by_key<K, F, B>(
    events: Vec<SearchInspectorFields>,
    key_fn: F,
    build_summary: B,
) -> Vec<SearchInspectorFields>
where
    K: std::hash::Hash + Eq + Clone,
    F: Fn(&SearchInspectorFields) -> K,
    B: Fn(
        SearchInspectorFields,
        K,
        String,
        usize,
        Vec<SearchInspectorFields>,
    ) -> SearchInspectorFields,
{
    let mut groups: HashMap<K, (String, usize, Vec<SearchInspectorFields>)> = HashMap::new();
    for event in events {
        let key = key_fn(&event);
        let ts = event.timestamp.clone().unwrap_or_default();
        let dur = event.duration.unwrap_or_default();
        let entry = groups
            .entry(key)
            .or_insert_with(|| (String::new(), 0, Vec::new()));
        if entry.0.is_empty() || ts < entry.0 {
            entry.0 = ts;
        }
        if event.component.is_none() || event.component.as_ref().unwrap() != "remote scan streaming"
        {
            entry.1 += dur;
        }
        entry.2.push(event);
    }
    groups
        .into_iter()
        .map(|(key, (timestamp, duration, events))| {
            build_summary(
                SearchInspectorFields::new(),
                key,
                timestamp,
                duration,
                events,
            )
        })
        .collect()
}

fn format_trace_id(trace_id: Option<String>) -> String {
    let Some(trace_id) = trace_id else {
        return "".to_string();
    };
    let mut cols = trace_id.split("-").collect::<Vec<&str>>();
    // 019cae07a3f0740ab34831ba04563200-1-13jPR6A
    // 21aae3eed2c6fd63aabba9feed664331-Evlj599
    // we only need the first two columns or the first column when the second is not number, the
    // third used for different stage on same node
    if cols.len() >= 2 {
        if cols[1].chars().all(|c| c.is_ascii_digit()) {
            cols.truncate(2);
        } else {
            cols.truncate(1);
        }
    }
    cols.join("-")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::service::search::inspector::SearchInspectorFields;

    #[test]
    fn test_format_trace_id_none_returns_empty() {
        assert_eq!(format_trace_id(None), "");
    }

    #[test]
    fn test_format_trace_id_single_part_unchanged() {
        assert_eq!(format_trace_id(Some("abcdef".to_string())), "abcdef");
    }

    #[test]
    fn test_format_trace_id_three_parts_second_numeric_keeps_two() {
        assert_eq!(
            format_trace_id(Some(
                "019cae07a3f0740ab34831ba04563200-1-13jPR6A".to_string()
            )),
            "019cae07a3f0740ab34831ba04563200-1"
        );
    }

    #[test]
    fn test_format_trace_id_two_parts_second_non_numeric_keeps_first() {
        assert_eq!(
            format_trace_id(Some("21aae3eed2c6fd63aabba9feed664331-Evlj599".to_string())),
            "21aae3eed2c6fd63aabba9feed664331"
        );
    }

    #[test]
    fn test_sort_events_by_timestamp_empty_returns_empty() {
        let events: Vec<SearchInspectorFields> = vec![];
        let result = sort_events_by_timestamp(events);
        assert!(result.is_empty());
    }

    #[test]
    fn test_sort_events_by_timestamp_clears_identifying_fields() {
        let mut event = SearchInspectorFields::default();
        event.trace_id = Some("trace-123".to_string());
        event.search_role = Some("follower".to_string());
        event.cluster = Some("cluster-a".to_string());
        event.region = Some("us-east-1".to_string());
        event.node_name = Some("node-1".to_string());
        event.timestamp = Some("1000".to_string());

        let result = sort_events_by_timestamp(vec![event]);
        let e = &result[0];
        assert!(e.trace_id.is_none());
        assert!(e.search_role.is_none());
        assert!(e.cluster.is_none());
        assert!(e.region.is_none());
        assert!(e.node_name.is_none());
    }

    #[test]
    fn test_sort_events_by_timestamp_orders_ascending() {
        let mut e1 = SearchInspectorFields::default();
        e1.timestamp = Some("2000".to_string());
        let mut e2 = SearchInspectorFields::default();
        e2.timestamp = Some("1000".to_string());

        let result = sort_events_by_timestamp(vec![e1, e2]);
        assert_eq!(result[0].timestamp, Some("1000".to_string()));
        assert_eq!(result[1].timestamp, Some("2000".to_string()));
    }
}
