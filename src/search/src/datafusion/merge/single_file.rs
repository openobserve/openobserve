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
    FileFormat,
    meta::stream::FileMeta,
    utils::parquet::{VORTEX_FILE_META_KEY, encode_vortex_file_meta, new_parquet_writer},
};
use datafusion::{
    arrow::datatypes::Schema,
    error::{DataFusionError, Result},
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

use super::{MergeMode, MergeOutput, MergedFile, append_metadata};
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
    // Metadata segments belong to the write options and can't be appended at
    // close time like Parquet metadata, so `records` may drift from the rows written.
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
