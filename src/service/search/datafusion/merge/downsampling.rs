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

use arrow::array::{Int64Array, RecordBatch};
use config::{
    TIMESTAMP_COL_NAME, get_config,
    meta::{
        promql::{DownsamplingRule, Function, HASH_LABEL, VALUE_LABEL},
        stream::FileMeta,
    },
    utils::parquet::new_parquet_writer,
};
use datafusion::{
    arrow::datatypes::Schema,
    catalog::TableProvider,
    error::{DataFusionError, Result},
    physical_plan::execute_stream,
};
use futures::TryStreamExt;

use crate::service::search::datafusion::{
    exec::{DATAFUSION_MIN_PARTITION, DataFusionContextBuilder},
    merge::{MergeParquetResult, append_metadata},
    table_provider::uniontable::NewUnionTable,
};

const TIMESTAMP_ALIAS: &str = "_timestamp_alias";

pub async fn merge_parquet_files_with_downsampling(
    schema: Arc<Schema>,
    tables: Vec<Arc<dyn TableProvider>>,
    bloom_filter_fields: &[String],
    rule: &DownsamplingRule,
    metadata: &FileMeta,
) -> Result<(Arc<Schema>, MergeParquetResult)> {
    let start = std::time::Instant::now();
    let cfg = get_config();
    let mut metadata = metadata.clone();
    // assume that the metrics data is sampled at a point every 15 seconds, and then estimate the
    // records, used for bloom filter.
    let step = if rule.step < 15 { 15 } else { rule.step };
    metadata.records = (metadata.records * 15) / step;

    let sql = generate_downsampling_sql(&schema, rule);

    log::debug!("merge_parquet_files_with_downsampling sql: {sql}");

    // create datafusion context
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

    // write result to parquet file
    let mut bufs = Vec::new();
    let mut file_metas = Vec::new();
    let mut min_ts = 0;

    let mut buf = Vec::with_capacity(cfg.compact.max_file_size as usize);
    let mut file_meta = FileMeta::default();
    let mut writer = new_parquet_writer(
        &mut buf,
        &schema,
        bloom_filter_fields,
        &metadata,
        false,
        None,
    );
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
                        log::error!(
                            "merge_parquet_files_with_downsampling write to channel error: {e}"
                        );
                        return Err(DataFusionError::External(Box::new(e)));
                    }
                }
                Err(e) => {
                    log::error!("merge_parquet_files_with_downsampling execute stream error: {e}");
                    return Err(e);
                }
            }
        }
        Ok(())
    });
    while let Some(batch) = rx.recv().await {
        if file_meta.max_ts == 0 {
            file_meta.max_ts = get_max_timestamp(&batch);
        }
        file_meta.original_size += batch.get_array_memory_size() as i64;
        file_meta.records += batch.num_rows() as i64;
        min_ts = get_min_timestamp(&batch);
        if file_meta.original_size > cfg.compact.max_file_size as i64 {
            file_meta.min_ts = min_ts;
            append_metadata(&mut writer, &file_meta)?;
            writer.close().await?;
            bufs.push(std::mem::take(&mut buf));
            file_metas.push(file_meta);

            // reset for next file
            buf.clear();
            file_meta = FileMeta::default();
            writer = new_parquet_writer(
                &mut buf,
                &schema,
                bloom_filter_fields,
                &metadata,
                false,
                None,
            );
        }
        if let Err(e) = writer.write(&batch).await {
            log::error!("merge_parquet_files_with_downsampling write Error: {e}");
            return Err(e.into());
        }
    }
    task.await
        .map_err(|e| DataFusionError::External(Box::new(e)))??;

    if file_meta.original_size > 0 {
        file_meta.min_ts = min_ts;
        append_metadata(&mut writer, &file_meta)?;
        writer.close().await?;
        bufs.push(std::mem::take(&mut buf));
        file_metas.push(file_meta);
    }

    ctx.deregister_table("tbl")?;
    drop(ctx);

    log::debug!(
        "merge_parquet_files_with_downsampling took {} ms",
        start.elapsed().as_millis()
    );

    Ok((schema, MergeParquetResult::Multiple { bufs, file_metas }))
}

