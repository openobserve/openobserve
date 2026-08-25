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

//! Loads PromQL series samples, exemplars, and labels from DataFusion.

mod label_cache;
mod labels;
mod load_labels;

use std::{sync::Arc, time::Duration};

use config::{
    TIMESTAMP_COL_NAME,
    meta::promql::{
        EXEMPLARS_LABEL, HASH_LABEL, VALUE_LABEL,
        value::{Exemplar, Label, Labels, QueryContext, RangeValue, Sample},
    },
    utils::{
        hash::{Sum64, gxhash},
        json,
    },
};
use datafusion::{
    arrow::{
        array::{ArrayRef, Float64Array, Int64Array, StringArray, UInt64Array},
        datatypes::{DataType, Schema},
        record_batch::RecordBatch,
    },
    error::{DataFusionError, Result},
    logical_expr::utils::disjunction,
    physical_plan::{
        Partitioning, display::DisplayableExecutionPlan, execute_stream_partitioned,
        expressions::Column, repartition::RepartitionExec,
    },
    prelude::{DataFrame, Expr, SessionContext, col, lit},
};
use futures::TryStreamExt;
use hashbrown::{HashMap, HashSet};
use promql_parser::parser::VectorSelector;

use self::labels::load_series_labels;
use super::utils::{apply_label_selector, apply_matchers};

pub(super) type PartitionedMetrics = Vec<HashMap<u64, RangeValue>>;

pub(super) enum LoadedMetrics {
    /// UInt64 hashes are the repartition key, so maps have disjoint keys and
    /// can be flattened without rebuilding a global hash table.
    Partitioned(PartitionedMetrics),
    /// String hashes are repartitioned before being fingerprinted locally.
    /// Preserve the previous global-map behavior for the (extremely rare)
    /// case where two strings fingerprint to the same u64 in different
    /// partitions.
    Merged(HashMap<u64, RangeValue>),
}

type TokioResult = tokio::task::JoinHandle<Result<(HashMap<u64, RangeValue>, HashSet<i64>)>>;

#[derive(Default)]
struct SamplePartitionStats {
    rows: usize,
    batches: usize,
    arrow_bytes: usize,
    hash_runs: usize,
    builder_cpu: Duration,
    series_created: usize,
    initial_preallocated_slots: usize,
    additional_vector_growths: usize,
}

type SampleTokioResult =
    tokio::task::JoinHandle<Result<(HashMap<u64, RangeValue>, HashSet<i64>, SamplePartitionStats)>>;

#[derive(Clone, Copy)]
struct RoutedHashRun {
    hash: u64,
    start: usize,
    end: usize,
}

struct RoutedSampleBatch {
    timestamps: ArrayRef,
    values: ArrayRef,
    runs: Vec<RoutedHashRun>,
}

struct RoutedOwnerBatch {
    batch: Arc<RoutedSampleBatch>,
    run_start: usize,
    run_end: usize,
}

#[derive(Default)]
struct HashRunRouterStats {
    rows: usize,
    batches: usize,
    arrow_bytes: usize,
    hash_runs: usize,
    routed_messages: usize,
    routing_cpu: Duration,
    send_wait: Duration,
}

type HashRunRouterResult = tokio::task::JoinHandle<Result<HashRunRouterStats>>;

type HashRunWorkerResult =
    tokio::task::JoinHandle<Result<(HashMap<u64, RangeValue>, HashSet<i64>, SamplePartitionStats)>>;

#[inline]
fn hash_range_owner(hash: u64, target_partitions: usize) -> usize {
    debug_assert!(target_partitions > 0);
    (((hash as u128) * (target_partitions as u128)) >> u64::BITS) as usize
}

const STORAGE_HOUR_MICROS: i64 = 60 * 60 * 1_000_000;
const MAX_SERIES_FRAGMENT_HINT: usize = 24;
const MAX_INITIAL_SERIES_CAPACITY: usize = 2048;

fn series_fragment_hint(start: i64, end: i64, lookback: i64) -> usize {
    let query_start = start.saturating_sub(lookback);
    let duration = end.saturating_sub(query_start).max(0);
    let hourly_fragments = duration
        .saturating_add(STORAGE_HOUR_MICROS - 1)
        .div_euclid(STORAGE_HOUR_MICROS)
        .max(1);
    usize::try_from(hourly_fragments)
        .unwrap_or(1)
        .clamp(1, MAX_SERIES_FRAGMENT_HINT)
}

fn initial_series_capacity(
    first_run_len: usize,
    fragment_hint: usize,
    first_timestamp: i64,
    last_timestamp: i64,
    query_duration: i64,
) -> usize {
    let run_based = first_run_len.saturating_mul(fragment_hint.max(1));
    let interval_based = if first_run_len > 1 && last_timestamp > first_timestamp {
        let intervals = i64::try_from(first_run_len - 1).unwrap_or(i64::MAX);
        let sample_interval = (last_timestamp - first_timestamp)
            .div_euclid(intervals)
            .max(1);
        usize::try_from(
            query_duration
                .max(0)
                .saturating_add(sample_interval - 1)
                .div_euclid(sample_interval)
                .saturating_add(1),
        )
        .unwrap_or(MAX_INITIAL_SERIES_CAPACITY)
    } else {
        0
    };
    run_based
        .max(interval_based)
        .min(MAX_INITIAL_SERIES_CAPACITY.max(first_run_len))
}

/// Materialize the labels exposed to the query. The process-wide cache stores
/// only source labels, so raw-data queries add their synthetic hash label at
/// this boundary for both cache hits and freshly loaded labels.
fn with_hash_label(labels: Labels, hash: u64, include_hash_label: bool) -> Labels {
    if !include_hash_label {
        return labels;
    }
    let mut with_hash = Vec::with_capacity(labels.len() + 1);
    with_hash.push(Arc::new(Label {
        name: HASH_LABEL.to_string(),
        value: hash.to_string(),
    }));
    with_hash.extend(labels);
    with_hash
}

