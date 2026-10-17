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
    cmp::{max, min},
    sync::Arc,
};

use config::{
    get_config,
    meta::{
        cluster::{Node, RoleGroup},
        promql::value::*,
        search::{ScanStats, SearchEventType},
        self_reporting::usage::{RequestStats, UsageType},
        stream::StreamType,
    },
    utils::{
        time::{now_micros, second_micros},
        took_watcher::TookWatcher,
    },
};
use futures::future::try_join_all;
use hashbrown::HashMap;
use infra::{
    client::grpc::{ResponseCompression, make_grpc_metrics_client_with_policy},
    errors::{Error, ErrorCodes, Result},
    runtime::DATAFUSION_RUNTIME,
};
use promql::{
    DEFAULT_LOOKBACK, DEFAULT_MAX_POINTS_PER_SERIES, adjust_start_end,
    ast::{
        at_modifier::resolve_query, result_order::top_level_order,
        selector_window::selector_window, subquery_grid::max_subquery_steps,
    },
    micros,
};
use promql_parser::parser;
use proto::cluster_rpc;
use search_service::{LeaderInfo, SEARCH_SERVER, server_internal_error};
use tracing::{Instrument, info_span};
#[cfg(feature = "enterprise")]
use {
    o2_enterprise::enterprise::common::config::get_config as get_o2_config,
    o2_enterprise::enterprise::search::WorkGroup, search_service::QueryPhase,
};

use crate::MetricsQueryRequest;

mod cache;
pub mod grpc;
pub use cache::{get_cache_stats, remove_org_results};

#[derive(Debug)]
pub struct SearchResponse {
    pub value: Value,
    /// Non-empty when some nodes failed and the value may be incomplete.
    pub warnings: Vec<String>,
}

pub async fn init() -> Result<()> {
    if !config::cluster::LOCAL_NODE.is_querier() {
        return Ok(());
    }
    if let Err(e) = cache::init().await {
        log::error!("Error init metrics disk cache: {e}");
    }
    Ok(())
}

