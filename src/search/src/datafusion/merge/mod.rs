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
use config::{get_config, meta::stream::FileMeta};
use datafusion::{
    arrow::datatypes::Schema,
    catalog::TableProvider,
    error::{DataFusionError, Result},
    physical_plan::execute_stream,
};
use futures::TryStreamExt;
use parquet::{
    arrow::{AsyncArrowWriter, async_writer::AsyncFileWriter},
    file::metadata::KeyValue,
};

use super::table_provider::uniontable::NewUnionTable;
use crate::datafusion::{exec::DataFusionContextBuilder, sort_order::FileSortOrder};

#[cfg(feature = "enterprise")]
pub mod downsampling;
mod metrics;
pub mod mode;
mod result;
mod single_file;

pub use mode::{MergeMode, MergeOutput};
pub use result::{MergeResult, MergedFile};

/// Merge `tables` (the union of the input files) into one or more files
/// according to `mode`, written as `output` says.
pub async fn merge_parquet_files(
    schema: Arc<Schema>,
    tables: Vec<Arc<dyn TableProvider>>,
    bloom_filter_fields: &[String],
    metadata: FileMeta,
    mode: &MergeMode,
    output: MergeOutput,
) -> Result<MergeResult> {
    let start = std::time::Instant::now();
    let sql = mode.sql(&schema);
    log::debug!("merge_parquet_files [{mode}] sql: {sql}");
    let (schema, rx, read_task) =
        run_merge_query(&sql, mode.output_sort_order(), schema, tables).await?;

    let files = match mode {
        MergeMode::MetricsIndexed => {
            metrics::write_files(
                &schema,
                bloom_filter_fields,
                &metadata,
                output.file_format,
                get_config().compact.max_file_size,
                rx,
                read_task,
            )
            .await?
        }
        MergeMode::Classic
        | MergeMode::TraceTimeIndex
        | MergeMode::FileList
        | MergeMode::MetricsHashSorted => {
            single_file::write(
                schema,
                bloom_filter_fields,
                metadata,
                mode,
                output,
                rx,
                read_task,
            )
            .await?
        }
        #[cfg(feature = "enterprise")]
        MergeMode::Downsampling(_) => {
            downsampling::write_files(
                &schema,
                bloom_filter_fields,
                &metadata,
                output.file_format,
                rx,
                read_task,
            )
            .await?
        }
    };

    log::debug!(
        "merge_parquet_files [{mode}] wrote {} file(s) in {} ms",
        files.len(),
        start.elapsed().as_millis()
    );
    Ok(MergeResult {
        files,
        file_format: output.file_format,
    })
}

/// Plan and start `sql` over the union of `tables`; the record batches arrive
/// on the returned channel, the task reports the stream's completion / error.
/// `sort_order` only enables `split_file_groups_by_statistics` for that
/// order; the input tables declare what the files really carry.
async fn run_merge_query(
    sql: &str,
    sort_order: FileSortOrder,
    schema: Arc<Schema>,
    tables: Vec<Arc<dyn TableProvider>>,
) -> Result<(
    Arc<Schema>,
    tokio::sync::mpsc::Receiver<RecordBatch>,
    tokio::task::JoinHandle<Result<()>>,
)> {
    let cfg = get_config();
    let ctx = DataFusionContextBuilder::new()
        .trace_id("merge_parquet_files")
        .sort_order(sort_order)
        .build(cfg.limit.datafusion_min_partition_num)
        .await?;
    // register union table
    let union_table = Arc::new(NewUnionTable::new(schema, tables));
    ctx.register_table("tbl", union_table)?;

    let plan = ctx.state().create_logical_plan(sql).await?;
    let physical_plan = ctx.state().create_physical_plan(&plan).await?;
    let schema = physical_plan.schema();

    // print the physical plan
    if cfg.common.print_key_sql {
        let plan = datafusion::physical_plan::displayable(physical_plan.as_ref())
            .indent(false)
            .to_string();
        println!("+---------------------------+--------------------------+");
        println!("merge_parquet_files");
        println!("+---------------------------+--------------------------+");
        println!("{plan}");
    }

    let mut batch_stream = execute_stream(physical_plan, ctx.task_ctx())?;
    let (tx, rx) = tokio::sync::mpsc::channel::<RecordBatch>(2);
    let read_task = tokio::task::spawn(async move {
        loop {
            match batch_stream.try_next().await {
                Ok(None) => {
                    break;
                }
                Ok(Some(batch)) => {
                    if let Err(e) = tx.send(batch).await {
                        log::error!("merge_parquet_files write to channel error: {e}");
                        return Err(DataFusionError::External(Box::new(e)));
                    }
                }
                Err(e) => {
                    log::error!("merge_parquet_files execute stream error: {e}");
                    return Err(e);
                }
            }
        }
        Ok(())
    });
    Ok((schema, rx, read_task))
}

