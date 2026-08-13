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

use config::{
    TIMESTAMP_COL_NAME,
    meta::promql::{
        HASH_LABEL,
        value::{Label, Labels, QueryContext, RangeValue},
    },
    utils::hash::{Sum64, gxhash},
};
use datafusion::{
    arrow::{
        array::{Array, StringArray, StringViewArray, UInt64Array},
        datatypes::DataType,
    },
    error::{DataFusionError, Result},
    physical_plan::{
        Partitioning, execute_stream_partitioned, expressions::Column, repartition::RepartitionExec,
    },
    prelude::{DataFrame, col, lit},
};
use futures::TryStreamExt;
use hashbrown::{HashMap, HashSet};
use rayon::iter::{IntoParallelRefMutIterator, ParallelIterator};

use super::{
    label_cache::{self, CacheMisses},
    selector_loader::PartitionedMetrics,
};

type TokioLabelsResult = tokio::task::JoinHandle<Result<HashMap<u64, RangeValue>>>;

const MAX_HASH_INLIST_FILTER: usize = 8192;
const LABEL_INTERNER_OBSERVATION_WINDOW: usize = 4096;
const LABEL_INTERNER_MIN_HIT_PERCENT: usize = 10;
const LABEL_INTERNER_MAX_VALUES: usize = 16_384;
const TIMESTAMP_IN_LIST_MAX_VALUES: usize = 1024;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum TimestampFilterStrategy {
    InList,
    Between { min: i64, max: i64 },
}

/// Choose the cheaper timestamp predicate using a bounded empirical model.
fn timestamp_filter_strategy(timestamp_set: &HashSet<i64>) -> TimestampFilterStrategy {
    if timestamp_set.len() <= TIMESTAMP_IN_LIST_MAX_VALUES {
        return TimestampFilterStrategy::InList;
    }

    let (min, max) = timestamp_set
        .iter()
        .fold((i64::MAX, i64::MIN), |(min, max), &timestamp| {
            (min.min(timestamp), max.max(timestamp))
        });

    TimestampFilterStrategy::Between { min, max }
}

/// Query-local cache for immutable labels from one DataFusion column.
///
/// Label values are looked up by borrowed `&str`, so cache hits only clone the
/// `Arc`. A low-reuse column disables and releases its cache after an observation
/// window instead of retaining one map entry per series.
struct LabelInterner {
    name: String,
    values: Option<HashMap<String, Arc<Label>>>,
    window_lookups: usize,
    window_hits: usize,
}

enum LabelColumn<'a> {
    Utf8(&'a StringArray),
    Utf8View(&'a StringViewArray),
}

impl LabelColumn<'_> {
    fn is_null(&self, row: usize) -> bool {
        match self {
            Self::Utf8(values) => values.is_null(row),
            Self::Utf8View(values) => values.is_null(row),
        }
    }

    fn value(&self, row: usize) -> &str {
        match self {
            Self::Utf8(values) => values.value(row),
            Self::Utf8View(values) => values.value(row),
        }
    }
}

impl LabelInterner {
    fn new(name: String) -> Self {
        Self {
            name,
            values: Some(HashMap::new()),
            window_lookups: 0,
            window_hits: 0,
        }
    }

    fn intern(&mut self, value: &str) -> Arc<Label> {
        let Some(values) = self.values.as_mut() else {
            return Arc::new(Label {
                name: self.name.clone(),
                value: value.to_string(),
            });
        };

        self.window_lookups += 1;
        let label = if let Some(label) = values.get(value) {
            self.window_hits += 1;
            Arc::clone(label)
        } else {
            let label = Arc::new(Label {
                name: self.name.clone(),
                value: value.to_string(),
            });
            if values.len() < LABEL_INTERNER_MAX_VALUES {
                values.insert(value.to_string(), Arc::clone(&label));
            }
            label
        };

        if self.window_lookups == LABEL_INTERNER_OBSERVATION_WINDOW {
            let keep_cache =
                self.window_hits * 100 >= self.window_lookups * LABEL_INTERNER_MIN_HIT_PERCENT;
            self.window_lookups = 0;
            self.window_hits = 0;
            if !keep_cache {
                self.values = None;
            }
        }

        label
    }