#[tracing::instrument(skip_all, fields(org_id = org_id))]
pub async fn search(
    trace_id: &str,
    org_id: &str,
    req: &MetricsQueryRequest,
    user_email: &str,
    timeout: i64,
    is_super_cluster: bool,
) -> Result<SearchResponse> {
    let trace_id = search_service::leader_trace_id(trace_id);
    let trace_id = trace_id.as_str();
    // callers such as Grafana share one trace_id across concurrent requests
    let registration = SEARCH_SERVER.register_leader(
        org_id,
        trace_id,
        LeaderInfo {
            user_id: Some(user_email),
            stream_type: StreamType::Metrics.as_str(),
            sql: &req.query,
            start_time: req.start,
            end_time: req.end,
            search_type: None,
            search_event_context: None,
        },
    );
    let query_tracker = registration.tracker();

    let timeout = if timeout > 0 {
        timeout as u64
    } else {
        get_config().limit.query_timeout
    };

    let mut req: cluster_rpc::MetricsQueryRequest = req.to_owned().into();
    req.org_id = org_id.to_string();
    req.timeout = timeout as i64;
    req.is_super_cluster = is_super_cluster;
    // whatever splits the range below sees only its own part of it
    let stmt = req.query.as_mut().unwrap();
    if let Some(query) = resolve_query(&stmt.query, stmt.start, stmt.end, stmt.step)
        .map_err(|e| Error::ErrorCode(ErrorCodes::InvalidParams(e)))?
    {
        stmt.query = query;
    }

    let mut stop_watch = TookWatcher::new();

    // get querier nodes from cluster.
    // Use "metrics/" (stream-type sentinel) rather than a bare "metrics" string
    // so that select_nodes with strategy=stream receives a non-empty,
    // deterministic key.  A single PromQL request may cover multiple metric
    // names, so we cannot provide a more specific stream name here.
    let nodes = search_service::cluster::flight::get_online_querier_nodes(
        trace_id,
        &req.org_id,
        "metrics/",
        Some(RoleGroup::Interactive),
    )
    .await?;
    let nodes: Vec<_> = nodes.into_iter().filter(|node| node.is_querier()).collect();
    if nodes.is_empty() {
        log::error!("no querier node online");
        return Err(Error::ErrorCode(ErrorCodes::ServerInternalError(
            "no querier node found".to_string(),
        )));
    }

    log::info!(
        "[trace_id {trace_id}] promql->search: get nodes num: {}",
        nodes.len(),
    );

    // Check work group (OSS uses dist_lock, Enterprise uses WorkGroup::Short)
    #[cfg(not(feature = "enterprise"))]
    let _lock = search_service::work_group::check_work_group(
        query_tracker,
        &req.org_id,
        timeout,
        &mut stop_watch,
        "metrics",
    )
    .await
    .map_err(|e| Error::ErrorCode(ErrorCodes::ServerInternalError(e.to_string())))?;

    // Enterprise: Always use Short workgroup for metrics queries
    #[cfg(feature = "enterprise")]
    let _lock = search_service::work_group::check_work_group(
        query_tracker,
        &req.org_id,
        Some(user_email),
        timeout,
        WorkGroup::Short,
        &mut stop_watch,
        "metrics",
    )
    .await
    .map_err(|e| Error::ErrorCode(ErrorCodes::ServerInternalError(e.to_string())))?;

    let mut _took_wait = _lock.took_wait;

    // Node-level slot admission for PromQL (enterprise)
    // Placed here alongside the work_group check so both admission stages are co-located.
    // The guard is held for the duration of search_in_cluster via the select! below.
    // PromQL always runs as "short". Nodes are cached so the extra call is cheap.
    #[cfg(feature = "enterprise")]
    let _node_slot_guard = {
        let wg = &get_o2_config().work_group;
        if wg.max_nodes_per_query > 0 {
            let start_time = std::time::Instant::now();
            let elapsed_ms = stop_watch.total_millis();
            let remaining_ms = (timeout * 1000).saturating_sub(elapsed_ms);
            let guard = Some(
                o2_enterprise::enterprise::search::admission::acquire_node_slots(
                    trace_id,
                    &nodes,
                    &WorkGroup::Short,
                    remaining_ms,
                )
                .await
                .map_err(|e| Error::ErrorCode(ErrorCodes::ServerInternalError(e.to_string())))?,
            );
            let took_wait = start_time.elapsed().as_millis() as usize;
            _took_wait += took_wait;
            log::info!(
                "[trace_id {trace_id}] promql->search: wait in node slot queue took: {took_wait} ms"
            );
            guard
        } else {
            None
        }
    };
    log::info!("[trace_id {trace_id}] promql->search: total wait in queue took: {_took_wait} ms");

    #[cfg(feature = "enterprise")]
    let Ok(abort_receiver) = query_tracker.abort_receiver(QueryPhase::Running) else {
        log::info!("[trace_id {trace_id}] promql->search: search canceled before execution plan");
        return Err(Error::ErrorCode(
            infra::errors::ErrorCodes::SearchCancelQuery(format!(
                "[trace_id {trace_id}] promql->search: search canceled before execution plan"
            )),
        ));
    };

    let trace_id_move = trace_id.to_string();
    let user_email_move = user_email.to_string();
    let query_task = DATAFUSION_RUNTIME.spawn(async move {
        search_in_cluster(&trace_id_move, req, &user_email_move, &nodes).await
    });
    tokio::pin!(query_task);

    // run search in cluster
    let task = tokio::select! {
        ret = &mut query_task => {
            match ret {
                Ok(ret) => Ok(ret),
                Err(err) => {
                    log::error!("[trace_id {trace_id}] promql->search: search execute error: {err}");
                    Err(Error::Message(err.to_string()))
                }
            }
        },
        _ = tokio::time::sleep(tokio::time::Duration::from_secs(timeout)) => {
            query_task.abort();
            log::error!("[trace_id {trace_id}] promql->search: search timeout");
            Err(Error::ErrorCode(ErrorCodes::SearchTimeout("promql->search: search timeout".to_string())))
        },
        _ = async {
            #[cfg(feature = "enterprise")]
            let _ = abort_receiver.await;
            #[cfg(not(feature = "enterprise"))]
            futures::future::pending::<()>().await;
        } => {
            query_task.abort();
            log::info!("[trace_id {trace_id}] promql->search: search canceled");
            Err(Error::ErrorCode(ErrorCodes::SearchCancelQuery("promql->search: search canceled".to_string())))
        }
    };

    // release lock
    drop(_lock);

    match task {
        Ok(Ok(ret)) => Ok(ret),
        Ok(Err(err)) => Err(err),
        Err(err) => Err(err),
    }
}

