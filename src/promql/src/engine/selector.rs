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

//! Vector/matrix selector evaluation and data loading. Reads `ctx`,
//! `label_selector`, and `skip_labels`; writes `result_type`.

use std::{sync::Arc, time::Duration};

use config::meta::{
    promql::{NAME_LABEL, value::*},
    search::ScanStats,
};
use datafusion::{
    arrow::datatypes::Schema,
    error::{DataFusionError, Result},
    prelude::SessionContext,
};
use futures::future::{pending, try_join_all};
use hashbrown::HashMap;
use infra::errors::ErrorCodes;
use promql_parser::{
    label::{MatchOp, Matchers},
    parser::{LabelModifier, Offset, VectorSelector},
};
use rayon::iter::{IntoParallelIterator, IntoParallelRefMutIterator, ParallelIterator};

use super::Engine;
use crate::{
    functions, fused,
    load_series::{LoadedMetrics, PartitionedMetrics, selector_load_data_from_datafusion},
    micros,
    promql::rewrite::remove_filter_all,
};

/// One context per selected schema with its scan stats and whether the matchers still apply.
type SelectorContexts = Vec<(SessionContext, Arc<Schema>, ScanStats, bool)>;

impl Engine {
    /// Instant vector selector --- select a single sample at each evaluation
    /// timestamp.
    ///
    /// See <https://promlabs.com/blog/2020/07/02/selecting-data-in-promql/#confusion-alert-instantrange-selectors-vs-instantrange-queries>
    pub(super) async fn eval_vector_selector(
        &mut self,
        selector: &VectorSelector,
    ) -> Result<Vec<RangeValue>> {
        if self.result_type.is_none() {
            self.result_type = Some("vector".to_string());
        }

        let selector = named_selector(selector.clone(), "VectorSelector")?;

        let data = self.selector_load_data_owned(&selector, None, None).await?;

        let metrics_cache = match data.get_range_values() {
            Some(v) => v,
            None => return Ok(vec![]),
        };

        let offset_modifier = get_offset_modifier(selector.offset);

        // Get all evaluation timestamps from the context
        let eval_timestamps = self.eval_ctx.timestamps();

        // For each metric, select appropriate samples at each evaluation timestamp
        // TODO: make it parallel
        let mut result = Vec::with_capacity(metrics_cache.len());
        for metric in metrics_cache {
            let mut selected_samples = Vec::with_capacity(eval_timestamps.len());

            for &eval_ts in &eval_timestamps {
                // Calculate lookback window for this evaluation timestamp
                let start = eval_ts - self.ctx.lookback_delta;

                // Find the sample for this evaluation timestamp
                // Binary search for the last sample before or at eval_ts (considering offset)
                let end_index = metric
                    .samples
                    .partition_point(|v| v.timestamp + offset_modifier <= eval_ts);

                let match_sample = if end_index > 0 {
                    metric.samples.get(end_index - 1).and_then(|sample| {
                        let adjusted_ts = sample.timestamp + offset_modifier;
                        if adjusted_ts >= start && adjusted_ts <= eval_ts {
                            Some(sample)
                        } else {
                            None
                        }
                    })
                } else {
                    None
                };

                // Add the matched sample (already validated to be within range)
                if let Some(sample) = match_sample {
                    // Use eval_ts as the timestamp for the selected sample
                    // See https://promlabs.com/blog/2020/06/18/the-anatomy-of-a-promql-query/#instant-queries
                    selected_samples.push(Sample::new(eval_ts, sample.value));
                }
            }

            // Only include metrics that have at least one sample
            if !selected_samples.is_empty() {
                result.push(RangeValue {
                    labels: metric.labels,
                    samples: selected_samples,
                    exemplars: metric.exemplars,
                    time_window: metric.time_window,
                });
            }
        }

        Ok(result)
    }

    /// Range vector selector --- select a whole time range at each evaluation
    /// timestamp.
    ///
    /// See <https://promlabs.com/blog/2020/07/02/selecting-data-in-promql/#confusion-alert-instantrange-selectors-vs-instantrange-queries>
    ///
    /// MatrixSelector is a special case of VectorSelector that returns a matrix
    /// of samples. `ctxs` reuses contexts already created for this selector.
    pub(super) async fn eval_matrix_selector(
        &mut self,
        selector: &VectorSelector,
        range: Duration,
        ctxs: Option<SelectorContexts>,
    ) -> Result<Vec<RangeValue>> {
        if self.result_type.is_none() {
            self.result_type = Some("matrix".to_string());
        }

        let selector = named_selector(selector.clone(), "MatrixSelector")?;

        let data = self
            .selector_load_data_owned(&selector, Some(range), ctxs)
            .await?;

        let values = match data.get_range_values() {
            Some(v) => v,
            None => return Ok(vec![]),
        };

        let start = std::time::Instant::now();
        let mut values = values
            .into_par_iter()
            .map(|rv| RangeValue {
                labels: rv.labels,
                samples: rv.samples,
                exemplars: rv.exemplars,
                time_window: Some(TimeWindow::new(range)),
            })
            .collect::<Vec<_>>();

        log::info!(
            "[trace_id: {}] [PromQL Timing] eval_matrix_selector() processing took: {:?}",
            self.trace_id,
            start.elapsed()
        );

        // apply offset to samples
        let offset_modifier = get_offset_modifier(selector.offset);
        if offset_modifier != 0 {
            values.par_iter_mut().for_each(|rv| {
                rv.samples
                    .iter_mut()
                    .for_each(|s| s.timestamp += offset_modifier);
            });
        }

        Ok(values)
    }

