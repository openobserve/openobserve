// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

use std::sync::Arc;

use arrow::array::RecordBatch;
use config::{
    CompactMergeOutput, FileFormat,
    meta::stream::FileMeta,
    utils::parquet::{VORTEX_FILE_META_KEY, encode_vortex_file_meta, new_parquet_writer},
};
use datafusion::{
    arrow::datatypes::Schema,
    error::{DataFusionError, Result},
};
use parquet::arrow::async_writer::AsyncFileWriter;
use vortex::{
    VortexSessionDefault,
    array::ArrayRef,
    arrow::ArrowSessionExt,
    file::VortexWriteOptions,
    io::{VortexWrite, session::RuntimeSessionExt},
    session::VortexSession,
};

use super::{MergeMode, MergeOutput, MergedFile, append_metadata, new_temp_file};
use crate::datafusion::vortex::{VORTEX_RUNTIME, vortex_write_strategy};

pub(super) async fn write(
    schema: Arc<Schema>,
    bloom_filter_fields: &[String],
    mut metadata: FileMeta,
    mode: &MergeMode,
    output: MergeOutput,
    mut rx: tokio::sync::mpsc::Receiver<RecordBatch>,
    read_task: tokio::task::JoinHandle<Result<()>>,
) -> Result<Vec<MergedFile>> {
    // hash-sorted metrics stay buffered: the ingester consumes them in memory
    if output.sink == CompactMergeOutput::Disk && !matches!(mode, MergeMode::MetricsHashSorted) {
        let (file, data_path) = new_temp_file()?;
        let mut meta = match output.file_format {
            FileFormat::Parquet => {
                write_parquet_to(
                    file,
                    &schema,
                    bloom_filter_fields,
                    &metadata,
                    output.parquet_compression,
                    &mut rx,
                    read_task,
                )
                .await?
            }
            FileFormat::Vortex => {
                write_vortex_to(file, schema, &metadata, rx, read_task).await?;
                metadata
            }
        };
        meta.compressed_size = tokio::fs::metadata(&data_path).await?.len() as i64;
        return Ok(vec![MergedFile::StandardFile { data_path, meta }]);
    }

    let buf = match output.file_format {
        FileFormat::Parquet => {
            let mut buf = Vec::new();
            metadata = write_parquet_to(
                &mut buf,
                &schema,
                bloom_filter_fields,
                &metadata,
                output.parquet_compression,
                &mut rx,
                read_task,
            )
            .await?;
            buf
        }
        FileFormat::Vortex => write_vortex_to(Vec::new(), schema, &metadata, rx, read_task).await?,
    };
    metadata.compressed_size = buf.len() as i64;

    Ok(vec![match mode {
        MergeMode::MetricsHashSorted => MergedFile::MetricsHashSorted {
            data: buf,
            meta: metadata,
        },
        _ => MergedFile::Standard {
            data: buf,
            meta: metadata,
        },
    }])
}

/// Returns the file meta with the rows actually written; `compressed_size` is the caller's.
async fn write_parquet_to<W: AsyncFileWriter>(
    sink: W,
    schema: &Arc<Schema>,
    bloom_filter_fields: &[String],
    metadata: &FileMeta,
    compression: Option<&str>,
    rx: &mut tokio::sync::mpsc::Receiver<RecordBatch>,
    read_task: tokio::task::JoinHandle<Result<()>>,
) -> Result<FileMeta> {
    let mut writer = new_parquet_writer(
        sink,
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
    Ok(new_file_meta)
}

/// Encode into `sink` and hand it back once the file is finished.
async fn write_vortex_to<W: VortexWrite + Unpin + 'static>(
    sink: W,
    schema: Arc<Schema>,
    metadata: &FileMeta,
    mut rx: tokio::sync::mpsc::Receiver<RecordBatch>,
    read_task: tokio::task::JoinHandle<Result<()>>,
) -> Result<W> {
    // Metadata segments belong to the write options and can't be appended at
    // close time like Parquet metadata, so `records` may drift from the rows written.
    let file_meta = encode_vortex_file_meta(metadata);
    let writer_task = VORTEX_RUNTIME.spawn_blocking(move || {
        VORTEX_RUNTIME.block_on(async move {
            let mut sink = sink;
            let session = VortexSession::default().with_tokio();
            let dtype = session.arrow().from_arrow_schema(schema.as_ref())?;
            let write_options = VortexWriteOptions::new(session.clone())
                .with_strategy(vortex_write_strategy(&session))
                .with_metadata_segment(VORTEX_FILE_META_KEY, file_meta);
            let mut writer = write_options.writer(&mut sink, dtype);

            while let Some(batch) = rx.recv().await {
                let array: ArrayRef = session
                    .arrow()
                    .from_arrow_record_batch(batch, schema.as_ref())
                    .map_err(|e| {
                        DataFusionError::Execution(format!(
                            "Failed to convert arrow array to vortex array: {e}"
                        ))
                    })?;
                writer.push(array).await?;
            }

            writer.finish().await?;

            Ok::<W, anyhow::Error>(sink)
        })
    });

    // join the writer first: its error is the root cause, the read task only
    // fails with a derived channel SendError
    let buf = writer_task
        .await
        .map_err(|e| DataFusionError::Execution(format!("Vortex runtime task failed: {e}")))?
        .map_err(|e| DataFusionError::Execution(format!("Failed to write vortex file: {e}")))?;
    read_task
        .await
        .map_err(|e| DataFusionError::External(Box::new(e)))??;
    Ok(buf)
}