#[tracing::instrument(name = "promql:search:cluster", skip_all, fields(org_id = req.org_id))]
async fn search_in_cluster(
    trace_id: &str,
    req: cluster_rpc::MetricsQueryRequest,
    user_email: &str,
    nodes: &[Node],
) -> Result<SearchResponse> {
    let start_ins = std::time::Instant::now();
    let started_at = now_micros();
    let cfg = get_config();
    let timeout = req.timeout as u64;
    let ast = promql::parse(&req.query.as_ref().unwrap().query)
        .map_err(|e| Error::ErrorCode(ErrorCodes::InvalidParams(e)))?;
    let window = selector_window(&ast);

    let &cluster_rpc::MetricsQueryStmt {
        ref query,
        start,
        end,
        step,
        query_exemplars,
        query_data: _,
        label_selector: _,
    } = req.query.as_ref().unwrap();
    if rejects_root_subquery(&ast, start != end, query_exemplars) {
        return Err(Error::ErrorCode(ErrorCodes::InvalidParams(
            "invalid expression type \"range vector\" for range query, must be Scalar or instant Vector".to_string(),
        )));
    }
    let nr_queriers = nodes.len() as i64;

    // cache enabled if result cache is enabled and use_cache is true and start != end
    // the cache keys on the output range, but a pinned value follows the data at `T` (#14688)
    // the cache key ignores the query type, so exemplar results never share it with samples
    let cacheable = cfg.common.result_cache_enabled && window.pinned.is_none() && !query_exemplars;
    let use_cache = cacheable && req.use_cache && start != end;
    // adjust start and end time
    let (start, end) = adjust_start_end(start, end, step);
    let max_points = if cfg.limit.metrics_max_points_per_series > 0 {
        cfg.limit.metrics_max_points_per_series
    } else {
        DEFAULT_MAX_POINTS_PER_SERIES
    };
    // checked over the whole range, so the answer does not depend on how workers split it
    let subquery_steps = max_subquery_steps(&ast, start, end);
    if !query_exemplars && subquery_steps > max_points as i64 {
        return Err(Error::ErrorCode(ErrorCodes::InvalidParams(format!(
            "subquery evaluates {subquery_steps} steps per series, more than the {max_points} allowed by ZO_METRICS_MAX_POINTS_PER_SERIES; use a larger subquery step"
        ))));
    }

    log::info!(
        "[trace_id {trace_id}] promql->search->start: org_id: {}, use_cache: {}, time_range: [{},{}), step: {}, query: {}",
        req.org_id,
        use_cache,
        start,
        end,
        step,
        query,
    );

    // The number of resolution steps; see the diagram at
    // https://promlabs.com/blog/2020/06/18/the-anatomy-of-a-promql-query/#range-queries
    let partition_step = max(micros(DEFAULT_LOOKBACK) * 2, step);
    let nr_steps = (end - start + partition_step - 1) / partition_step;

    // get cache data
    let original_start = start;
    let (start, cached_values) = if !use_cache {
        (start, vec![])
    } else {
        let start_time = std::time::Instant::now();
        match cache::get(&req.org_id, query, start, end, step).await {
            Ok(Some((new_start, values))) => {
                let took = start_time.elapsed().as_millis() as i32;
                let cache_ratio = (new_start - start) as f64 / (end - start) as f64;
                config::metrics::promql::QUERY_METRICS_CACHE_RATIO
                    .with_label_values(&[&req.org_id])
                    .observe(cache_ratio);
                log::info!(
                    "[trace_id {trace_id}] promql->search->cache: hit cache, cache ratio: {:.2}%, took: {took} ms",
                    cache_ratio * 100.0,
                );
                (new_start, values)
            }
            Ok(None) => (start, vec![]),
            Err(err) => {
                log::error!("[trace_id {trace_id}] promql->search->cache: get cache err: {err:?}");
                (start, vec![])
            }
        }
    };

    // cache hits and full cache found
    if start > end && !cached_values.is_empty() {
        log::info!("[trace_id {trace_id}] promql->search->cache: hit full cache");
        let mut warnings = Vec::new();
        let values = if query_exemplars {
            merge_exemplars_query(&cached_values, &req.org_id, &mut warnings).await?
        } else {
            merge_matrix_query(&cached_values, &req.org_id, &mut warnings).await?
        };

        return Ok(SearchResponse {
            value: values,
            warnings,
        });
    }

    if (end - start) / step > max_points as i64 {
        return Err(Error::ErrorCode(ErrorCodes::InvalidParams(
            "too many points per series must be returned on the given, you can change the limit by ZO_METRICS_MAX_POINTS_PER_SERIES".to_string(),
        )));
    }

    // A span of time covered by an individual querier (worker).
    let worker_dt = if nr_steps > nr_queriers {
        partition_step * ((nr_steps + nr_queriers - 1) / nr_queriers)
    } else {
        partition_step
    };

    let job = cluster_rpc::Job {
        trace_id: trace_id.to_string(),
        job: trace_id[..7].to_string(),
        stage: 0,
        partition: 0,
    };

    // make cluster request
    let mut tasks = Vec::with_capacity(nodes.len());
    let mut worker_start = start;
    for node in nodes.iter() {
        let node = node.clone();
        if worker_start > end {
            break;
        }
        let job = Some(cluster_rpc::Job {
            partition: node.id as _,
            ..job.clone()
        });
        let mut req = cluster_rpc::MetricsQueryRequest { job, ..req.clone() };
        let req_query = req.query.as_mut().unwrap();
        req_query.start = worker_start;
        req_query.end = min(end, worker_start + worker_dt);
        // if the end time is within the last 3 retention time, we need to fetch wal data
        let wal_floor = now_micros() - second_micros(cfg.limit.max_file_retention_time as i64 * 3);
        if window.reaches(req_query.end, wal_floor) {
            req.need_wal = true;
        }
        let req_need_wal = req.need_wal;
        worker_start += worker_dt;

        log::info!(
            "[trace_id {trace_id}] promql->search->partition: node: {}, need_wal: {}, time_range: [{},{})",
            node.grpc_addr,
            req_need_wal,
            req_query.start,
            req_query.end,
        );

        let trace_id = trace_id.to_string();
        let grpc_span = info_span!("promql:search:cluster:grpc_search", org_id = req.org_id);
        let task = tokio::task::spawn(
            async move {
                let response_compression = ResponseCompression::for_node(&node);
                let node = Arc::new(node) as _;
                let org_id = req.org_id.clone();
                let mut request = tonic::Request::new(req);
                let mut client = make_grpc_metrics_client_with_policy(
                    &trace_id, &org_id, &mut request, &node, timeout, response_compression,
                ).await?;
                let response: cluster_rpc::MetricsQueryResponse = match client.query(request).await
                {
                    Ok(res) => res.into_inner(),
                    Err(err) => {
                        log::error!(
                            "[trace_id {trace_id}] promql->search->grpc: node: {}, search err: {err:?}",
                            node.get_grpc_addr(),
                        );
                        let err = ErrorCodes::from_json(err.message())
                            .unwrap_or(ErrorCodes::ServerInternalError(err.to_string()));
                        return Err(Error::ErrorCode(err));
                    }
                };
                let scan_stats = response.scan_stats.as_ref().unwrap();

                log::info!(
                    "[trace_id {trace_id}] promql->search->grpc: result node: {}, need_wal: {req_need_wal}, files: {}, scan_size: {} mb, took: {} ms",
                    node.get_grpc_addr(),
                    scan_stats.files,
                    scan_stats.original_size,
                    response.took,
                );
                Ok(response)
            }
            .instrument(grpc_span),
        );
        tasks.push(task);
    }

    let mut results = Vec::with_capacity(tasks.len());
    let task_results = match try_join_all(tasks).await {
        Ok(res) => res,
        Err(err) => {
            return Err(Error::ErrorCode(ErrorCodes::ServerInternalError(
                err.to_string(),
            )));
        }
    };
    for res in task_results {
        match res {
            Ok(response) => results.push(response),
            Err(err) => {
                return Err(err);
            }
        }
    }

    // merge multiple instances data
    let mut scan_stats = ScanStats::new();
    let mut result_type = String::new();
    let mut series_data: Vec<cluster_rpc::Series> = Vec::new();
    let mut warnings: Vec<String> = Vec::new();
    for resp in results {
        scan_stats.add(&resp.scan_stats.as_ref().unwrap().into());
        for warning in resp.warnings {
            if !warnings.contains(&warning) {
                warnings.push(warning);
            }
        }
        if result_type.is_empty() {
            result_type = resp.result_type.clone();
        }
        resp.series.into_iter().for_each(|series| {
            series_data.push(series);
        });
    }

    // add cached values to series_data
    cached_values.into_iter().for_each(|series| {
        series_data.push(series);
    });

    // a worker left with a lone point answers as an instant query, the range is still a matrix
    if (result_type == "vector" || result_type == "scalar") && original_start != end {
        result_type = "matrix".to_string();
    }

    // merge result
    let values = if result_type == "matrix" {
        merge_matrix_query(&series_data, &req.org_id, &mut warnings).await?
    } else if result_type == "vector" {
        merge_vector_query(&series_data, &req.org_id, query, &mut warnings).await?
    } else if result_type == "scalar" {
        merge_scalar_query(&series_data)
    } else if result_type == "exemplars" {
        merge_exemplars_query(&series_data, &req.org_id, &mut warnings).await?
    } else {
        return Err(server_internal_error(format!(
            "invalid result type: {result_type}"
        )));
    };
    let took = start_ins.elapsed().as_millis() as f64;
    log::info!(
        "[trace_id {trace_id}] promql->search->result: files: {}, scan_size: {} mb, took: {took} ms",
        scan_stats.files,
        scan_stats.original_size,
    );

    let req_stats = RequestStats {
        records: scan_stats.records,
        size: scan_stats.original_size as f64,
        response_time: start_ins.elapsed().as_secs_f64(),
        request_body: Some(query.to_string()),
        user_email: Some(user_email.to_string()),
        min_ts: Some(start),
        max_ts: Some(end),
        trace_id: Some(trace_id.to_string()),
        search_event_context: req.search_event_context.map(Into::into),
        search_type: SearchEventType::try_from(req.search_event_type.as_str()).ok(),
        ..Default::default()
    };

    usage_reporting::report_request_usage_stats(
        req_stats,
        &req.org_id,
        "", // TODO see if we can add metric name
        StreamType::Metrics,
        UsageType::MetricSearch,
        0,
        started_at,
    )
    .await;

    if !warnings.is_empty() {
        log::warn!("[trace_id {trace_id}] promql->search: partial result: {warnings:?}");
    }

    // an incomplete result must not be served from cache later
    if cacheable
        && warnings.is_empty()
        && let Some(matrix) = values.get_ref_matrix_values()
        && let Err(err) = cache::set(
            trace_id,
            &req.org_id,
            query,
            original_start,
            end,
            step,
            matrix.to_vec(),
            !use_cache, // if the query with use_cache=false, we should update the exist cache
        )
        .await
    {
        log::error!("[trace_id {trace_id}] promql->search->cache: set cache err: {err:?}");
    }

    let took = start_ins.elapsed().as_millis() as f64;
    log::info!("[trace_id {trace_id}] promql->search search finished took: {took} ms",);

    Ok(SearchResponse {
        value: values,
        warnings,
    })
}