    #[tracing::instrument(name = "promql:engine:load_data_owned", skip_all)]
    async fn selector_load_data_owned(
        &mut self,
        selector: &VectorSelector,
        range: Option<Duration>,
        ctxs: Option<SelectorContexts>,
    ) -> Result<Value> {
        let mut metric_values = match self.selector_load_data_inner(selector, range, ctxs).await {
            Ok(v) => v,
            Err(e) => {
                log::error!(
                    "[trace_id: {}] [PromQL] Failed to load data for stream, error: {e:?}",
                    self.trace_id
                );
                return Err(e);
            }
        };

        // no data, return immediately
        if metric_values.is_empty() {
            return Ok(Value::None);
        }

        let start = std::time::Instant::now();
        metric_values.par_iter_mut().for_each(|metric| {
            metric.samples.sort_unstable_by_key(|k| k.timestamp);
            if self.ctx.query_ctx.query_exemplars
                && let Some(exemplars) = &mut metric.exemplars
            {
                exemplars.sort_by_key(|k| k.timestamp);
            }
        });
        let values = if metric_values.is_empty() {
            Value::None
        } else {
            Value::Matrix(metric_values)
        };
        log::info!(
            "[trace_id: {}] [PromQL] sort samples by timestamps took: {:?}",
            self.trace_id,
            start.elapsed()
        );
        Ok(values)
    }

    #[tracing::instrument(name = "promql:engine:load_data", skip_all)]
    async fn selector_load_data_inner(
        &self,
        selector: &VectorSelector,
        range: Option<Duration>,
        ctxs: Option<SelectorContexts>,
    ) -> Result<Vec<RangeValue>> {
        let start_time = std::time::Instant::now();
        // https://promlabs.com/blog/2020/07/02/selecting-data-in-promql/#lookback-delta
        let offset_modifier = get_offset_modifier(selector.offset.clone());
        // Positive offset (e.g. `offset 10m`) looks into the past, so we shift
        // the data-load window backwards by `offset_modifier`.
        let start =
            self.ctx.start - range.map_or(self.ctx.lookback_delta, micros) - offset_modifier;
        let end = self.ctx.end - offset_modifier;

        // 1. Group by metrics (sets of label name-value pairs)
        let table_name = selector.name.as_ref().unwrap();
        log::info!(
            "[trace_id: {}] [PromQL] loading data for stream: {table_name}, range: [{start},{end}), filter: {:?}",
            self.trace_id,
            selector.to_string(),
        );

        let mut filters = equal_matcher_filters(&selector.matchers);

        // check for super cluster
        let trace_id = self.ctx.query_ctx.trace_id.clone();
        #[cfg(feature = "enterprise")]
        let (super_tx, mut super_rx) = tokio::sync::mpsc::channel::<
            Result<(HashMap<u64, RangeValue>, config::meta::search::ScanStats)>,
        >(1);
        #[cfg(feature = "enterprise")]
        if self.ctx.query_ctx.is_super_cluster {
            let query_ctx = self.ctx.query_ctx.clone();
            let step = self.eval_ctx.step;
            let selector = selector.clone();
            let label_selector = self.label_selector.clone();
            let trace_id_clone = trace_id.clone();
            tokio::task::spawn(async move {
                let ret = o2_enterprise::enterprise::metrics::super_cluster::selector_load_data(
                    query_ctx,
                    selector,
                    range,
                    &label_selector,
                    start,
                    end,
                    step,
                )
                .await;
                if let Err(e) = super_tx.send(ret).await {
                    log::error!(
                        "[trace_id: {trace_id_clone}] [PromQL] Failed to send super cluster result to channel, error: {e:?}",
                    );
                }
                drop(super_tx);
            });
        } else {
            drop(super_tx);
        }

        let mut label_selector = self.label_selector.clone();
        label_selector.extend(self.ctx.label_selector.iter().cloned());

        let ctxs = match ctxs {
            Some(ctxs) => ctxs,
            None => {
                self.ctx
                    .table_provider
                    .create_context(
                        &self.ctx.query_ctx.org_id,
                        table_name,
                        (start, end),
                        selector.matchers.clone(),
                        label_selector.clone(),
                        &mut filters,
                    )
                    .await?
            }
        };

        // check if we need to load data from local cluster
        #[cfg(feature = "enterprise")]
        let ctxs = if self.ctx.query_ctx.is_super_cluster
            && !o2_enterprise::enterprise::super_cluster::search::has_local_cluster(
                self.ctx.query_ctx.regions.clone(),
                self.ctx.query_ctx.clusters.clone(),
            )
            .await
        {
            vec![]
        } else {
            ctxs
        };

        // Calculate step and lookback for the optimization
        let start = self.eval_ctx.start - offset_modifier;
        let end = self.eval_ctx.end - offset_modifier;
        let step = self.eval_ctx.step;
        let lookback = range.map_or(self.ctx.lookback_delta, micros);

        let skip_labels = self.skip_labels;
        let mut tasks = Vec::with_capacity(ctxs.len());
        let mut abort_handles = Vec::with_capacity(ctxs.len());
        for (ctx, schema, scan_stats, keep_filters) in ctxs {
            let query_ctx = self.ctx.query_ctx.clone();
            let mut selector = selector.clone();
            if !keep_filters {
                selector.matchers = Matchers::empty();
            };
            let label_selector = label_selector.clone();
            let task = tokio::spawn(async move {
                tokio::time::timeout(
                    Duration::from_secs(query_ctx.timeout),
                    selector_load_data_from_datafusion(
                        query_ctx,
                        ctx,
                        schema,
                        selector,
                        label_selector,
                        start,
                        end,
                        step,
                        lookback,
                        skip_labels,
                    ),
                )
                .await
            });
            abort_handles.push(task.abort_handle());
            tasks.push(task);
            // update stats
            let mut ctx_scan_stats = self.ctx.scan_stats.write().await;
            ctx_scan_stats.add(&scan_stats);
        }

        let mut abort_receiver = self
            .ctx
            .table_provider
            .register_cancellation(&trace_id)
            .await?;

        // run datafusion collect data task
        let timeout = self.ctx.query_ctx.timeout;
        let query_task = try_join_all(tasks);
        tokio::pin!(query_task);
        let task_results: Result<Vec<_>> = tokio::select! {
            ret = &mut query_task => {
                match ret {
                    Ok(ret) => {
                        // Unwrap the nested Results: JoinHandle result -> timeout result -> actual result
                        let mut unwrapped_results = Vec::new();
                        for result in ret {
                            match result {
                                Ok(Ok(data)) => unwrapped_results.push(data),
                                Ok(Err(_)) => {
                                    log::error!("[trace_id {trace_id}] [PromQL] grpc search load data task timeout");
                                    return Err(ErrorCodes::SearchTimeout(
                                        "[PromQL] grpc search load data task timeout".to_string(),
                                    )
                                    .into());
                                }
                                Err(err) => {
                                    log::error!("[trace_id {trace_id}] [PromQL] grpc search execute error: {err}");
                                    return Err(ErrorCodes::ServerInternalError(err.to_string()).into());
                                }
                            }
                        }
                        Ok(unwrapped_results)
                    },
                    Err(err) => {
                        log::error!("[trace_id {trace_id}] [PromQL] grpc search execute error: {err}");
                        Err(ErrorCodes::ServerInternalError(err.to_string()).into())
                    }
                }
            },
            _ = tokio::time::sleep(tokio::time::Duration::from_secs(timeout )) => {
                for handle in abort_handles {
                    handle.abort();
                }
                log::error!("[trace_id {trace_id}] [PromQL] grpc search timeout");
                Err(ErrorCodes::SearchTimeout("[PromQL] grpc search timeout".to_string()).into())
            },
            _ = async {
                match abort_receiver.as_mut() {
                    Some(receiver) => {
                        let _ = receiver.await;
                    }
                    None => futures::future::pending::<()>().await,
                }
            } => {
                for handle in abort_handles {
                    handle.abort();
                }
                log::info!("[trace_id {trace_id}] [PromQL] grpc search canceled");
                Err(ErrorCodes::SearchCancelQuery("[PromQL] grpc search canceled".to_string()).into())
            }
        };

        let task_results = task_results?;

        // check for super cluster
        #[cfg(feature = "enterprise")]
        let metrics = if self.ctx.query_ctx.is_super_cluster {
            let mut metrics = merge_loaded_metrics(task_results);
            let (metric, stats) = match super_rx.recv().await {
                Some(Ok(ret)) => ret,
                Some(Err(e)) => {
                    log::error!(
                        "[trace_id: {}] [PromQL] Super cluster result channel error: {e:?}",
                        self.trace_id
                    );
                    return Err(e);
                }
                None => {
                    log::error!(
                        "[trace_id: {}] [PromQL] Super cluster result channel is closed",
                        self.trace_id
                    );
                    return Err(DataFusionError::Plan(
                        "super cluster result channel is closed".to_string(),
                    ));
                }
            };
            for (key, value) in metric {
                if let Some(metric) = metrics.get_mut(&key) {
                    metric.extend(value);
                } else {
                    metrics.insert(key, value);
                }
            }
            let mut ctx_scan_stats = self.ctx.scan_stats.write().await;
            ctx_scan_stats.add(&stats);

            metrics.into_values().collect()
        } else {
            collect_loaded_metrics(task_results)
        };
        #[cfg(not(feature = "enterprise"))]
        let metrics = collect_loaded_metrics(task_results);

        log::info!(
            "[trace_id: {}] load data done for stream: {}, took: {} ms",
            self.trace_id,
            table_name,
            start_time.elapsed().as_millis()
        );

        Ok(metrics)
    }

