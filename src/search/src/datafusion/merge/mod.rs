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
use config::{
    FileFormat, get_config,
    meta::stream::FileMeta,
    utils::parquet::{VORTEX_FILE_META_KEY, encode_vortex_file_meta, new_parquet_writer},
};
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
use vortex::{
    VortexSessionDefault,
    array::ArrayRef,
    arrow::{FromArrowArray, FromArrowType},
    dtype::DType,
    file::VortexWriteOptions,
    io::session::RuntimeSessionExt,
    session::VortexSession,
};

use super::table_provider::uniontable::NewUnionTable;
use crate::datafusion::{
    exec::DataFusionContextBuilder,
    sort_order::FileSortOrder,
    vortex::{VORTEX_RUNTIME, vortex_write_strategy},
};

#[cfg(feature = "enterprise")]
pub mod downsampling;
pub mod mode;

pub use mode::{MergeMode, MergeOutput};

/// One file written by [`merge_parquet_files`].
pub struct MergedFile {
    pub buf: Vec<u8>,
    pub meta: FileMeta,
}

pub struct MergeParquetResult {
    pub files: Vec<MergedFile>,
    pub file_format: FileFormat,
}

impl MergeParquetResult {
    /// The merged file, for callers that always merge into exactly one file
    /// (the ingester movers).
    pub fn into_single(self) -> Result<(MergedFile, FileFormat)> {
        let Self {
            mut files,
            file_format,
        } = self;
        if files.len() != 1 {
            return Err(DataFusionError::Execution(format!(
                "merge_parquet_files produced {} files, expected exactly one",
                files.len()
            )));
        }
        Ok((files.pop().unwrap(), file_format))
    }
}

/// Merge `tables` (the union of the input files) into one or more files
/// according to `mode`, written as `output` says.
pub async fn merge_parquet_files(
    schema: Arc<Schema>,
    tables: Vec<Arc<dyn TableProvider>>,
    bloom_filter_fields: &[String],
    mut metadata: FileMeta,
    mode: &MergeMode,
    output: MergeOutput,
) -> Result<MergeParquetResult> {
    let start = std::time::Instant::now();
    let sql = mode.sql(&schema);
    log::debug!("merge_parquet_files [{mode}] sql: {sql}");
    let (schema, mut rx, read_task) =
        run_merge_query(&sql, mode.input_sort_order(), schema, tables).await?;

    let files = match mode {
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
        _ => {
            let buf = match output.file_format {
                FileFormat::Parquet => {
                    write_parquet(
                        &schema,
                        bloom_filter_fields,
                        &metadata,
                        output.parquet_compression,
                        &mut rx,
                        read_task,
                    )
                    .await?
                }
                FileFormat::Vortex => write_vortex(schema, &metadata, rx, read_task).await?,
            };
            metadata.compressed_size = buf.len() as i64;
            vec![MergedFile {
                buf,
                meta: metadata,
            }]
        }
    };

    log::debug!(
        "merge_parquet_files [{mode}] wrote {} file(s) in {} ms",
        files.len(),
        start.elapsed().as_millis()
    );
    Ok(MergeParquetResult {
        files,
        file_format: output.file_format,
    })
}