// Constants for optimization thresholds
const OPTIMIZATION_STEP_LOOKBACK_MULTIPLIER: i64 = 5;
const OPTIMIZATION_MAX_STEPS: i64 = 30;

#[allow(clippy::too_many_arguments)]
pub(super) async fn selector_load_data_from_datafusion(
    query_ctx: Arc<QueryContext>,
    ctx: SessionContext,
    schema: Arc<Schema>,
    selector: VectorSelector,
    label_selector: HashSet<String>,
    start: i64,
    end: i64,
    step: i64,
    lookback: i64,
    skip_labels: bool,
) -> Result<LoadedMetrics> {
    let start_time = std::time::Instant::now();
    let table_name = selector.name.as_ref().unwrap();

    let mut df_group = match ctx.table(table_name).await {
        Ok(v) => {
            // Optimization: When step > lookback, we don't need to load all data in
            // [start-lookback, end] Instead, we only need to load data windows around
            // each evaluation point
            let use_optimization = start != end
                && step > 0
                && step >= lookback * OPTIMIZATION_STEP_LOOKBACK_MULTIPLIER
                && (((end - start) / step) + 1) < OPTIMIZATION_MAX_STEPS;
            if use_optimization {
                let num_steps = ((end - start) / step) + 1;
                let eval_timestamps: Vec<i64> =
                    (0..num_steps).map(|i| start + (step * i)).collect();

                let mut conditions: Vec<Expr> = Vec::new();
                for &eval_ts in &eval_timestamps {
                    let window_start = eval_ts - lookback;
                    let window_end = eval_ts;

                    conditions.push(
                        col(TIMESTAMP_COL_NAME)
                            .gt_eq(lit(window_start))
                            .and(col(TIMESTAMP_COL_NAME).lt_eq(lit(window_end))),
                    );
                }

                let filters = disjunction(conditions).unwrap();
                v.filter(filters)?
            } else {
                // Need to include lookback window before start for the first evaluation point
                let query_start = start - lookback;
                v.filter(
                    col(TIMESTAMP_COL_NAME)
                        .gt_eq(lit(query_start))
                        .and(col(TIMESTAMP_COL_NAME).lt_eq(lit(end))),
                )?
            }
        }
        Err(_) => {
            return Ok(LoadedMetrics::Partitioned(Vec::new()));
        }
    };

    df_group = apply_matchers(df_group, &selector.matchers)?;

    match apply_label_selector(df_group, &schema, &label_selector) {
        Some(dataframe) => df_group = dataframe,
        None => return Ok(LoadedMetrics::Partitioned(Vec::new())),
    }

    // check if exemplars field is exists
    if query_ctx.query_exemplars {
        let schema = df_group.schema().as_arrow();
        if schema.field_with_name(EXEMPLARS_LABEL).is_err() {
            return Ok(LoadedMetrics::Partitioned(Vec::new()));
        }
    }

    // get label columns
    let mut label_col_names = df_group
        .schema()
        .fields()
        .iter()
        .filter_map(|field| {
            let name = field.name();
            if name == TIMESTAMP_COL_NAME || name == VALUE_LABEL || name == EXEMPLARS_LABEL {
                None
            } else {
                Some(name.to_string())
            }
        })
        .collect::<Vec<_>>();
    // sort labels to have a consistent order
    label_col_names.sort();

    // get hash & timestamp
    let start1 = std::time::Instant::now();
    let hash_field_type = schema.field_with_name(HASH_LABEL)?.data_type();
    let (metrics, timestamp_set) = if query_ctx.query_exemplars {
        load_exemplars_from_datafusion(
            &query_ctx.trace_id,
            hash_field_type,
            df_group.clone(),
            !skip_labels,
        )
        .await?
    } else {
        load_samples_from_datafusion(
            &query_ctx.trace_id,
            hash_field_type,
            df_group.clone(),
            !skip_labels,
            series_fragment_hint(start, end, lookback),
            end.saturating_sub(start.saturating_sub(lookback)),
        )
        .await?
    };
    let metrics_count = metrics.iter().map(HashMap::len).sum::<usize>();
    let sample_count = metrics
        .iter()
        .flat_map(HashMap::values)
        .map(|metric| metric.samples.len())
        .sum::<usize>();
    let sample_capacity_bytes = metrics
        .iter()
        .flat_map(HashMap::values)
        .map(|metric| metric.samples.capacity() * std::mem::size_of::<Sample>())
        .sum::<usize>();

    log::info!(
        "[trace_id: {}] load hashing and sample took: {:?}, metrics count: {}, sample count: {}, allocated sample bytes: {}, timestamp count: {}",
        query_ctx.trace_id,
        start1.elapsed(),
        metrics_count,
        sample_count,
        sample_capacity_bytes,
        timestamp_set.len(),
    );

    // The query provably discards all labels (e.g. `sum(rate(m[5m]))`), so
    // the label scan can be skipped entirely.
    if skip_labels {
        log::info!(
            "[trace_id: {}] skip loading labels: query drops all labels",
            query_ctx.trace_id,
        );
        return Ok(into_loaded_metrics(hash_field_type, metrics));
    }

    if metrics_count == 0 {
        return Ok(LoadedMetrics::Partitioned(Vec::new()));
    }

    let metrics = load_series_labels(
        &query_ctx,
        table_name,
        df_group,
        hash_field_type,
        &label_col_names,
        &timestamp_set,
        metrics,
    )
    .await?;

    log::info!(
        "[trace_id: {}] load data from datafusion took: {:?}",
        query_ctx.trace_id,
        start_time.elapsed(),
    );

    Ok(into_loaded_metrics(hash_field_type, metrics))
}

