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
        cluster::RoleGroup,
        promql::value::*,
        search::ScanStats,
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
    client::grpc::make_grpc_metrics_client,
    cluster::get_cached_online_querier_nodes,
    errors::{Error, ErrorCodes, Result},
    runtime::DATAFUSION_RUNTIME,
};
use proto::cluster_rpc;
use tracing::{Instrument, info_span};
#[cfg(feature = "enterprise")]
use {
    crate::service::search::SEARCH_SERVER, o2_enterprise::enterprise::search::TaskStatus,
    o2_enterprise::enterprise::search::WorkGroup,
};

use crate::service::{
    promql::{
        DEFAULT_LOOKBACK, DEFAULT_MAX_POINTS_PER_SERIES, MetricsQueryRequest, adjust_start_end,
        micros,
    },
    search::server_internal_error,
    self_reporting::report_request_usage_stats,
};

mod cache;
pub mod grpc;

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
) -> Result<Value> {
    #[cfg(feature = "enterprise")]
    {
        let sql = Some(req.query.clone());
        let start_time = Some(req.start);
        let end_time = Some(req.end);

        SEARCH_SERVER
            .insert(
                trace_id.to_string(),
                TaskStatus::new_leader(
                    vec![],
                    true,
                    Some(user_email.to_string()),
                    Some(org_id.to_string()),
                    Some(StreamType::Metrics.to_string()),
                    sql,
                    start_time,
                    end_time,
                    None,
                    None,
                ),
            )
            .await;
    }

    let timeout = if timeout > 0 {
        timeout as u64
    } else {
        get_config().limit.query_timeout
    };

    let mut req: cluster_rpc::MetricsQueryRequest = req.to_owned().into();
    req.org_id = org_id.to_string();
    req.timeout = timeout as i64;
    req.is_super_cluster = is_super_cluster;

    let mut stop_watch = TookWatcher::new();

    // Check work group (OSS uses dist_lock, Enterprise uses WorkGroup::Short)
    #[cfg(not(feature = "enterprise"))]
    let _lock = crate::service::search::work_group::check_work_group(
        trace_id,
        &req.org_id,
        timeout,
        &mut stop_watch,
        "metrics",
    )
    .await
    .map_err(|e| Error::ErrorCode(ErrorCodes::ServerInternalError(e.to_string())))?;

    // Enterprise: Always use Short workgroup for metrics queries
    #[cfg(feature = "enterprise")]
    let _lock = crate::service::search::work_group::check_work_group(
        trace_id,
        &req.org_id,
        Some(user_email),
        timeout,
        WorkGroup::Short,
        &mut stop_watch,
        "metrics",
    )
    .await
    .map_err(|e| Error::ErrorCode(ErrorCodes::ServerInternalError(e.to_string())))?;

    #[cfg(feature = "enterprise")]
    let (abort_sender, abort_receiver) = tokio::sync::oneshot::channel();
    #[cfg(feature = "enterprise")]
    if SEARCH_SERVER
        .insert_sender(trace_id, abort_sender, true)
        .await
        .is_err()
    {
        log::info!("[trace_id {trace_id}] promql->search: search canceled before execution plan");
        return Err(Error::ErrorCode(
            infra::errors::ErrorCodes::SearchCancelQuery(format!(
                "[trace_id {trace_id}] promql->search: search canceled before execution plan"
            )),
        ));
    }

    let trace_id_move = trace_id.to_string();
    let user_email_move = user_email.to_string();
    let query_task = DATAFUSION_RUNTIME
        .spawn(async move { search_in_cluster(&trace_id_move, req, &user_email_move).await });
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

    // Clean up task record before returning
    #[cfg(feature = "enterprise")]
    SEARCH_SERVER.remove(trace_id, false).await;

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
) -> Result<Value> {
    let start_ins = std::time::Instant::now();
    let started_at = now_micros();
    let cfg = get_config();
    let timeout = req.timeout as u64;

    let &cluster_rpc::MetricsQueryStmt {
        ref query,
        start,
        end,
        step,
        query_exemplars,
        query_data: _,
        label_selector: _,
    } = req.query.as_ref().unwrap();

    // cache enabled if result cache is enabled and use_cache is true and start != end
    let use_cache = cfg.common.result_cache_enabled && req.use_cache && start != end;
    // adjust start and end time
    let (start, end) = adjust_start_end(start, end, step);

    log::info!(
        "[trace_id {trace_id}] promql->search->start: org_id: {}, use_cache: {}, time_range: [{},{}), step: {}, query: {}",
        req.org_id,
        use_cache,
        start,
        end,
        step,
        query,
    );

    // get querier nodes from cluster
    let mut nodes = get_cached_online_querier_nodes(Some(RoleGroup::Interactive))
        .await
        .unwrap();
    // sort nodes by node_id this will improve hit cache ratio
    nodes.sort_by(|a, b| a.grpc_addr.cmp(&b.grpc_addr));
    nodes.dedup_by(|a, b| a.grpc_addr == b.grpc_addr);
    nodes.sort_by_key(|x| x.id);
    let nodes = nodes;
    if nodes.is_empty() {
        return Err(Error::ErrorCode(ErrorCodes::ServerInternalError(
            "no querier node found".to_string(),
        )));
    }
    let nr_queriers = nodes.len() as i64;

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
        match cache::get(query, start, end, step).await {
            Ok(Some((new_start, values))) => {
                let took = start_time.elapsed().as_millis() as i32;
                let cache_ratio = (new_start - start) as f64 / (end - start) as f64;
                config::metrics::QUERY_METRICS_CACHE_RATIO
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
        let values = if query_exemplars {
            merge_exemplars_query(&cached_values, &req.org_id).await?
        } else {
            merge_matrix_query(&cached_values, &req.org_id).await?
        };

        return Ok(values);
    }

    let max_points = if cfg.limit.metrics_max_points_per_series > 0 {
        cfg.limit.metrics_max_points_per_series
    } else {
        DEFAULT_MAX_POINTS_PER_SERIES
    };
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
        if req_query.end
            >= now_micros() - second_micros(cfg.limit.max_file_retention_time as i64 * 3)
        {
            req.need_wal = true;
        }
        let req_need_wal = req.need_wal;
        worker_start += worker_dt;

        log::info!(
            "[trace_id {trace_id}] promql->search->partition: node: {}, need_wal: {}, time_range: [{},{})",
            &node.grpc_addr,
            req_need_wal,
            req_query.start,
            req_query.end,
        );

        let trace_id = trace_id.to_string();
        let grpc_span = info_span!("promql:search:cluster:grpc_search", org_id = req.org_id);
        let task = tokio::task::spawn(
            async move {
                let node = Arc::new(node) as _;
                let org_id = req.org_id.clone();
                let mut request = tonic::Request::new(req);
                let mut client = make_grpc_metrics_client(&trace_id, &org_id, &mut request, &node, timeout)
                    .await?;
                let response: cluster_rpc::MetricsQueryResponse = match client.query(request).await
                {
                    Ok(res) => res.into_inner(),
                    Err(err) => {
                        log::error!(
                            "[trace_id {trace_id}] promql->search->grpc: node: {}, search err: {err:?}",
                            &node.get_grpc_addr(),
                        );
                        let err = ErrorCodes::from_json(err.message())
                            .unwrap_or(ErrorCodes::ServerInternalError(err.to_string()));
                        return Err(Error::ErrorCode(err));
                    }
                };
                let scan_stats = response.scan_stats.as_ref().unwrap();

                log::info!(
                    "[trace_id {trace_id}] promql->search->grpc: result node: {}, need_wal: {req_need_wal}, files: {}, scan_size: {} mb, took: {} ms",
                    &node.get_grpc_addr(),
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
    for resp in results {
        scan_stats.add(&resp.scan_stats.as_ref().unwrap().into());
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

    // with cache maybe we only get the last point from original data, then the result_type will
    // return as vector, but if the query is range query, the result_type should be matrix
    if result_type == "vector" && original_start != end {
        result_type = "matrix".to_string();
    }

    // merge result
    let values = if result_type == "matrix" {
        merge_matrix_query(&series_data, &req.org_id).await?
    } else if result_type == "vector" {
        merge_vector_query(&series_data, &req.org_id).await?
    } else if result_type == "scalar" {
        merge_scalar_query(&series_data)
    } else if result_type == "exemplars" {
        merge_exemplars_query(&series_data, &req.org_id).await?
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
        ..Default::default()
    };

    report_request_usage_stats(
        req_stats,
        &req.org_id,
        "", // TODO see if we can add metric name
        StreamType::Metrics,
        UsageType::MetricSearch,
        0,
        started_at,
    )
    .await;

    // cache the result
    if cfg.common.result_cache_enabled
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

    Ok(values)
}

async fn merge_matrix_query(series: &[cluster_rpc::Series], org_id: &str) -> Result<Value> {
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
        ser.samples.iter().for_each(|v| {
            entry.insert(v.time, v.value);
        });
        merged_metrics.insert(signature(&labels), labels);
    }
    let mut merged_data = merged_data
        .into_iter()
        .map(|(sig, samples)| {
            let mut samples = samples
                .into_iter()
                .map(|(ts, v)| Sample {
                    timestamp: ts,
                    value: v,
                })
                .collect::<Vec<_>>();
            samples.sort_by(|a, b| a.timestamp.cmp(&b.timestamp));
            RangeValue::new(merged_metrics.get(&sig).unwrap().to_owned(), samples)
        })
        .collect::<Vec<_>>();

    // Check series limit and truncate if necessary
    let max_limit = get_max_series_limit(org_id).await;
    if should_truncate_series(merged_data.len(), max_limit) {
        merged_data.truncate(max_limit);
    }

    let mut value = Value::Matrix(merged_data);
    value.sort();
    Ok(value)
}

async fn merge_vector_query(series: &[cluster_rpc::Series], org_id: &str) -> Result<Value> {
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
    let mut merged_data = merged_data
        .into_iter()
        .map(|(sig, sample)| InstantValue {
            labels: merged_metrics.get(&sig).unwrap().to_owned(),
            sample,
        })
        .collect::<Vec<_>>();

    // Check series limit and truncate if necessary
    let max_limit = get_max_series_limit(org_id).await;
    if should_truncate_series(merged_data.len(), max_limit) {
        merged_data.truncate(max_limit);
    }

    let mut value = Value::Vector(merged_data);
    value.sort();
    Ok(value)
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

async fn merge_exemplars_query(series: &[cluster_rpc::Series], org_id: &str) -> Result<Value> {
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
        ser.exemplars
            .as_ref()
            .unwrap()
            .exemplars
            .iter()
            .for_each(|v| {
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
            exemplars.sort_by(|a, b| a.timestamp.cmp(&b.timestamp));
            RangeValue::new_with_exemplars(merged_metrics.get(&sig).unwrap().to_owned(), exemplars)
        })
        .collect::<Vec<_>>();

    // Check series limit and truncate if necessary
    let max_limit = get_max_series_limit(org_id).await;
    if should_truncate_series(merged_data.len(), max_limit) {
        merged_data.truncate(max_limit);
    }

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
    match crate::service::db::organization::get_org_setting(org_id).await {
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

/// Check if series count exceeds the limit and log a warning if truncation is needed.
///
/// This function does not return an error. Instead, it logs a warning when the series
/// count exceeds the limit, allowing the caller to truncate the results.
///
/// # Arguments
/// * `series_count` - The actual number of series in the result
/// * `max_limit` - The maximum allowed series limit
///
/// # Returns
/// `true` if series count exceeds limit (truncation needed), `false` otherwise
fn should_truncate_series(series_count: usize, max_limit: usize) -> bool {
    if series_count > max_limit {
        log::warn!(
            "Query result exceeds maximum allowed series limit. Returning first {} series out of {}. \
             You can increase this limit via organization settings or ZO_METRICS_MAX_SERIES_RESPONSE environment variable.",
            max_limit,
            series_count
        );
        true
    } else {
        false
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_should_truncate_series_within_limit() {
        // Test series count within limit - should not truncate
        assert!(!should_truncate_series(1000, 10000));

        // Test series count exactly at limit - should not truncate
        assert!(!should_truncate_series(10000, 10000));
    }

    #[test]
    fn test_should_truncate_series_exceeds_limit() {
        // Test series count exceeds limit - should truncate
        assert!(should_truncate_series(10001, 10000));
        assert!(should_truncate_series(50000, 10000));
    }

    #[test]
    fn test_should_truncate_series_edge_cases() {
        // Test zero series - should not truncate
        assert!(!should_truncate_series(0, 1000));

        // Test with limit of 1
        assert!(!should_truncate_series(0, 1));
        assert!(!should_truncate_series(1, 1));
        assert!(should_truncate_series(2, 1));
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
}