    #[cfg(test)]
    fn is_enabled(&self) -> bool {
        self.values.is_some()
    }
}

/// Attach labels to every loaded series: serve them from the process-wide
/// label cache and scan the label columns only for the misses. Labels are
/// immutable per series hash, so a full cache hit skips the scan entirely.
pub async fn load_series_labels(
    query_ctx: &QueryContext,
    table_name: &str,
    df_group: DataFrame,
    hash_field_type: &DataType,
    label_col_names: &[String],
    timestamp_set: &HashSet<i64>,
    mut metrics: PartitionedMetrics,
) -> Result<PartitionedMetrics> {
    let start = std::time::Instant::now();

    let misses = attach_cached_labels(query_ctx, table_name, label_col_names, &mut metrics);
    let (cache_hits, cache_misses) = (misses.hits(), misses.count());

    if !misses.is_empty() {
        let series_df = missing_label_scan(
            &query_ctx.trace_id,
            df_group,
            hash_field_type,
            label_col_names,
            timestamp_set,
            &misses,
        )?;
        let cache_fp = misses.write_fingerprint(&query_ctx.trace_id, label_col_names.len());
        metrics = load_labels(
            &query_ctx.trace_id,
            hash_field_type,
            series_df,
            query_ctx.query_data,
            cache_fp,
            misses.into_missing_sets(),
            metrics,
        )
        .await?;
    }

    log::info!(
        "[trace_id: {}] load and process all labels took: {:?}, label cache hits: {}, misses: {}",
        query_ctx.trace_id,
        start.elapsed(),
        cache_hits,
        cache_misses,
    );
    Ok(metrics)
}

/// Attach cached labels partition-parallel — millions of series make the
/// lookup+clone loop CPU-bound. Reads are never admission-gated: a lookup
/// cannot grow the cache, and even a query too big to write back benefits
/// from entries other queries warmed.
fn attach_cached_labels(
    query_ctx: &QueryContext,
    table_name: &str,
    label_col_names: &[String],
    metrics: &mut PartitionedMetrics,
) -> CacheMisses {
    let ctx_fp = label_cache::context_fingerprint(&query_ctx.org_id, table_name, label_col_names);
    let label_cache = &*label_cache::LABEL_CACHE;
    let per_partition: Vec<Vec<u64>> = metrics
        .par_iter_mut()
        .map(|partition| {
            partition
                .iter_mut()
                .filter_map(|(hash, range_val)| match label_cache.get(ctx_fp, *hash) {
                    // the cached set is materialized here, outside the shard lock
                    Some(labels) => {
                        range_val.labels =
                            maybe_prepend_hash_label(labels.to_vec(), *hash, query_ctx.query_data);
                        None
                    }
                    None => Some(*hash),
                })
                .collect()
        })
        .collect();

    let misses = CacheMisses::new(
        ctx_fp,
        metrics.iter().map(HashMap::len).sum(),
        per_partition,
    );
    config::metrics::QUERY_METRICS_LABEL_CACHE_HIT_COUNT
        .with_label_values(&[&query_ctx.org_id])
        .inc_by(misses.hits() as u64);
    config::metrics::QUERY_METRICS_LABEL_CACHE_MISS_COUNT
        .with_label_values(&[&query_ctx.org_id])
        .inc_by(misses.count() as u64);
    misses
}