/// Whether a range query would answer with a subquery's own samples, which sit off its grid.
fn rejects_root_subquery(expr: &parser::Expr, is_range: bool, query_exemplars: bool) -> bool {
    // exemplars only read the selectors, never the root expression
    is_range && !query_exemplars && is_root_subquery(expr)
}

fn is_root_subquery(expr: &parser::Expr) -> bool {
    match expr {
        parser::Expr::Paren(paren) => is_root_subquery(&paren.expr),
        expr => matches!(expr, parser::Expr::Subquery(_)),
    }
}

async fn merge_matrix_query(
    series: &[cluster_rpc::Series],
    org_id: &str,
    warnings: &mut Vec<String>,
) -> Result<Value> {
    let mut merged_data = HashMap::new();
    let mut merged_metrics = HashMap::new();
    for ser in series {
        let labels: Labels = ser
            .metric
            .iter()
            .map(|v| Arc::new(Label::from(v)))
            .collect();
        let entry = merged_data
            .entry(signature(&labels))
            .or_insert_with(HashMap::new);
        ser.samples.iter().chain(ser.sample.iter()).for_each(|v| {
            entry.insert(v.time, v.value);
        });
        merged_metrics.insert(signature(&labels), labels);
    }
    let mut merged_data = merged_data
        .into_iter()
        // Prometheus never answers a range query with a series that has no samples
        .filter(|(_, samples)| !samples.is_empty())
        .map(|(sig, samples)| {
            let mut samples = samples
                .into_iter()
                .map(|(ts, v)| Sample {
                    timestamp: ts,
                    value: v,
                })
                .collect::<Vec<_>>();
            samples.sort_by_key(|k| k.timestamp);
            RangeValue::new(merged_metrics.get(&sig).unwrap().to_owned(), samples)
        })
        .collect::<Vec<_>>();

    let max_limit = get_max_series_limit(org_id).await;
    truncate_series(&mut merged_data, max_limit, warnings);

    let mut value = Value::Matrix(merged_data);
    value.sort();
    Ok(value)
}