pub(super) async fn load_samples_from_datafusion(
    trace_id: &str,
    hash_field_type: &DataType,
    df: DataFrame,
    collect_timestamps: bool,
    series_fragment_hint: usize,
    series_query_duration: i64,
) -> Result<(PartitionedMetrics, HashSet<i64>)> {
    let ctx = Arc::new(df.task_ctx());
    let target_partitions = ctx.session_config().target_partitions();
    let plan = df
        .select_columns(&[TIMESTAMP_COL_NAME, HASH_LABEL, VALUE_LABEL])?
        .create_physical_plan()
        .await?;

    if hash_field_type == &DataType::UInt64 {
        return load_hash_sorted_samples(
            trace_id,
            plan,
            ctx,
            target_partitions,
            collect_timestamps,
            series_fragment_hint,
            series_query_duration,
        )
        .await;
    }

    let schema = plan.schema();
    let plan = Arc::new(RepartitionExec::try_new(
        plan,
        Partitioning::Hash(
            vec![Arc::new(Column::new_with_schema(HASH_LABEL, &schema)?)],
            target_partitions,
        ),
    )?);

    if config::get_config().common.print_key_sql {
        log::info!(
            "{}",
            config::meta::plan::generate_plan_string(trace_id, plan.as_ref())
        );
    }

    let streams = execute_stream_partitioned(plan.clone(), ctx)?;
    let output_partitions = streams.len();
    let mut tasks = Vec::with_capacity(streams.len());
    for mut stream in streams {
        let hash_field_type = hash_field_type.clone();
        let task: SampleTokioResult = tokio::task::spawn(async move {
            let mut metrics: HashMap<u64, RangeValue> = HashMap::new();
            let mut stats = SamplePartitionStats::default();
            loop {
                match stream.try_next().await {
                    Ok(Some(batch)) => {
                        stats.rows += batch.num_rows();
                        stats.batches += 1;
                        stats.arrow_bytes += batch.get_array_memory_size();
                        let builder_start = std::time::Instant::now();
                        let time_values = batch
                            .column_by_name(TIMESTAMP_COL_NAME)
                            .unwrap()
                            .as_any()
                            .downcast_ref::<Int64Array>()
                            .unwrap();
                        let value_values = batch
                            .column_by_name(VALUE_LABEL)
                            .unwrap()
                            .as_any()
                            .downcast_ref::<Float64Array>()
                            .unwrap();

                        if hash_field_type == DataType::UInt64 {
                            let hash_values = batch
                                .column_by_name(HASH_LABEL)
                                .unwrap()
                                .as_any()
                                .downcast_ref::<UInt64Array>()
                                .unwrap();
                            let mut run_start = 0;
                            while run_start < batch.num_rows() {
                                let hash = hash_values.value(run_start);
                                let mut run_end = run_start + 1;
                                while run_end < batch.num_rows()
                                    && hash_values.value(run_end) == hash
                                {
                                    run_end += 1;
                                }

                                // TSID-major input leaves long same-hash runs even after
                                // hash repartition. Do one map lookup per run instead of
                                // one lookup per physical sample row. This remains correct
                                // for fragmented or legacy input: shorter runs only reduce
                                // the optimization's hit rate.
                                let entry = metrics.entry(hash).or_insert_with(|| RangeValue {
                                    labels: vec![],
                                    samples: vec![],
                                    exemplars: None,
                                    time_window: None,
                                });
                                entry.samples.reserve(run_end - run_start);
                                entry.samples.extend((run_start..run_end).map(|row| {
                                    Sample::new(time_values.value(row), value_values.value(row))
                                }));
                                stats.hash_runs += 1;
                                run_start = run_end;
                            }
                        } else {
                            let hash_values = batch
                                .column_by_name(HASH_LABEL)
                                .unwrap()
                                .as_any()
                                .downcast_ref::<StringArray>()
                                .unwrap();
                            for i in 0..batch.num_rows() {
                                let timestamp = time_values.value(i);
                                let hash: u64 = gxhash::new().sum64(hash_values.value(i));
                                stats.hash_runs += 1;
                                let entry = metrics.entry(hash).or_insert_with(|| RangeValue {
                                    labels: vec![],
                                    samples: vec![],
                                    exemplars: None,
                                    time_window: None,
                                });
                                entry
                                    .samples
                                    .push(Sample::new(timestamp, value_values.value(i)));
                            }
                        }
                        stats.builder_cpu += builder_start.elapsed();
                    }
                    Ok(None) => break,
                    Err(e) => {
                        log::error!("load samples from datafusion execute stream Error: {e}");
                        return Err(e);
                    }
                }
            }
            let mut unique_timestamps = HashSet::new();
            if collect_timestamps {
                for metric in metrics.values() {
                    if let Some(max_timestamp) =
                        metric.samples.iter().map(|sample| sample.timestamp).max()
                    {
                        unique_timestamps.insert(max_timestamp);
                    }
                }
            }
            Ok((metrics, unique_timestamps, stats))
        });
        tasks.push(task);
    }

    let mut all_unique_timestamps = HashSet::new();
    let mut metrics = Vec::with_capacity(tasks.len());
    let mut total_stats = SamplePartitionStats::default();
    let mut max_partition_builder_cpu = Duration::ZERO;
    for task in tasks {
        let (partition, timestamps, stats) = task
            .await
            .map_err(|e| DataFusionError::Execution(e.to_string()))??;
        all_unique_timestamps.extend(timestamps);
        metrics.push(partition);
        total_stats.rows += stats.rows;
        total_stats.batches += stats.batches;
        total_stats.arrow_bytes += stats.arrow_bytes;
        total_stats.hash_runs += stats.hash_runs;
        total_stats.builder_cpu += stats.builder_cpu;
        max_partition_builder_cpu = max_partition_builder_cpu.max(stats.builder_cpu);
    }

    log::info!(
        "[trace_id: {trace_id}] promql->load-series: post-repartition partitions: {output_partitions}, batches: {}, rows: {}, Arrow array bytes: {}, contiguous hash runs: {}, rows per hash lookup: {:.2}, builder CPU: {:?}, max partition builder CPU: {:?}",
        total_stats.batches,
        total_stats.rows,
        total_stats.arrow_bytes,
        total_stats.hash_runs,
        total_stats.rows as f64 / total_stats.hash_runs.max(1) as f64,
        total_stats.builder_cpu,
        max_partition_builder_cpu,
    );
    log::info!(
        "[trace_id: {trace_id}] promql->load-series: DataFusion physical metrics:\n{}",
        DisplayableExecutionPlan::with_metrics(plan.as_ref())
            .set_show_statistics(false)
            .indent(false),
    );

    Ok((metrics, all_unique_timestamps))
}

