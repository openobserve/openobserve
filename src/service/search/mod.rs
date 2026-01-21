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

use std::{cmp::max, sync::Arc};

use arrow::array::RecordBatch;
use arrow_schema::{DataType, Field, Schema};
use cache::cacher::get_ts_col_order_by;
use chrono::{Duration, Utc};
use config::{
    TIMESTAMP_COL_NAME,
    cluster::LOCAL_NODE,
    get_config, ider,
    meta::{
        cluster::RoleGroup,
        function::RESULT_ARRAY,
        search::{self},
        self_reporting::usage::{RequestStats, UsageType},
        sql::{OrderBy, TableReferenceExt, resolve_stream_names},
        stream::{FileKey, StreamParams, StreamPartition, StreamType},
    },
    utils::{
        base64, json,
        schema::filter_source_by_partition_key,
        sql::{
            is_aggregate_query, is_eligible_for_histogram, is_explain_query,
            is_simple_distinct_query,
        },
        time::now_micros,
    },
};
use hashbrown::HashMap;
use infra::{
    cache::stats,
    cluster::get_cached_online_querier_nodes,
    errors::{Error, ErrorCodes},
    schema::unwrap_stream_settings,
};
use once_cell::sync::Lazy;
use opentelemetry::trace::TraceContextExt;
use proto::cluster_rpc::{self, SearchQuery};
use sql::Sql;
use tracing::Instrument;
use tracing_opentelemetry::OpenTelemetrySpanExt;
#[cfg(feature = "enterprise")]
use {
    crate::service::search::sql::visitor::group_by::get_group_by_fields,
    config::{
        META_ORG_ID,
        meta::{
            search::{CardinalityLevel, generate_aggregation_search_interval},
            self_reporting::usage::USAGE_STREAM,
        },
        utils::sql::is_simple_aggregate_query,
    },
    infra::{client::grpc::make_grpc_search_client, cluster::get_cached_online_query_nodes},
    o2_enterprise::enterprise::{
        common::config::get_config as get_o2_config,
        search::{
            TaskStatus, WorkGroup,
            cache::streaming_agg::{
                create_aggregation_cache_file_path, discover_cache_for_query,
                generate_optimal_partitions, get_aggregation_cache_key_from_request,
            },
            cache_aggs_util,
            datafusion::distributed_plan::streaming_aggs_exec,
        },
    },
    std::collections::HashSet,
    tracing::info_span,
};

use super::self_reporting::report_request_usage_stats;
use crate::{
    common::utils::{
        functions::{get_all_transform_keys, init_vrl_runtime},
        stream::get_settings_max_query_range,
    },
    handler::grpc::request::search::Searcher,
    service::search::{
        inspector::{SearchInspectorFieldsBuilder, search_inspector_fields},
        sql::{
            rewriter::index::use_inverted_index,
            visitor::histogram_interval::{
                convert_histogram_interval_to_seconds, generate_histogram_interval,
            },
        },
    },
};

pub(crate) mod cache;
#[cfg(feature = "enterprise")]
pub(crate) mod cardinality;
pub(crate) mod cluster;
pub(crate) mod datafusion;
pub(crate) mod grpc;
pub(crate) mod grpc_search;
pub(crate) mod index;
pub(crate) mod inspector;
pub(crate) mod partition;
pub(crate) mod sql;
pub(crate) mod streaming;
#[cfg(feature = "enterprise")]
pub(crate) mod super_cluster;
pub(crate) mod utils;
pub(crate) mod work_group;

/// The result of search in cluster
/// data, scan_stats, wait_in_queue, is_partial, partial_err
type SearchResult = (Vec<RecordBatch>, search::ScanStats, usize, bool, String);

// search manager
pub static SEARCH_SERVER: Lazy<Searcher> = Lazy::new(Searcher::new);