/// Build the scan that recovers the missing series' labels: label columns
/// only, narrowed by a hash in-list when the misses are few, and by the
/// series max timestamps the sample scan already collected (every series has
/// a label row at its own max sample/exemplar timestamp).
///
/// The timestamp set covers all series rather than just the misses: series
/// share scrape timestamps, so a miss-only set is virtually identical, and
/// deriving it would cost a full pass over the loaded samples.
fn missing_label_scan(
    trace_id: &str,
    df_group: DataFrame,
    hash_field_type: &DataType,
    label_col_names: &[String],
    timestamp_set: &HashSet<i64>,
    misses: &CacheMisses,
) -> Result<DataFrame> {
    let mut df = df_group;
    if hash_field_type == &DataType::UInt64 && misses.count() <= MAX_HASH_INLIST_FILTER {
        let hashes = misses.hashes().map(lit).collect();
        df = df.filter(col(HASH_LABEL).in_list(hashes, false))?;
    }

    let filter_strategy = timestamp_filter_strategy(timestamp_set);
    let timestamp_filter = match filter_strategy {
        TimestampFilterStrategy::InList => {
            let mut timestamps = timestamp_set.iter().copied().collect::<Vec<_>>();
            timestamps.sort_unstable();
            col(TIMESTAMP_COL_NAME).in_list(timestamps.into_iter().map(lit).collect(), false)
        }
        TimestampFilterStrategy::Between { min, max } => {
            col(TIMESTAMP_COL_NAME).between(lit(min), lit(max))
        }
    };
    log::info!(
        "[trace_id: {trace_id}] load labels with {filter_strategy:?} timestamp filter for {} values",
        timestamp_set.len(),
    );

    let label_cols = label_col_names
        .iter()
        .map(|name| col(name.as_str()))
        .collect::<Vec<_>>();
    df.filter(timestamp_filter)?.select(label_cols)
}