fn generate_downsampling_sql(schema: &Arc<Schema>, rule: &DownsamplingRule) -> String {
    let step = rule.step;
    let fields = schema
        .fields()
        .iter()
        .filter_map(|f| {
            if f.name() != HASH_LABEL && f.name() != VALUE_LABEL && f.name() != TIMESTAMP_COL_NAME {
                Some(format!("max({}) as {}", f.name(), f.name()))
            } else {
                None
            }
        })
        .collect::<Vec<_>>();

    let fun_str = if rule.function == Function::Last || rule.function == Function::First {
        format!(
            "{}({} ORDER BY {} ASC) as {}",
            rule.function.fun(),
            VALUE_LABEL,
            TIMESTAMP_COL_NAME,
            VALUE_LABEL
        )
    } else {
        format!(
            "{}({}) as {}",
            rule.function.fun(),
            VALUE_LABEL,
            VALUE_LABEL
        )
    };

    let sql = format!(
        "SELECT {}, to_unixtime(date_bin(interval '{} second', to_timestamp_micros({}), to_timestamp('2001-01-01T00:00:00'))) * 1000000 as {}, {}, {} FROM tbl GROUP BY {}, {}",
        HASH_LABEL,
        step,
        TIMESTAMP_COL_NAME,
        TIMESTAMP_ALIAS,
        fields.join(", "),
        fun_str,
        HASH_LABEL,
        TIMESTAMP_ALIAS,
    );

    let fields = schema
        .fields()
        .iter()
        .filter_map(|f| {
            if f.name() != HASH_LABEL && f.name() != VALUE_LABEL && f.name() != TIMESTAMP_COL_NAME {
                Some(f.name().to_string())
            } else {
                None
            }
        })
        .collect::<Vec<_>>();
    format!(
        "SELECT {}, {}, {}, {} AS {} FROM ({}) ORDER BY {} DESC",
        HASH_LABEL,
        VALUE_LABEL,
        fields.join(", "),
        TIMESTAMP_ALIAS,
        TIMESTAMP_COL_NAME,
        sql,
        TIMESTAMP_ALIAS,
    )
}

fn get_max_timestamp(record_batch: &RecordBatch) -> i64 {
    record_batch
        .column_by_name(TIMESTAMP_COL_NAME)
        .unwrap()
        .slice(0, 1)
        .as_any()
        .downcast_ref::<Int64Array>()
        .unwrap()
        .value(0)
}

fn get_min_timestamp(record_batch: &RecordBatch) -> i64 {
    record_batch
        .column_by_name(TIMESTAMP_COL_NAME)
        .unwrap()
        .slice(record_batch.num_rows() - 1, 1)
        .as_any()
        .downcast_ref::<Int64Array>()
        .unwrap()
        .value(0)
}
#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use arrow::array::{Int64Array, RecordBatch, StringArray};
    use arrow_schema::{DataType, Field, Schema};

    use super::*;

    fn create_test_schema() -> Arc<Schema> {
        Arc::new(Schema::new(vec![
            Field::new(TIMESTAMP_COL_NAME, DataType::Int64, false),
            Field::new("field1", DataType::Utf8, true),
            Field::new("field2", DataType::Int64, true),
        ]))
    }

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
    fn test_get_max_timestamp() {
        let batch = create_test_record_batch();
        let max_ts = get_max_timestamp(&batch);
        assert_eq!(max_ts, 1000); // first row in timestamp column
    }

    #[test]
    fn test_get_min_timestamp() {
        let batch = create_test_record_batch();
        let min_ts = get_min_timestamp(&batch);
        assert_eq!(min_ts, 3000); // last row in timestamp column
    }

    #[test]
    fn test_generate_downsampling_sql() {
        use config::meta::promql::{DownsamplingRule, Function};

        let schema = Arc::new(Schema::new(vec![
            Field::new("__hash__", DataType::Utf8, false),
            Field::new("__value__", DataType::Float64, false),
            Field::new(TIMESTAMP_COL_NAME, DataType::Int64, false),
            Field::new("instance", DataType::Utf8, true),
        ]));

        let rule = DownsamplingRule {
            rule: None,
            function: Function::Avg,
            offset: 0,
            step: 300, // 5 minutes
        };

        let sql = generate_downsampling_sql(&schema, &rule);

        // Basic checks that SQL contains expected elements
        assert!(sql.contains("GROUP BY"));
        assert!(sql.contains("__hash__"));
        assert!(sql.contains("__value__"));
        assert!(sql.contains("300 second"));
        assert!(sql.contains("ORDER BY"));
    }
}
