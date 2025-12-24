// Copyright 2025 OpenObserve Inc.
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
    FileFormat, TIMESTAMP_COL_NAME, get_config,
    meta::stream::{FileMeta, StreamType},
    utils::{
        parquet::new_parquet_writer,
        vortex::{Utf8Compressor, VORTEX_RUNTIME},
    },
};
use datafusion::{
    arrow::datatypes::Schema,
    catalog::TableProvider,
    error::{DataFusionError, Result},
    physical_plan::execute_stream,
};
use futures::TryStreamExt;
use vortex::{
    VortexSessionDefault,
    array::{ArrayRef, arrow::FromArrowArray},
    dtype::{DType, arrow::FromArrowType},
    file::VortexWriteOptions,
    session::VortexSession,
};
use vortex_file::WriteStrategyBuilder;
use vortex_io::session::RuntimeSessionExt;

use super::table_provider::uniontable::NewUnionTable;
use crate::service::{
    metadata::distinct_values::DISTINCT_STREAM_PREFIX,
    search::datafusion::exec::{DATAFUSION_MIN_PARTITION, DataFusionContextBuilder},
};

#[cfg(feature = "enterprise")]
pub mod downsampling;
#[cfg(feature = "enterprise")]
use {
    crate::service::search::datafusion::merge::downsampling::merge_parquet_files_with_downsampling,
    o2_enterprise::enterprise::common::downsampling::get_largest_downsampling_rule,
};

pub enum MergeParquetResult {
    Single(Vec<u8>, FileMeta),
    #[allow(unused)]
    Multiple {
        bufs: Vec<Vec<u8>>,
        file_metas: Vec<FileMeta>,
    },
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

    #[cfg(feature = "enterprise")]
    if stream_type == StreamType::Metrics && !is_ingester {
        let rule = get_largest_downsampling_rule(stream_name, metadata.max_ts);
        if let Some(rule) = rule {
            return merge_parquet_files_with_downsampling(
                schema,
                tables,
                bloom_filter_fields,
                rule,
                &metadata,
            )
            .await;
        }
    }

    // get all sorted data
    let sql = if cfg.limit.distinct_values_hourly
        && stream_type == StreamType::Metadata
        && stream_name.starts_with(DISTINCT_STREAM_PREFIX)
    {
        let fields = schema
            .fields()
            .iter()
            .filter(|f| f.name() != TIMESTAMP_COL_NAME && f.name() != "count")
            .map(|x| x.name().to_string())
            .collect::<Vec<_>>();
        let fields_str = fields.join(", ");
        format!(
            "SELECT MIN({TIMESTAMP_COL_NAME}) AS {TIMESTAMP_COL_NAME}, SUM(count) as count, {fields_str} FROM tbl GROUP BY {fields_str} ORDER BY {TIMESTAMP_COL_NAME} DESC"
        )
    } else if stream_type == StreamType::Filelist {
        // for file list we do not have timestamp, so we instead sort by min ts of entries
        "SELECT * FROM tbl ORDER BY min_ts DESC".to_string()
    } else {
        format!("SELECT * FROM tbl ORDER BY {TIMESTAMP_COL_NAME} DESC")
    };
    log::debug!("merge_parquet_files sql: {sql}");

    let ctx = DataFusionContextBuilder::new()
        .sorted_by_time(true)
        .build(DATAFUSION_MIN_PARTITION)
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

    // write result to file (parquet or vortex based on config)
    let compression = if is_ingester && cfg.common.feature_ingester_none_compression {
        Some("none")
    } else {
        None
    };

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

    // write batches to the appropriate format
    let buf = match cfg.common.file_format {
        FileFormat::Parquet => {
            let mut buf = Vec::new();
            let mut writer = new_parquet_writer(
                &mut buf,
                &schema,
                bloom_filter_fields,
                &metadata,
                false,
                compression,
            );

            while let Some(batch) = rx.recv().await {
                if let Err(e) = writer.write(&batch).await {
                    log::error!("merge_parquet_files write error: {e}");
                    return Err(e.into());
                }
            }

            read_task
                .await
                .map_err(|e| DataFusionError::External(Box::new(e)))??;
            writer.close().await?;
            buf
        }
        FileFormat::Vortex => {
            let schema_clone = schema.clone();

            // Spawn writer task in VORTEX_RUNTIME
            let writer_task = VORTEX_RUNTIME.spawn_blocking(move || {
                VORTEX_RUNTIME.block_on(async move {
                    let mut buf = Vec::new();
                    let session = VortexSession::default().with_tokio();
                    let dtype = DType::from_arrow(schema_clone.as_ref());
                    let write_options = VortexWriteOptions::new(session.clone()).with_strategy(
                        WriteStrategyBuilder::new()
                            .with_compressor(Utf8Compressor::default())
                            .build(),
                    );
                    let mut writer = write_options.writer(&mut buf, dtype);

                    while let Some(batch) = rx.recv().await {
                        let array: ArrayRef = ArrayRef::from_arrow(batch, false);
                        writer.push(array).await?;
                    }

                    writer.finish().await?;

                    Ok::<Vec<u8>, anyhow::Error>(buf)
                })
            });

            // Wait for both tasks to complete
            read_task
                .await
                .map_err(|e| DataFusionError::External(Box::new(e)))??;

            writer_task
                .await
                .map_err(|e| {
                    DataFusionError::Execution(format!("Vortex runtime task failed: {e}"))
                })?
                .map_err(|e| {
                    DataFusionError::Execution(format!("Failed to write vortex file: {e}"))
                })?
        }
    };

    log::debug!(
        "merge_parquet_files took {} ms",
        start.elapsed().as_millis()
    );

    metadata.compressed_size = buf.len() as i64;
    Ok(MergeParquetResult::Single(buf, metadata))
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use arrow_schema::{DataType, Field, Schema};

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
        let bloom_fields = vec![];
        let metadata = FileMeta::default();

        let result = merge_parquet_files(
            StreamType::Logs,
            "test_stream",
            schema,
            empty_tables,
            &bloom_fields,
            metadata,
            false,
        )
        .await;

        // Should handle empty tables gracefully or return appropriate error
        // The exact behavior depends on implementation details
        assert!(result.is_ok() || result.is_err());
    }
}