    /// Streams the fused aggregation when the layout allows it, otherwise materializes on the
    /// same contexts; `None` only when the query shape rules the streaming path out up front.
    pub(super) async fn try_streaming_fused_agg(
        &mut self,
        vs: &VectorSelector,
        range: Duration,
        modifier: &Option<LabelModifier>,
        func: Arc<dyn functions::RangeFunc>,
        op: fused::FusedAggOp,
    ) -> Result<Option<Value>> {
        let query_ctx = &self.ctx.query_ctx;
        // need_wal bails early: WAL would split series across contexts
        if !config::get_config()
            .search
            .feature_metrics_streaming_agg_enabled
            || query_ctx.query_exemplars
            || query_ctx.query_data
            || query_ctx.is_super_cluster
            || query_ctx.need_wal
            || matches!(modifier, Some(LabelModifier::Exclude(_)))
        {
            return Ok(None);
        }
        let selector = named_selector(plain_selector(vs, "MatrixSelector")?, "MatrixSelector")?;
        let table_name = selector.name.clone().unwrap();
        let timeout = query_ctx.timeout;

        let offset = get_offset_modifier(selector.offset.clone());
        let start = self.ctx.start - micros(range) - offset;
        let end = self.ctx.end - offset;
        let mut filters = equal_matcher_filters(&selector.matchers);
        let mut label_selector = self.label_selector.clone();
        label_selector.extend(self.ctx.label_selector.iter().cloned());

        let ctxs = self
            .ctx
            .table_provider
            .create_context(
                &query_ctx.org_id,
                &table_name,
                (start, end),
                selector.matchers.clone(),
                label_selector,
                &mut filters,
            )
            .await?;
        // a second context would split series and evaluate rate windows on partial data
        if let [(ctx, schema, scan_stats, keep_filters)] = ctxs.as_slice() {
            let matchers = if *keep_filters {
                selector.matchers.clone()
            } else {
                Matchers::empty()
            };
            let run = fused::stream::fused_agg(
                ctx,
                schema,
                fused::stream::StreamingSelector {
                    table_name: &table_name,
                    matchers: &matchers,
                    offset,
                },
                fused::stream::FusedShape {
                    op,
                    func: func.clone(),
                    range,
                },
                modifier,
                &self.eval_ctx,
            );
            if let Some(value) = self.run_cancellable(run, timeout).await? {
                self.ctx.scan_stats.write().await.add(scan_stats);
                if self.result_type.is_none() {
                    self.result_type = Some("matrix".to_string());
                }
                return Ok(Some(value));
            }
        }

        // the layout cannot stream: materialize on the contexts already created
        let matrix = self
            .eval_matrix_selector(&selector, range, Some(ctxs))
            .await?;
        let input = if matrix.is_empty() {
            Value::None
        } else {
            Value::Matrix(matrix)
        };
        fused::matrix::fused_agg(modifier, input, func, op, &self.eval_ctx, timeout)
            .await
            .map(Some)
    }