/// Repartition TSID-major UInt64 samples into contiguous raw-hash ranges.
///
/// Each scan partition identifies contiguous hash runs and routes shared Arrow
/// batches to bounded owner channels. Owner workers build the final series map
/// directly. Hash-sorted batches normally produce one contiguous slice per
/// owner instead of broadcasting every batch to nearly every randomized hash
/// owner. The same hash always has the same range owner, including when a
/// series spans batches, files, or hours.
async fn load_hash_sorted_samples(
    trace_id: &str,
    plan: Arc<dyn datafusion::physical_plan::ExecutionPlan>,
    ctx: Arc<datafusion::execution::TaskContext>,
    target_partitions: usize,
    collect_timestamps: bool,
    series_fragment_hint: usize,
    series_query_duration: i64,
) -> Result<(PartitionedMetrics, HashSet<i64>)> {
    let streams = execute_stream_partitioned(plan.clone(), ctx)?;
    let input_partitions = streams.len();
    let channel_capacity = input_partitions.max(2);
    let mut senders = Vec::with_capacity(target_partitions);
    let mut worker_tasks = Vec::with_capacity(target_partitions);

    for _owner in 0..target_partitions {
        let (sender, mut receiver) =
            tokio::sync::mpsc::channel::<RoutedOwnerBatch>(channel_capacity);
        senders.push(sender);
        let task: HashRunWorkerResult =
            tokio::task::spawn(async move {
                let mut metrics: HashMap<u64, RangeValue> = HashMap::new();
                let mut stats = SamplePartitionStats::default();

                while let Some(message) = receiver.recv().await {
                    let builder_start = std::time::Instant::now();
                    let batch = message.batch;
                    let time_values = batch
                        .timestamps
                        .as_any()
                        .downcast_ref::<Int64Array>()
                        .unwrap();
                    let value_values = batch
                        .values
                        .as_any()
                        .downcast_ref::<Float64Array>()
                        .unwrap();

                    stats.batches += 1;
                    for run in &batch.runs[message.run_start..message.run_end] {
                        let run_len = run.end - run.start;
                        let entry = match metrics.entry(run.hash) {
                            hashbrown::hash_map::Entry::Occupied(entry) => entry.into_mut(),
                            hashbrown::hash_map::Entry::Vacant(entry) => {
                                let capacity = initial_series_capacity(
                                    run_len,
                                    series_fragment_hint,
                                    time_values.value(run.start),
                                    time_values.value(run.end - 1),
                                    series_query_duration,
                                );
                                stats.series_created += 1;
                                stats.initial_preallocated_slots += capacity;
                                entry.insert(RangeValue {
                                    labels: vec![],
                                    samples: Vec::with_capacity(capacity),
                                    exemplars: None,
                                    time_window: None,
                                })
                            }
                        };
                        let capacity_before = entry.samples.capacity();
                        entry.samples.reserve(run_len);
                        if entry.samples.capacity() > capacity_before {
                            stats.additional_vector_growths += 1;
                        }
                        entry.samples.extend((run.start..run.end).map(|row| {
                            Sample::new(time_values.value(row), value_values.value(row))
                        }));
                        stats.rows += run.end - run.start;
                        stats.hash_runs += 1;
                    }
                    stats.builder_cpu += builder_start.elapsed();
                }

                let mut unique_timestamps = HashSet::new();
                if collect_timestamps {
                    for metric in metrics.values() {
                        if let Some(max_timestamp) =
                            metric.samples.iter().map(|sample| sample.timestamp).max()
                        {
                            unique_timestamps.insert(max_timestamp);
                        }
                    }
                }
                Ok((metrics, unique_timestamps, stats))
            });
        worker_tasks.push(task);
    }

    let mut router_tasks = Vec::with_capacity(input_partitions);
    for mut stream in streams {
        let senders = senders.clone();
        let task: HashRunRouterResult = tokio::task::spawn(async move {
            let mut stats = HashRunRouterStats::default();
            while let Some(batch) = stream.try_next().await? {
                stats.rows += batch.num_rows();
                stats.batches += 1;
                stats.arrow_bytes += batch.get_array_memory_size();

                let routing_start = std::time::Instant::now();
                let hash_values = batch
                    .column_by_name(HASH_LABEL)
                    .unwrap()
                    .as_any()
                    .downcast_ref::<UInt64Array>()
                    .unwrap();
                let mut runs = Vec::new();
                let mut owner_segments = Vec::new();
                let mut segment_owner = None;
                let mut segment_start = 0;
                let mut run_start = 0;
                while run_start < batch.num_rows() {
                    let hash = hash_values.value(run_start);
                    let mut run_end = run_start + 1;
                    while run_end < batch.num_rows() && hash_values.value(run_end) == hash {
                        run_end += 1;
                    }
                    let owner = hash_range_owner(hash, target_partitions);
                    if segment_owner != Some(owner) {
                        if let Some(previous_owner) = segment_owner {
                            owner_segments.push((previous_owner, segment_start, runs.len()));
                        }
                        segment_owner = Some(owner);
                        segment_start = runs.len();
                    }
                    runs.push(RoutedHashRun {
                        hash,
                        start: run_start,
                        end: run_end,
                    });
                    run_start = run_end;
                }
                if let Some(owner) = segment_owner {
                    owner_segments.push((owner, segment_start, runs.len()));
                }
                stats.hash_runs += runs.len();
                let routed_batch = Arc::new(RoutedSampleBatch {
                    timestamps: batch.column_by_name(TIMESTAMP_COL_NAME).unwrap().clone(),
                    values: batch.column_by_name(VALUE_LABEL).unwrap().clone(),
                    runs,
                });
                stats.routing_cpu += routing_start.elapsed();

                for (owner, run_start, run_end) in owner_segments {
                    let send_start = std::time::Instant::now();
                    senders[owner]
                        .send(RoutedOwnerBatch {
                            batch: Arc::clone(&routed_batch),
                            run_start,
                            run_end,
                        })
                        .await
                        .map_err(|_| {
                            DataFusionError::Execution(
                                "hash-range owner worker closed before routing completed"
                                    .to_string(),
                            )
                        })?;
                    stats.send_wait += send_start.elapsed();
                    stats.routed_messages += 1;
                }
            }
            Ok(stats)
        });
        router_tasks.push(task);
    }
    drop(senders);

    let mut router_stats = HashRunRouterStats::default();
    let mut max_router_cpu = Duration::ZERO;
    for task in router_tasks {
        let stats = task
            .await
            .map_err(|error| DataFusionError::Execution(error.to_string()))??;
        router_stats.rows += stats.rows;
        router_stats.batches += stats.batches;
        router_stats.arrow_bytes += stats.arrow_bytes;
        router_stats.hash_runs += stats.hash_runs;
        router_stats.routed_messages += stats.routed_messages;
        router_stats.routing_cpu += stats.routing_cpu;
        router_stats.send_wait += stats.send_wait;
        max_router_cpu = max_router_cpu.max(stats.routing_cpu);
    }

    let mut metrics = Vec::with_capacity(target_partitions);
    let mut all_unique_timestamps = HashSet::new();
    let mut worker_stats = SamplePartitionStats::default();
    let mut max_worker_cpu = Duration::ZERO;
    for task in worker_tasks {
        let (owner_metrics, timestamps, stats) = task
            .await
            .map_err(|error| DataFusionError::Execution(error.to_string()))??;
        all_unique_timestamps.extend(timestamps);
        metrics.push(owner_metrics);
        worker_stats.rows += stats.rows;
        worker_stats.batches += stats.batches;
        worker_stats.hash_runs += stats.hash_runs;
        worker_stats.builder_cpu += stats.builder_cpu;
        worker_stats.series_created += stats.series_created;
        worker_stats.initial_preallocated_slots += stats.initial_preallocated_slots;
        worker_stats.additional_vector_growths += stats.additional_vector_growths;
        max_worker_cpu = max_worker_cpu.max(stats.builder_cpu);
    }

    log::info!(
        "[trace_id: {trace_id}] promql->load-series: hash-range repartition input partitions: {input_partitions}, output owners: {target_partitions}, input batches: {}, rows: {}, Arrow array bytes: {}, source hash runs: {}, rows per routing decision: {:.2}, routed owner messages: {}, routing CPU: {:?}, max router CPU: {:?}, channel send wait: {:?}, owner messages: {}, owner hash runs: {}, builder CPU: {:?}, max owner builder CPU: {:?}, series created: {}, capacity fragment hint: {series_fragment_hint}, capacity query duration micros: {series_query_duration}, initial preallocated slots: {}, additional vector growths: {}",
        router_stats.batches,
        router_stats.rows,
        router_stats.arrow_bytes,
        router_stats.hash_runs,
        router_stats.rows as f64 / router_stats.hash_runs.max(1) as f64,
        router_stats.routed_messages,
        router_stats.routing_cpu,
        max_router_cpu,
        router_stats.send_wait,
        worker_stats.batches,
        worker_stats.hash_runs,
        worker_stats.builder_cpu,
        max_worker_cpu,
        worker_stats.series_created,
        worker_stats.initial_preallocated_slots,
        worker_stats.additional_vector_growths,
    );
    log::info!(
        "[trace_id: {trace_id}] promql->load-series: hash-run input DataFusion physical metrics:\n{}",
        DisplayableExecutionPlan::with_metrics(plan.as_ref())
            .set_show_statistics(false)
            .indent(false),
    );

    Ok((metrics, all_unique_timestamps))
}