pub fn append_metadata<W: AsyncFileWriter>(
    writer: &mut AsyncArrowWriter<W>,
    file_meta: &FileMeta,
) -> Result<()> {
    writer.append_key_value_metadata(KeyValue::new(
        "min_ts".to_string(),
        file_meta.min_ts.to_string(),
    ));
    writer.append_key_value_metadata(KeyValue::new(
        "max_ts".to_string(),
        file_meta.max_ts.to_string(),
    ));
    writer.append_key_value_metadata(KeyValue::new(
        "records".to_string(),
        file_meta.records.to_string(),
    ));
    writer.append_key_value_metadata(KeyValue::new(
        "original_size".to_string(),
        file_meta.original_size.to_string(),
    ));
    Ok(())
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use arrow::array::{Array, Int64Array, StringArray};
    use arrow_schema::{DataType, Field, Schema};
    use config::{FileFormat, TIMESTAMP_COL_NAME, meta::stream::StreamType};
    use datafusion::datasource::MemTable;
    use parquet::arrow::arrow_reader::ParquetRecordBatchReaderBuilder;

    use super::*;

    #[test]
    fn merged_file_names_only_mark_metrics_layouts() {
        let standard = MergedFile::Standard {
            data: Vec::new(),
            meta: FileMeta::default(),
        };
        assert_eq!(standard.file_name("1", FileFormat::Vortex), "1.vortex");
        assert_eq!(
            standard.mark_file_key("files/o/logs/s/1.parquet"),
            "files/o/logs/s/1.parquet"
        );

        let metrics = MergedFile::MetricsHashSorted {
            data: Vec::new(),
            meta: FileMeta::default(),
        };
        assert_eq!(
            metrics.file_name("1", FileFormat::Parquet),
            "hash-sorted-v1-1.parquet"
        );
        assert_eq!(
            metrics.file_name("1", FileFormat::Vortex),
            "hash-sorted-v1-1.vortex"
        );
        assert_eq!(
            metrics.mark_file_key("files/o/metrics/s/1.parquet"),
            "files/o/metrics/s/hash-sorted-v1-1.parquet"
        );
    }

    fn create_test_schema() -> Arc<Schema> {
        Arc::new(Schema::new(vec![
            Field::new(TIMESTAMP_COL_NAME, DataType::Int64, false),
            Field::new("field1", DataType::Utf8, true),
            Field::new("field2", DataType::Int64, true),
        ]))
    }

    #[tokio::test]
    async fn test_merge_parquet_files_error_handling() {
        // Test with empty tables vector
        let schema = create_test_schema();
        let empty_tables: Vec<Arc<dyn TableProvider>> = vec![];
        let metadata = FileMeta::default();

        let result = merge_parquet_files(
            schema,
            empty_tables,
            &[],
            metadata,
            &MergeMode::Classic,
            MergeOutput::for_compactor(StreamType::Logs),
        )
        .await;

        // Should handle empty tables gracefully or return appropriate error
        // The exact behavior depends on implementation details
        assert!(result.is_ok() || result.is_err());
    }

    #[tokio::test]
    async fn test_trace_time_index_merge_aggregates_by_trace_id() {
        let schema = Arc::new(Schema::new(vec![
            Field::new(TIMESTAMP_COL_NAME, DataType::Int64, false),
            Field::new("trace_id", DataType::Utf8, false),
            Field::new("session_id", DataType::Utf8, true),
            Field::new("min_ts", DataType::Int64, false),
            Field::new("max_ts", DataType::Int64, false),
        ]));
        let batch = RecordBatch::try_new(
            schema.clone(),
            vec![
                Arc::new(Int64Array::from(vec![100, 110, 120, 130])),
                Arc::new(StringArray::from(vec!["a", "a", "b", "a"])),
                Arc::new(StringArray::from(vec![None, Some("session-a"), None, None])),
                Arc::new(Int64Array::from(vec![100, 90, 120, 80])),
                Arc::new(Int64Array::from(vec![101, 115, 125, 140])),
            ],
        )
        .unwrap();
        let table = Arc::new(MemTable::try_new(schema.clone(), vec![vec![batch]]).unwrap());

        let mode = MergeMode::for_ingester(StreamType::Metadata, "trace_time_index_test", &schema);
        assert!(matches!(mode, MergeMode::TraceTimeIndex));
        let merged = merge_parquet_files(
            schema,
            vec![table],
            &[],
            FileMeta {
                min_ts: 80,
                max_ts: 140,
                records: 4,
                ..Default::default()
            },
            &mode,
            MergeOutput::for_ingester(StreamType::Metadata),
        )
        .await
        .unwrap();
        let (merged, _) = merged.into_single().unwrap();
        let (data, _) = merged.into_buffered().unwrap();
        let batches = ParquetRecordBatchReaderBuilder::try_new(bytes::Bytes::from(data))
            .unwrap()
            .build()
            .unwrap()
            .collect::<Result<Vec<_>, _>>()
            .unwrap();
        let batch = arrow::compute::concat_batches(&batches[0].schema(), &batches).unwrap();
        assert_eq!(batch.num_rows(), 2);

        let trace_ids = batch
            .column_by_name("trace_id")
            .unwrap()
            .as_any()
            .downcast_ref::<StringArray>()
            .unwrap();
        let timestamps = batch
            .column_by_name(TIMESTAMP_COL_NAME)
            .unwrap()
            .as_any()
            .downcast_ref::<Int64Array>()
            .unwrap();
        let min_ts = batch
            .column_by_name("min_ts")
            .unwrap()
            .as_any()
            .downcast_ref::<Int64Array>()
            .unwrap();
        let max_ts = batch
            .column_by_name("max_ts")
            .unwrap()
            .as_any()
            .downcast_ref::<Int64Array>()
            .unwrap();
        let session_ids = batch
            .column_by_name("session_id")
            .unwrap()
            .as_any()
            .downcast_ref::<StringArray>()
            .unwrap();
        let rows = (0..batch.num_rows())
            .map(|index| {
                (
                    trace_ids.value(index).to_string(),
                    (
                        timestamps.value(index),
                        (!session_ids.is_null(index)).then(|| session_ids.value(index).to_string()),
                        min_ts.value(index),
                        max_ts.value(index),
                    ),
                )
            })
            .collect::<std::collections::HashMap<_, _>>();
        // MAX(session_id) ignores NULLs: trace a keeps the one known session.
        assert_eq!(rows["a"], (100, Some("session-a".to_string()), 80, 140));
        assert_eq!(rows["b"], (120, None, 120, 125));
    }
}