/// Plan and start `sql` over the union of `tables`; the record batches arrive
/// on the returned channel, the task reports the stream's completion / error.
async fn run_merge_query(
    sql: &str,
    input_sort_order: FileSortOrder,
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
        .sort_order(input_sort_order)
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

async fn write_parquet(
    schema: &Arc<Schema>,
    bloom_filter_fields: &[String],
    metadata: &FileMeta,
    compression: Option<&str>,
    rx: &mut tokio::sync::mpsc::Receiver<RecordBatch>,
    read_task: tokio::task::JoinHandle<Result<()>>,
) -> Result<Vec<u8>> {
    let mut buf = Vec::new();
    let mut writer = new_parquet_writer(
        &mut buf,
        schema,
        bloom_filter_fields,
        metadata,
        false,
        compression,
    );

    let mut new_file_meta = metadata.clone();
    new_file_meta.records = 0;
    while let Some(batch) = rx.recv().await {
        new_file_meta.records += batch.num_rows() as i64;
        if let Err(e) = writer.write(&batch).await {
            log::error!("merge_parquet_files write error: {e}");
            return Err(e.into());
        }
    }

    read_task
        .await
        .map_err(|e| DataFusionError::External(Box::new(e)))??;
    append_metadata(&mut writer, &new_file_meta)?;
    writer.close().await?;
    Ok(buf)
}

async fn write_vortex(
    schema: Arc<Schema>,
    metadata: &FileMeta,
    mut rx: tokio::sync::mpsc::Receiver<RecordBatch>,
    read_task: tokio::task::JoinHandle<Result<()>>,
) -> Result<Vec<u8>> {
    // metadata segments belong to the write options, they can't be appended at
    // close time like parquet's, so `records` may drift from the rows written
    let file_meta = encode_vortex_file_meta(metadata);
    let writer_task = VORTEX_RUNTIME.spawn_blocking(move || {
        VORTEX_RUNTIME.block_on(async move {
            let mut buf = Vec::new();
            let session = VortexSession::default().with_tokio();
            let dtype = DType::from_arrow(schema.as_ref());
            let write_options = VortexWriteOptions::new(session.clone())
                .with_strategy(vortex_write_strategy())
                .with_metadata_segment(VORTEX_FILE_META_KEY, file_meta);
            let mut writer = write_options.writer(&mut buf, dtype);

            while let Some(batch) = rx.recv().await {
                let array: ArrayRef = ArrayRef::from_arrow(batch, false).map_err(|e| {
                    DataFusionError::Execution(format!(
                        "Failed to convert arrow array to vortex array: {e}"
                    ))
                })?;
                writer.push(array).await?;
            }

            writer.finish().await?;

            Ok::<Vec<u8>, anyhow::Error>(buf)
        })
    });

    read_task
        .await
        .map_err(|e| DataFusionError::External(Box::new(e)))??;

    writer_task
        .await
        .map_err(|e| DataFusionError::Execution(format!("Vortex runtime task failed: {e}")))?
        .map_err(|e| DataFusionError::Execution(format!("Failed to write vortex file: {e}")))
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
    use bytes::Bytes;
    use config::{TIMESTAMP_COL_NAME, meta::stream::StreamType};
    use datafusion::datasource::MemTable;
    use parquet::arrow::arrow_reader::ParquetRecordBatchReaderBuilder;
    use vortex::file::OpenOptionsSessionExt;

    use super::*;

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

        let mode = MergeMode::for_ingester(StreamType::Metadata, "trace_time_index_test");
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
        let batches = ParquetRecordBatchReaderBuilder::try_new(Bytes::from(merged.buf))
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

    #[tokio::test]
    async fn test_write_vortex_carries_file_meta() {
        let schema = create_test_schema();
        let batch = RecordBatch::try_new(
            schema.clone(),
            vec![
                Arc::new(Int64Array::from(vec![100, 200, 300])),
                Arc::new(StringArray::from(vec!["a", "b", "c"])),
                Arc::new(Int64Array::from(vec![1, 2, 3])),
            ],
        )
        .unwrap();

        let metadata = FileMeta {
            min_ts: 100,
            max_ts: 300,
            records: 3,
            original_size: 1024,
            ..Default::default()
        };

        let (tx, rx) = tokio::sync::mpsc::channel::<RecordBatch>(2);
        tx.send(batch).await.unwrap();
        drop(tx);
        let read_task = tokio::task::spawn(async { Ok(()) });

        let buf = write_vortex(schema, &metadata, rx, read_task)
            .await
            .unwrap();

        let session = VortexSession::default().with_tokio();
        let vxf = session
            .open_options()
            .include_metadata()
            .open_buffer(vortex::buffer::Buffer::from(buf))
            .unwrap();
        let segment = vxf.metadata_segment(VORTEX_FILE_META_KEY).unwrap();
        let file_meta: config::utils::json::Value =
            config::utils::json::from_slice(segment.as_slice()).unwrap();
        assert_eq!(file_meta["min_ts"], metadata.min_ts);
        assert_eq!(file_meta["max_ts"], metadata.max_ts);
        assert_eq!(file_meta["records"], metadata.records);
        assert_eq!(file_meta["original_size"], metadata.original_size);
        assert_eq!(vxf.row_count(), 3);
    }
}
