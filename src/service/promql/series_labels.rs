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

//! Loads and attaches series labels in parallel.

use std::sync::Arc;

use config::{
    TIMESTAMP_COL_NAME,
    meta::promql::{
        HASH_LABEL,
        value::{Label, QueryContext, RangeValue},
    },
    utils::hash::{Sum64, gxhash},
};
use datafusion::{
    arrow::{
        array::{Array, StringArray, UInt64Array},
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

use super::selector_loader::PartitionedMetrics;

type TokioLabelsResult = tokio::task::JoinHandle<Result<HashMap<u64, RangeValue>>>;

// Keep the cache bounded for high-cardinality label columns. Re-evaluating the
// hit rate in windows also lets a cache disable itself if the value distribution
// changes while batches are being processed.
const LABEL_INTERNER_OBSERVATION_WINDOW: usize = 4096;
const LABEL_INTERNER_MIN_HIT_PERCENT: usize = 10;
const LABEL_INTERNER_MAX_VALUES: usize = 16_384;

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

/// Select one label row for every loaded series, then process the selected
/// label data in parallel by series hash.
pub async fn load_series_labels(
    query_ctx: &QueryContext,
    df_group: DataFrame,
    hash_field_type: &DataType,
    label_col_names: &[String],
    timestamp_set: &HashSet<i64>,
    metrics: PartitionedMetrics,
) -> Result<PartitionedMetrics> {
    let start = std::time::Instant::now();

    let label_cols = label_col_names
        .iter()
        .map(|name| col(name.as_str()))
        .collect::<Vec<_>>();
    let series_df =
        if config::get_config().limit.metrics_inlist_filter_enabled || timestamp_set.is_empty() {
            df_group
                .filter(
                    col(TIMESTAMP_COL_NAME).in_list(
                        timestamp_set
                            .iter()
                            .map(|&timestamp| lit(timestamp))
                            .collect::<Vec<_>>(),
                        false,
                    ),
                )?
                .select(label_cols)?
        } else {
            let min = timestamp_set.iter().min().unwrap();
            let max = timestamp_set.iter().max().unwrap();
            df_group
                .filter(col(TIMESTAMP_COL_NAME).between(lit(*min), lit(*max)))?
                .select(label_cols)?
        };

    let metrics = load_labels(hash_field_type, series_df, query_ctx.query_data, metrics).await?;

    log::info!(
        "[trace_id: {}] load and process all labels took: {:?}",
        query_ctx.trace_id,
        start.elapsed(),
    );
    Ok(metrics)
}

/// Repartition labels by series hash and process each partition in its own
/// Tokio task. Each label partition mutates the corresponding metrics partition
/// produced by the sample scan, so the global metrics map is built only once.
pub(super) async fn load_labels(
    hash_field_type: &DataType,
    df: DataFrame,
    include_hash_label: bool,
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
            .filter(|(_, field)| field.name() != HASH_LABEL && field.data_type() == &DataType::Utf8)
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

    let streams = execute_stream_partitioned(plan, ctx)?;
    if streams.len() != metrics.len() {
        return Err(DataFusionError::Execution(format!(
            "label partitions ({}) do not match metrics partitions ({})",
            streams.len(),
            metrics.len()
        )));
    }
    let mut tasks = Vec::with_capacity(streams.len());
    for (mut stream, mut metrics) in streams.into_iter().zip(metrics) {
        let hash_field_type = hash_field_type.clone();
        let label_columns = Arc::clone(&label_columns);
        let task: TokioLabelsResult = tokio::task::spawn(async move {
            let mut labeled_hashes = HashSet::with_capacity(metrics.len());
            let mut label_interners = label_columns
                .iter()
                .map(|(_, name)| LabelInterner::new(name.clone()))
                .collect::<Vec<_>>();
            while let Some(batch) = stream.try_next().await? {
                let columns = batch.columns();
                let cols = label_columns
                    .iter()
                    .map(|(index, name)| {
                        columns
                            .get(*index)
                            .and_then(|column| column.as_any().downcast_ref::<StringArray>())
                            .ok_or_else(|| {
                                DataFusionError::Execution(format!(
                                    "label column {name} is missing or is not Utf8"
                                ))
                            })
                    })
                    .collect::<Result<Vec<_>>>()?;

                let mut attach_row_labels = |hash: u64, row: usize| {
                    if labeled_hashes.contains(&hash) {
                        return;
                    }
                    let Some(range_val) = metrics.get_mut(&hash) else {
                        return;
                    };
                    let mut labels =
                        Vec::with_capacity(label_columns.len() + usize::from(include_hash_label));
                    if include_hash_label {
                        labels.push(Arc::new(Label {
                            name: HASH_LABEL.to_string(),
                            value: hash.to_string(),
                        }));
                    }
                    for (value, interner) in cols.iter().zip(&mut label_interners) {
                        if !value.is_null(row) {
                            labels.push(interner.intern(value.value(row)));
                        }
                    }
                    range_val.labels = labels;
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
            array::{Float64Array, Int64Array, StringArray, UInt64Array},
            datatypes::{Field, Schema},
            record_batch::RecordBatch,
        },
        prelude::{SessionConfig, SessionContext},
    };

    use super::*;

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

        let metrics = load_labels(&DataType::UInt64, df, false, metrics)
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

        let metrics = load_labels(&DataType::UInt64, label_df, true, metrics)
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

        let error = load_labels(&DataType::UInt64, df, false, vec![HashMap::new()])
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

        let metrics = load_labels(&DataType::Utf8, df, false, metrics)
            .await
            .unwrap();
        let metrics = metrics.into_iter().next().unwrap();

        let labels = &metrics.get(&hash).unwrap().labels;
        assert_eq!(labels.len(), 1);
        assert_eq!(labels[0].name, "instance");
        assert_eq!(labels[0].value, "a");
    }
}
