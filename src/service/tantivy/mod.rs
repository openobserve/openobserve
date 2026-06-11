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

mod parallel;
mod reader;
mod sequential;
use std::{collections::HashMap, sync::Arc};

use arrow::array::{
    Array, BooleanArray, Float64Array, Int64Array, LargeStringArray, RecordBatch, StringArray,
    StringViewArray, UInt64Array,
};
use arrow_schema::{DataType, Schema};
use bytes::Bytes;
use config::{
    FileFormat, INDEX_FIELD_NAME_FOR_ALL, PARQUET_MAX_ROW_GROUP_SIZE, TIMESTAMP_COL_NAME,
    get_config, tantivy::tokenizer::O2_TOKENIZER, utils::inverted_index::to_tantivy_name,
};
use hashbrown::HashSet;
use infra::storage;
use tantivy_utils::puffin_directory::{PROP_ROW_GROUP_SIZE, writer::PuffinDirWriter};

pub(crate) async fn create_tantivy_index(
    caller: &str,
    org_id: &str,
    parquet_file_name: &str,
    fts_fields: &[String],
    index_fields: &[String],
    schema: Arc<Schema>,
    buf: Bytes,
) -> Result<usize, anyhow::Error> {
    let start = std::time::Instant::now();
    let cfg = get_config();
    let caller = format!("[{caller}:JOB]");
    let file_format = FileFormat::from_extension(parquet_file_name).unwrap_or_default();
    let thread_num = cfg.compact.tantivy_builder_thread_num;

    let Some(index_schema) = build_tantivy_schema(fts_fields, index_fields, &schema) else {
        return Ok(0);
    };

    let dir = PuffinDirWriter::new();
    let index = if thread_num > 1 {
        parallel::build_index(dir.clone(), file_format, buf, index_schema, thread_num).await?
    } else {
        sequential::build_index(dir.clone(), file_format, buf, index_schema).await?
    };
    if index.is_none() {
        return Ok(0);
    }

    // Record the parquet row group size in effect at index build time so the
    // reader can map doc_ids back to row groups even if the constant changes.
    dir.set_property(PROP_ROW_GROUP_SIZE, PARQUET_MAX_ROW_GROUP_SIZE.to_string());
    let puffin_bytes = dir.to_puffin_bytes()?;
    let index_size = puffin_bytes.len();

    // write fst bytes into disk
    let Some(idx_file_name) = to_tantivy_name(parquet_file_name) else {
        return Ok(0);
    };

    let buf = Bytes::from(puffin_bytes);
    if cfg.cache_latest_files.enabled
        && cfg.cache_latest_files.cache_index
        && cfg.cache_latest_files.download_from_node
    {
        infra::cache::file_data::disk::set(&idx_file_name, buf.clone()).await?;
        log::info!("file: {idx_file_name} file_data::disk::set success");
    }

    // the index file is stored in the same account as the parquet file
    let account = storage::get_account(org_id, parquet_file_name).unwrap_or_default();
    match storage::put(&account, &idx_file_name, buf).await {
        Ok(_) => {
            log::info!(
                "{caller} generated tantivy index file: {idx_file_name}, size {index_size}, took: {} ms",
                start.elapsed().as_millis()
            );
        }
        Err(e) => {
            log::error!("{caller} generated tantivy index file error: {e}");
            return Err(e.into());
        }
    }
    Ok(index_size)
}

/// Bundle of the tantivy schema and the per-row metadata both build paths need.
///
/// Built once by [`build_tantivy_schema`] and shared by the
/// sequential and parallel builders so they don't each rebuild the schema.
#[derive(Clone)]
pub(super) struct TantivyIndexSchema {
    /// The built tantivy schema.
    pub(super) schema: tantivy::schema::Schema,
    /// Set of column names we must populate per row — union of fts fields and
    /// secondary index fields, filtered by data type.
    pub(super) fields: HashSet<String>,
    /// Field handle for `INDEX_FIELD_NAME_FOR_ALL`, present when there is at
    /// least one full-text-search field.
    pub(super) fts_field: Option<tantivy::schema::Field>,
}