/// Prepend the synthetic `__hash__` label when the query asked for raw data;
/// otherwise return the labels unchanged. Cached label sets never include the
/// hash label, so both raw-data and regular queries share cache entries.
fn maybe_prepend_hash_label(labels: Labels, hash: u64, include_hash_label: bool) -> Labels {
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

/// Repartition labels by series hash and process each partition in its own
/// Tokio task. Each label partition mutates the corresponding metrics partition
/// produced by the sample scan, so the global metrics map is built only once.
///
/// When `missing_sets` is given, only those series are attached (the rest were
/// served from the cache); when `cache_fp` is given, extracted label sets are
/// stored in the label cache for the next query.
pub(super) async fn load_labels(
    trace_id: &str,
    hash_field_type: &DataType,
    df: DataFrame,
    include_hash_label: bool,
    cache_fp: Option<u64>,
    missing_sets: Option<Vec<HashSet<u64>>>,
    metrics: PartitionedMetrics,
) -> Result<PartitionedMetrics> {
    let ctx = Arc::new(df.task_ctx());
    let target_partitions = ctx.session_config().target_partitions();
    let plan = df.create_physical_plan().await?;
    let schema = plan.schema();
    let label_columns = Arc::new(
        schema
            .fields()
            .iter()
            .enumerate()
            .filter(|(_, field)| {
                field.name() != HASH_LABEL
                    && matches!(field.data_type(), DataType::Utf8 | DataType::Utf8View)
            })
            .map(|(index, field)| (index, field.name().clone()))
            .collect::<Vec<_>>(),
    );
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
    if streams.len() != metrics.len() {
        return Err(DataFusionError::Execution(format!(
            "label partitions ({}) do not match metrics partitions ({})",
            streams.len(),
            metrics.len()
        )));
    }
    let missing_sets = match missing_sets {
        Some(sets) => sets.into_iter().map(Some).collect::<Vec<_>>(),
        None => vec![None; metrics.len()],
    };
    let mut tasks = Vec::with_capacity(streams.len());
    for ((mut stream, mut metrics), missing_set) in
        streams.into_iter().zip(metrics).zip(missing_sets)
    {
        let hash_field_type = hash_field_type.clone();
        let label_columns = Arc::clone(&label_columns);
        let task: TokioLabelsResult = tokio::task::spawn(async move {
            let mut labeled_hashes =
                HashSet::with_capacity(missing_set.as_ref().map_or(metrics.len(), HashSet::len));
            let mut label_interners = label_columns
                .iter()
                .map(|(_, name)| LabelInterner::new(name.clone()))
                .collect::<Vec<_>>();
            while let Some(batch) = stream.try_next().await? {
                let columns = batch.columns();
                let cols = label_columns
                    .iter()
                    .map(|(index, name)| {
                        let column = columns.get(*index).ok_or_else(|| {
                            DataFusionError::Execution(format!("label column {name} is missing"))
                        })?;
                        match column.data_type() {
                            DataType::Utf8 => column
                                .as_any()
                                .downcast_ref::<StringArray>()
                                .map(LabelColumn::Utf8),
                            DataType::Utf8View => column
                                .as_any()
                                .downcast_ref::<StringViewArray>()
                                .map(LabelColumn::Utf8View),
                            _ => None,
                        }
                        .ok_or_else(|| {
                            DataFusionError::Execution(format!(
                                "label column {name} is not Utf8 or Utf8View"
                            ))
                        })
                    })
                    .collect::<Result<Vec<_>>>()?;

                let mut attach_row_labels = |hash: u64, row: usize| {
                    if labeled_hashes.contains(&hash)
                        || missing_set
                            .as_ref()
                            .is_some_and(|missing| !missing.contains(&hash))
                    {
                        return;
                    }
                    let Some(range_val) = metrics.get_mut(&hash) else {
                        return;
                    };
                    let mut labels = Vec::with_capacity(label_columns.len());
                    for (value, interner) in cols.iter().zip(&mut label_interners) {
                        if !value.is_null(row) {
                            labels.push(interner.intern(value.value(row)));
                        }
                    }
                    if let Some(ctx_fp) = cache_fp {
                        label_cache::LABEL_CACHE.put(ctx_fp, hash, Arc::new(labels.clone()));
                    }
                    range_val.labels = maybe_prepend_hash_label(labels, hash, include_hash_label);
                    labeled_hashes.insert(hash);
                };

                if hash_field_type == DataType::UInt64 {
                    let hash_values = batch
                        .column_by_name(HASH_LABEL)
                        .unwrap()
                        .as_any()
                        .downcast_ref::<UInt64Array>()
                        .unwrap();
                    for i in 0..batch.num_rows() {
                        attach_row_labels(hash_values.value(i), i);
                    }
                } else {
                    let hash_values = batch
                        .column_by_name(HASH_LABEL)
                        .unwrap()
                        .as_any()
                        .downcast_ref::<StringArray>()
                        .unwrap();
                    for i in 0..batch.num_rows() {
                        attach_row_labels(gxhash::new().sum64(hash_values.value(i)), i);
                    }
                }
            }
            Ok(metrics)
        });
        tasks.push(task);
    }

    let mut metrics = Vec::with_capacity(tasks.len());
    for task in tasks {
        let partition = task
            .await
            .map_err(|e| DataFusionError::Execution(e.to_string()))??;
        metrics.push(partition);
    }

    Ok(metrics)
}

#[cfg(test)]
mod tests {
    use datafusion::{
        arrow::{
            array::{Float64Array, Int64Array, StringArray, StringViewArray, UInt64Array},
            datatypes::{Field, Schema},
            record_batch::RecordBatch,
        },
        prelude::{SessionConfig, SessionContext},
    };

    use super::*;

    fn timestamps(count: usize, gap_micros: i64) -> HashSet<i64> {
        (0..count)
            .map(|timestamp| timestamp as i64 * gap_micros)
            .collect()
    }

    #[test]
    fn test_timestamp_filter_strategy_uses_in_list_up_to_limit() {
        assert_eq!(
            timestamp_filter_strategy(&HashSet::new()),
            TimestampFilterStrategy::InList
        );
        assert_eq!(
            timestamp_filter_strategy(&timestamps(TIMESTAMP_IN_LIST_MAX_VALUES, 1)),
            TimestampFilterStrategy::InList
        );
    }

    #[test]
    fn test_timestamp_filter_strategy_caps_in_list_size() {
        let count = TIMESTAMP_IN_LIST_MAX_VALUES + 1;
        let sparse_gap = 10;
        let sparse = timestamps(count, sparse_gap);
        assert_eq!(
            timestamp_filter_strategy(&sparse),
            TimestampFilterStrategy::Between {
                min: 0,
                max: (count - 1) as i64 * sparse_gap,
            }
        );
    }

    #[tokio::test]
    async fn test_load_labels_interns_across_batches_and_preserves_first_row() {
        let schema = Arc::new(Schema::new(vec![
            Field::new(HASH_LABEL, DataType::UInt64, false),
            Field::new("instance", DataType::Utf8, true),
            Field::new("region", DataType::Utf8, true),
        ]));
        let make_batch = |hash: u64, instance: Option<&str>, region: Option<&str>| {
            RecordBatch::try_new(
                Arc::clone(&schema),
                vec![
                    Arc::new(UInt64Array::from(vec![hash])),
                    Arc::new(StringArray::from(vec![instance])),
                    Arc::new(StringArray::from(vec![region])),
                ],
            )
            .unwrap()
        };
        let batches = vec![
            make_batch(11, Some("first"), Some("shared")),
            make_batch(22, Some("shared"), None),
            make_batch(33, Some("shared"), Some("shared")),
            make_batch(11, Some("ignored"), Some("ignored")),
            make_batch(44, None, None),
            make_batch(44, Some("late"), Some("late")),
        ];
        let ctx = SessionContext::new_with_config(
            SessionConfig::new()
                .with_target_partitions(1)
                .with_batch_size(1),
        );
        let df = ctx.read_batches(batches).unwrap();
        let metrics = vec![HashMap::from([
            (11, RangeValue::default()),
            (22, RangeValue::default()),
            (33, RangeValue::default()),
            (44, RangeValue::default()),
        ])];

        let metrics = load_labels("test", &DataType::UInt64, df, false, None, None, metrics)
            .await
            .unwrap()
            .into_iter()
            .next()
            .unwrap();

        let labels_11 = &metrics[&11].labels;
        let labels_22 = &metrics[&22].labels;
        let labels_33 = &metrics[&33].labels;
        assert_eq!(labels_11[0].value, "first");
        assert_eq!(labels_11[1].value, "shared");
        assert_eq!(labels_22.len(), 1);
        assert_eq!(labels_22[0].name, "instance");
        assert!(Arc::ptr_eq(&labels_22[0], &labels_33[0]));
        assert!(Arc::ptr_eq(&labels_11[1], &labels_33[1]));
        assert!(!Arc::ptr_eq(&labels_33[0], &labels_33[1]));
        assert_eq!(labels_33[0].name, "instance");
        assert_eq!(labels_33[1].name, "region");
        assert!(metrics[&44].labels.is_empty());
    }

    #[tokio::test]
    async fn test_load_labels_supports_utf8_view() {
        let schema = Arc::new(Schema::new(vec![
            Field::new(HASH_LABEL, DataType::UInt64, false),
            Field::new("instance", DataType::Utf8View, true),
        ]));
        let batch = RecordBatch::try_new(
            schema,
            vec![
                Arc::new(UInt64Array::from(vec![11, 22])),
                Arc::new(StringViewArray::from(vec![Some("api"), None])),
            ],
        )
        .unwrap();
        let ctx = SessionContext::new_with_config(
            SessionConfig::new()
                .with_target_partitions(1)
                .with_batch_size(2),
        );
        let df = ctx.read_batch(batch).unwrap();
        let metrics = vec![HashMap::from([
            (11, RangeValue::default()),
            (22, RangeValue::default()),
        ])];

        let metrics = load_labels("test", &DataType::UInt64, df, false, None, None, metrics)
            .await
            .unwrap()
            .into_iter()
            .next()
            .unwrap();

        assert_eq!(metrics[&11].labels[0].name, "instance");
        assert_eq!(metrics[&11].labels[0].value, "api");
        assert!(metrics[&22].labels.is_empty());
    }

    #[test]
    fn test_label_interner_disables_low_reuse_columns() {
        let mut unique_interner = LabelInterner::new("instance".to_string());
        for value in 0..LABEL_INTERNER_OBSERVATION_WINDOW {
            unique_interner.intern(&format!("unique-{value}"));
        }
        assert!(!unique_interner.is_enabled());
        let first = unique_interner.intern("tail-repeat");
        let second = unique_interner.intern("tail-repeat");
        assert!(!Arc::ptr_eq(&first, &second));

        let mut repeated_interner = LabelInterner::new("instance".to_string());
        let first = repeated_interner.intern("shared");
        for _ in 1..LABEL_INTERNER_OBSERVATION_WINDOW {
            repeated_interner.intern("shared");
        }
        assert!(repeated_interner.is_enabled());
        let last = repeated_interner.intern("shared");
        assert!(Arc::ptr_eq(&first, &last));

        // Do not disable a column just because the first window starts with a
        // few thousand distinct values. The bounded cache still pays off when
        // those values repeat over the rest of a large query.
        let mut moderately_reused_interner = LabelInterner::new("instance".to_string());
        for value in 0..3000 {
            moderately_reused_interner.intern(&format!("value-{value}"));
        }
        let cached = moderately_reused_interner.intern("value-0");
        for _ in 3001..LABEL_INTERNER_OBSERVATION_WINDOW {
            moderately_reused_interner.intern("value-0");
        }
        assert!(moderately_reused_interner.is_enabled());
        let reused = moderately_reused_interner.intern("value-0");
        assert!(Arc::ptr_eq(&cached, &reused));
    }

    #[tokio::test]
    async fn test_load_labels_from_datafusion_repartitions_and_deduplicates() {
        let label_schema = Arc::new(Schema::new(vec![
            Field::new(HASH_LABEL, DataType::UInt64, false),
            Field::new("instance", DataType::Utf8, true),
            Field::new("region", DataType::Utf8, true),
        ]));
        let hashes = vec![11, 22, 33, 44, 55, 66, 77, 88, 11];
        let label_batch = RecordBatch::try_new(
            label_schema,
            vec![
                Arc::new(UInt64Array::from(hashes.clone())),
                Arc::new(StringArray::from(vec![
                    Some("a"),
                    Some("b"),
                    Some("c"),
                    Some("d"),
                    Some("e"),
                    Some("f"),
                    Some("g"),
                    Some("h"),
                    Some("ignored"),
                ])),
                Arc::new(StringArray::from(vec![
                    Some("east"),
                    None,
                    Some("west"),
                    Some("north"),
                    Some("south"),
                    Some("central"),
                    Some("edge"),
                    Some("remote"),
                    Some("ignored"),
                ])),
            ],
        )
        .unwrap();
        let ctx = SessionContext::new_with_config(SessionConfig::new().with_target_partitions(4));
        let sample_schema = Arc::new(Schema::new(vec![
            Field::new(TIMESTAMP_COL_NAME, DataType::Int64, false),
            Field::new(HASH_LABEL, DataType::UInt64, false),
            Field::new(config::meta::promql::VALUE_LABEL, DataType::Float64, false),
        ]));
        let sample_batch = RecordBatch::try_new(
            sample_schema,
            vec![
                Arc::new(Int64Array::from_iter_values(0..hashes.len() as i64)),
                Arc::new(UInt64Array::from(hashes)),
                Arc::new(Float64Array::from(vec![1.0; 9])),
            ],
        )
        .unwrap();
        let sample_df = ctx.read_batch(sample_batch).unwrap();
        let (metrics, _) = super::super::selector_loader::load_samples_from_datafusion(
            "test",
            &DataType::UInt64,
            sample_df,
            false,
        )
        .await
        .unwrap();
        let label_df = ctx.read_batch(label_batch).unwrap();

        let metrics = load_labels(
            "test",
            &DataType::UInt64,
            label_df,
            true,
            None,
            None,
            metrics,
        )
        .await
        .unwrap();
        let metrics = metrics.into_iter().flatten().collect::<HashMap<_, _>>();

        assert_eq!(metrics.len(), 8);
        assert_eq!(metrics[&11].samples.len(), 2);

        let labels_11 = &metrics.get(&11).unwrap().labels;
        assert_eq!(labels_11.len(), 3);
        assert_eq!(labels_11[0].name, HASH_LABEL);
        assert_eq!(labels_11[0].value, "11");
        assert_eq!(labels_11[1].value, "a");
        assert_eq!(labels_11[2].value, "east");

        let labels_22 = &metrics.get(&22).unwrap().labels;
        assert_eq!(labels_22.len(), 2);
        assert_eq!(labels_22[1].name, "instance");
        assert_eq!(labels_22[1].value, "b");

        for (hash, expected_instance) in [
            (33, "c"),
            (44, "d"),
            (55, "e"),
            (66, "f"),
            (77, "g"),
            (88, "h"),
        ] {
            assert!(
                metrics[&hash]
                    .labels
                    .iter()
                    .any(|label| { label.name == "instance" && label.value == expected_instance })
            );
        }
    }

    #[tokio::test]
    async fn test_load_labels_rejects_partition_count_mismatch() {
        let schema = Arc::new(Schema::new(vec![
            Field::new(HASH_LABEL, DataType::UInt64, false),
            Field::new("instance", DataType::Utf8, false),
        ]));
        let batch = RecordBatch::try_new(
            schema,
            vec![
                Arc::new(UInt64Array::from(vec![11])),
                Arc::new(StringArray::from(vec!["a"])),
            ],
        )
        .unwrap();
        let ctx = SessionContext::new_with_config(SessionConfig::new().with_target_partitions(2));
        let df = ctx.read_batch(batch).unwrap();

        let error = load_labels(
            "test",
            &DataType::UInt64,
            df,
            false,
            None,
            None,
            vec![HashMap::new()],
        )
        .await
        .unwrap_err();

        assert!(
            error
                .to_string()
                .contains("do not match metrics partitions")
        );
    }

    #[tokio::test]
    async fn test_load_labels_from_datafusion_hashes_string_series_id() {
        let schema = Arc::new(Schema::new(vec![
            Field::new(HASH_LABEL, DataType::Utf8, false),
            Field::new("instance", DataType::Utf8, false),
        ]));
        let series_id = "string-series-id";
        let hash = gxhash::new().sum64(series_id);
        let batch = RecordBatch::try_new(
            schema,
            vec![
                Arc::new(StringArray::from(vec![series_id])),
                Arc::new(StringArray::from(vec!["a"])),
            ],
        )
        .unwrap();
        let ctx = SessionContext::new_with_config(SessionConfig::new().with_target_partitions(1));
        let df = ctx.read_batch(batch).unwrap();
        let metrics = vec![HashMap::from([(hash, RangeValue::default())])];

        let metrics = load_labels("test", &DataType::Utf8, df, false, None, None, metrics)
            .await
            .unwrap();
        let metrics = metrics.into_iter().next().unwrap();

        let labels = &metrics.get(&hash).unwrap().labels;
        assert_eq!(labels.len(), 1);
        assert_eq!(labels[0].name, "instance");
        assert_eq!(labels[0].value, "a");
    }

    #[test]
    fn test_attach_cached_labels_hits_and_misses() {
        let query_ctx = QueryContext {
            trace_id: "test".to_string(),
            org_id: "org".to_string(),
            query_exemplars: false,
            query_data: true,
            need_wal: false,
            use_cache: false,
            timeout: 0,
            search_event_type: None,
            regions: vec![],
            clusters: vec![],
            is_super_cluster: false,
        };
        // unique table name so the process-wide cache is not shared with
        // other tests
        let table = "attach_cached_labels_test";
        let ctx_fp = label_cache::context_fingerprint("org", table, &[]);
        let cached = Arc::new(vec![Arc::new(Label {
            name: "instance".to_string(),
            value: "cached".to_string(),
        })]);
        label_cache::LABEL_CACHE.put(ctx_fp, 11, Arc::clone(&cached));
        let mut metrics = vec![
            HashMap::from([(11, RangeValue::default())]),
            HashMap::from([(22, RangeValue::default())]),
        ];

        let misses = attach_cached_labels(&query_ctx, table, &[], &mut metrics);

        assert_eq!(misses.hashes().collect::<Vec<_>>(), vec![22]);
        assert_eq!(misses.count(), 1);
        assert_eq!(misses.hits(), 1);
        assert!(!misses.is_empty());
        let labels = &metrics[0][&11].labels;
        assert_eq!(labels.len(), 2);
        assert_eq!(labels[0].name, HASH_LABEL);
        assert_eq!(labels[0].value, "11");
        assert!(Arc::ptr_eq(&labels[1], &cached[0]));
        assert!(metrics[1][&22].labels.is_empty());
        // a partial hit restricts the scan to the missing series
        assert_eq!(
            misses.into_missing_sets(),
            Some(vec![HashSet::new(), HashSet::from_iter([22])])
        );
    }

    #[tokio::test]
    async fn test_load_labels_scans_only_missing_and_populates_cache() {
        let ctx_fp = label_cache::context_fingerprint("org", "load_labels_cache_test", &[]);
        let schema = Arc::new(Schema::new(vec![
            Field::new(HASH_LABEL, DataType::UInt64, false),
            Field::new("instance", DataType::Utf8, true),
        ]));
        let batch = RecordBatch::try_new(
            schema,
            vec![
                Arc::new(UInt64Array::from(vec![11, 22])),
                Arc::new(StringArray::from(vec![Some("overwrite"), Some("scanned")])),
            ],
        )
        .unwrap();
        let ctx = SessionContext::new_with_config(SessionConfig::new().with_target_partitions(1));
        let df = ctx.read_batch(batch).unwrap();
        // series 11 was served from the cache and must not be re-attached or
        // re-cached by the scan
        let hit = RangeValue {
            labels: vec![Arc::new(Label {
                name: "instance".to_string(),
                value: "cached".to_string(),
            })],
            ..Default::default()
        };
        let metrics = vec![HashMap::from([(11, hit), (22, RangeValue::default())])];
        let missing_sets = Some(vec![HashSet::from_iter([22])]);

        let metrics = load_labels(
            "test",
            &DataType::UInt64,
            df,
            false,
            Some(ctx_fp),
            missing_sets,
            metrics,
        )
        .await
        .unwrap();
        let metrics = metrics.into_iter().next().unwrap();

        assert_eq!(metrics[&11].labels[0].value, "cached");
        assert_eq!(metrics[&22].labels[0].value, "scanned");
        // only the missing series was stored in the cache
        assert!(label_cache::LABEL_CACHE.get(ctx_fp, 11).is_none());
        let cached = label_cache::LABEL_CACHE.get(ctx_fp, 22).unwrap();
        assert_eq!(cached.len(), 1);
        assert_eq!(cached[0].name, "instance");
        assert_eq!(cached[0].value, "scanned");
    }

    #[tokio::test]
    async fn test_load_labels_cached_entries_exclude_hash_label() {
        let ctx_fp = label_cache::context_fingerprint("org", "load_labels_hash_label_test", &[]);
        let schema = Arc::new(Schema::new(vec![
            Field::new(HASH_LABEL, DataType::UInt64, false),
            Field::new("instance", DataType::Utf8, true),
        ]));
        let batch = RecordBatch::try_new(
            schema,
            vec![
                Arc::new(UInt64Array::from(vec![11])),
                Arc::new(StringArray::from(vec![Some("a")])),
            ],
        )
        .unwrap();
        let ctx = SessionContext::new_with_config(SessionConfig::new().with_target_partitions(1));
        let df = ctx.read_batch(batch).unwrap();
        let metrics = vec![HashMap::from([(11, RangeValue::default())])];

        let metrics = load_labels(
            "test",
            &DataType::UInt64,
            df,
            true,
            Some(ctx_fp),
            None,
            metrics,
        )
        .await
        .unwrap();
        let metrics = metrics.into_iter().next().unwrap();

        // the attached labels carry the synthetic hash label, the cached
        // entry does not
        let labels = &metrics[&11].labels;
        assert_eq!(labels.len(), 2);
        assert_eq!(labels[0].name, HASH_LABEL);
        assert_eq!(labels[1].value, "a");
        let cached = label_cache::LABEL_CACHE.get(ctx_fp, 11).unwrap();
        assert_eq!(cached.len(), 1);
        assert_eq!(cached[0].name, "instance");
    }
}
