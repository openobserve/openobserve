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
mod series_capacity;

use std::{borrow::Cow, sync::Arc};

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
        array::{Array, AsArray, RecordBatch},
        datatypes::{DataType, Float64Type, Int64Type, Schema, UInt64Type},
    },
    error::{DataFusionError, Result},
    logical_expr::utils::disjunction,
    physical_plan::{
        Partitioning, execute_stream_partitioned, expressions::Column, repartition::RepartitionExec,
    },
    prelude::{DataFrame, Expr, SessionContext, col, lit},
};
use futures::TryStreamExt;
use hashbrown::{HashMap, HashSet, hash_map::Entry};
use promql_parser::parser::VectorSelector;

use self::{
    labels::load_series_labels,
    series_capacity::{initial_series_capacity, series_fragment_hint},
};
pub(crate) use self::{load_labels::LabelColumn, series_capacity::batch_run_len};
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

/// Restricts `df` to the rows the evaluation can observe: per-step lookback
/// windows when the steps are sparse enough, the contiguous
/// `[start - lookback, end]` range otherwise.
pub(crate) fn apply_time_window(
    df: DataFrame,
    start: i64,
    end: i64,
    step: i64,
    lookback: i64,
) -> Result<DataFrame> {
    // Optimization: When step > lookback, we don't need to load all data in
    // [start-lookback, end] Instead, we only need to load data windows around
    // each evaluation point
    let use_optimization = start != end
        && step > 0
        && step >= lookback * OPTIMIZATION_STEP_LOOKBACK_MULTIPLIER
        && (((end - start) / step) + 1) < OPTIMIZATION_MAX_STEPS;
    if use_optimization {
        let num_steps = ((end - start) / step) + 1;
        let eval_timestamps: Vec<i64> = (0..num_steps).map(|i| start + (step * i)).collect();

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
        df.filter(filters)
    } else {
        // Need to include lookback window before start for the first evaluation point
        let query_start = start - lookback;
        df.filter(
            col(TIMESTAMP_COL_NAME)
                .gt_eq(lit(query_start))
                .and(col(TIMESTAMP_COL_NAME).lt_eq(lit(end))),
        )
    }
}

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
        Ok(v) => apply_time_window(v, start, end, step, lookback)?,
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
        let query_duration = end.saturating_sub(start.saturating_sub(lookback));
        load_samples_from_datafusion(
            &query_ctx.trace_id,
            hash_field_type,
            df_group.clone(),
            !skip_labels,
            series_fragment_hint(query_duration),
            query_duration,
        )
        .await?
    };
    let metrics_count = metrics.iter().map(HashMap::len).sum::<usize>();

    log::info!(
        "[trace_id: {}] load hashing and sample took: {:?}, metrics count: {}, timestamp count: {}",
        query_ctx.trace_id,
        start1.elapsed(),
        metrics_count,
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
    fragment_hint: usize,
    query_duration: i64,
) -> Result<(PartitionedMetrics, HashSet<i64>)> {
    let ctx = Arc::new(df.task_ctx());
    let target_partitions = ctx.session_config().target_partitions();
    let plan = df
        .select_columns(&[TIMESTAMP_COL_NAME, HASH_LABEL, VALUE_LABEL])?
        .create_physical_plan()
        .await?;
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
                        let time_values = batch[TIMESTAMP_COL_NAME].as_primitive::<Int64Type>();
                        let value_values = batch[VALUE_LABEL].as_primitive::<Float64Type>();

                        let hashes = batch_hash_values(&batch, &hash_field_type);
                        append_batch_samples(
                            &mut metrics,
                            &hashes,
                            time_values.values(),
                            value_values.values(),
                            fragment_hint,
                            query_duration,
                        );
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

fn append_batch_samples(
    metrics: &mut HashMap<u64, RangeValue>,
    hashes: &[u64],
    timestamps: &[i64],
    values: &[f64],
    fragment_hint: usize,
    query_duration: i64,
) {
    let mut i = 0;
    while i < hashes.len() {
        let run_len = batch_run_len(hashes, i);
        let entry = match metrics.entry(hashes[i]) {
            Entry::Occupied(entry) => entry.into_mut(),
            Entry::Vacant(entry) => {
                let capacity = initial_series_capacity(
                    run_len,
                    fragment_hint,
                    timestamps[i],
                    timestamps[i + run_len - 1],
                    query_duration,
                );
                entry.insert(RangeValue {
                    labels: vec![],
                    samples: Vec::with_capacity(capacity),
                    exemplars: None,
                    time_window: None,
                })
            }
        };
        entry.samples.extend(
            timestamps[i..i + run_len]
                .iter()
                .zip(&values[i..i + run_len])
                .map(|(&timestamp, &value)| Sample::new(timestamp, value)),
        );
        i += run_len;
    }
}

/// The hash column as u64 values: zero-copy for UInt64, hashed per row for
/// Utf8.
fn batch_hash_values<'a>(batch: &'a RecordBatch, hash_field_type: &DataType) -> Cow<'a, [u64]> {
    if *hash_field_type == DataType::UInt64 {
        let hash_values = batch[HASH_LABEL].as_primitive::<UInt64Type>();
        Cow::Borrowed(hash_values.values().as_ref())
    } else {
        let hash_values = batch[HASH_LABEL].as_string::<i32>();
        let mut hasher = gxhash::new();
        Cow::Owned(
            (0..hash_values.len())
                .map(|i| hasher.sum64(hash_values.value(i)))
                .collect(),
        )
    }
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
                        let exemplars_values = batch[EXEMPLARS_LABEL].as_string::<i32>();
                        let hashes = batch_hash_values(&batch, &hash_field_type);
                        for (i, &hash) in hashes.iter().enumerate() {
                            let exemplar = exemplars_values.value(i);
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
    async fn test_load_exemplars_returns_max_timestamp_per_series() {
        let schema = Arc::new(Schema::new(vec![
            Field::new(HASH_LABEL, DataType::UInt64, false),
            Field::new(EXEMPLARS_LABEL, DataType::Utf8, false),
        ]));
        let batch = RecordBatch::try_new(
            schema,
            vec![
                Arc::new(UInt64Array::from(vec![11, 11, 22])),
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
        assert_eq!(metrics[&22].exemplars.as_ref().unwrap().len(), 1);
    }
}