async fn load_exemplars_from_datafusion(
    trace_id: &str,
    hash_field_type: &DataType,
    df: DataFrame,
    collect_timestamps: bool,
) -> Result<(PartitionedMetrics, HashSet<i64>)> {
    let ctx = Arc::new(df.task_ctx());
    let target_partitions = ctx.session_config().target_partitions();
    let plan = df
        .filter(col(EXEMPLARS_LABEL).is_not_null())?
        .select_columns(&[HASH_LABEL, EXEMPLARS_LABEL])?
        .create_physical_plan()
        .await?;
    if hash_field_type == &DataType::UInt64 {
        return load_hash_range_exemplars(
            trace_id,
            plan,
            ctx,
            target_partitions,
            collect_timestamps,
        )
        .await;
    }
    let schema = plan.schema();
    let plan = Arc::new(RepartitionExec::try_new(
        plan,
        Partitioning::Hash(
            vec![Arc::new(Column::new_with_schema(HASH_LABEL, &schema)?)],
            target_partitions,
        ),
    )?);

    if config::get_config().common.print_key_sql {
        log::info!(
            "{}",
            config::meta::plan::generate_plan_string(trace_id, plan.as_ref())
        );
    }

    let streams = execute_stream_partitioned(plan, ctx)?;
    let mut tasks = Vec::with_capacity(streams.len());
    for mut stream in streams {
        let hash_field_type = hash_field_type.clone();
        let task: TokioResult = tokio::task::spawn(async move {
            let mut metrics: HashMap<u64, RangeValue> = HashMap::new();
            loop {
                match stream.try_next().await {
                    Ok(Some(batch)) => {
                        let exemplars_values = batch
                            .column_by_name(EXEMPLARS_LABEL)
                            .unwrap()
                            .as_any()
                            .downcast_ref::<StringArray>()
                            .unwrap();
                        if hash_field_type == DataType::UInt64 {
                            let hash_values = batch
                                .column_by_name(HASH_LABEL)
                                .unwrap()
                                .as_any()
                                .downcast_ref::<UInt64Array>()
                                .unwrap();
                            for i in 0..batch.num_rows() {
                                let hash: u64 = hash_values.value(i);
                                let exemplar = exemplars_values.value(i);
                                if let Ok(exemplars) = json::from_str::<Vec<json::Value>>(exemplar)
                                {
                                    let entry = metrics.entry(hash).or_insert_with(|| RangeValue {
                                        labels: vec![],
                                        samples: vec![],
                                        exemplars: Some(vec![]),
                                        time_window: None,
                                    });
                                    let entry = entry.exemplars.as_mut().unwrap();
                                    for exemplar in exemplars {
                                        if let Some(exemplar) = exemplar.as_object() {
                                            entry.push(Arc::new(Exemplar::from(exemplar)));
                                        }
                                    }
                                }
                            }
                        } else {
                            let hash_values = batch
                                .column_by_name(HASH_LABEL)
                                .unwrap()
                                .as_any()
                                .downcast_ref::<StringArray>()
                                .unwrap();
                            for i in 0..batch.num_rows() {
                                let hash: u64 = gxhash::new().sum64(hash_values.value(i));
                                let exemplar = exemplars_values.value(i);
                                if let Ok(exemplars) = json::from_str::<Vec<json::Value>>(exemplar)
                                {
                                    let entry = metrics.entry(hash).or_insert_with(|| RangeValue {
                                        labels: vec![],
                                        samples: vec![],
                                        exemplars: Some(vec![]),
                                        time_window: None,
                                    });
                                    let entry = entry.exemplars.as_mut().unwrap();
                                    for exemplar in exemplars {
                                        if let Some(exemplar) = exemplar.as_object() {
                                            entry.push(Arc::new(Exemplar::from(exemplar)));
                                        }
                                    }
                                }
                            }
                        }
                    }
                    Ok(None) => break,
                    Err(e) => {
                        log::error!("load exemplars from datafusion execute stream Error: {e}");
                        return Err(e);
                    }
                }
            }
            let mut unique_timestamps = HashSet::new();
            if collect_timestamps {
                for metric in metrics.values() {
                    if let Some(max_timestamp) = metric.exemplars.as_ref().and_then(|exemplars| {
                        exemplars.iter().map(|exemplar| exemplar.timestamp).max()
                    }) {
                        unique_timestamps.insert(max_timestamp);
                    }
                }
            }
            Ok((metrics, unique_timestamps))
        });
        tasks.push(task);
    }

    let mut all_unique_timestamps = HashSet::new();
    let mut metrics = Vec::with_capacity(tasks.len());
    for task in tasks {
        let (partition, timestamps) = task
            .await
            .map_err(|e| DataFusionError::Execution(e.to_string()))??;
        all_unique_timestamps.extend(timestamps);
        metrics.push(partition);
    }

    Ok((metrics, all_unique_timestamps))
}