    /// Runs the streaming fold under the query timeout and the host's cancel signal; dropping
    /// the future aborts the shard folds.
    async fn run_cancellable<T>(
        &self,
        run: impl Future<Output = Result<T>>,
        timeout: u64,
    ) -> Result<T> {
        let trace_id = &self.ctx.query_ctx.trace_id;
        let mut abort_receiver = self
            .ctx
            .table_provider
            .register_cancellation(trace_id)
            .await?;
        tokio::pin!(run);
        // a cancel or an expired budget wins over a fold that happens to be ready
        tokio::select! {
            biased;
            _ = async {
                match abort_receiver.as_mut() {
                    Some(receiver) => {
                        let _ = receiver.await;
                    }
                    None => pending::<()>().await,
                }
            } => {
                log::info!("[trace_id {trace_id}] [PromQL] streaming fused agg canceled");
                Err(ErrorCodes::SearchCancelQuery(
                    "[PromQL] streaming fused agg canceled".to_string(),
                )
                .into())
            }
            _ = tokio::time::sleep(Duration::from_secs(timeout)) => {
                log::error!("[trace_id {trace_id}] [PromQL] streaming fused agg timeout");
                Err(ErrorCodes::SearchTimeout(
                    "[PromQL] streaming fused agg timeout".to_string(),
                )
                .into())
            }
            ret = &mut run => ret,
        }
    }
}

/// Strips placeholder matchers and rejects the selector forms no loader supports.
pub(super) fn plain_selector(selector: &VectorSelector, kind: &str) -> Result<VectorSelector> {
    let mut selector = selector.clone();
    remove_filter_all(&mut selector);
    if !selector.matchers.or_matchers.is_empty() {
        return Err(DataFusionError::Plan(format!(
            "{kind}: or_matchers is not supported"
        )));
    }
    if selector.at.is_some() {
        return Err(DataFusionError::NotImplemented(format!(
            "{kind}: @ modifier is not supported"
        )));
    }
    Ok(selector)
}

/// Lifts the `__name__` matcher into the selector name; kept as a matcher it would filter the
/// stored column, which may hold the pre-`format_stream_name` case.
fn named_selector(mut selector: VectorSelector, kind: &str) -> Result<VectorSelector> {
    if selector.name.is_some() {
        return Ok(selector);
    }
    let Some(name) = selector
        .matchers
        .find_matchers(NAME_LABEL)
        .first()
        .map(|mat| mat.value.clone())
    else {
        return Err(DataFusionError::Plan(format!(
            "{kind}: metric name is required"
        )));
    };
    selector.name = Some(name);
    selector
        .matchers
        .matchers
        .retain(|mat| mat.name != NAME_LABEL);
    Ok(selector)
}

/// Discard the already-partitioned series hashes without rebuilding a global
/// hash table. This is the common path when DataFusion creates one query
/// context for the selected schema.
fn flatten_partitioned_metrics(partitions: PartitionedMetrics) -> Vec<RangeValue> {
    let metrics_count = partitions.iter().map(HashMap::len).sum();
    let mut metrics = Vec::with_capacity(metrics_count);
    for partition in partitions {
        metrics.extend(partition.into_values());
    }
    metrics
}

fn flatten_loaded_metrics(metrics: LoadedMetrics) -> Vec<RangeValue> {
    match metrics {
        LoadedMetrics::Partitioned(partitions) => flatten_partitioned_metrics(partitions),
        LoadedMetrics::Merged(metrics) => metrics.into_values().collect(),
    }
}

/// A single DataFusion context is the common case and its series are already
/// deduplicated, so flatten it; series from multiple contexts must be merged
/// by series hash.
fn collect_loaded_metrics(mut results: Vec<LoadedMetrics>) -> Vec<RangeValue> {
    if results.len() == 1 {
        flatten_loaded_metrics(results.pop().unwrap())
    } else {
        merge_loaded_metrics(results).into_values().collect()
    }
}

fn equal_matcher_filters(matchers: &Matchers) -> Vec<(String, Vec<String>)> {
    matchers
        .matchers
        .iter()
        .filter_map(|mat| {
            if mat.op == MatchOp::Equal {
                Some((mat.name.to_string(), vec![mat.value.to_string()]))
            } else {
                None
            }
        })
        .collect()
}

