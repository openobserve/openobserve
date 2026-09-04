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

use config::meta::promql::{NAME_LABEL, value::*};
use datafusion::error::{DataFusionError, Result};
use futures::future::{pending, try_join_all};
use hashbrown::HashMap;
use infra::errors::ErrorCodes;
use promql_parser::{
    label::{MatchOp, Matchers},
    parser::{LabelModifier, MatrixSelector, Offset, VectorSelector},
};
use rayon::iter::{IntoParallelIterator, IntoParallelRefMutIterator, ParallelIterator};

use super::Engine;
use crate::{
    functions, fused,
    load_series::{LoadedMetrics, PartitionedMetrics, selector_load_data_from_datafusion},
    micros,
    promql::rewrite::remove_filter_all,
};

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

        let mut selector = selector.clone();
        if selector.name.is_none() {
            let name = match selector.matchers.find_matchers(NAME_LABEL).first() {
                Some(mat) => mat.value.clone(),
                None => {
                    return Err(DataFusionError::Plan(
                        "VectorSelector: metric name is required".into(),
                    ));
                }
            };
            selector.name = Some(name);
            // the matcher is fully consumed by stream selection; leaving it in
            // would filter on the stored `__name__` column (which may keep the
            // pre-`format_stream_name` case), leak into partition pruning, and
            // make the selector's PromQL text unparseable on super-cluster peers
            selector
                .matchers
                .matchers
                .retain(|mat| mat.name != NAME_LABEL);
        }

        let data = self.selector_load_data_owned(&selector, None).await?;

        let metrics_cache = match data.get_range_values() {
            Some(v) => v,
            None => return Ok(vec![]),
        };

        let mut offset_modifier = 0;
        if let Some(offset) = selector.offset {
            match offset {
                Offset::Pos(offset) => {
                    offset_modifier = micros(offset);
                }
                Offset::Neg(offset) => {
                    offset_modifier = -micros(offset);
                }
            }
        };

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
    /// of samples.
    pub(super) async fn eval_matrix_selector(
        &mut self,
        selector: &VectorSelector,
        range: Duration,
    ) -> Result<Vec<RangeValue>> {
        if self.result_type.is_none() {
            self.result_type = Some("matrix".to_string());
        }

        let mut selector = selector.clone();
        if selector.name.is_none() {
            let name = match selector.matchers.find_matchers(NAME_LABEL).first() {
                Some(mat) => mat.value.clone(),
                None => {
                    return Err(DataFusionError::Plan(
                        "MatrixSelector: metric name is required".into(),
                    ));
                }
            };

            selector.name = Some(name);
            // see eval_vector_selector: the matcher is consumed by stream selection
            selector
                .matchers
                .matchers
                .retain(|mat| mat.name != NAME_LABEL);
        }

        let data = self
            .selector_load_data_owned(&selector, Some(range))
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
    ) -> Result<Value> {
        let mut metric_values = match self.selector_load_data_inner(selector, range).await {
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

        let ctxs = self
            .ctx
            .table_provider
            .create_context(
                &self.ctx.query_ctx.org_id,
                table_name,
                (start, end),
                selector.matchers.clone(),
                self.label_selector.clone(),
                &mut filters,
            )
            .await?;

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

        let mut label_selector = self.label_selector.clone();
        label_selector.extend(self.ctx.label_selector.iter().cloned());

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
        let task_results = tokio::select! {
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
                                    return Err(DataFusionError::Plan(format!("task error: {err}")));
                                }
                            }
                        }
                        Ok(unwrapped_results)
                    },
                    Err(err) => {
                        log::error!("[trace_id {trace_id}] [PromQL] grpc search execute error: {err}");
                        Err(DataFusionError::Execution(err.to_string()))
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

    /// Attempts the streaming fused path: series arrive whole from
    /// `(__hash__, _timestamp)` ordered scans and fold straight into the
    /// aggregation, so the sample matrix is never materialized. `None` means
    /// the query shape or the storage layout requires the materializing path.
    pub(super) async fn try_streaming_fused_agg(
        &mut self,
        matrix_selector: &MatrixSelector,
        modifier: &Option<LabelModifier>,
        func: Arc<dyn functions::RangeFunc>,
        op: fused::FusedAggOp,
    ) -> Result<Option<Value>> {
        let query_ctx = &self.ctx.query_ctx;
        // need_wal bails early: WAL would split series and double the context-creation cost
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
        let MatrixSelector { vs, range } = matrix_selector;
        let range = *range;
        let mut selector = vs.clone();
        remove_filter_all(&mut selector);
        if !selector.matchers.or_matchers.is_empty() || selector.at.is_some() {
            return Ok(None);
        }
        if selector.name.is_none() {
            let names = selector.matchers.find_matchers(NAME_LABEL);
            let Some(matcher) = names.first() else {
                return Ok(None);
            };
            selector.name = Some(matcher.value.clone());
            selector
                .matchers
                .matchers
                .retain(|mat| mat.name != NAME_LABEL);
        }
        let table_name = selector.name.clone().unwrap();

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
        if ctxs.len() != 1 {
            return Ok(None);
        }
        let (ctx, schema, scan_stats, keep_filters) = ctxs.into_iter().next().unwrap();
        if !keep_filters {
            selector.matchers = Matchers::empty();
        }

        let run = fused::stream::fused_agg(
            &ctx,
            &schema,
            fused::stream::StreamingSelector {
                table_name: &table_name,
                matchers: &selector.matchers,
                offset,
            },
            fused::stream::FusedShape { op, func, range },
            modifier,
            &self.eval_ctx,
        );
        let value = self.run_cancellable(run, query_ctx.timeout).await?;
        if value.is_some() {
            let mut ctx_scan_stats = self.ctx.scan_stats.write().await;
            ctx_scan_stats.add(&scan_stats);
            if self.result_type.is_none() {
                self.result_type = Some("matrix".to_string());
            }
        }
        Ok(value)
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
            .eval_matrix_selector(&selector, Duration::from_secs(300))
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
            .eval_matrix_selector(&selector, Duration::from_secs(300))
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
            .eval_matrix_selector(&selector, Duration::from_secs(300))
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
        use config::{
            TIMESTAMP_COL_NAME,
            meta::{
                promql::{HASH_LABEL, STREAMING_AGG_TABLE_SUFFIX, VALUE_LABEL},
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

        /// Two counters sampled every 20 s, registered as the hash-sorted table.
        fn provider(canceled: bool) -> StreamingProvider {
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
            let table = MemTable::try_new(metrics_schema(), vec![vec![batch]])
                .unwrap()
                .with_sort_order(vec![vec![
                    col(HASH_LABEL).sort(true, false),
                    col(TIMESTAMP_COL_NAME).sort(true, false),
                ]]);
            let mut config = SessionConfig::new().with_target_partitions(3);
            config.options_mut().optimizer.prefer_existing_sort = true;
            let ctx = SessionContext::new_with_config(config);
            ctx.register_table(format!("m{STREAMING_AGG_TABLE_SUFFIX}"), Arc::new(table))
                .unwrap();
            StreamingProvider {
                ctx,
                canceled,
                cancel: Default::default(),
            }
        }

        /// The flag defaults to off; flip it once for this process before the engine reads it.
        fn enable_streaming() {
            static ENABLE: std::sync::Once = std::sync::Once::new();
            ENABLE.call_once(|| {
                unsafe { std::env::set_var("ZO_FEATURE_METRICS_STREAMING_AGG_ENABLED", "true") };
                config::refresh_config().expect("config refresh");
            });
        }

        async fn eval_sum_rate(provider: StreamingProvider, timeout: u64) -> Result<Value> {
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
            let mut engine = Engine::new("test_trace", Arc::new(ctx), eval_ctx);
            let expr = promql_parser::parser::parse("sum(rate(m[1m]))").unwrap();
            engine.exec(&expr).await.map(|(value, _)| value)
        }

        #[tokio::test]
        async fn test_streaming_run_stops_on_cancel() {
            let err = eval_sum_rate(provider(true), 30).await.unwrap_err();
            assert!(matches!(
                infra::errors::Error::from(err),
                infra::errors::Error::ErrorCode(ErrorCodes::SearchCancelQuery(_))
            ));
        }

        #[tokio::test]
        async fn test_streaming_run_stops_on_timeout() {
            let err = eval_sum_rate(provider(false), 0).await.unwrap_err();
            assert!(matches!(
                infra::errors::Error::from(err),
                infra::errors::Error::ErrorCode(ErrorCodes::SearchTimeout(_))
            ));
        }
    }
}