async fn merge_vector_query(
    series: &[cluster_rpc::Series],
    org_id: &str,
    query: &str,
    warnings: &mut Vec<String>,
) -> Result<Value> {
    let max_limit = get_max_series_limit(org_id).await;
    Ok(merge_vector_series(series, query, max_limit, warnings))
}

/// Orders before truncating, so a capped response keeps the series the order puts first.
fn merge_vector_series(
    series: &[cluster_rpc::Series],
    query: &str,
    max_limit: usize,
    warnings: &mut Vec<String>,
) -> Value {
    let mut merged_data = HashMap::new();
    let mut merged_metrics: HashMap<u64, Vec<Arc<Label>>> = HashMap::new();
    for ser in series {
        let labels: Labels = ser
            .metric
            .iter()
            .map(|l| Arc::new(Label::from(l)))
            .collect();
        if let Some(sample) = ser.sample.as_ref() {
            let sample: Sample = sample.into();
            merged_data.insert(signature(&labels), sample);
            merged_metrics.insert(signature(&labels), labels);
        }
    }
    let merged_data = merged_data
        .into_iter()
        .map(|(sig, sample)| InstantValue {
            labels: merged_metrics.get(&sig).unwrap().to_owned(),
            sample,
        })
        .collect::<Vec<_>>();

    let mut value = Value::Vector(merged_data);
    match promql::parse(query)
        .ok()
        .and_then(|expr| top_level_order(&expr))
    {
        Some(order) => order.apply(&mut value),
        None => value.sort(),
    }
    if let Value::Vector(vector) = &mut value {
        truncate_series(vector, max_limit, warnings);
    }
    value
}