/// Merge series that may occur in more than one DataFusion context. Contexts
/// can have different partition counts, so this fallback deliberately merges
/// by series hash instead of zipping partitions.
fn merge_loaded_metrics(results: Vec<LoadedMetrics>) -> HashMap<u64, RangeValue> {
    // Multiple contexts can contain the same high-cardinality series. Grow
    // from the unique keys instead of reserving the sum of all context sizes.
    let mut metrics: HashMap<u64, RangeValue> = HashMap::default();
    for result in results {
        let maps = match result {
            LoadedMetrics::Partitioned(partitions) => partitions,
            LoadedMetrics::Merged(metrics) => vec![metrics],
        };
        for map in maps {
            for (hash, value) in map {
                match metrics.entry(hash) {
                    hashbrown::hash_map::Entry::Occupied(mut entry) => {
                        entry.get_mut().extend(value)
                    }
                    hashbrown::hash_map::Entry::Vacant(entry) => {
                        entry.insert(value);
                    }
                };
            }
        }
    }
    metrics
}

fn get_offset_modifier(offset: Option<Offset>) -> i64 {
    if let Some(offset) = offset {
        match offset {
            Offset::Pos(offset) => micros(offset),
            Offset::Neg(offset) => -micros(offset),
        }
    } else {
        0
    }
}

#[cfg(test)]
mod tests {
    use std::{sync::Arc, time::Duration};

    use promql_parser::{
        label::{MatchOp, Matchers},
        parser::{Offset, VectorSelector},
    };

    use super::*;
    use crate::{engine::tests::*, exec::PromqlContext};

    #[test]
    fn test_flatten_partitioned_metrics_preserves_all_series() {
        let partitions = vec![
            HashMap::from([(11, range_value(100, 1.0))]),
            HashMap::from([(22, range_value(200, 2.0))]),
        ];

        let metrics = flatten_partitioned_metrics(partitions);
        assert_eq!(metrics.len(), 2);
        assert_eq!(
            metrics
                .iter()
                .map(|metric| metric.samples.len())
                .sum::<usize>(),
            2
        );
    }

    #[test]
    fn test_merge_partitioned_metrics_extends_series_across_contexts() {
        // Deliberately use different partition counts: separate DataFusion
        // contexts are not required to have identical physical plans.
        let results = vec![
            LoadedMetrics::Partitioned(vec![HashMap::from([(11, range_value(100, 1.0))])]),
            LoadedMetrics::Partitioned(vec![
                HashMap::new(),
                HashMap::from([(11, range_value(200, 2.0)), (22, range_value(300, 3.0))]),
            ]),
        ];

        let metrics = merge_loaded_metrics(results);
        assert_eq!(metrics.len(), 2);
        assert_eq!(metrics[&11].samples.len(), 2);
        assert_eq!(metrics[&22].samples.len(), 1);
    }

    #[tokio::test]
    async fn test_eval_vector_selector_strips_consumed_name_matcher() {
        let trace_id = "test_trace";
        let captured = Arc::new(std::sync::Mutex::new(None));
        let mut engine = Engine::new(
            trace_id,
            Arc::new(PromqlContext::new(
                create_test_query_ctx(trace_id, "test_org", 30),
                MatcherCapturingProvider {
                    captured: captured.clone(),
                },
                vec![],
            )),
            create_test_eval_ctx(),
        );

        // `{__name__="test_metric", env="prod"}` form: the name matcher is lifted
        // into selector.name and must NOT survive as a column filter — the stored
        // `__name__` column can hold the pre-`format_stream_name` metric name
        let selector = VectorSelector {
            name: None,
            matchers: Matchers {
                matchers: vec![
                    promql_parser::label::Matcher {
                        name: NAME_LABEL.to_string(),
                        op: MatchOp::Equal,
                        value: "test_metric".to_string(),
                    },
                    promql_parser::label::Matcher {
                        name: "env".to_string(),
                        op: MatchOp::Equal,
                        value: "prod".to_string(),
                    },
                ],
                or_matchers: vec![],
            },
            offset: None,
            at: None,
        };

        engine.eval_vector_selector(&selector).await.unwrap();

        let matchers = captured.lock().unwrap().take().unwrap();
        assert!(matchers.matchers.iter().all(|m| m.name != NAME_LABEL));
        assert_eq!(matchers.matchers.len(), 1);
        assert_eq!(matchers.matchers[0].name, "env");
    }

    #[tokio::test]
    async fn test_eval_vector_selector_basic() {
        let trace_id = "test_trace";
        let org_id = "test_org";
        let mut engine = Engine::new(
            trace_id,
            Arc::new(PromqlContext::new(
                create_test_query_ctx(trace_id, org_id, 30),
                SimpleMockProvider,
                vec![],
            )),
            create_test_eval_ctx(),
        );

        let matchers = Matchers {
            matchers: vec![promql_parser::label::Matcher {
                name: "env".to_string(),
                op: MatchOp::Equal,
                value: "prod".to_string(),
            }],
            or_matchers: vec![],
        };

        let selector = VectorSelector {
            name: Some("test_metric".to_string()),
            matchers,
            offset: None,
            at: None,
        };

        let result = engine.eval_vector_selector(&selector).await;
        assert!(result.is_ok());
        let values = result.unwrap();
        assert_eq!(values.len(), 0); // Mock provider returns empty data
    }

    #[tokio::test]
    async fn test_eval_vector_selector_with_offset() {
        let trace_id = "test_trace";
        let org_id = "test_org";
        let mut engine = Engine::new(
            trace_id,
            Arc::new(PromqlContext::new(
                create_test_query_ctx(trace_id, org_id, 30),
                SimpleMockProvider,
                vec![],
            )),
            create_test_eval_ctx(),
        );

        let matchers = Matchers {
            matchers: vec![promql_parser::label::Matcher {
                name: "env".to_string(),
                op: MatchOp::Equal,
                value: "prod".to_string(),
            }],
            or_matchers: vec![],
        };

        let selector = VectorSelector {
            name: Some("test_metric".to_string()),
            matchers,
            offset: Some(Offset::Pos(Duration::from_secs(60))),
            at: None,
        };

        let result = engine.eval_vector_selector(&selector).await;
        assert!(result.is_ok());
        let values = result.unwrap();
        assert_eq!(values.len(), 0); // Mock provider returns empty data
    }