struct RoutedExemplarBatch {
    batch: Arc<RecordBatch>,
    start: usize,
    end: usize,
}

async fn load_hash_range_exemplars(
    trace_id: &str,
    plan: Arc<dyn datafusion::physical_plan::ExecutionPlan>,
    ctx: Arc<datafusion::execution::TaskContext>,
    target_partitions: usize,
    collect_timestamps: bool,
) -> Result<(PartitionedMetrics, HashSet<i64>)> {
    let streams = execute_stream_partitioned(Arc::clone(&plan), ctx)?;
    let input_partitions = streams.len();
    let channel_capacity = input_partitions.max(2);
    let mut senders = Vec::with_capacity(target_partitions);
    let mut worker_tasks = Vec::with_capacity(target_partitions);

    for _owner in 0..target_partitions {
        let (sender, mut receiver) =
            tokio::sync::mpsc::channel::<RoutedExemplarBatch>(channel_capacity);
        senders.push(sender);
        worker_tasks.push(tokio::task::spawn(async move {
            let mut metrics: HashMap<u64, RangeValue> = HashMap::new();
            while let Some(message) = receiver.recv().await {
                let hash_values = message
                    .batch
                    .column_by_name(HASH_LABEL)
                    .unwrap()
                    .as_any()
                    .downcast_ref::<UInt64Array>()
                    .unwrap();
                let exemplar_values = message
                    .batch
                    .column_by_name(EXEMPLARS_LABEL)
                    .unwrap()
                    .as_any()
                    .downcast_ref::<StringArray>()
                    .unwrap();
                for row in message.start..message.end {
                    let hash = hash_values.value(row);
                    let exemplar = exemplar_values.value(row);
                    if let Ok(exemplars) = json::from_str::<Vec<json::Value>>(exemplar) {
                        let entry = metrics.entry(hash).or_insert_with(|| RangeValue {
                            labels: vec![],
                            samples: vec![],
                            exemplars: Some(vec![]),
                            time_window: None,
                        });
                        let entry = entry.exemplars.as_mut().unwrap();
                        for exemplar in exemplars {
                            if let Some(exemplar) = exemplar.as_object() {
                                entry.push(Arc::new(Exemplar::from(exemplar)));
                            }
                        }
                    }
                }
            }
            let mut unique_timestamps = HashSet::new();
            if collect_timestamps {
                for metric in metrics.values() {
                    if let Some(max_timestamp) = metric.exemplars.as_ref().and_then(|exemplars| {
                        exemplars.iter().map(|exemplar| exemplar.timestamp).max()
                    }) {
                        unique_timestamps.insert(max_timestamp);
                    }
                }
            }
            Ok::<_, DataFusionError>((metrics, unique_timestamps))
        }));
    }

    let mut router_tasks = Vec::with_capacity(input_partitions);
    for mut stream in streams {
        let senders = senders.clone();
        router_tasks.push(tokio::task::spawn(async move {
            let mut messages = 0_usize;
            while let Some(batch) = stream.try_next().await? {
                if batch.num_rows() == 0 {
                    continue;
                }
                let hash_values = batch
                    .column_by_name(HASH_LABEL)
                    .unwrap()
                    .as_any()
                    .downcast_ref::<UInt64Array>()
                    .unwrap();
                let mut segments = Vec::new();
                let mut segment_start = 0;
                let mut segment_owner = hash_range_owner(hash_values.value(0), target_partitions);
                for row in 1..batch.num_rows() {
                    let owner = hash_range_owner(hash_values.value(row), target_partitions);
                    if owner != segment_owner {
                        segments.push((segment_owner, segment_start, row));
                        segment_owner = owner;
                        segment_start = row;
                    }
                }
                segments.push((segment_owner, segment_start, batch.num_rows()));
                let batch = Arc::new(batch);
                for (owner, start, end) in segments {
                    senders[owner]
                        .send(RoutedExemplarBatch {
                            batch: Arc::clone(&batch),
                            start,
                            end,
                        })
                        .await
                        .map_err(|_| {
                            DataFusionError::Execution(
                                "hash-range exemplar owner closed before routing completed"
                                    .to_string(),
                            )
                        })?;
                    messages += 1;
                }
            }
            Ok::<_, DataFusionError>(messages)
        }));
    }
    drop(senders);

    let mut routed_messages = 0;
    for task in router_tasks {
        routed_messages += task
            .await
            .map_err(|error| DataFusionError::Execution(error.to_string()))??;
    }
    let mut metrics = Vec::with_capacity(target_partitions);
    let mut all_unique_timestamps = HashSet::new();
    for task in worker_tasks {
        let (owner_metrics, timestamps) = task
            .await
            .map_err(|error| DataFusionError::Execution(error.to_string()))??;
        metrics.push(owner_metrics);
        all_unique_timestamps.extend(timestamps);
    }
    log::info!(
        "[trace_id: {trace_id}] promql->load-exemplars: hash-range input partitions: {input_partitions}, output owners: {target_partitions}, routed owner messages: {routed_messages}",
    );
    Ok((metrics, all_unique_timestamps))
}

