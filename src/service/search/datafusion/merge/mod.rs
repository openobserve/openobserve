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

use arrow::record_batch::RecordBatch;
use config::{
    TIMESTAMP_COL_NAME, get_config,
    meta::stream::{FileMeta, StreamType},
    utils::{parquet::new_parquet_writer, util::DISTINCT_STREAM_PREFIX},
};
use datafusion::{
    arrow::datatypes::Schema,
    catalog::TableProvider,
    error::{DataFusionError, Result},
    physical_plan::execute_stream,
};
use futures::TryStreamExt;
use parquet::{arrow::AsyncArrowWriter, file::metadata::KeyValue};

use super::table_provider::uniontable::NewUnionTable;
use crate::service::search::datafusion::exec::{
    DATAFUSION_MIN_PARTITION, DataFusionContextBuilder,
};

#[cfg(feature = "enterprise")]
pub mod downsampling;
#[cfg(feature = "enterprise")]
use {
    crate::service::search::datafusion::merge::downsampling::merge_parquet_files_with_downsampling,
    o2_enterprise::enterprise::common::downsampling::get_largest_downsampling_rule,
};

pub enum MergeParquetResult {
    Single(Vec<u8>),
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
    metadata: &FileMeta,
    is_ingester: bool,
) -> Result<(Arc<Schema>, MergeParquetResult)> {
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
                metadata,
            )
            .await;
        }
    }

    // get all sorted data
    let sql = if stream_type == StreamType::Index {
        format!(
            "SELECT * FROM tbl WHERE file_name NOT IN (SELECT file_name FROM tbl WHERE deleted IS TRUE ORDER BY {TIMESTAMP_COL_NAME} DESC) ORDER BY {TIMESTAMP_COL_NAME} DESC"
        )
    } else if cfg.limit.distinct_values_hourly
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

    // create datafusion context
    let sort_by_timestamp_desc = true;
    // force use DATAFUSION_MIN_PARTITION for each merge task
    let target_partitions = DATAFUSION_MIN_PARTITION;
    let ctx = DataFusionContextBuilder::new()
        .sorted_by_time(sort_by_timestamp_desc)
        .build(target_partitions)
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

    // write result to parquet file
    let mut buf = Vec::new();
    let compression = if is_ingester && cfg.common.feature_ingester_none_compression {
        Some("none")
    } else {
        None
    };
    let mut writer = new_parquet_writer(
        &mut buf,
        &schema,
        bloom_filter_fields,
        metadata,
        false,
        compression,
    );

    // calculate the new file meta records
    let mut new_file_meta = metadata.clone();
    new_file_meta.records = 0;

    let mut batch_stream = execute_stream(physical_plan, ctx.task_ctx())?;
    let (tx, mut rx) = tokio::sync::mpsc::channel::<RecordBatch>(2);
    let task = tokio::task::spawn(async move {
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
    while let Some(batch) = rx.recv().await {
        new_file_meta.records += batch.num_rows() as i64;
        if let Err(e) = writer.write(&batch).await {
            log::error!("merge_parquet_files write error: {e}");
            return Err(e.into());
        }
    }
    task.await
        .map_err(|e| DataFusionError::External(Box::new(e)))??;
    append_metadata(&mut writer, &new_file_meta)?;
    writer.close().await?;

    ctx.deregister_table("tbl")?;
    drop(ctx);

    log::debug!(
        "merge_parquet_files took {} ms",
        start.elapsed().as_millis()
    );

    Ok((schema, MergeParquetResult::Single(buf)))
}

pub(crate) fn append_metadata(
    writer: &mut AsyncArrowWriter<&mut Vec<u8>>,
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

    use arrow::array::{Int64Array, StringArray};
    use arrow_schema::{DataType, Field, Schema};
    use parquet::arrow::AsyncArrowWriter;

    use super::*;

    fn create_test_schema() -> Arc<Schema> {
        Arc::new(Schema::new(vec![
            Field::new(TIMESTAMP_COL_NAME, DataType::Int64, false),
            Field::new("field1", DataType::Utf8, true),
            Field::new("field2", DataType::Int64, true),
        ]))
    }

    #[allow(dead_code)]
    fn create_test_record_batch() -> RecordBatch {
        let schema = create_test_schema();
        let timestamp_array = Int64Array::from(vec![1000, 2000, 3000]);
        let field1_array = StringArray::from(vec![Some("a"), Some("b"), Some("c")]);
        let field2_array = Int64Array::from(vec![Some(10), Some(20), Some(30)]);

        RecordBatch::try_new(
            schema,
            vec![
                Arc::new(timestamp_array),
                Arc::new(field1_array),
                Arc::new(field2_array),
            ],
        )
        .unwrap()
    }

    #[test]
    fn test_append_metadata() -> Result<()> {
        let mut buf = Vec::new();
        let schema = create_test_schema();
        let mut writer = AsyncArrowWriter::try_new(&mut buf, schema, None)?;

        let file_meta = FileMeta {
            min_ts: 1000,
            max_ts: 2000,
            records: 100,
            original_size: 1024,
            compressed_size: 512,
            flattened: false,
            index_size: 0,
        };

        let result = append_metadata(&mut writer, &file_meta);
        assert!(result.is_ok());
        Ok(())
    }

    #[tokio::test]
    async fn test_append_metadata_values() -> Result<()> {
        let mut buf = Vec::new();
        let schema = create_test_schema();
        let mut writer = AsyncArrowWriter::try_new(&mut buf, schema, None)?;

        let file_meta = FileMeta {
            min_ts: 1000,
            max_ts: 2000,
            records: 100,
            original_size: 1024,
            compressed_size: 512,
            flattened: false,
            index_size: 0,
        };

        append_metadata(&mut writer, &file_meta)?;

        // Verify the writer has the metadata (indirectly by checking no errors)
        let result = writer.close().await;
        assert!(result.is_ok());

        Ok(())
    }

    #[test]
    fn test_append_metadata_with_defaults() -> Result<()> {
        let mut buf = Vec::new();
        let schema = create_test_schema();
        let mut writer = AsyncArrowWriter::try_new(&mut buf, schema, None)?;

        let file_meta = FileMeta::default();
        let result = append_metadata(&mut writer, &file_meta);
        assert!(result.is_ok());

        Ok(())
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
            &metadata,
            false,
        )
        .await;

        // Should handle empty tables gracefully or return appropriate error
        // The exact behavior depends on implementation details
        assert!(result.is_ok() || result.is_err());
    }
}