/// Builds the tantivy `Schema` shared by both index-build paths.
///
/// Returns `None` when there are no fields to index (configured fields don't
/// intersect with the stream schema).
fn build_tantivy_schema(
    fts_fields: &[String],
    index_fields: &[String],
    arrow_schema: &Schema,
) -> Option<TantivyIndexSchema> {
    let mut tantivy_schema_builder = tantivy::schema::SchemaBuilder::new();
    let schema_fields = arrow_schema
        .fields()
        .iter()
        .map(|f| (f.name(), f))
        .collect::<HashMap<_, _>>();

    let fts_fields_filtered = fts_fields
        .iter()
        .filter(|f| {
            schema_fields.get(f).is_some_and(|v| {
                v.data_type() == &DataType::Utf8 || v.data_type() == &DataType::LargeUtf8
            })
        })
        .map(String::from)
        .collect::<HashSet<_>>();
    let index_fields_filtered = index_fields
        .iter()
        .filter(|f| schema_fields.contains_key(f))
        .map(String::from)
        .collect::<HashSet<_>>();
    let tantivy_fields: HashSet<_> = &fts_fields_filtered | &index_fields_filtered;

    if tantivy_fields.is_empty() {
        return None;
    }

    if !fts_fields_filtered.is_empty() {
        let fts_opts = tantivy::schema::TextOptions::default().set_indexing_options(
            tantivy::schema::TextFieldIndexing::default()
                .set_index_option(tantivy::schema::IndexRecordOption::Basic)
                .set_tokenizer(O2_TOKENIZER)
                .set_fieldnorms(false),
        );
        tantivy_schema_builder.add_text_field(INDEX_FIELD_NAME_FOR_ALL, fts_opts);
    }

    let index_opts = tantivy::schema::TextOptions::default()
        .set_indexing_options(
            tantivy::schema::TextFieldIndexing::default()
                .set_index_option(tantivy::schema::IndexRecordOption::Basic)
                .set_tokenizer("raw")
                .set_fieldnorms(false),
        )
        .set_fast(None);
    for field in index_fields_filtered.iter() {
        if field == TIMESTAMP_COL_NAME {
            continue;
        }
        tantivy_schema_builder.add_text_field(field, index_opts.clone());
    }

    tantivy_schema_builder.add_i64_field(TIMESTAMP_COL_NAME, tantivy::schema::FAST);

    let tantivy_schema = tantivy_schema_builder.build();
    let fts_field = tantivy_schema.get_field(INDEX_FIELD_NAME_FOR_ALL).ok();

    Some(TantivyIndexSchema {
        schema: tantivy_schema,
        fields: tantivy_fields,
        fts_field,
    })
}

macro_rules! process_string_array_sync {
    ($data:expr, $array_type:ty, $docs:expr, $field:expr) => {
        if let Some(array) = $data.as_any().downcast_ref::<$array_type>() {
            for (i, doc) in $docs.iter_mut().enumerate() {
                if array.is_null(i) {
                    doc.add_text($field, "");
                } else {
                    doc.add_text($field, array.value(i));
                }
            }
            continue;
        }
    };
}

macro_rules! process_numeric_array_sync {
    ($data:expr, $array_type:ty, $docs:expr, $field:expr) => {
        if let Some(array) = $data.as_any().downcast_ref::<$array_type>() {
            for (i, doc) in $docs.iter_mut().enumerate() {
                if array.is_null(i) {
                    doc.add_text($field, "");
                } else {
                    let text = array.value(i).to_string();
                    doc.add_text($field, &text);
                }
            }
            continue;
        }
    };
}