// Please note: `query_fn` which is the vrl needs to be base64::decoded
// when using this search
#[tracing::instrument(name = "service:search:enter", skip_all)]
pub async fn search(
    trace_id: &str,
    org_id: &str,
    stream_type: StreamType,
    user_id: Option<String>,
    in_req: &search::Request,
) -> Result<search::Response, Error> {
    let start = std::time::Instant::now();
    let started_at = now_micros();
    let cfg = get_config();

    let trace_id = if trace_id.is_empty() {
        if cfg.common.tracing_enabled || cfg.common.tracing_search_enabled {
            let ctx = tracing::Span::current().context();
            ctx.span().span_context().trace_id().to_string()
        } else {
            ider::generate_trace_id()
        }
    } else {
        trace_id.to_string()
    };

    #[cfg(not(feature = "enterprise"))]
    let req_regions = vec![];
    #[cfg(not(feature = "enterprise"))]
    let req_clusters = vec![];
    #[cfg(feature = "enterprise")]
    let req_regions = in_req.regions.clone();
    #[cfg(feature = "enterprise")]
    let req_clusters = in_req.clusters.clone();

    let query: SearchQuery = in_req.query.clone().into();
    let req_query = query.clone();
    let mut request = config::datafusion::request::Request::new(
        trace_id.clone(),
        org_id.to_string(),
        stream_type,
        in_req.timeout,
        user_id.clone(),
        Some((query.start_time, query.end_time)),
        in_req.search_type.map(|v| v.to_string()),
        in_req.query.histogram_interval,
        in_req.clear_cache,
    );
    if in_req.query.streaming_output && !in_req.query.track_total_hits {
        request.set_streaming_output(true, in_req.query.streaming_id.clone());
    }
    if let Some(v) = in_req.local_mode {
        request.set_local_mode(Some(v));
    }
    request.set_use_cache(in_req.use_cache);
    let meta = Sql::new_from_req(&request, &query).await?;

    #[cfg(feature = "enterprise")]
    {
        let sql = Some(in_req.query.sql.clone());
        let start_time = Some(in_req.query.start_time);
        let end_time = Some(in_req.query.end_time);
        let s_event_type = in_req
            .search_type
            .map(|s_event_type| s_event_type.to_string());
        // set search task
        SEARCH_SERVER
            .insert(
                trace_id.clone(),
                TaskStatus::new_leader(
                    vec![],
                    true,
                    user_id.clone(),
                    Some(org_id.to_string()),
                    Some(stream_type.to_string()),
                    sql,
                    start_time,
                    end_time,
                    s_event_type,
                    in_req.search_event_context.clone(),
                ),
            )
            .await;
    }

    let span = tracing::span::Span::current();
    let handle = tokio::task::spawn(
        async move { cluster::http::search(request, query, req_regions, req_clusters, true).await }
            .instrument(span),
    );
    let res = match handle.await {
        Ok(Ok(res)) => Ok(res),
        Ok(Err(e)) => Err(e),
        Err(e) => Err(Error::Message(e.to_string())),
    };

    #[allow(unused_mut)]
    let mut search_role = "leader".to_string();

    #[cfg(feature = "enterprise")]
    if get_o2_config().super_cluster.enabled {
        search_role = "super".to_string();
    }

    log::info!(
        "{}",
        search_inspector_fields(
            format!("[trace_id {trace_id}] in leader task finish"),
            SearchInspectorFieldsBuilder::new()
                .node_name(LOCAL_NODE.name.clone())
                .component("service:search leader finish".to_string())
                .search_role(search_role)
                .duration(start.elapsed().as_millis() as usize)
                .build()
        )
    );

    // remove task because task if finished
    let mut _work_group = None;
    #[cfg(feature = "enterprise")]
    {
        if let Some(status) = SEARCH_SERVER.remove(&trace_id, false).await
            && let Some((_, stat)) = status.first()
        {
            match stat.work_group.as_ref() {
                Some(WorkGroup::Short) => _work_group = Some("short".to_string()),
                Some(WorkGroup::Long) => _work_group = Some("long".to_string()),
                Some(WorkGroup::Background) => _work_group = Some("background".to_string()),
                None => _work_group = None,
            }
        };
    }

    match res {
        Ok(mut res) => {
            if in_req.query.streaming_output && meta.order_by.is_empty() {
                res = crate::service::search::streaming::order_search_results(res, None);
            }
            res.set_work_group(_work_group.clone());
            let time = start.elapsed().as_secs_f64();
            let (report_usage, search_type, search_event_context) = match in_req.search_type {
                Some(search_type) => {
                    if matches!(
                        search_type,
                        search::SearchEventType::UI
                            | search::SearchEventType::Dashboards
                            | search::SearchEventType::Values
                            | search::SearchEventType::Other
                            | search::SearchEventType::Alerts
                            | search::SearchEventType::DerivedStream
                    ) {
                        (false, None, None)
                    } else {
                        (
                            true,
                            in_req.search_type,
                            in_req.search_event_context.clone(),
                        )
                    }
                }
                None => (false, None, None),
            };

            if report_usage {
                let stream_name = match resolve_stream_names(&req_query.sql) {
                    Ok(v) => v.join(","),
                    Err(e) => {
                        log::error!("ParseSQLError(report_usage: parse sql error: {e:?})");
                        "".to_string()
                    }
                };
                let req_stats = RequestStats {
                    records: res.hits.len() as i64,
                    response_time: time,
                    size: res.scan_size as f64,
                    scan_files: if res.scan_files > 0 {
                        Some(res.scan_files as i64)
                    } else {
                        None
                    },
                    request_body: Some(req_query.sql.clone()),
                    function: if req_query.query_fn.is_empty() {
                        None
                    } else {
                        Some(req_query.query_fn.clone())
                    },
                    user_email: user_id,
                    min_ts: Some(req_query.start_time),
                    max_ts: Some(req_query.end_time),
                    cached_ratio: Some(res.cached_ratio),
                    search_type,
                    search_event_context,
                    trace_id: Some(trace_id),
                    took_wait_in_queue: Some(res.took_detail.wait_in_queue),
                    work_group: _work_group,
                    result_cache_ratio: Some(res.result_cache_ratio),
                    peak_memory_usage: res.peak_memory_usage,
                    ..Default::default()
                };
                let num_fn = if req_query.query_fn.is_empty() { 0 } else { 1 };
                report_request_usage_stats(
                    req_stats,
                    org_id,
                    &stream_name,
                    stream_type,
                    UsageType::Search,
                    num_fn,
                    started_at,
                )
                .await;
            }
            Ok(res)
        }
        Err(e) => {
            #[cfg(feature = "enterprise")]
            if let Some(streaming_id) = in_req.query.streaming_id.as_ref() {
                streaming_aggs_exec::remove_cache(streaming_id)
            }
            Err(e)
        }
    }
}