fn merge_partitioned_metrics(partitions: PartitionedMetrics) -> HashMap<u64, RangeValue> {
    let metrics_count = partitions.iter().map(HashMap::len).sum();
    let mut metrics = HashMap::with_capacity(metrics_count);
    for partition in partitions {
        metrics.extend(partition);
    }
    metrics
}

fn into_loaded_metrics(
    hash_field_type: &DataType,
    partitions: PartitionedMetrics,
) -> LoadedMetrics {
    if hash_field_type == &DataType::UInt64 {
        LoadedMetrics::Partitioned(partitions)
    } else {
        LoadedMetrics::Merged(merge_partitioned_metrics(partitions))
    }
}

#[cfg(test)]
mod tests {
    use datafusion::{
        arrow::{
            array::{Float64Array, Int64Array, StringArray, UInt64Array},
            datatypes::{Field, Schema},
            record_batch::RecordBatch,
        },
        prelude::{SessionConfig, SessionContext},
    };

    use super::*;

    #[test]
    fn test_hash_range_owner_uses_contiguous_unsigned_ranges() {
        assert_eq!(hash_range_owner(0, 4), 0);
        assert_eq!(hash_range_owner((1_u64 << 62) - 1, 4), 0);
        assert_eq!(hash_range_owner(1_u64 << 62, 4), 1);
        assert_eq!(hash_range_owner(1_u64 << 63, 4), 2);
        assert_eq!(hash_range_owner(u64::MAX, 4), 3);
    }

    #[test]
    fn test_series_fragment_and_capacity_hints_are_bounded() {
        let hour = STORAGE_HOUR_MICROS;
        assert_eq!(
            series_fragment_hint(8 * hour, 11 * hour, 5 * 60 * 1_000_000),
            4
        );
        assert_eq!(series_fragment_hint(8 * hour, 8 * hour, 0), 1);
        assert_eq!(
            series_fragment_hint(0, 100 * hour, 0),
            MAX_SERIES_FRAGMENT_HINT,
        );

        assert_eq!(initial_series_capacity(160, 4, 0, 0, 0), 640);
        assert_eq!(
            initial_series_capacity(100, 4, 0, 99 * 15 * 1_000_000, 11_100 * 1_000_000,),
            741,
        );
        assert_eq!(initial_series_capacity(1024, 4, 0, 0, 0), 2048);
        assert_eq!(initial_series_capacity(4096, 4, 0, 0, 0), 4096);
    }

    #[test]
    fn test_into_loaded_metrics_only_keeps_uint64_hashes_partitioned() {
        let partitions = vec![HashMap::from([(11, RangeValue::default())])];
        assert!(matches!(
            into_loaded_metrics(&DataType::UInt64, partitions),
            LoadedMetrics::Partitioned(_)
        ));

        let partitions = vec![HashMap::from([(11, RangeValue::default())])];
        assert!(matches!(
            into_loaded_metrics(&DataType::Utf8, partitions),
            LoadedMetrics::Merged(_)
        ));
    }