    #[tokio::test]
    async fn test_eval_vector_selector_with_negative_offset() {
        let trace_id = "test_trace";
        let org_id = "test_org";
        let mut engine = Engine::new(
            trace_id,
            Arc::new(PromqlContext::new(
                create_test_query_ctx(trace_id, org_id, 30),
                SimpleMockProvider,
                vec![],
            )),
            create_test_eval_ctx(),
        );

        let matchers = Matchers {
            matchers: vec![promql_parser::label::Matcher {
                name: "env".to_string(),
                op: MatchOp::Equal,
                value: "prod".to_string(),
            }],
            or_matchers: vec![],
        };

        let selector = VectorSelector {
            name: Some("test_metric".to_string()),
            matchers,
            offset: Some(Offset::Neg(Duration::from_secs(60))),
            at: None,
        };

        let result = engine.eval_vector_selector(&selector).await;
        assert!(result.is_ok());
        let values = result.unwrap();
        assert_eq!(values.len(), 0); // Mock provider returns empty data
    }

    #[tokio::test]
    async fn test_eval_matrix_selector_basic() {
        let trace_id = "test_trace";
        let org_id = "test_org";
        let mut engine = Engine::new(
            trace_id,
            Arc::new(PromqlContext::new(
                create_test_query_ctx(trace_id, org_id, 30),
                SimpleMockProvider,
                vec![],
            )),
            create_test_eval_ctx(),
        );

        let matchers = Matchers {
            matchers: vec![promql_parser::label::Matcher {
                name: "env".to_string(),
                op: MatchOp::Equal,
                value: "prod".to_string(),
            }],
            or_matchers: vec![],
        };

        let selector = VectorSelector {
            name: Some("test_metric".to_string()),
            matchers,
            offset: None,
            at: None,
        };

        let result = engine
            .eval_matrix_selector(&selector, Duration::from_secs(300), None)
            .await;
        assert!(result.is_ok());
        let values = result.unwrap();
        assert_eq!(values.len(), 0); // Mock provider returns empty data
    }

    #[tokio::test]
    async fn test_eval_vector_selector_without_a_metric_name_is_an_error() {
        let trace_id = "test_trace";
        let org_id = "test_org";
        let mut engine = Engine::new(
            trace_id,
            Arc::new(PromqlContext::new(
                create_test_query_ctx(trace_id, org_id, 30),
                SimpleMockProvider,
                vec![],
            )),
            create_test_eval_ctx(),
        );

        // `{env="prod"}` -- no name and no __name__ matcher to fall back on.
        let selector = VectorSelector {
            name: None,
            matchers: Matchers {
                matchers: vec![promql_parser::label::Matcher {
                    name: "env".to_string(),
                    op: MatchOp::Equal,
                    value: "prod".to_string(),
                }],
                or_matchers: vec![],
            },
            offset: None,
            at: None,
        };

        let result = engine.eval_vector_selector(&selector).await;

        assert!(result.is_err(), "expected an error, not a panic");
        assert!(
            result
                .unwrap_err()
                .to_string()
                .contains("VectorSelector: metric name is required"),
            "the error should name the vector selector"
        );
    }

    #[tokio::test]
    async fn test_eval_matrix_selector_without_a_metric_name_is_an_error() {
        let trace_id = "test_trace";
        let org_id = "test_org";
        let mut engine = Engine::new(
            trace_id,
            Arc::new(PromqlContext::new(
                create_test_query_ctx(trace_id, org_id, 30),
                SimpleMockProvider,
                vec![],
            )),
            create_test_eval_ctx(),
        );

        // `{env="prod"}[5m]` -- no name and no __name__ matcher to fall back on.
        let selector = VectorSelector {
            name: None,
            matchers: Matchers {
                matchers: vec![promql_parser::label::Matcher {
                    name: "env".to_string(),
                    op: MatchOp::Equal,
                    value: "prod".to_string(),
                }],
                or_matchers: vec![],
            },
            offset: None,
            at: None,
        };

        let result = engine
            .eval_matrix_selector(&selector, Duration::from_secs(300), None)
            .await;

        assert!(result.is_err(), "expected an error, not a panic");
        assert!(
            result
                .unwrap_err()
                .to_string()
                .contains("MatrixSelector: metric name is required"),
            "the error should name the matrix selector"
        );
    }

    #[tokio::test]
    async fn test_eval_matrix_selector_with_offset() {
        let trace_id = "test_trace";
        let org_id = "test_org";
        let mut engine = Engine::new(
            trace_id,
            Arc::new(PromqlContext::new(
                create_test_query_ctx(trace_id, org_id, 30),
                SimpleMockProvider,
                vec![],
            )),
            create_test_eval_ctx(),
        );

        let matchers = Matchers {
            matchers: vec![promql_parser::label::Matcher {
                name: "env".to_string(),
                op: MatchOp::Equal,
                value: "prod".to_string(),
            }],
            or_matchers: vec![],
        };

        let selector = VectorSelector {
            name: Some("test_metric".to_string()),
            matchers,
            offset: Some(Offset::Pos(Duration::from_secs(120))),
            at: None,
        };

        let result = engine
            .eval_matrix_selector(&selector, Duration::from_secs(300), None)
            .await;
        assert!(result.is_ok());
        let values = result.unwrap();
        assert_eq!(values.len(), 0); // Mock provider returns empty data
    }

    #[test]
    fn test_get_offset_modifier_none() {
        assert_eq!(get_offset_modifier(None), 0);
    }