/// Returns Error if the first query is failed, otherwise returns the partial results.
/// In case one query fails, the remaining queries are not executed.
#[tracing::instrument(name = "service:search_multi:enter", skip(multi_req))]
pub async fn search_multi(
    trace_id: &str,
    org_id: &str,
    stream_type: StreamType,
    user_id: Option<String>,
    multi_req: &search::MultiStreamRequest,
) -> Result<search::Response, Error> {
    let start = std::time::Instant::now();
    let started_at = Utc::now().timestamp_micros();
    let cfg = get_config();
    let trace_id = if trace_id.is_empty() {
        if cfg.common.tracing_enabled || cfg.common.tracing_search_enabled {
            let ctx = tracing::Span::current().context();
            ctx.span().span_context().trace_id().to_string()
        } else {
            ider::generate_trace_id()
        }
    } else {
        trace_id.to_string()
    };

    let mut per_query_resp = multi_req.per_query_response;

    let mut query_fn = multi_req
        .query_fn
        .as_ref()
        .and_then(|v| base64::decode_url(v).ok());

    if let Some(vrl_function) = &query_fn {
        if RESULT_ARRAY.is_match(vrl_function) {
            // The query function expects results array as input
            // Hence, per_query_resp should be true
            per_query_resp = true;
        }
        if !vrl_function.trim().ends_with('.') {
            query_fn = Some(format!("{vrl_function} \n ."));
        }
    }

    let mut queries = multi_req.to_query_req();
    log::info!(
        "search_multi: trace_id: {}, queries.len(): {}",
        trace_id,
        queries.len()
    );
    let mut multi_res = search::Response::new(multi_req.from, multi_req.size);
    // Before making any rpc requests, first check the sql expressions can be decoded correctly
    for req in queries.iter_mut() {
        if let Err(e) = req.decode() {
            return Err(Error::Message(format!("decode sql error: {e:?}")));
        }
    }
    let queries_len = queries.len();
    let mut stream_names = vec![];
    let mut sqls = vec![];
    let mut index = 0;

    for mut req in queries {
        stream_names = match resolve_stream_names(&req.query.sql) {
            Ok(v) => v,
            Err(e) => {
                log::error!("ParseSQLError(search_multi: parse sql error: {e:?})");
                vec![]
            }
        };
        sqls.push(req.query.sql.clone());
        if !per_query_resp {
            req.query.query_fn = query_fn.clone();
        }

        for fn_name in get_all_transform_keys(org_id).await {
            if req.query.sql.contains(&format!("{fn_name}(")) {
                req.query.uses_zo_fn = true;
                break;
            }
        }

        let res = search(&trace_id, org_id, stream_type, user_id.clone(), &req).await;

        match res {
            Ok(res) => {
                index += 1;
                multi_res.took += res.took;

                if res.total > multi_res.total {
                    multi_res.total = res.total;
                }
                multi_res.from = res.from;
                multi_res.size += res.size;
                multi_res.scan_files += res.scan_files;
                multi_res.scan_size += res.scan_size;
                multi_res.scan_records += res.scan_records;
                multi_res.columns.extend(res.columns);

                multi_res.response_type = res.response_type;
                multi_res.trace_id = res.trace_id;
                multi_res.cached_ratio = res.cached_ratio;
                log::debug!(
                    "search_multi: res.hits.len() for query timerange to {} from {} : {}",
                    req.query.end_time,
                    req.query.start_time,
                    res.hits.len()
                );

                if per_query_resp {
                    multi_res.hits.push(serde_json::Value::Array(res.hits));
                } else {
                    multi_res.hits.extend(res.hits);
                }
            }
            Err(e) => {
                log::error!("search_multi: search error: {e:?}");
                if index == 0 {
                    // Error in the first query, return the error
                    return Err(e); // TODO: return partial results
                } else {
                    // Error in subsequent queries, add the error to the response and break
                    // No need to run the remaining queries
                    multi_res.function_error.push(e.to_string());
                    multi_res.is_partial = true;
                    break;
                }
            }
        }
    }

    let mut report_function_usage = false;
    multi_res.hits = if query_fn.is_some() && !multi_res.hits.is_empty() && !multi_res.is_partial {
        // compile vrl function & apply the same before returning the response
        let input_fn = query_fn.unwrap().trim().to_string();

        let apply_over_hits = RESULT_ARRAY.is_match(&input_fn);
        let mut runtime = init_vrl_runtime();
        let program = match crate::service::ingestion::compile_vrl_function(&input_fn, org_id) {
            Ok(program) => {
                let registry = program
                    .config
                    .get_custom::<vector_enrichment::TableRegistry>()
                    .unwrap();
                registry.finish_load();
                Some(program)
            }
            Err(err) => {
                log::error!("[trace_id {trace_id}] search->vrl: compile err: {err:?}");
                multi_res.function_error.push(err.to_string());
                multi_res.is_partial = true;
                None
            }
        };
        match program {
            Some(program) => {
                report_function_usage = true;
                if apply_over_hits {
                    let (ret_val, _) = crate::service::ingestion::apply_vrl_fn(
                        &mut runtime,
                        &config::meta::function::VRLResultResolver {
                            program: program.program.clone(),
                            fields: program.fields.clone(),
                        },
                        json::Value::Array(multi_res.hits),
                        org_id,
                        &stream_names,
                    );
                    ret_val
                        .as_array()
                        .unwrap()
                        .iter()
                        .filter_map(|v| {
                            if per_query_resp {
                                let flattened_array = v
                                    .as_array()
                                    .unwrap()
                                    .iter()
                                    .map(|item| {
                                        config::utils::flatten::flatten(item.clone()).unwrap()
                                    })
                                    .collect::<Vec<_>>();
                                Some(serde_json::Value::Array(flattened_array))
                            } else {
                                (!v.is_null())
                                    .then_some(config::utils::flatten::flatten(v.clone()).unwrap())
                            }
                        })
                        .collect()
                } else {
                    multi_res
                        .hits
                        .into_iter()
                        .filter_map(|hit| {
                            let (ret_val, _) = crate::service::ingestion::apply_vrl_fn(
                                &mut runtime,
                                &config::meta::function::VRLResultResolver {
                                    program: program.program.clone(),
                                    fields: program.fields.clone(),
                                },
                                hit,
                                org_id,
                                &stream_names,
                            );
                            (!ret_val.is_null())
                                .then_some(config::utils::flatten::flatten(ret_val).unwrap())
                        })
                        .collect()
                }
            }
            None => multi_res.hits,
        }
    } else {
        multi_res.hits
    };
    log::debug!("multi_res len after applying vrl: {}", multi_res.hits.len());
    let column_timestamp = TIMESTAMP_COL_NAME.to_string();
    multi_res.cached_ratio /= queries_len;
    multi_res.hits.sort_by(|a, b| {
        if a.get(&column_timestamp).is_none() || b.get(&column_timestamp).is_none() {
            return std::cmp::Ordering::Equal;
        }
        let a_ts = a.get(&column_timestamp).unwrap().as_i64().unwrap();
        let b_ts = b.get(&column_timestamp).unwrap().as_i64().unwrap();
        b_ts.cmp(&a_ts)
    });
    let time = start.elapsed().as_secs_f64();

    if report_function_usage {
        let req_stats = RequestStats {
            // For functions, records = records * num_function, in this case num_function = 1
            records: multi_res.total as i64,
            response_time: time,
            size: multi_res.scan_size as f64,
            request_body: Some(json::to_string(&sqls).unwrap()),
            user_email: None,
            min_ts: None,
            max_ts: None,
            cached_ratio: None,
            trace_id: None,
            search_type: multi_req.search_type,
            search_event_context: multi_req.search_event_context.clone(),
            ..Default::default()
        };
        report_request_usage_stats(
            req_stats,
            org_id,
            &stream_names.join(","),
            stream_type,
            UsageType::Functions,
            0, // The request stats already contains function event
            started_at,
        )
        .await;
    }
    Ok(multi_res)
}