// Callers run this inside `spawn_blocking` so the per-row CPU work stays off the async runtime.
pub(super) fn convert_batch_to_docs_sync(
    batch: &RecordBatch,
    index_schema: &TantivyIndexSchema,
) -> Vec<tantivy::TantivyDocument> {
    let tantivy_schema = &index_schema.schema;
    let tantivy_fields = &index_schema.fields;
    let fts_field = index_schema.fts_field;

    let num_rows = batch.num_rows();
    let mut docs = vec![tantivy::doc!(); num_rows];

    for column_name in tantivy_fields.iter() {
        let field = match tantivy_schema.get_field(column_name) {
            Ok(f) => f,
            Err(_) => fts_field.expect("fts field must exist when index field is missing"),
        };

        if let Some(data) = batch.column_by_name(column_name) {
            process_string_array_sync!(data, StringViewArray, docs, field);
            process_string_array_sync!(data, StringArray, docs, field);
            process_string_array_sync!(data, LargeStringArray, docs, field);
            process_numeric_array_sync!(data, Int64Array, docs, field);
            process_numeric_array_sync!(data, UInt64Array, docs, field);
            process_numeric_array_sync!(data, Float64Array, docs, field);
            process_numeric_array_sync!(data, BooleanArray, docs, field);
            for doc in docs.iter_mut() {
                doc.add_text(field, "");
            }
        } else {
            for doc in docs.iter_mut() {
                doc.add_text(field, "");
            }
        }
    }

    let ts_data: &Int64Array = batch
        .column_by_name(TIMESTAMP_COL_NAME)
        .and_then(|c| c.as_any().downcast_ref::<Int64Array>())
        .expect("batch must contain a valid Int64 _timestamp column");
    let ts_field = tantivy_schema.get_field(TIMESTAMP_COL_NAME).unwrap();
    for (i, doc) in docs.iter_mut().enumerate() {
        doc.add_i64(ts_field, ts_data.value(i));
    }

    docs
}

#[cfg(test)]
pub(super) mod tests {
    use std::sync::Arc;

    use arrow::{
        array::{Int64Array, StringArray},
        datatypes::{DataType, Field, Schema},
        record_batch::RecordBatch,
    };
    use config::TIMESTAMP_COL_NAME;

    use super::*;

    /// Helper function to create test record batches.
    /// Shared with [`super::sequential`] and [`super::parallel`] test modules.
    pub(in crate::service::tantivy) fn create_test_batch(
        num_rows: usize,
        include_timestamp: bool,
        include_fts_field: bool,
        include_index_field: bool,
    ) -> RecordBatch {
        let mut fields = Vec::new();
        let mut columns: Vec<Arc<dyn arrow::array::Array>> = Vec::new();

        if include_timestamp {
            fields.push(Field::new(TIMESTAMP_COL_NAME, DataType::Int64, false));
            let timestamps: Vec<i64> = (0..num_rows).map(|i| 1000 + i as i64).collect();
            columns.push(Arc::new(Int64Array::from(timestamps)));
        }

        if include_fts_field {
            fields.push(Field::new("content", DataType::Utf8, false));
            let content: Vec<String> = (0..num_rows)
                .map(|i| format!("Test content number {i}"))
                .collect();
            columns.push(Arc::new(StringArray::from(content)));
        }

        if include_index_field {
            fields.push(Field::new("status", DataType::Utf8, false));
            let status: Vec<String> = (0..num_rows)
                .map(|i| {
                    if i.is_multiple_of(2) {
                        "success".to_string()
                    } else {
                        "error".to_string()
                    }
                })
                .collect();
            columns.push(Arc::new(StringArray::from(status)));
        }

        let schema = Arc::new(Schema::new(fields));
        RecordBatch::try_new(schema, columns).unwrap()
    }

