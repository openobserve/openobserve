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

//! Attaches labels to the series the sample scan returned: cache hits first, then one label scan
//! for the remaining series.

use std::sync::Arc;

use config::{
    TIMESTAMP_COL_NAME,
    meta::promql::{
        HASH_LABEL,
        value::{Labels, QueryContext, RangeValue},
    },
    utils::hash::{Sum64, gxhash},
};
use datafusion::{
    arrow::{
        array::{StringArray, UInt64Array},
        datatypes::DataType,
    },
    error::{DataFusionError, Result},
    prelude::{DataFrame, col, lit},
};
use futures::TryStreamExt;
use hashbrown::{HashMap, HashSet};

use super::{
    PartitionedMetrics, label_cache,
    label_interner::{LabelColumn, LabelInterner},
    partition_streams, with_hash_label,
};

const MAX_HASH_INLIST_FILTER: usize = 8192;
const TIMESTAMP_IN_LIST_MAX_VALUES: usize = 1024;

type TokioLabelsResult = tokio::task::JoinHandle<Result<HashMap<u64, RangeValue>>>;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum TimestampFilterStrategy {
    InList,
    Between { min: i64, max: i64 },
}

/// Receives source labels as they are extracted. Implementations can observe
/// or persist them without coupling the loader to a particular cache.
pub(super) trait LoadedLabelsObserver: Send + Sync {
    fn observe(&self, hash: u64, labels: &Labels);
}

/// Attach labels to every loaded series. Cache hits are attached first, then
/// the loader scans and extracts labels only for the remaining series.
pub(super) async fn load_series_labels(
    query_ctx: &QueryContext,
    table_name: &str,
    df_group: DataFrame,
    hash_field_type: &DataType,
    label_col_names: &[String],
    timestamp_set: &HashSet<i64>,
    mut metrics: PartitionedMetrics,
) -> Result<PartitionedMetrics> {
    let start = std::time::Instant::now();

    let misses = label_cache::attach_cached_labels(
        &query_ctx.org_id,
        table_name,
        label_col_names,
        query_ctx.query_data,
        &mut metrics,
    );
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
        let observer = misses.write_observer(&query_ctx.trace_id, label_col_names.len());
        metrics = load_labels(
            &query_ctx.trace_id,
            hash_field_type,
            series_df,
            query_ctx.query_data,
            observer,
            misses.into_selected_hashes(),
            metrics,
        )
        .await?;
    }

    log::info!(
        "[trace_id: {}] load and process all labels took: {:?}, label cache hits: {cache_hits}, misses: {cache_misses}",
        query_ctx.trace_id,
        start.elapsed(),
    );
    Ok(metrics)
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
    misses: &label_cache::CacheMisses,
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

/// Repartition labels by series hash and process each partition in its own
/// Tokio task. Each label partition mutates the corresponding metrics partition
/// produced by the sample scan, so the global metrics map is built only once.
///
/// When `selected_hashes` is given, only those series are attached. The
/// observer receives source labels before a synthetic hash label is added.
async fn load_labels(
    trace_id: &str,
    hash_field_type: &DataType,
    df: DataFrame,
    include_hash_label: bool,
    observer: Option<Arc<dyn LoadedLabelsObserver>>,
    selected_hashes: Option<Vec<HashSet<u64>>>,
    metrics: PartitionedMetrics,
) -> Result<PartitionedMetrics> {
    let (schema, streams) = partition_streams(trace_id, df).await?;
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
    if streams.len() != metrics.len() {
        return Err(DataFusionError::Execution(format!(
            "label partitions ({}) do not match metrics partitions ({})",
            streams.len(),
            metrics.len()
        )));
    }
    let selected_hashes = match selected_hashes {
        Some(sets) => sets.into_iter().map(Some).collect::<Vec<_>>(),
        None => vec![None; metrics.len()],
    };
    let mut tasks = Vec::with_capacity(streams.len());
    for ((mut stream, mut metrics), selected_hashes) in
        streams.into_iter().zip(metrics).zip(selected_hashes)
    {
        let hash_field_type = hash_field_type.clone();
        let label_columns = Arc::clone(&label_columns);
        let observer = observer.clone();
        let task: TokioLabelsResult = tokio::task::spawn(async move {
            let mut labeled_hashes = HashSet::with_capacity(
                selected_hashes.as_ref().map_or(metrics.len(), HashSet::len),
            );
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
                        LabelColumn::try_from_array(column.as_ref()).ok_or_else(|| {
                            DataFusionError::Execution(format!(
                                "label column {name} is not Utf8 or Utf8View"
                            ))
                        })
                    })
                    .collect::<Result<Vec<_>>>()?;

                let mut attach_row_labels = |hash: u64, row: usize| {
                    if labeled_hashes.contains(&hash)
                        || selected_hashes
                            .as_ref()
                            .is_some_and(|selected| !selected.contains(&hash))
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
                    if let Some(observer) = &observer {
                        observer.observe(hash, &labels);
                    }
                    range_val.labels = with_hash_label(labels, hash, include_hash_label);
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
    use config::meta::promql::value::Label;
    use datafusion::{
        arrow::{
            array::{Float64Array, Int64Array, StringArray, StringViewArray, UInt64Array},
            datatypes::{Field, Schema},
            record_batch::RecordBatch,
        },
        prelude::{SessionConfig, SessionContext},
    };
    use parking_lot::Mutex;

    use super::*;
    use crate::series_loader::load_samples_from_datafusion;

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
        let (metrics, _) =
            load_samples_from_datafusion("test", &DataType::UInt64, sample_df, false, 1, 0)
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

    #[derive(Default)]
    struct RecordingObserver {
        labels: Mutex<Vec<(u64, Labels)>>,
    }

    impl LoadedLabelsObserver for RecordingObserver {
        fn observe(&self, hash: u64, labels: &Labels) {
            self.labels.lock().push((hash, labels.clone()));
        }
    }

    #[tokio::test]
    async fn test_load_labels_observer_receives_only_selected_source_labels() {
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
        let hit = RangeValue {
            labels: vec![Arc::new(Label {
                name: "instance".to_string(),
                value: "existing".to_string(),
            })],
            ..Default::default()
        };
        let metrics = vec![HashMap::from([(11, hit), (22, RangeValue::default())])];
        let selected_hashes = Some(vec![HashSet::from([22])]);
        let observer = Arc::new(RecordingObserver::default());
        let loaded_labels_observer: Arc<dyn LoadedLabelsObserver> = observer.clone();

        let metrics = load_labels(
            "test",
            &DataType::UInt64,
            df,
            true,
            Some(loaded_labels_observer),
            selected_hashes,
            metrics,
        )
        .await
        .unwrap();
        let metrics = metrics.into_iter().next().unwrap();

        assert_eq!(metrics[&11].labels[0].value, "existing");
        assert_eq!(metrics[&22].labels.len(), 2);
        assert_eq!(metrics[&22].labels[0].name, HASH_LABEL);
        assert_eq!(metrics[&22].labels[1].value, "scanned");

        let observed = observer.labels.lock();
        assert_eq!(observed.len(), 1);
        assert_eq!(observed[0].0, 22);
        assert_eq!(observed[0].1.len(), 1);
        assert_eq!(observed[0].1[0].name, "instance");
        assert_eq!(observed[0].1[0].value, "scanned");
    }
}
