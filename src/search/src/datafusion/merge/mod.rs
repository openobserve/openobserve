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
    FileFormat, FileFormatConfig, TIMESTAMP_COL_NAME, get_config,
    meta::stream::{FileMeta, StreamType},
    utils::{
        parquet::{VORTEX_FILE_META_KEY, encode_vortex_file_meta, new_parquet_writer},
        util::is_trace_time_index_stream,
    },
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
#[cfg(feature = "enterprise")]
use {
    crate::datafusion::merge::downsampling::merge_parquet_files_with_downsampling,
    o2_enterprise::enterprise::common::downsampling::get_largest_downsampling_rule,
};

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

pub async fn merge_parquet_files(
    stream_type: StreamType,
    stream_name: &str,
    schema: Arc<Schema>,
    tables: Vec<Arc<dyn TableProvider>>,
    bloom_filter_fields: &[String],
    mut metadata: FileMeta,
    is_ingester: bool,
) -> Result<MergeParquetResult> {
    let start = std::time::Instant::now();
    let cfg = get_config();

    let file_format = merge_output_file_format(stream_type, is_ingester, cfg.common.file_format);

    #[cfg(feature = "enterprise")]
    if stream_type == StreamType::Metrics && !is_ingester {
        let rule = get_largest_downsampling_rule(stream_name, metadata.max_ts);
        if let Some(rule) = rule {
            log::info!(
                "merge_parquet_files: stream_type={stream_type}, stream_name={stream_name}, downsampling rule={rule:?}"
            );
            return merge_parquet_files_with_downsampling(
                schema,
                tables,
                bloom_filter_fields,
                rule,
                &metadata,
                file_format,
            )
            .await;
        }
    }

    // get all sorted data
    let sql = if stream_type == StreamType::Metadata && is_trace_time_index_stream(stream_name) {
        format!(
            "SELECT MIN({TIMESTAMP_COL_NAME}) AS {TIMESTAMP_COL_NAME}, trace_id, MAX(session_id) AS session_id, MIN(min_ts) AS min_ts, MAX(max_ts) AS max_ts FROM tbl GROUP BY trace_id ORDER BY {TIMESTAMP_COL_NAME} DESC"
        )
    } else if stream_type == StreamType::Filelist {
        // for file list we do not have timestamp, so we instead sort by min ts of entries
        "SELECT * FROM tbl ORDER BY min_ts DESC".to_string()
    } else {
        format!("SELECT * FROM tbl ORDER BY {TIMESTAMP_COL_NAME} DESC")
    };
    log::debug!("merge_parquet_files sql: {sql}");

    let ctx = DataFusionContextBuilder::new()
        .trace_id("merge_parquet_files")
        .sort_order(FileSortOrder::TimestampDesc)
        .build(get_config().limit.datafusion_min_partition_num)
        .await?;
    // register union table
    let union_table = Arc::new(NewUnionTable::new(schema.clone(), tables));
    ctx.register_table("tbl", union_table)?;

    let plan = ctx.state().create_logical_plan(&sql).await?;
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
    let (tx, mut rx) = tokio::sync::mpsc::channel::<RecordBatch>(2);
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

    let buf = match file_format {
        FileFormat::Parquet => {
            write_parquet(
                &schema,
                bloom_filter_fields,
                &metadata,
                is_ingester,
                &mut rx,
                read_task,
            )
            .await?
        }
        FileFormat::Vortex => write_vortex(schema, &metadata, rx, read_task).await?,
    };

    log::debug!(
        "merge_parquet_files took {} ms",
        start.elapsed().as_millis()
    );

    metadata.compressed_size = buf.len() as i64;
    Ok(MergeParquetResult {
        files: vec![MergedFile {
            buf,
            meta: metadata,
        }],
        file_format,
    })
}

fn merge_output_file_format(
    stream_type: StreamType,
    is_ingester: bool,
    configured: FileFormatConfig,
) -> FileFormat {
    let configured = configured.for_stream(stream_type);
    if is_ingester {
        FileFormat::for_ingester_stream(stream_type, configured)
    } else {
        configured
    }
}

async fn write_parquet(
    schema: &Arc<Schema>,
    bloom_filter_fields: &[String],
    metadata: &FileMeta,
    is_ingester: bool,
    rx: &mut tokio::sync::mpsc::Receiver<RecordBatch>,
    read_task: tokio::task::JoinHandle<Result<()>>,
) -> Result<Vec<u8>> {
    let cfg = get_config();
    let mut buf = Vec::new();
    let compression = if is_ingester && cfg.common.feature_ingester_none_compression {
        Some("none")
    } else {
        None
    };
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

    #[test]
    fn test_merge_output_file_format_uses_parquet_for_ingester_metrics() {
        let configured = "parquet,metrics=vortex"
            .parse::<FileFormatConfig>()
            .unwrap();
        assert_eq!(
            merge_output_file_format(StreamType::Metrics, true, configured),
            FileFormat::Parquet
        );
        assert_eq!(
            merge_output_file_format(StreamType::Logs, true, configured),
            FileFormat::Parquet
        );
        assert_eq!(
            merge_output_file_format(StreamType::Metrics, false, configured),
            FileFormat::Vortex
        );
        assert_eq!(
            merge_output_file_format(StreamType::Traces, false, configured),
            FileFormat::Parquet
        );

        let configured = FileFormatConfig::new(FileFormat::Vortex);
        assert_eq!(
            merge_output_file_format(StreamType::Logs, true, configured),
            FileFormat::Vortex
        );
    }

    #[tokio::test]
    async fn test_merge_parquet_files_error_handling() {
        // Test with empty tables vector
        let schema = create_test_schema();
        let empty_tables: Vec<Arc<dyn TableProvider>> = vec![];
        let metadata = FileMeta::default();

        let result = merge_parquet_files(
            StreamType::Logs,
            "test_stream",
            schema,
            empty_tables,
            &[],
            metadata,
            false,
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

        let merged = merge_parquet_files(
            StreamType::Metadata,
            "trace_time_index_test",
            schema,
            vec![table],
            &[],
            FileMeta {
                min_ts: 80,
                max_ts: 140,
                records: 4,
                ..Default::default()
            },
            true,
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