fn merge_scalar_query(series: &[cluster_rpc::Series]) -> Value {
    let mut sample: Sample = Default::default();
    for ser in series {
        if let Some(x) = ser.sample.as_ref() {
            sample = x.into();
        } else if let Some(x) = ser.scalar {
            sample.value = x;
        }
    }
    Value::Sample(sample)
}

async fn merge_exemplars_query(
    series: &[cluster_rpc::Series],
    org_id: &str,
    warnings: &mut Vec<String>,
) -> Result<Value> {
    let mut merged_data = HashMap::new();
    let mut merged_metrics = HashMap::new();
    for ser in series {
        let Some(exemplars) = ser.exemplars.as_ref() else {
            continue;
        };
        let labels: Labels = ser
            .metric
            .iter()
            .map(|v| Arc::new(Label::from(v)))
            .collect();
        let entry = merged_data
            .entry(signature(&labels))
            .or_insert_with(HashMap::new);
        exemplars.exemplars.iter().for_each(|v| {
            entry.insert(v.time, v);
        });
        merged_metrics.insert(signature(&labels), labels);
    }
    let mut merged_data = merged_data
        .into_iter()
        .map(|(sig, exemplars)| {
            let mut exemplars: Vec<Arc<Exemplar>> = exemplars
                .into_iter()
                .map(|(_ts, v)| Arc::new(v.into()))
                .collect::<Vec<_>>();
            exemplars.sort_by_key(|k| k.timestamp);
            RangeValue::new_with_exemplars(merged_metrics.get(&sig).unwrap().to_owned(), exemplars)
        })
        .collect::<Vec<_>>();

    let max_limit = get_max_series_limit(org_id).await;
    truncate_series(&mut merged_data, max_limit, warnings);

    let mut value = Value::Matrix(merged_data);
    value.sort();
    Ok(value)
}

/// Get the maximum series limit for the organization.
///
/// Fetches the org-specific setting if available, otherwise falls back
/// to the system-wide ENV configuration default (ZO_METRICS_MAX_SERIES_RESPONSE).
///
/// # Arguments
/// * `org_id` - The organization identifier
///
/// # Returns
/// Maximum number of series allowed per PromQL query
///
/// # Note
/// This function is called for every PromQL query. Consider caching org settings
/// with a TTL to reduce database load in high-throughput scenarios.
async fn get_max_series_limit(org_id: &str) -> usize {
    match db::organization::get_org_setting(org_id).await {
        Ok(settings) => settings.max_series_per_query.unwrap_or_else(|| {
            let cfg = get_config();
            cfg.limit.metrics_max_series_response
        }),
        Err(err) => {
            log::warn!(
                "Failed to fetch org settings for {}, using default limit: {:?}",
                org_id,
                err
            );
            let cfg = get_config();
            cfg.limit.metrics_max_series_response
        }
    }
}

