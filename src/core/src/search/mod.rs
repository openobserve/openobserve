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

use std::sync::Arc;

use arrow::array::RecordBatch;
use arrow_schema::{DataType, Field, Schema};
use chrono::Utc;
use config::{
    TIMESTAMP_COL_NAME,
    cluster::LOCAL_NODE,
    get_config, ider,
    meta::{
        cluster::RoleGroup,
        function::RESULT_ARRAY,
        search::{self},
        self_reporting::usage::{RequestStats, UsageType},
        sql::{OrderBy, resolve_stream_names},
        stream::{FileKey, StreamParams, StreamPartition, StreamType},
    },
    utils::{base64, json, schema::filter_source_by_partition_key, time::now_micros},
};
use hashbrown::HashMap;
use infra::errors::{Error, ErrorCodes};
#[cfg(feature = "enterprise")]
use openobserve_search_service::SEARCH_SERVER;
use openobserve_search_service::partition::{
    calculate_partition_settings_for_context, cpu_cores::estimated_secs,
    generate_partitions_for_context, sql_context::PartitionSqlContext,
    stream_files::collect_stream_files,
};
use opentelemetry::trace::TraceContextExt;
use proto::cluster_rpc::SearchQuery;
use sql::Sql;
use tracing::Instrument;
use tracing_opentelemetry::OpenTelemetrySpanExt;
#[cfg(feature = "enterprise")]
use {
    config::{META_ORG_ID, meta::self_reporting::usage::USAGE_STREAM},
    infra::{client::grpc::make_grpc_search_client, cluster::get_cached_online_query_nodes},
    o2_enterprise::enterprise::{
        common::config::get_config as get_o2_config,
        search::{TaskStatus, datafusion::distributed_plan::streaming_aggs_exec},
    },
    std::collections::HashSet,
    tracing::info_span,
};

use super::self_reporting::report_request_usage_stats;
use crate::{
    common::utils::functions::{get_all_transform_keys, init_vrl_runtime},
    service::search::inspector::{SearchInspectorFieldsBuilder, search_inspector_fields},
};

pub mod cluster;
pub mod grpc;
pub mod grpc_search;
#[cfg(feature = "enterprise")]
pub mod super_cluster;

pub use ::search::{bloom_pruner, datafusion, index, inspector, sql, tantivy, utils};

/// Core's composition adapter for cache-owned search orchestration.
#[derive(Clone, Copy, Debug, Default)]
pub struct CoreSearchRuntime;

#[async_trait::async_trait]
impl openobserve_search_service::cache::CacheRuntime for CoreSearchRuntime {
    async fn execute_search(
        &self,
        trace_id: &str,
        org_id: &str,
        stream_type: StreamType,
        user_id: Option<String>,
        req: &search::Request,
    ) -> Result<search::Response, Error> {
        crate::search::search(trace_id, org_id, stream_type, user_id, req).await
    }

    fn report_search_metrics(
        &self,
        start: std::time::Instant,
        org_id: &str,
        stream_type: StreamType,
        search_type: &str,
        search_group: &str,
    ) {
        crate::self_reporting::http_report_metrics(
            start,
            org_id,
            stream_type,
            "200",
            "_search",
            search_type,
            search_group,
        );
    }

    async fn report_search_usage(
        &self,
        stats: RequestStats,
        org_id: &str,
        stream_name: &str,
        stream_type: StreamType,
        num_functions: u16,
        timestamp: i64,
    ) {
        crate::self_reporting::report_request_usage_stats(
            stats,
            org_id,
            stream_name,
            stream_type,
            UsageType::Search,
            num_functions,
            timestamp,
        )
        .await;
    }
}

#[async_trait::async_trait]
impl openobserve_search_service::streaming::StreamingRuntime for CoreSearchRuntime {
    async fn max_query_range(
        &self,
        stream_names: &[String],
        org_id: &str,
        user_id: &str,
        stream_type: StreamType,
    ) -> i64 {
        crate::stream_utils::get_max_query_range(stream_names, org_id, user_id, stream_type).await
    }