#[cfg(test)]
mod tests {
    use arrow::array::{Int64Array, StringArray};
    use arrow_schema::{DataType, Field};
    use config::TIMESTAMP_COL_NAME;
    use vortex::file::OpenOptionsSessionExt;

    use super::*;

    #[tokio::test]
    async fn write_parquet_to_file_carries_file_meta() {
        let schema = Arc::new(Schema::new(vec![
            Field::new(TIMESTAMP_COL_NAME, DataType::Int64, false),
            Field::new("field1", DataType::Utf8, true),
        ]));
        let batch = RecordBatch::try_new(
            schema.clone(),
            vec![
                Arc::new(Int64Array::from(vec![300, 200, 100])),
                Arc::new(StringArray::from(vec!["a", "b", "c"])),
            ],
        )
        .unwrap();
        let metadata = FileMeta {
            min_ts: 100,
            max_ts: 300,
            records: 0,
            original_size: 1024,
            ..Default::default()
        };

        let (tx, mut rx) = tokio::sync::mpsc::channel::<RecordBatch>(2);
        tx.send(batch.clone()).await.unwrap();
        drop(tx);
        let read_task = tokio::task::spawn(async { Ok(()) });

        let (file, data_path) = new_temp_file().unwrap();
        let meta = write_parquet_to(file, &schema, &[], &metadata, None, &mut rx, read_task)
            .await
            .unwrap();

        let bytes = std::fs::read(&data_path).unwrap();
        assert_eq!(meta.records, 3);
        let reader = parquet::arrow::arrow_reader::ParquetRecordBatchReaderBuilder::try_new(
            bytes::Bytes::from(bytes),
        )
        .unwrap();
        let footer = reader
            .metadata()
            .file_metadata()
            .key_value_metadata()
            .unwrap();
        let records = footer.iter().find(|kv| kv.key == "records").unwrap();
        assert_eq!(records.value.as_deref(), Some("3"));
        let read: Vec<RecordBatch> = reader.build().unwrap().map(|b| b.unwrap()).collect();
        assert_eq!(read, vec![batch]);
    }

    #[tokio::test]
    async fn test_write_vortex_carries_file_meta() {
        let schema = Arc::new(Schema::new(vec![
            Field::new(TIMESTAMP_COL_NAME, DataType::Int64, false),
            Field::new("field1", DataType::Utf8, true),
            Field::new("field2", DataType::Int64, true),
        ]));
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
        tx.send(batch.clone()).await.unwrap();
        drop(tx);
        let read_task = tokio::task::spawn(async { Ok(()) });

        let buf = write_vortex_to(Vec::new(), schema.clone(), &metadata, rx, read_task)
            .await
            .unwrap();

        // the disk sink must produce the same file
        let (tx, rx) = tokio::sync::mpsc::channel::<RecordBatch>(2);
        tx.send(batch).await.unwrap();
        drop(tx);
        let read_task = tokio::task::spawn(async { Ok(()) });
        let (file, data_path) = new_temp_file().unwrap();
        write_vortex_to(file, schema, &metadata, rx, read_task)
            .await
            .unwrap();
        assert_eq!(std::fs::read(&data_path).unwrap(), buf);

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