#[allow(clippy::too_many_arguments)]
#[tracing::instrument(name = "service:search_partition", skip(req))]
pub async fn search_partition(
    trace_id: &str,
    org_id: &str,
    user_id: Option<&str>,
    stream_type: StreamType,
    req: &search::SearchPartitionRequest,
    skip_max_query_range: bool,
    is_http_req: bool,
    enable_align_histogram: bool,
    use_aggs_cache: bool,
) -> Result<search::SearchPartitionResponse, Error> {
    let start = std::time::Instant::now();
    let cfg = get_config();

    let query = cluster_rpc::SearchQuery {
        start_time: req.start_time,
        end_time: req.end_time,
        sql: req.sql.to_string(),
        histogram_interval: req.histogram_interval,
        ..Default::default()
    };
    let sql = Sql::new(&query, org_id, stream_type, None).await?;

    // check for vrl
    let apply_over_hits = match req.query_fn.as_ref() {
        None => false,
        Some(v) => {
            if v.is_empty() {
                false
            } else {
                let v = base64::decode_url(v).unwrap_or(v.to_string());
                RESULT_ARRAY.is_match(&v)
            }
        }
    };

    // if there is no _timestamp field or EXPLAIN in the query, return single partitions
    let is_explain_query = is_explain_query(&req.sql);
    let is_aggregate = is_aggregate_query(&req.sql).unwrap_or(false);
    let ts_column = get_ts_col_order_by(&sql, TIMESTAMP_COL_NAME, is_aggregate).map(|(v, _)| v);

    #[cfg(feature = "enterprise")]
    let mut is_cachable_aggs = is_simple_aggregate_query(&req.sql).unwrap_or(false);

    #[cfg(feature = "enterprise")]
    {
        let res: Result<cache_aggs_util::CacheAggregationAnalysisResult, String> =
            cache_aggs_util::analyze_count_aggregation_pattern(&req.sql);
        if let Ok(result) = res {
            is_cachable_aggs = result.matches_pattern || is_cachable_aggs;
        }
    }

    let mut skip_get_file_list = ts_column.is_none() || apply_over_hits;
    let is_simple_distinct = is_simple_distinct_query(&req.sql).unwrap_or(false);
    let is_http_distinct = is_simple_distinct && is_http_req;

    #[cfg(feature = "enterprise")]
    let org_settings = crate::service::db::organization::get_org_setting(org_id)
        .await
        .unwrap_or_default();

    #[cfg(feature = "enterprise")]
    let mut is_streaming_aggregate = ts_column.is_none()
        && is_cachable_aggs
        && cfg.common.feature_query_streaming_aggs
        && org_settings.streaming_aggregation_enabled
        && !is_http_distinct;

    #[cfg(not(feature = "enterprise"))]
    let is_streaming_aggregate = false;

    // if need streaming output and is simple query, we shouldn't skip file list
    if skip_get_file_list && req.streaming_output && is_streaming_aggregate {
        skip_get_file_list = false;
    }

    // if http distinct, we should skip file list
    if is_http_distinct || is_explain_query {
        skip_get_file_list = true;
    }

    let mut files = Vec::with_capacity(sql.schemas.len() * 10);

    let mut step_factor = 1;

    let mut max_query_range = 0;
    let mut max_query_range_in_hour = 0;
    let mut index_size = 0;
    let mut original_size = 0;
    for (stream, schema) in sql.schemas.iter() {
        let stream_type = stream.get_stream_type(stream_type);
        let stream_name = stream.stream_name();
        let stream_settings = unwrap_stream_settings(schema.schema()).unwrap_or_default();
        let stats = stats::get_stream_stats(org_id, &stream_name, stream_type);
        let use_stream_stats_for_partition =
            if stream_settings == config::meta::stream::StreamSettings::default() {
                cfg.common.use_stream_settings_for_partitions_enabled
            } else {
                stream_settings.approx_partition
            };

        if !skip_get_file_list && !use_stream_stats_for_partition {
            let stream_files = crate::service::file_list::query_ids(
                trace_id,
                &sql.org_id,
                stream_type,
                &stream_name,
                sql.time_range.unwrap_or_default(),
            )
            .await?;
            max_query_range = max(
                max_query_range,
                get_settings_max_query_range(stream_settings.max_query_range, org_id, user_id)
                    .await
                    * 3600
                    * 1_000_000,
            );
            max_query_range_in_hour = max(
                max_query_range_in_hour,
                get_settings_max_query_range(stream_settings.max_query_range, org_id, user_id)
                    .await,
            );
            files.extend(stream_files);
        } else {
            // data retention should be either from stream settings or global data retension
            let data_retention = if stream_settings.data_retention > 0 {
                stream_settings.data_retention
            } else {
                cfg.compact.data_retention_days
            };
            let mut data_retention = data_retention * 24 * 60 * 60;
            // data duration in seconds
            let query_duration = (req.end_time - req.start_time) / 1000 / 1000;

            // if stats.doc_time_max is 0, handle the case by using current time
            let data_end_time = if stats.doc_time_max == 0 {
                Utc::now().timestamp_micros()
            } else {
                std::cmp::min(Utc::now().timestamp_micros(), stats.doc_time_max)
            };

            let data_retention_based_on_stats = (data_end_time - stats.doc_time_min) / 1000 / 1000;

            if data_retention_based_on_stats > 0 {
                data_retention = std::cmp::min(data_retention, data_retention_based_on_stats);
            };
            if data_retention == 0 {
                log::warn!("Data retention is zero, setting to 1 to prevent division by zero");
                data_retention = 1;
            }
            let records = (stats.doc_num as i64 / data_retention) * query_duration;
            let original_size = (stats.storage_size as i64 / data_retention) * query_duration;
            log::info!(
                "[trace_id {trace_id}] using approximation: stream: {stream_name}, records: {records}, original_size: {original_size}, data_retention in seconds: {data_retention}",
            );
            files.push(infra::file_list::FileId {
                id: Utc::now().timestamp_micros(),
                records,
                original_size,
                deleted: false,
            });
        }
        index_size = max(index_size, stats.index_size as i64);
        original_size = max(original_size, stats.storage_size as i64);
        if index_size > 0 {
            step_factor = max(step_factor, original_size / index_size);
        } else {
            step_factor = 1;
        }
    }
    log::info!(
        "[trace_id {trace_id}] max_query_range: {}, max_query_range_in_hour: {}",
        max_query_range,
        max_query_range_in_hour
    );

    let file_list_took = start.elapsed().as_millis() as usize;
    let (is_histogram_eligible, _) = is_eligible_for_histogram(
        &req.sql, // `is_multi_stream_search` will always be false for search_partition
        false,
    )
    .unwrap_or((false, false));

    log::info!(
        "[trace_id {trace_id}] search_partition: get file_list time_range: {:?}, files: {}, took: {} ms",
        (req.start_time, req.end_time),
        files.len(),
        file_list_took,
    );

    if skip_get_file_list {
        let mut response = search::SearchPartitionResponse::default();
        response.partitions.push([req.start_time, req.end_time]);
        response.max_query_range = max_query_range_in_hour;
        response.histogram_interval = sql.histogram_interval;
        response.is_histogram_eligible = is_histogram_eligible;
        log::info!("[trace_id {trace_id}] search_partition: returning single partition");
        return Ok(response);
    };

    let nodes = get_cached_online_querier_nodes(Some(RoleGroup::Interactive))
        .await
        .unwrap_or_default();
    if nodes.is_empty() {
        log::error!("[trace_id {trace_id}] search_partition: no querier node online");
        return Err(Error::Message("no querier node online".to_string()));
    }
    let cpu_cores = nodes.iter().map(|n| n.cpu_num).sum::<u64>() as usize;

    let (records, original_size) = files.iter().fold((0, 0), |(records, original_size), f| {
        (records + f.records, original_size + f.original_size)
    });

    let mut resp = search::SearchPartitionResponse {
        trace_id: trace_id.to_string(),
        file_num: files.len(),
        records: records as usize,
        original_size: original_size as usize,
        compressed_size: 0, // there is no compressed size in file list
        max_query_range: max_query_range_in_hour,
        histogram_interval: sql.histogram_interval,
        partitions: vec![],
        order_by: OrderBy::Desc,
        limit: sql.limit,
        // non enterprise - diabled
        #[cfg(not(feature = "enterprise"))]
        streaming_output: false,
        #[cfg(not(feature = "enterprise"))]
        streaming_aggs: false,
        #[cfg(not(feature = "enterprise"))]
        streaming_id: None,
        // enterprise
        #[cfg(feature = "enterprise")]
        streaming_output: false,
        #[cfg(feature = "enterprise")]
        streaming_aggs: false,
        #[cfg(feature = "enterprise")]
        streaming_id: None,
        is_histogram_eligible,
    };

    let mut min_step = Duration::try_seconds(1)
        .unwrap()
        .num_microseconds()
        .unwrap();
    if (is_aggregate && ts_column.is_some()) || enable_align_histogram {
        let hist_int = if let Some(hist_int) = sql.histogram_interval {
            hist_int
        } else {
            let interval = generate_histogram_interval(Some((req.start_time, req.end_time)));
            match convert_histogram_interval_to_seconds(interval) {
                Ok(v) => v,
                Err(e) => {
                    log::error!(
                        "[trace_id {trace_id}] search_partition: convert_histogram_interval_to_seconds error: {e:?}",
                    );
                    10
                }
            }
        };
        // add a check if histogram interval is greater than 0 to avoid panic with min_step being 0
        if hist_int > 0 {
            min_step *= hist_int;
        }
    }

    // Calculate original step with all factors considered
    let mut total_secs = resp.original_size / cfg.limit.query_group_base_speed / cpu_cores;
    if total_secs * cfg.limit.query_group_base_speed * cpu_cores < resp.original_size {
        total_secs += 1;
    }

    // If total secs is <= aggs_min_num_partition_secs (default 3 seconds), then disable
    // partitioning even if streaming aggs is true. This optimization avoids partition overhead
    // for fast queries.
    #[cfg(feature = "enterprise")]
    if is_streaming_aggregate && total_secs <= cfg.limit.aggs_min_num_partition_secs {
        log::info!(
            "[trace_id {trace_id}] Disabling streaming aggregation: total_secs ({}) <= aggs_min_num_partition_secs ({}), returning single partition",
            total_secs,
            cfg.limit.aggs_min_num_partition_secs
        );
        resp.partitions = vec![[req.start_time, req.end_time]];
        resp.streaming_aggs = false;
        resp.streaming_id = None;
        return Ok(resp);
    }

    let mut part_num = max(1, total_secs / cfg.limit.query_partition_by_secs);
    if part_num * cfg.limit.query_partition_by_secs < total_secs {
        part_num += 1;
    }
    // if the partition number is too large, we limit it to 1000
    if part_num > 1000 {
        part_num = 1000;
    }

    log::info!(
        "[trace_id {trace_id}] search_partition: original_size: {}, cpu_cores: {}, base_speed: {}, partition_secs: {}, part_num: {}",
        resp.original_size,
        cpu_cores,
        cfg.limit.query_group_base_speed,
        cfg.limit.query_partition_by_secs,
        part_num
    );

    // Calculate step with all constraints
    let mut step = (req.end_time - req.start_time) / part_num as i64;
    // step must be times of min_step
    if step < min_step {
        step = min_step;
    }
    // Align step with min_step to ensure partition boundaries match histogram intervals
    if min_step > 0 && step % min_step > 0 {
        // If step is not perfectly divisible by min_step, round it down to the nearest multiple
        // Example: If min_step = 5 minutes  and step = 17 minutes
        //   step % min_step = 17 % 5 = 2 (2 minutes)
        //   step = 17 - 2 = 15 (15 minutes, which is divisible by 5)
        step = step - step % min_step;
    }
    // this is to ensure we create partitions less than max_query_range
    if !skip_max_query_range && max_query_range > 0 && step > max_query_range {
        step = if min_step < max_query_range {
            max_query_range - max_query_range % min_step
        } else {
            max_query_range
        };
    }

    let mut is_histogram = sql.histogram_interval.is_some();
    let mut add_mini_partition = false;
    // Set this to true to generate partitions aligned with interval
    // only for logs page when query is non-histogram
    // and also with query param `align_histogram` is true,
    // so that logs can reuse the same partitions
    // for histogram query
    if !is_histogram && enable_align_histogram {
        is_histogram = true;
        // add mini partition for the histogram aligned partitions in the UI search
        add_mini_partition = true;
    }

    let sql_order_by = sql
        .order_by
        .first()
        .map(|(field, order_by)| {
            if field == &ts_column.clone().unwrap_or_default() && order_by == &OrderBy::Asc {
                OrderBy::Asc
            } else {
                OrderBy::Desc
            }
        })
        .unwrap_or(OrderBy::Desc);

    log::debug!(
        "[trace_id {trace_id}] total_secs: {}, partition_num: {}, step: {}, min_step: {}, is_histogram: {}",
        total_secs,
        part_num,
        step,
        min_step,
        is_histogram || enable_align_histogram
    );
    // Create a partition generator
    let generator = partition::PartitionGenerator::new(
        min_step,
        cfg.limit.search_mini_partition_duration_secs,
        is_histogram || enable_align_histogram,
    );

    if cfg.common.align_partitions_for_index && use_inverted_index(&sql) {
        step *= step_factor;
    }

    #[cfg(feature = "enterprise")]
    // check if we need to use streaming_output
    let streaming_id = if req.streaming_output && is_streaming_aggregate && !skip_get_file_list {
        let (stream_name, _all_streams) = match resolve_stream_names(&req.sql) {
            // TODO: cache don't not support multiple stream names
            Ok(v) => (v[0].clone(), v.join(",")),
            Err(e) => {
                return Err(Error::Message(e.to_string()));
            }
        };

        // check cardinality for group by fields
        let group_by_fields = get_group_by_fields(&sql).await?;
        let cardinality_map = crate::service::search::cardinality::check_cardinality(
            org_id,
            stream_type,
            &stream_name,
            &group_by_fields,
            query.end_time,
        )
        .await?;

        let cardinality_value = cardinality_map.values().product::<f64>();
        let cardinality_level = CardinalityLevel::from(cardinality_value);
        let cache_interval = generate_aggregation_search_interval(
            query.start_time,
            query.end_time,
            cardinality_level,
        );

        log::info!(
            "[trace_id {trace_id}] search_partition: using streaming_output, group by fields: {cardinality_map:?}, cardinality level: {cardinality_level:?}, interval: {cache_interval:?}"
        );

        let cache_interval_mins = cache_interval.get_duration_minutes();
        if cache_interval_mins == 0 {
            // this query can't use streaming_agg cache,
            // so we set is_streaming_aggregate to false and return None
            is_streaming_aggregate = false;
            // skip_get_file_list = true;
            None
        } else {
            let streaming_id = ider::uuid();
            let hashed_query = get_aggregation_cache_key_from_request(req);
            let cache_file_path = create_aggregation_cache_file_path(
                org_id,
                &stream_type.to_string(),
                &stream_name,
                hashed_query,
            );

            // Discover existing cache files for this query
            let cache_discovery_result = if !use_aggs_cache {
                o2_enterprise::enterprise::search::cache::streaming_agg::CacheDiscoveryResult::empty(
                    query.start_time,
                    query.end_time,
                )
            } else {
                match discover_cache_for_query(
                    &cache_file_path,
                    query.start_time,
                    query.end_time,
                    cache_interval,
                )
                .await
                {
                    Ok(result) => result,
                    Err(e) => {
                        log::warn!(
                            "[trace_id {trace_id}] [streaming_id: {streaming_id}] Failed to discover cache: {e}, proceeding without cache optimization"
                        );
                        // Create empty discovery result to proceed without cache
                        o2_enterprise::enterprise::search::cache::streaming_agg::CacheDiscoveryResult::empty(
                            query.start_time,
                            query.end_time,
                        )
                    }
                }
            };

            log::info!(
                "[trace_id {trace_id}] [streaming_id: {streaming_id}] Cache discovery: coverage={:.2}%, cached_ranges={}, uncached_ranges={}",
                cache_discovery_result.cache_coverage_ratio * 100.0,
                cache_discovery_result.cached_ranges.len(),
                cache_discovery_result.uncached_ranges.len()
            );

            // Generate optimal partitions based on cache discovery
            let partition_strategy = generate_optimal_partitions(
                cache_discovery_result,
                query.start_time,
                query.end_time,
                cardinality_level,
            );

            log::info!(
                "[trace_id {trace_id}] [streaming_id: {streaming_id}] Partition strategy: {}, requires_execution={}, execution_partitions={}",
                partition_strategy.strategy_name(),
                partition_strategy.requires_execution(),
                partition_strategy.execution_partition_count()
            );

            streaming_aggs_exec::init_cache(
                &streaming_id,
                query.start_time,
                query.end_time,
                &cache_file_path,
                cache_interval_mins,
            );

            // Store partition strategy for use in do_partitioned_search
            streaming_aggs_exec::set_partition_strategy(&streaming_id, partition_strategy);

            log::info!(
                "[trace_id {trace_id}] [streaming_id: {streaming_id}] init streaming_agg cache: cache_file_path: {cache_file_path}"
            );
            Some(streaming_id)
        }
    } else {
        None
    };
    #[cfg(feature = "enterprise")]
    let streaming_aggs = is_streaming_aggregate && req.streaming_output && streaming_id.is_some();
    #[cfg(feature = "enterprise")]
    {
        resp.streaming_output = streaming_aggs;
        resp.streaming_aggs = streaming_aggs;
        resp.streaming_id = streaming_id.clone();
    }

    // Get cache strategy for streaming aggregates (enterprise only)
    #[cfg(feature = "enterprise")]
    let stremaing_aggs_cache_strategy = if streaming_aggs && streaming_id.is_some() {
        let streaming_id_ref = streaming_id.as_ref().unwrap();
        match streaming_aggs_exec::get_partition_strategy(streaming_id_ref) {
            Some(strategy) => {
                log::info!(
                    "[trace_id {trace_id}] [streaming_id: {streaming_id_ref}] Using cache-aware partition strategy"
                );
                Some(strategy)
            }
            None => {
                log::warn!(
                    "[trace_id {trace_id}] [streaming_id: {streaming_id_ref}] No partition strategy found, using default generation"
                );
                None
            }
        }
    } else {
        None
    };

    // Generate partitions
    let partitions = generator.generate_partitions(
        req.start_time,
        req.end_time,
        step,
        sql_order_by,
        is_aggregate,
        add_mini_partition,
        #[cfg(feature = "enterprise")]
        stremaing_aggs_cache_strategy,
    );

    if sql_order_by == OrderBy::Asc {
        resp.order_by = OrderBy::Asc;
    }

    resp.partitions = partitions;
    if enable_align_histogram {
        let min_step_secs = min_step / 1_000_000;
        resp.histogram_interval = Some(min_step_secs);
    }
    Ok(resp)
}