    #[tokio::test]
    async fn test_load_samples_returns_max_timestamp_per_series() {
        let schema = Arc::new(Schema::new(vec![
            Field::new(TIMESTAMP_COL_NAME, DataType::Int64, false),
            Field::new(HASH_LABEL, DataType::UInt64, false),
            Field::new(VALUE_LABEL, DataType::Float64, false),
        ]));
        let batch = RecordBatch::try_new(
            schema,
            vec![
                Arc::new(Int64Array::from(vec![100, 200, 150])),
                Arc::new(UInt64Array::from(vec![11, 11, 22])),
                Arc::new(Float64Array::from(vec![1.0, 2.0, 3.0])),
            ],
        )
        .unwrap();
        let ctx = SessionContext::new_with_config(SessionConfig::new().with_target_partitions(4));
        let df = ctx.read_batch(batch).unwrap();

        let (metrics_without_timestamps, skipped_timestamps) =
            load_samples_from_datafusion("test", &DataType::UInt64, df.clone(), false, 1, 0)
                .await
                .unwrap();
        assert!(skipped_timestamps.is_empty());
        assert_eq!(metrics_without_timestamps.len(), 4);
        let metrics_without_timestamps = merge_partitioned_metrics(metrics_without_timestamps);
        assert_eq!(metrics_without_timestamps[&11].samples.len(), 2);

        let (metrics, timestamps) =
            load_samples_from_datafusion("test", &DataType::UInt64, df, true, 1, 0)
                .await
                .unwrap();
        let metrics = merge_partitioned_metrics(metrics);

        assert_eq!(timestamps, HashSet::from([150, 200]));
        assert_eq!(metrics[&11].samples.len(), 2);
        assert_eq!(metrics[&22].samples.len(), 1);
    }

    #[tokio::test]
    async fn test_hash_range_repartition_merges_cross_batch_fragments_into_one_owner() {
        let schema = Arc::new(Schema::new(vec![
            Field::new(TIMESTAMP_COL_NAME, DataType::Int64, false),
            Field::new(HASH_LABEL, DataType::UInt64, false),
            Field::new(VALUE_LABEL, DataType::Float64, false),
        ]));
        let make_batch = |timestamps: Vec<i64>, hashes: Vec<u64>, values: Vec<f64>| {
            RecordBatch::try_new(
                Arc::clone(&schema),
                vec![
                    Arc::new(Int64Array::from(timestamps)),
                    Arc::new(UInt64Array::from(hashes)),
                    Arc::new(Float64Array::from(values)),
                ],
            )
            .unwrap()
        };
        let batches = vec![
            make_batch(vec![100, 200, 100], vec![11, 11, 22], vec![1.0, 2.0, 3.0]),
            make_batch(vec![300, 200, 300], vec![11, 22, 22], vec![4.0, 5.0, 6.0]),
        ];
        let ctx = SessionContext::new_with_config(
            SessionConfig::new()
                .with_target_partitions(4)
                .with_batch_size(3),
        );
        let df = ctx.read_batches(batches).unwrap();

        let (partitions, _) =
            load_samples_from_datafusion("test", &DataType::UInt64, df, false, 1, 0)
                .await
                .unwrap();

        assert_eq!(partitions.len(), 4);
        assert_eq!(
            partitions[hash_range_owner(11, partitions.len())][&11]
                .samples
                .iter()
                .map(|sample| sample.timestamp)
                .collect::<Vec<_>>(),
            vec![100, 200, 300],
        );
        assert_eq!(
            partitions[hash_range_owner(22, partitions.len())][&22]
                .samples
                .iter()
                .map(|sample| sample.timestamp)
                .collect::<Vec<_>>(),
            vec![100, 200, 300],
        );
        assert_eq!(partitions.iter().map(HashMap::len).sum::<usize>(), 2,);
    }

    #[tokio::test]
    async fn test_load_exemplars_returns_max_timestamp_per_series() {
        let high_hash = 1_u64 << 63;
        let schema = Arc::new(Schema::new(vec![
            Field::new(HASH_LABEL, DataType::UInt64, false),
            Field::new(EXEMPLARS_LABEL, DataType::Utf8, false),
        ]));
        let batch = RecordBatch::try_new(
            schema,
            vec![
                Arc::new(UInt64Array::from(vec![11, 11, high_hash])),
                Arc::new(StringArray::from(vec![
                    r#"[{"_timestamp":100,"value":1.0}]"#,
                    r#"[{"_timestamp":200,"value":2.0}]"#,
                    r#"[{"_timestamp":150,"value":3.0}]"#,
                ])),
            ],
        )
        .unwrap();
        let ctx = SessionContext::new_with_config(SessionConfig::new().with_target_partitions(4));
        let df = ctx.read_batch(batch).unwrap();

        let (metrics_without_timestamps, skipped_timestamps) =
            load_exemplars_from_datafusion("test", &DataType::UInt64, df.clone(), false)
                .await
                .unwrap();
        assert!(skipped_timestamps.is_empty());
        assert_eq!(metrics_without_timestamps.len(), 4);
        assert!(metrics_without_timestamps[hash_range_owner(11, 4)].contains_key(&11));
        assert!(
            metrics_without_timestamps[hash_range_owner(high_hash, 4)].contains_key(&high_hash)
        );
        let metrics_without_timestamps = merge_partitioned_metrics(metrics_without_timestamps);
        assert_eq!(
            metrics_without_timestamps[&11]
                .exemplars
                .as_ref()
                .unwrap()
                .len(),
            2
        );

        let (metrics, timestamps) =
            load_exemplars_from_datafusion("test", &DataType::UInt64, df, true)
                .await
                .unwrap();
        let metrics = merge_partitioned_metrics(metrics);

        assert_eq!(timestamps, HashSet::from([150, 200]));
        assert_eq!(metrics[&11].exemplars.as_ref().unwrap().len(), 2);
        assert_eq!(metrics[&high_hash].exemplars.as_ref().unwrap().len(), 1);
    }
}