    async fn search_partition(
        &self,
        trace_id: &str,
        org_id: &str,
        user_id: Option<&str>,
        stream_type: StreamType,
        req: &search::SearchPartitionRequest,
        skip_max_query_range: bool,
        use_cache: bool,
    ) -> Result<search::SearchPartitionResponse, Error> {
        crate::search::search_partition(
            trace_id,
            org_id,
            user_id,
            stream_type,
            req,
            skip_max_query_range,
            use_cache,
        )
        .await
    }

    #[cfg(feature = "enterprise")]
    fn search_error_status(&self, error: &Error) -> u16 {
        crate::http::map_error_to_http_response(error, None)
            .status()
            .as_u16()
    }

    #[cfg(feature = "enterprise")]
    async fn audit(&self, message: o2_enterprise::enterprise::common::auditor::AuditMessage) {
        crate::self_reporting::audit(message).await;
    }
}

#[async_trait::async_trait]
impl openobserve_search_service::partition::PartitionRuntime for CoreSearchRuntime {
    async fn query_file_ids(
        &self,
        trace_id: &str,
        org_id: &str,
        stream_type: StreamType,
        stream_name: &str,
        time_range: (i64, i64),
    ) -> Result<Vec<infra::file_list::FileId>, Error> {
        crate::file_list::query_ids(trace_id, org_id, stream_type, stream_name, time_range).await
    }

    async fn settings_max_query_range(
        &self,
        stream_max_query_range: i64,
        org_id: &str,
        user_id: Option<&str>,
    ) -> i64 {
        crate::stream_utils::get_settings_max_query_range(stream_max_query_range, org_id, user_id)
            .await
    }
}

#[async_trait::async_trait]
impl openobserve_search_service::GrpcRuntime for CoreSearchRuntime {
    async fn cached_search(
        &self,
        trace_id: &str,
        org_id: &str,
        stream_type: StreamType,
        user_id: Option<String>,
        req: &search::Request,
    ) -> Result<search::Response, Error> {
        openobserve_search_service::cache::search(
            *self,
            trace_id,
            org_id,
            stream_type,
            user_id,
            req,
            String::new(),
            false,
            None,
            false,
        )
        .await
    }

    async fn search_multi(
        &self,
        trace_id: &str,
        org_id: &str,
        stream_type: StreamType,
        user_id: Option<String>,
        req: &search::MultiStreamRequest,
    ) -> Result<search::Response, Error> {
        crate::search::search_multi(trace_id, org_id, stream_type, user_id, req).await
    }

    async fn search_partition(
        &self,
        trace_id: &str,
        org_id: &str,
        user_id: Option<&str>,
        stream_type: StreamType,
        req: &search::SearchPartitionRequest,
        skip_max_query_range: bool,
        use_cache: bool,
    ) -> Result<search::SearchPartitionResponse, Error> {
        crate::search::search_partition(
            trace_id,
            org_id,
            user_id,
            stream_type,
            req,
            skip_max_query_range,
            use_cache,
        )
        .await
    }

    async fn cancel_query(
        &self,
        _org_id: &str,
        trace_id: &str,
    ) -> Result<search::CancelQueryResponse, Error> {
        #[cfg(feature = "enterprise")]
        return crate::search::cancel_query(_org_id, trace_id).await;

        #[cfg(not(feature = "enterprise"))]
        Ok(search::CancelQueryResponse {
            trace_id: trace_id.to_string(),
            is_success: false,
        })
    }