#[cfg(feature = "enterprise")]
pub async fn query_status() -> Result<search::QueryStatusResponse, Error> {
    // get nodes from cluster

    let mut nodes = match get_cached_online_query_nodes(None).await {
        Some(nodes) => nodes,
        None => {
            log::error!("query_status: no querier node online");
            return Err(server_internal_error("no querier node online"));
        }
    };
    // sort nodes by node_id this will improve hit cache ratio
    nodes.dedup_by(|a, b| a.grpc_addr == b.grpc_addr);
    let nodes = nodes;

    // make cluster request
    let trace_id = config::ider::generate_trace_id();
    let mut tasks = Vec::with_capacity(nodes.len());
    for node in nodes {
        let node_addr = node.grpc_addr.clone();
        let grpc_span = info_span!(
            "service:search:cluster:grpc_query_status",
            node_id = node.id,
            node_addr = node_addr.as_str(),
        );

        let trace_id = trace_id.clone();
        let task = tokio::task::spawn(
            async move {
                let mut request = tonic::Request::new(proto::cluster_rpc::QueryStatusRequest {});
                let node = Arc::new(node) as _;
                let mut client = make_grpc_search_client(&trace_id, &mut request, &node, 0).await?;
                let response = match client.query_status(request).await {
                    Ok(res) => res.into_inner(),
                    Err(err) => {
                        log::error!(
                            "[trace_id {trace_id}] search->grpc: node: {}, search err: {:?}",
                            &node.get_grpc_addr(),
                            err
                        );
                        let err = ErrorCodes::from_json(err.message())?;
                        return Err(Error::ErrorCode(err));
                    }
                };
                Ok(response)
            }
            .instrument(grpc_span),
        );
        tasks.push(task);
    }

    let mut results = Vec::with_capacity(tasks.len());
    for task in tasks {
        match task.await {
            Ok(res) => match res {
                Ok(res) => results.push(res),
                Err(err) => {
                    return Err(err);
                }
            },
            Err(e) => {
                return Err(Error::ErrorCode(ErrorCodes::ServerInternalError(
                    e.to_string(),
                )));
            }
        }
    }

    let mut status = vec![];
    let mut set = HashSet::new();
    for result in results.into_iter().flat_map(|v| v.status.into_iter()) {
        if set.contains(&result.trace_id) {
            continue;
        } else {
            set.insert(result.trace_id.clone());
        }
        let query = result.query.as_ref().map(|query| search::QueryInfo {
            sql: query.sql.clone(),
            start_time: query.start_time,
            end_time: query.end_time,
        });
        let scan_stats = result
            .scan_stats
            .as_ref()
            .map(|scan_stats| search::ScanStats {
                files: scan_stats.files,
                records: scan_stats.records,
                original_size: scan_stats.original_size / 1024 / 1024, // change to MB
                compressed_size: scan_stats.compressed_size / 1024 / 1024, // change to MB
                querier_files: scan_stats.querier_files,
                querier_memory_cached_files: scan_stats.querier_memory_cached_files,
                querier_disk_cached_files: scan_stats.querier_disk_cached_files,
                idx_scan_size: scan_stats.idx_scan_size / 1024 / 1024, // change to MB
                idx_took: scan_stats.idx_took,
                file_list_took: scan_stats.file_list_took,
                aggs_cache_ratio: scan_stats.aggs_cache_ratio,
                peak_memory_usage: scan_stats.peak_memory_usage / 1024 / 1024, // change to MB
            });
        let query_status = if result.is_queue {
            "waiting"
        } else {
            "processing"
        };
        let work_group = if result.work_group.is_none() {
            "Unknown"
        } else if *result.work_group.as_ref().unwrap() == 0 {
            "Short"
        } else {
            "Long"
        };
        let search_type: Option<search::SearchEventType> = result.search_type.map(|s_event_type| {
            search::SearchEventType::try_from(s_event_type.as_str())
                .unwrap_or(search::SearchEventType::UI)
        });
        status.push(search::QueryStatus {
            trace_id: result.trace_id,
            created_at: result.created_at,
            started_at: result.started_at,
            status: query_status.to_string(),
            user_id: result.user_id,
            org_id: result.org_id,
            stream_type: result.stream_type,
            query,
            scan_stats,
            work_group: work_group.to_string(),
            search_type,
            search_event_context: result.search_event_context.map(Into::into),
        });
    }

    Ok(search::QueryStatusResponse { status })
}