    #[test]
    fn test_get_offset_modifier_positive() {
        let result = get_offset_modifier(Some(Offset::Pos(Duration::from_secs(60))));
        assert_eq!(result, 60_000_000); // 60s in micros
    }

    #[test]
    fn test_get_offset_modifier_negative() {
        let result = get_offset_modifier(Some(Offset::Neg(Duration::from_secs(30))));
        assert_eq!(result, -30_000_000); // -30s in micros
    }

    mod streaming_fused_agg {
        use std::sync::atomic::{AtomicUsize, Ordering};

        use config::{
            TIMESTAMP_COL_NAME,
            meta::{
                promql::{HASH_LABEL, HASH_SORTED_TABLE_SUFFIX, VALUE_LABEL},
                search::ScanStats,
            },
        };
        use datafusion::{
            arrow::{
                array::{Float64Array, Int64Array, RecordBatch, UInt64Array},
                datatypes::{DataType, Field, Schema},
            },
            datasource::MemTable,
            prelude::{SessionConfig, SessionContext, col},
        };
        use hashbrown::HashSet;
        use tokio::sync::oneshot;

        use super::*;

        const SECOND: i64 = 1_000_000;
        const BASE: i64 = 1_000 * SECOND;

        /// Serves one hash-sorted context and can hand out an already-fired cancel signal.
        struct StreamingProvider {
            ctx: SessionContext,
            calls: Arc<AtomicUsize>,
            canceled: bool,
            // a dropped sender reads as a cancel, so a live registration keeps it
            cancel: std::sync::Mutex<Option<oneshot::Sender<()>>>,
        }

        #[async_trait::async_trait]
        impl crate::TableProvider for StreamingProvider {
            async fn create_context(
                &self,
                _org_id: &str,
                _stream_name: &str,
                _time_range: (i64, i64),
                _matchers: Matchers,
                _label_selector: HashSet<String>,
                _filters: &mut [(String, Vec<String>)],
            ) -> Result<Vec<(SessionContext, Arc<Schema>, ScanStats, bool)>> {
                self.calls.fetch_add(1, Ordering::SeqCst);
                Ok(vec![(
                    self.ctx.clone(),
                    metrics_schema(),
                    ScanStats::default(),
                    true,
                )])
            }

            async fn register_cancellation(
                &self,
                _trace_id: &str,
            ) -> Result<Option<oneshot::Receiver<()>>> {
                let (sender, receiver) = oneshot::channel();
                if self.canceled {
                    let _ = sender.send(());
                } else {
                    *self.cancel.lock().unwrap() = Some(sender);
                }
                Ok(Some(receiver))
            }
        }

        fn metrics_schema() -> Arc<Schema> {
            Arc::new(Schema::new(vec![
                Field::new(TIMESTAMP_COL_NAME, DataType::Int64, false),
                Field::new(HASH_LABEL, DataType::UInt64, false),
                Field::new(VALUE_LABEL, DataType::Float64, false),
            ]))
        }

        /// Two counters sampled every 20 s; the hash-sorted table exists only when `streams`.
        fn provider(streams: bool, canceled: bool) -> StreamingProvider {
            let rows: Vec<(i64, u64, f64)> = [7u64, u64::MAX / 2]
                .into_iter()
                .flat_map(|hash| {
                    (0..10).map(move |step| (BASE + step * 20 * SECOND, hash, (step * 3) as f64))
                })
                .collect();
            let batch = RecordBatch::try_new(
                metrics_schema(),
                vec![
                    Arc::new(Int64Array::from_iter_values(rows.iter().map(|row| row.0))),
                    Arc::new(UInt64Array::from_iter_values(rows.iter().map(|row| row.1))),
                    Arc::new(Float64Array::from_iter_values(rows.iter().map(|row| row.2))),
                ],
            )
            .unwrap();
            let table = || MemTable::try_new(metrics_schema(), vec![vec![batch.clone()]]).unwrap();
            let mut config = SessionConfig::new().with_target_partitions(3);
            config.options_mut().optimizer.prefer_existing_sort = true;
            let ctx = SessionContext::new_with_config(config);
            ctx.register_table("m", Arc::new(table())).unwrap();
            if streams {
                let sorted = table().with_sort_order(vec![vec![
                    col(HASH_LABEL).sort(true, false),
                    col(TIMESTAMP_COL_NAME).sort(true, false),
                ]]);
                ctx.register_table(format!("m{HASH_SORTED_TABLE_SUFFIX}"), Arc::new(sorted))
                    .unwrap();
            }
            StreamingProvider {
                ctx,
                calls: Default::default(),
                canceled,
                cancel: Default::default(),
            }
        }

        /// Pins the flag on so a local env override cannot turn the streaming path off.
        fn enable_streaming() {
            static ENABLE: std::sync::Once = std::sync::Once::new();
            ENABLE.call_once(|| {
                unsafe { std::env::set_var("ZO_FEATURE_METRICS_STREAMING_AGG_ENABLED", "true") };
                config::refresh_config().expect("config refresh");
            });
        }

        fn engine(provider: StreamingProvider, timeout: u64) -> Engine {
            enable_streaming();
            let eval_ctx = EvalContext::new(
                BASE + 60 * SECOND,
                BASE + 180 * SECOND,
                60 * SECOND,
                "test_trace".into(),
            );
            let mut ctx = PromqlContext::new(
                create_test_query_ctx("test_trace", "test_org", timeout),
                provider,
                vec![],
            );
            ctx.start = eval_ctx.start;
            ctx.end = eval_ctx.end;
            Engine::new("test_trace", Arc::new(ctx), eval_ctx)
        }

        async fn eval_query(
            provider: StreamingProvider,
            timeout: u64,
            query: &str,
        ) -> Result<Value> {
            let mut engine = engine(provider, timeout);
            let expr = promql_parser::parser::parse(query).unwrap();
            engine.exec(&expr).await.map(|(value, _)| value)
        }