    #[cfg(feature = "enterprise")]
    async fn enrich_query_status(&self, status: &mut [proto::cluster_rpc::QueryStatus]) {
        for query_status in status {
            if let Some(ref mut ctx) = query_status.search_event_context
                && matches!(query_status.search_type.as_deref(), Some("dashboards"))
                && let Some(dashboard_id) = &ctx.dashboard_id
                && ctx.dashboard_name.is_none()
                && let Some(org_id) = &query_status.org_id
                && let Ok((folder, dashboard)) =
                    crate::dashboards::get_folder_and_dashboard(org_id, dashboard_id).await
            {
                ctx.dashboard_name = Some(dashboard.title().unwrap_or("").to_string());
                ctx.dashboard_folder_name = Some(folder.name);
                ctx.dashboard_folder_id = Some(folder.folder_id);
            }
        }
    }
}

/// The result of search in cluster
/// data, scan_stats, wait_in_queue, is_partial, partial_err
type SearchResult = (Vec<RecordBatch>, search::ScanStats, usize, bool, String);

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

    #[allow(unused_mut)]
    let mut search_role = "leader".to_string();
    #[cfg(feature = "enterprise")]
    if get_o2_config().super_cluster.enabled {
        search_role = "super".to_string();
    }

    let trace_id = if trace_id.is_empty() {
        if cfg.common.should_create_span() {
            let ctx = tracing::Span::current().context();
            ctx.span().span_context().trace_id().to_string()
        } else {
            ider::generate_trace_id()
        }
    } else {
        trace_id.to_string()
    };

    log::info!(
        "{}",
        search_inspector_fields(
            format!("[trace_id {trace_id}] in leader task start"),
            SearchInspectorFieldsBuilder::new()
                .trace_id(trace_id.to_string())
                .node_name(LOCAL_NODE.name.clone())
                .component("service:search leader start".to_string())
                .search_role(search_role.to_string())
                .build()
        )
    );

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

    log::info!(
        "{}",
        search_inspector_fields(
            format!("[trace_id {trace_id}] in leader task finish"),
            SearchInspectorFieldsBuilder::new()
                .trace_id(trace_id.to_string())
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
            && let Some(wg) = stat.work_group.as_ref()
        {
            _work_group = Some(wg.to_string());
        };
    }

    match res {
        Ok(mut res) => {
            if in_req.query.streaming_output && meta.order_by.is_empty() {
                res =
                    openobserve_search_service::streaming::sorting::order_search_results(res, None);
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
        if cfg.common.should_create_span() {
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
    multi_res.hits = if let Some(query_fn) = query_fn.as_ref()
        && !multi_res.hits.is_empty()
        && !multi_res.is_partial
    {
        // compile vrl function & apply the same before returning the response
        let input_fn = query_fn.trim().to_string();

        let apply_over_hits = RESULT_ARRAY.is_match(&input_fn);
        let mut runtime = init_vrl_runtime();
        let program = match openobserve_transform::compile_vrl_function(&input_fn, org_id) {
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
                    let (ret_val, err) = openobserve_transform::apply_vrl_fn(
                        &mut runtime,
                        &config::meta::function::VRLResultResolver {
                            program: program.program.clone(),
                            fields: program.fields.clone(),
                        },
                        json::Value::Array(multi_res.hits),
                        org_id,
                        &stream_names,
                    );
                    if let Some(e) = err {
                        log::error!("[trace_id {trace_id}] Error applying vrl function: {e}");
                    }
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
                    let mut error = "".to_string();
                    let res = multi_res
                        .hits
                        .into_iter()
                        .filter_map(|hit| {
                            let (ret_val, err) = openobserve_transform::apply_vrl_fn(
                                &mut runtime,
                                &config::meta::function::VRLResultResolver {
                                    program: program.program.clone(),
                                    fields: program.fields.clone(),
                                },
                                hit,
                                org_id,
                                &stream_names,
                            );
                            if let Some(e) = err {
                                error = e;
                            }
                            (!ret_val.is_null())
                                .then_some(config::utils::flatten::flatten(ret_val).unwrap())
                        })
                        .collect();
                    if !error.is_empty() {
                        log::error!("[trace_id {trace_id}] Error applying vrl function: {error}");
                    }
                    res
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
    use_cache: bool,
) -> Result<search::SearchPartitionResponse, Error> {
    let cfg = get_config();

    let role_group = req.search_type.map(RoleGroup::from);

    let ctx = PartitionSqlContext::new(req, org_id, stream_type).await?;

    let stream_files = collect_stream_files(&CoreSearchRuntime, trace_id, user_id, &ctx).await?;

    let mut resp = search::SearchPartitionResponse {
        trace_id: trace_id.to_string(),
        file_num: stream_files.files.len(),
        records: stream_files.records as usize,
        original_size: stream_files.original_size as usize,
        compressed_size: 0, // there is no compressed size in file list
        max_query_range: stream_files.max_query_range_in_hour,
        histogram_interval: ctx.sql.histogram_interval,
        partitions: vec![],
        order_by: ctx.sql_order_by,
        limit: ctx.sql.limit,
        streaming_output: false,
        streaming_aggs: false,
        streaming_id: None,
        is_histogram_eligible: ctx.is_histogram_eligible,
        non_ts_order_by_cols: vec![],
    };

    let total_secs = estimated_secs(trace_id, &ctx, role_group, resp.original_size).await?;

    if ctx.use_single_partition
        || (ctx.is_streaming_aggregate && total_secs <= cfg.limit.aggs_min_num_partition_secs)
    {
        log::info!(
            "[trace_id {trace_id}] search_partition: return single partition because (using single partition {}) or (total_secs ({total_secs}) <= aggs_min_num_partition_secs ({})) is true",
            ctx.use_single_partition,
            cfg.limit.aggs_min_num_partition_secs
        );
        resp.partitions = vec![[req.start_time, req.end_time]];
        return Ok(resp);
    }

    if ctx.detect_non_ts_order_by() {
        resp.non_ts_order_by_cols = ctx
            .sql
            .order_by
            .iter()
            .map(|(col, dir)| (col.clone(), matches!(dir, OrderBy::Desc)))
            .collect();
        if cfg.limit.disable_partitions_for_non_ts_order_by {
            log::info!(
                "[trace_id {trace_id}] search_partition: non-ts ORDER BY, disabling partitions (circuit breaker)"
            );
            resp.partitions = vec![[req.start_time, req.end_time]];
            return Ok(resp);
        }
    }

    #[cfg(feature = "enterprise")]
    {
        let (streaming_aggs, streaming_id, cache_strategy) =
            openobserve_search_service::partition::aggregate::prepare_streaming_aggregate(
                &CoreSearchRuntime,
                trace_id,
                req,
                &ctx,
                use_cache,
            )
            .await?;
        resp.streaming_output = streaming_aggs;
        resp.streaming_aggs = streaming_aggs;
        resp.streaming_id = streaming_id;

        if let Some(strategy) = cache_strategy {
            resp.partitions = strategy.to_time_partitions(ctx.sql_order_by);
            return Ok(resp);
        }
    }

    let partition_settings = calculate_partition_settings_for_context(
        trace_id,
        total_secs,
        &ctx,
        skip_max_query_range,
        stream_files.max_query_range,
    );

    resp.partitions = generate_partitions_for_context(&ctx, &partition_settings);
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
                            "[trace_id {trace_id}] search->grpc: node: {}, search err: {err:?}",
                            node.get_grpc_addr(),
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
                wait_in_queue: scan_stats.wait_in_queue,
            });
        let query_status = if result.is_queue {
            "waiting"
        } else {
            "processing"
        };
        let work_group = result.work_group.clone().unwrap_or_default();
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
            work_group,
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
                let response: proto::cluster_rpc::CancelQueryResponse = match client
                    .cancel_query(request)
                    .await
                {
                    Ok(res) => res.into_inner(),
                    Err(err) => {
                        log::error!(
                            "[trace_id {trace_id}] grpc_cancel_query: node: {}, search err: {err:?}",
                            node.get_grpc_addr(),
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
                search_type: None,
            },
            false,
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

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use arrow_schema::{DataType, Field, Schema};
    use hashbrown::HashMap;

    use super::*;

    #[test]
    fn test_generate_filter_from_equal_items_empty() {
        let result = generate_filter_from_equal_items(&[]);
        assert!(result.is_empty());
    }

    #[test]
    fn test_generate_filter_from_equal_items_single_pair() {
        let items = vec![("field1".to_string(), "val1".to_string())];
        let result = generate_filter_from_equal_items(&items);
        assert_eq!(result.len(), 1);
        let (field, values) = &result[0];
        assert_eq!(field, "field1");
        assert_eq!(values, &["val1"]);
    }

    #[test]
    fn test_generate_filter_from_equal_items_groups_by_field() {
        let items = vec![
            ("a".to_string(), "3".to_string()),
            ("b".to_string(), "5".to_string()),
            ("a".to_string(), "4".to_string()),
            ("b".to_string(), "6".to_string()),
        ];
        let mut result = generate_filter_from_equal_items(&items);
        result.sort_by(|x, y| x.0.cmp(&y.0));
        assert_eq!(result.len(), 2);
        let (_, a_vals) = result.iter().find(|(f, _)| f == "a").unwrap();
        let mut a_vals = a_vals.clone();
        a_vals.sort();
        assert_eq!(a_vals, vec!["3", "4"]);
        let (_, b_vals) = result.iter().find(|(f, _)| f == "b").unwrap();
        let mut b_vals = b_vals.clone();
        b_vals.sort();
        assert_eq!(b_vals, vec!["5", "6"]);
    }

    #[test]
    fn test_generate_filter_from_equal_items_single_field_multiple_values() {
        let items = vec![
            ("status".to_string(), "200".to_string()),
            ("status".to_string(), "404".to_string()),
            ("status".to_string(), "500".to_string()),
        ];
        let result = generate_filter_from_equal_items(&items);
        assert_eq!(result.len(), 1);
        let (_, values) = &result[0];
        let mut v = values.clone();
        v.sort();
        assert_eq!(v, vec!["200", "404", "500"]);
    }

    #[test]
    fn test_generate_search_schema_diff_no_diff() {
        let field = Arc::new(Field::new("col1", DataType::Utf8, false));
        let schema = Schema::new(vec![field.clone()]);
        let map: HashMap<&String, &Arc<Field>> = [(field.name(), &field)].into_iter().collect();
        let diff = generate_search_schema_diff(&schema, &map);
        assert!(diff.is_empty());
    }

    #[test]
    fn test_generate_search_schema_diff_detects_type_change() {
        let old_field = Arc::new(Field::new("col1", DataType::Utf8, false));
        let new_field = Arc::new(Field::new("col1", DataType::Int64, false));
        let schema = Schema::new(vec![old_field.clone()]);
        let map: HashMap<&String, &Arc<Field>> =
            [(new_field.name(), &new_field)].into_iter().collect();
        let diff = generate_search_schema_diff(&schema, &map);
        assert_eq!(diff.len(), 1);
        assert_eq!(diff.get("col1").unwrap(), &DataType::Int64);
    }

    #[test]
    fn test_generate_search_schema_diff_missing_in_latest() {
        let field = Arc::new(Field::new("col1", DataType::Utf8, false));
        let schema = Schema::new(vec![field]);
        let map: HashMap<&String, &Arc<Field>> = HashMap::new();
        let diff = generate_search_schema_diff(&schema, &map);
        assert!(diff.is_empty());
    }

    #[test]
    fn test_server_internal_error_contains_message() {
        let err = server_internal_error("disk full");
        assert!(err.to_string().contains("disk full"));
    }

    #[test]
    fn test_check_search_allowed_non_enterprise_always_ok() {
        assert!(check_search_allowed("myorg", None).is_ok());
        assert!(check_search_allowed("myorg", Some("logs")).is_ok());
    }
}