#[cfg(feature = "enterprise")]
pub async fn cancel_query(
    _org_id: &str,
    trace_id: &str,
) -> Result<search::CancelQueryResponse, Error> {
    // get nodes from cluster
    let mut nodes = match get_cached_online_query_nodes(None).await {
        Some(nodes) => nodes,
        None => {
            log::error!("cancel_query: no querier node online");
            return Err(server_internal_error("no querier node online"));
        }
    };
    // sort nodes by node_id this will improve hit cache ratio
    nodes.dedup_by(|a, b| a.grpc_addr == b.grpc_addr);
    let nodes = nodes;

    // make cluster request
    let mut tasks = Vec::new();
    for node in nodes.iter().cloned() {
        let node_addr = node.grpc_addr.clone();
        let grpc_span = info_span!(
            "service:search:cluster:grpc_cancel_query",
            node_id = node.id,
            node_addr = node_addr.as_str(),
        );

        let trace_id = trace_id.to_string();
        let task = tokio::task::spawn(
            async move {
                let mut request = tonic::Request::new(proto::cluster_rpc::CancelQueryRequest {
                    trace_id: trace_id.clone(),
                });
                let node = Arc::new(node) as _;
                let mut client = make_grpc_search_client(&trace_id, &mut request, &node, 0).await?;
                let response: cluster_rpc::CancelQueryResponse = match client
                    .cancel_query(request)
                    .await
                {
                    Ok(res) => res.into_inner(),
                    Err(err) => {
                        log::error!(
                            "[trace_id {trace_id}] grpc_cancel_query: node: {}, search err: {:?}",
                            &node.get_grpc_addr(),
                            err
                        );
                        let err = ErrorCodes::from_json(err.message())?;
                        return Err(Error::ErrorCode(err));
                    }
                };
                Ok(response)
            }
            .instrument(grpc_span),
        );
        tasks.push(task);
    }

    let mut results = Vec::with_capacity(tasks.len());
    for task in tasks {
        match task.await {
            Ok(res) => match res {
                Ok(res) => results.push(res),
                Err(err) => {
                    return Err(err);
                }
            },
            Err(e) => {
                return Err(Error::ErrorCode(ErrorCodes::ServerInternalError(
                    e.to_string(),
                )));
            }
        }
    }

    Ok(search::CancelQueryResponse {
        trace_id: trace_id.to_string(),
        is_success: true,
    })
}