fn truncate_series<T>(series: &mut Vec<T>, max_limit: usize, warnings: &mut Vec<String>) {
    if series.len() > max_limit {
        let warning = format!(
            "PromQL result truncated from {} to {max_limit} series; increase the organization limit or ZO_METRICS_MAX_SERIES_RESPONSE",
            series.len(),
        );
        log::warn!("{warning}");
        series.truncate(max_limit);
        warnings.push(warning);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_is_root_subquery() {
        for (query, expected) in [
            ("up[5m:1m]", true),
            ("((up[5m:1m] offset 1m))", true),
            ("max_over_time(up[5m:1m])", false),
            ("up[5m]", false),
            ("up", false),
        ] {
            assert_eq!(
                is_root_subquery(&promql::parse(query).unwrap()),
                expected,
                "{query}"
            );
        }
    }

    #[test]
    fn test_rejects_root_subquery_only_in_range_sample_queries() {
        let expr = promql::parse("up[5m:1m]").unwrap();
        assert!(rejects_root_subquery(&expr, true, false));
        assert!(!rejects_root_subquery(&expr, false, false));
        assert!(!rejects_root_subquery(&expr, true, true));
    }

    #[tokio::test]
    async fn test_merge_matrix_preserves_instant_worker_sample_with_cached_prefix() {
        let latest = Sample::new(3_000_000, 3.0);
        let labels = vec![Arc::new(Label::new("job", "test"))];
        for (worker_value, expected_labels) in [
            (Value::Sample(latest), Labels::default()),
            (
                Value::Vector(vec![InstantValue {
                    labels: labels.clone(),
                    sample: latest,
                }]),
                labels,
            ),
        ] {
            let mut response = cluster_rpc::MetricsQueryResponse::default();
            grpc::add_value(&mut response, worker_value);
            grpc::add_value(
                &mut response,
                Value::Matrix(vec![RangeValue::new(
                    expected_labels.clone(),
                    vec![Sample::new(1_000_000, 1.0), Sample::new(2_000_000, 2.0)],
                )]),
            );

            let value =
                merge_matrix_query(&response.series, "test_instant_worker_merge", &mut vec![])
                    .await
                    .unwrap();
            let Value::Matrix(matrix) = value else {
                panic!("expected matrix result");
            };
            assert_eq!(matrix.len(), 1);
            assert_eq!(matrix[0].labels, expected_labels);
            let samples: Vec<_> = matrix[0]
                .samples
                .iter()
                .map(|sample| (sample.timestamp, sample.value))
                .collect();
            assert_eq!(
                samples,
                vec![(1_000_000, 1.0), (2_000_000, 2.0), (3_000_000, 3.0)]
            );
        }
    }

    #[tokio::test]
    async fn test_merge_matrix_drops_series_without_samples() {
        let mut response = cluster_rpc::MetricsQueryResponse::default();
        grpc::add_value(
            &mut response,
            Value::Range(RangeValue::new(
                vec![Arc::new(Label::new("pod", "recovered"))],
                Vec::<Sample>::new(),
            )),
        );
        grpc::add_value(
            &mut response,
            Value::Range(RangeValue::new(
                vec![Arc::new(Label::new("pod", "waiting"))],
                vec![Sample::new(1_000_000, 1.0)],
            )),
        );

        let value = merge_matrix_query(&response.series, "test_merge_empty_series", &mut vec![])
            .await
            .unwrap();
        let Value::Matrix(matrix) = value else {
            panic!("expected matrix result");
        };
        assert_eq!(matrix.len(), 1);
        assert_eq!(
            matrix[0].labels,
            vec![Arc::new(Label::new("pod", "waiting"))]
        );
    }

    #[tokio::test]
    async fn test_merge_exemplars_skips_series_without_exemplars() {
        let labels = vec![Arc::new(Label::new("job", "test"))];
        let mut response = cluster_rpc::MetricsQueryResponse::default();
        grpc::add_value(
            &mut response,
            Value::Matrix(vec![RangeValue::new(
                labels.clone(),
                vec![Sample::new(1_000_000, 1.0)],
            )]),
        );
        grpc::add_value(
            &mut response,
            Value::Matrix(vec![RangeValue::new_with_exemplars(
                labels.clone(),
                vec![Arc::new(Exemplar {
                    timestamp: 2_000_000,
                    value: 2.0,
                    labels: vec![],
                })],
            )]),
        );

        let value = merge_exemplars_query(&response.series, "test_exemplars_merge", &mut vec![])
            .await
            .unwrap();
        let Value::Matrix(matrix) = value else {
            panic!("expected matrix result");
        };
        assert_eq!(matrix.len(), 1);
        assert_eq!(matrix[0].labels, labels);
        assert_eq!(matrix[0].exemplars.as_ref().unwrap().len(), 1);
    }

    #[tokio::test]
    async fn test_get_max_series_limit_fallback_to_env_default() {
        // Test that get_max_series_limit falls back to ENV default
        // when org settings cannot be fetched (e.g., org doesn't exist)
        let limit = get_max_series_limit("nonexistent_test_org_123456").await;

        // Should return the default from config
        let expected_default = get_config().limit.metrics_max_series_response;
        assert_eq!(limit, expected_default);

        // Verify the default is the expected value (40,000)
        assert_eq!(expected_default, 40_000);
    }

    fn instance_vector(instances: &[(&str, f64)]) -> cluster_rpc::MetricsQueryResponse {
        let mut response = cluster_rpc::MetricsQueryResponse::default();
        grpc::add_value(
            &mut response,
            Value::Vector(
                instances
                    .iter()
                    .map(|(instance, value)| InstantValue {
                        labels: vec![Arc::new(Label::new("instance", instance))],
                        sample: Sample::new(3_000_000, *value),
                    })
                    .collect(),
            ),
        );
        response
    }

    fn instances(value: Value) -> Vec<String> {
        let Value::Vector(vector) = value else {
            panic!("expected a vector, got {value:?}");
        };
        vector
            .iter()
            .map(|v| v.labels.get_value("instance"))
            .collect()
    }

    #[tokio::test]
    async fn test_merge_vector_orders_by_label() {
        let response = instance_vector(&[("host10", 1.0), ("host2", 3.0), ("host1", 2.0)]);
        let value = merge_vector_query(
            &response.series,
            "test_sort_by_label_merge",
            r#"sort_by_label(up, "instance")"#,
            &mut vec![],
        )
        .await
        .unwrap();
        assert_eq!(instances(value), ["host1", "host2", "host10"]);
    }

    #[test]
    fn test_merge_vector_orders_before_truncating() {
        let response = instance_vector(&[("host10", 1.0), ("host2", 3.0), ("host1", 2.0)]);
        for (query, expected) in [
            (r#"sort_by_label(up, "instance")"#, ["host1", "host2"]),
            ("sort(up)", ["host10", "host1"]),
            ("up", ["host2", "host1"]),
        ] {
            let value = merge_vector_series(&response.series, query, 2, &mut vec![]);
            assert_eq!(instances(value), expected, "{query}");
        }
    }
    #[test]
    fn test_vector_truncation_warns_only_when_series_are_dropped() {
        let response = instance_vector(&[("a", 1.0), ("b", 2.0), ("c", 3.0)]);
        for (limit, expected_len, warning_count) in [(4, 3, 0), (3, 3, 0), (2, 2, 1), (0, 0, 1)] {
            let mut warnings = vec!["ingester timeout".into()];
            let value = merge_vector_series(&response.series, "up", limit, &mut warnings);
            assert_eq!(instances(value).len(), expected_len);
            assert_eq!(warnings.len(), warning_count + 1);
            assert_eq!(warnings[0], "ingester timeout");
            if warning_count > 0 {
                assert!(warnings[1].contains(&format!("from 3 to {limit} series")));
            }
        }
        let mut warnings = vec![];
        let value = merge_vector_series(&[], "up", 0, &mut warnings);
        assert!(instances(value).is_empty());
        assert!(warnings.is_empty());
    }

    #[test]
    fn test_vector_truncation_counts_merged_series() {
        let response = instance_vector(&[("a", 1.0), ("a", 2.0), ("b", 3.0)]);
        let mut warnings = vec![];
        let value = merge_vector_series(&response.series, "up", 2, &mut warnings);
        assert_eq!(instances(value).len(), 2);
        assert!(warnings.is_empty());
    }

    #[test]
    fn test_matrix_and_exemplar_truncation_preserves_readings_and_reports_limit() {
        for with_exemplars in [false, true] {
            let mut series: Vec<_> = (0..3)
                .map(|i| {
                    let labels = vec![Arc::new(Label::new("instance".to_string(), i.to_string()))];
                    if with_exemplars {
                        RangeValue::new_with_exemplars(
                            labels,
                            vec![Arc::new(Exemplar {
                                timestamp: 10,
                                value: i as f64,
                                labels: vec![],
                            })],
                        )
                    } else {
                        RangeValue::new(labels, vec![Sample::new(10, i as f64)])
                    }
                })
                .collect();
            let mut warnings = vec![];
            truncate_series(&mut series, 3, &mut warnings);
            assert_eq!(series.len(), 3);
            assert!(warnings.is_empty());
            truncate_series(&mut series, 2, &mut warnings);
            assert_eq!(series.len(), 2);
            assert_eq!(warnings.len(), 1);
            assert!(warnings[0].contains("from 3 to 2 series"));
            for (i, row) in series.iter().enumerate() {
                if with_exemplars {
                    assert_eq!(row.exemplars.as_ref().unwrap()[0].value, i as f64);
                } else {
                    assert_eq!(row.samples[0].value, i as f64);
                }
            }
        }
    }
}