        async fn eval_sum_rate(provider: StreamingProvider, timeout: u64) -> Result<Value> {
            eval_query(provider, timeout, "sum(rate(m[1m]))").await
        }

        /// The generic instant path: `eval_vector_selector` then the plain aggregation.
        async fn generic_instant_agg(
            provider: StreamingProvider,
            selector: &str,
            modifier: &Option<LabelModifier>,
            agg: fn(&Option<LabelModifier>, Value, &EvalContext) -> Result<Value>,
        ) -> Value {
            let mut engine = engine(provider, 30);
            let promql_parser::parser::Expr::VectorSelector(vs) =
                promql_parser::parser::parse(selector).unwrap()
            else {
                panic!("{selector} is not a vector selector");
            };
            let data = engine.eval_vector_selector(&vs).await.unwrap();
            let eval_ctx = engine.eval_ctx.clone();
            agg(modifier, Value::Matrix(data), &eval_ctx).unwrap()
        }

        /// (sorted labels, (timestamp, value)) per series, sorted by labels.
        type CanonicalSeries = (Vec<(String, String)>, Vec<(i64, f64)>);

        fn canonical(value: Value) -> Vec<CanonicalSeries> {
            let Value::Matrix(matrix) = value else {
                panic!("expected a matrix, got {}", value.get_type());
            };
            let mut series: Vec<_> = matrix
                .into_iter()
                .map(|series| {
                    let mut labels: Vec<_> = series
                        .labels
                        .iter()
                        .map(|label| (label.name.clone(), label.value.clone()))
                        .collect();
                    labels.sort();
                    let samples = series
                        .samples
                        .iter()
                        .map(|sample| (sample.timestamp, sample.value))
                        .collect();
                    (labels, samples)
                })
                .collect();
            series.sort_by(|a, b| a.0.cmp(&b.0));
            series
        }

        fn assert_same_matrix(expected: Value, actual: Value, context: &str) {
            let (expected, actual) = (canonical(expected), canonical(actual));
            assert_eq!(expected.len(), actual.len(), "{context}: series count");
            for (expected, actual) in expected.iter().zip(&actual) {
                assert_eq!(expected.0, actual.0, "{context}: labels");
                assert_eq!(expected.1.len(), actual.1.len(), "{context}: sample count");
                for ((ts_e, v_e), (ts_a, v_a)) in expected.1.iter().zip(&actual.1) {
                    assert_eq!(ts_e, ts_a, "{context}: timestamp");
                    assert!(
                        (v_e - v_a).abs() <= 1e-9,
                        "{context}: {v_e} vs {v_a} at {ts_e}"
                    );
                }
            }
        }

        #[tokio::test]
        async fn test_streaming_run_stops_on_cancel() {
            let err = eval_sum_rate(provider(true, true), 30).await.unwrap_err();
            assert!(matches!(
                infra::errors::Error::from(err),
                infra::errors::Error::ErrorCode(ErrorCodes::SearchCancelQuery(_))
            ));
        }

        #[tokio::test]
        async fn test_streaming_run_stops_on_timeout() {
            let err = eval_sum_rate(provider(true, false), 0).await.unwrap_err();
            assert!(matches!(
                infra::errors::Error::from(err),
                infra::errors::Error::ErrorCode(ErrorCodes::SearchTimeout(_))
            ));
        }

        /// `agg(m)` streams as `agg(last_over_time(m[lookback]))` and must match the generic
        /// instant path, both when it streams and when it materializes on the same context.
        #[tokio::test]
        async fn test_instant_agg_matches_generic_streaming_and_materialized() {
            type Agg = fn(&Option<LabelModifier>, Value, &EvalContext) -> Result<Value>;
            let cases: [(&str, &str, Agg); 4] = [
                ("sum(m)", "m", crate::aggregations::sum),
                ("count(m)", "m", crate::aggregations::count),
                (
                    "avg(m offset 30s)",
                    "m offset 30s",
                    crate::aggregations::avg,
                ),
                (
                    "max(m offset 30s)",
                    "m offset 30s",
                    crate::aggregations::max,
                ),
            ];
            for (query, selector, agg) in cases {
                let expected =
                    generic_instant_agg(provider(false, false), selector, &None, agg).await;
                let streamed = eval_query(provider(true, false), 30, query).await.unwrap();
                assert_same_matrix(expected.clone(), streamed, &format!("streamed {query}"));
                let materialized = eval_query(provider(false, false), 30, query).await.unwrap();
                assert_same_matrix(expected, materialized, &format!("materialized {query}"));
            }
        }

        #[tokio::test]
        async fn test_instant_agg_takes_the_streaming_path() {
            let err = eval_query(provider(true, true), 30, "sum(m)")
                .await
                .unwrap_err();
            assert!(matches!(
                infra::errors::Error::from(err),
                infra::errors::Error::ErrorCode(ErrorCodes::SearchCancelQuery(_))
            ));
        }

        #[tokio::test]
        async fn test_materializes_on_the_streaming_context_without_sorted_table() {
            let provider = provider(false, false);
            let calls = provider.calls.clone();

            let value = eval_sum_rate(provider, 30).await.unwrap();
            let Value::Matrix(matrix) = value else {
                panic!("expected a matrix, got {}", value.get_type());
            };
            assert_eq!(matrix.len(), 1, "sum() folds both series into one");
            assert_eq!(matrix[0].samples.len(), 3, "one sample per evaluation step");
            assert_eq!(
                calls.load(Ordering::SeqCst),
                1,
                "the materializing fallback must reuse the context the streaming attempt created"
            );
        }
    }
}