/// match a source is a valid file or not
#[allow(clippy::too_many_arguments)]
pub async fn match_file(
    org_id: &str,
    stream_type: StreamType,
    stream_name: &str,
    time_range: Option<(i64, i64)>,
    source: &FileKey,
    partition_keys: &[StreamPartition],
    equal_items: &[(String, String)],
) -> bool {
    // fast path
    if partition_keys.is_empty()
        || !source.key.contains('=')
        || stream_type == StreamType::EnrichmentTables
    {
        return true;
    }

    // slow path
    let mut filters = generate_filter_from_equal_items(equal_items);
    let partition_keys: HashMap<&String, &StreamPartition> =
        partition_keys.iter().map(|v| (&v.field, v)).collect();
    for (key, value) in filters.iter_mut() {
        if let Some(partition_key) = partition_keys.get(key) {
            for val in value.iter_mut() {
                *val = partition_key.get_partition_value(val);
            }
        }
    }
    match_source(
        Arc::new(StreamParams::new(org_id, stream_name, stream_type)),
        time_range,
        &filters,
        source,
    )
    .await
}

/// before [("a", "3"), ("b", "5"), ("a", "4"), ("b", "6")]
/// after [("a", ["3", "4"]), ("b", ["5", "6"])]
pub fn generate_filter_from_equal_items(
    equal_items: &[(String, String)],
) -> Vec<(String, Vec<String>)> {
    let mut filters: HashMap<String, Vec<String>> = HashMap::new();
    for (field, value) in equal_items {
        filters
            .entry(field.to_string())
            .or_default()
            .push(value.to_string());
    }
    filters.into_iter().collect()
}