    /// Helper: serializes `batches` to an in-memory parquet file and returns
    /// the raw bytes. Shared by both the stream-based and the new
    /// row_group-direct parallel tests.
    pub(in crate::service::tantivy) async fn create_test_parquet_bytes(
        batches: Vec<RecordBatch>,
    ) -> bytes::Bytes {
        let schema = batches[0].schema();
        let mut buffer = Vec::new();
        let file_meta = config::meta::stream::FileMeta {
            min_ts: 1000,
            max_ts: 2000,
            records: batches.iter().map(|b| b.num_rows()).sum::<usize>() as i64,
            original_size: 1000,
            ..Default::default()
        };
        let mut writer = config::utils::parquet::new_parquet_writer(
            &mut buffer,
            &schema,
            &[],
            &file_meta,
            false,
            None,
        );
        for batch in batches {
            writer.write(&batch).await.unwrap();
        }
        writer.close().await.unwrap();
        bytes::Bytes::from(buffer)
    }

    /// Test helper: build the per-index schema struct or panic on `None`.
    pub(in crate::service::tantivy) fn make_index_schema(
        fts: &[String],
        index: &[String],
        arrow_schema: &Schema,
    ) -> TantivyIndexSchema {
        build_tantivy_schema(fts, index, arrow_schema).expect("schema helper returned None")
    }

    #[tokio::test]
    async fn test_build_tantivy_schema_no_fields() {
        let batch = create_test_batch(10, true, true, true);
        // No fields to index → helper returns None and the orchestrator short-circuits.
        assert!(build_tantivy_schema(&[], &[], &batch.schema()).is_none());
    }

    #[tokio::test]
    async fn test_build_tantivy_schema_missing_fields_in_schema() {
        let batch = create_test_batch(10, true, true, true);
        // Configured fields don't exist in the stream schema → helper returns None
        // and the orchestrator returns 0 without creating an index.
        let result = build_tantivy_schema(
            &["nonexistent_field".to_string()],
            &["another_nonexistent_field".to_string()],
            &batch.schema(),
        );
        assert!(result.is_none());
    }

    #[tokio::test]
    async fn test_create_tantivy_index_with_empty_data() {
        let empty_batch = create_test_batch(0, true, true, true);
        let buf = create_test_parquet_bytes(vec![empty_batch.clone()]).await;

        // Test that create_tantivy_index returns 0 for empty data
        let result = create_tantivy_index(
            "test_caller",
            "default",
            "test_file.parquet",
            &["content".to_string()],
            &["status".to_string()],
            empty_batch.schema(),
            buf,
        )
        .await;

        assert!(result.is_ok());
        assert_eq!(result.unwrap(), 0); // Should return 0 for empty data
    }

    #[tokio::test]
    async fn test_create_tantivy_index_with_no_fields() {
        let batch = create_test_batch(10, true, true, true);
        let buf = create_test_parquet_bytes(vec![batch.clone()]).await;

        // Test that create_tantivy_index returns 0 when no fields to index
        let result = create_tantivy_index(
            "test_caller",
            "default",
            "test_file.parquet",
            &[], // No FTS fields
            &[], // No index fields
            batch.schema(),
            buf,
        )
        .await;

        assert!(result.is_ok());
        assert_eq!(result.unwrap(), 0); // Should return 0 when no fields to index
    }

    #[tokio::test]
    async fn test_create_tantivy_index_with_invalid_parquet_filename() {
        let batch = create_test_batch(10, true, true, true);
        let buf = create_test_parquet_bytes(vec![batch.clone()]).await;

        // Test with an invalid parquet filename that won't convert to tantivy filename
        let result = create_tantivy_index(
            "test_caller",
            "default",
            "invalid_filename", // This won't convert to a valid tantivy filename
            &["content".to_string()],
            &["status".to_string()],
            batch.schema(),
            buf,
        )
        .await;

        assert!(result.is_ok());
        assert_eq!(result.unwrap(), 0); // Should return 0 when filename conversion fails
    }

    // Note: Full testing of create_tantivy_index with storage operations would require
    // mocking the storage layer, which is complex for unit tests. The main logic is
    // tested in sequential::build_index. Integration tests would be more appropriate
    // for testing the full create_tantivy_index function with actual storage operations.
}