/// match a source is a valid file or not
pub async fn match_source(
    stream: Arc<StreamParams>,
    time_range: Option<(i64, i64)>,
    filters: &[(String, Vec<String>)],
    source: &FileKey,
) -> bool {
    // match org_id & table
    if !source.key.starts_with(
        format!(
            "files/{}/{}/{}/",
            stream.org_id, stream.stream_type, stream.stream_name
        )
        .as_str(),
    ) {
        return false;
    }

    // check partition key
    if !filter_source_by_partition_key(&source.key, filters) {
        return false;
    }

    // check time range
    if source.meta.min_ts == 0 || source.meta.max_ts == 0 {
        return true;
    }
    log::trace!(
        "time range: {:?}, file time: {}-{}, {}",
        time_range,
        source.meta.min_ts,
        source.meta.max_ts,
        source.key
    );

    // match partition clause
    if let Some((time_min, time_max)) = time_range {
        if time_min > 0 && time_min > source.meta.max_ts {
            return false;
        }
        if time_max > 0 && time_max < source.meta.min_ts {
            return false;
        }
    }
    true
}

pub fn server_internal_error(error: impl ToString) -> Error {
    Error::ErrorCode(ErrorCodes::ServerInternalError(error.to_string()))
}

#[tracing::instrument(name = "service:search_partition_multi", skip(req))]
pub async fn search_partition_multi(
    trace_id: &str,
    org_id: &str,
    user_id: &str,
    stream_type: StreamType,
    req: &search::MultiSearchPartitionRequest,
    enable_align_histogram: bool,
) -> Result<search::SearchPartitionResponse, Error> {
    let mut res = search::SearchPartitionResponse::default();
    let mut total_rec = 0;
    let mut is_histogram_eligible = true;
    for query in &req.sql {
        match search_partition(
            trace_id,
            org_id,
            Some(user_id),
            stream_type,
            &search::SearchPartitionRequest {
                start_time: req.start_time,
                end_time: req.end_time,
                sql: query.to_string(),
                encoding: req.encoding,
                regions: req.regions.clone(),
                clusters: req.clusters.clone(),
                query_fn: req.query_fn.clone(),
                streaming_output: req.streaming_output,
                histogram_interval: req.histogram_interval,
                sampling_ratio: None,
            },
            false,
            true,
            enable_align_histogram,
            false, // disable aggs cache
        )
        .await
        {
            Ok(resp) => {
                if resp.partitions.len() > res.partitions.len() {
                    total_rec += resp.records;
                    if !resp.is_histogram_eligible {
                        is_histogram_eligible = false;
                    }
                    res = resp;
                }
            }
            Err(err) => {
                log::error!("search_partition_multi error: {err:?}");
            }
        };
    }
    res.records = total_rec;
    res.is_histogram_eligible = is_histogram_eligible;
    Ok(res)
}

// generate parquet file search schema
pub fn generate_search_schema_diff(
    schema: &Schema,
    latest_schema_map: &HashMap<&String, &Arc<Field>>,
) -> HashMap<String, DataType> {
    // calculate the diff between latest schema and group schema
    let mut diff_fields = HashMap::new();

    for field in schema.fields().iter() {
        if let Some(latest_field) = latest_schema_map.get(field.name())
            && field.data_type() != latest_field.data_type()
        {
            diff_fields.insert(field.name().clone(), latest_field.data_type().clone());
        }
    }

    diff_fields
}

#[inline]
pub fn check_search_allowed(_org_id: &str, _stream: Option<&str>) -> Result<(), Error> {
    #[cfg(feature = "enterprise")]
    {
        // for meta org usage and audit stream, we should always allow search
        if _org_id == META_ORG_ID && _stream == Some(USAGE_STREAM) || _stream == Some("audit") {
            return Ok(());
        }
        // this is installation level limit for all orgs combined
        if !o2_enterprise::enterprise::license::search_allowed() {
            Err(Error::Message(
                "Search is temporarily disabled due to exceeding allotted ingestion limit. Please contact your administrator.".to_string(),
            ))
        } else {
            Ok(())
        }
    }

    #[cfg(not(feature = "enterprise"))]
    Ok(())
}
