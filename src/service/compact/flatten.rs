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

use ::datafusion::arrow::datatypes::Schema;
use arrow::array::{
    ArrayBuilder, ArrayRef, RecordBatch, StringArray, StringBuilder, make_builder, new_null_array,
};
use arrow_schema::{DataType, Field};
use config::{
    FxIndexMap,
    cluster::LOCAL_NODE,
    get_config,
    meta::{
        cluster::Role,
        stream::{FileKey, PartitionTimeLevel, StreamType},
    },
    utils::{
        json,
        parquet::{read_recordbatch_from_bytes, write_recordbatch_to_parquet},
        time::{BASE_TIME, now_micros},
    },
};
use hashbrown::HashSet;
use infra::{cluster::get_node_from_consistent_hash, file_list as infra_file_list, storage};
use once_cell::sync::Lazy;
use parking_lot::RwLock;
use tokio::sync::{Semaphore, mpsc};

use crate::service::db;

static PROCESSING_FILES: Lazy<RwLock<HashSet<String>>> = Lazy::new(|| RwLock::new(HashSet::new()));

pub async fn run_generate(worker_tx: mpsc::Sender<FileKey>) -> Result<(), anyhow::Error> {
    let semaphore = std::sync::Arc::new(Semaphore::new(get_config().limit.file_merge_thread_num));
    let orgs = db::schema::list_organizations_from_cache().await;
    let stream_types = [StreamType::Logs];
    for org_id in orgs {
        // check backlist
        if !db::file_list::BLOCKED_ORGS.is_empty() && db::file_list::BLOCKED_ORGS.contains(&org_id)
        {
            continue;
        }
        for stream_type in stream_types {
            let streams = db::schema::list_streams_from_cache(&org_id, stream_type).await;
            let mut tasks = Vec::with_capacity(streams.len());
            for stream_name in streams {
                // check if this stream need flatten
                let stream_setting =
                    infra::schema::get_settings(&org_id, &stream_name, stream_type)
                        .await
                        .unwrap_or_default();
                let defined_schema_fields = stream_setting.defined_schema_fields;
                if defined_schema_fields.is_empty() {
                    continue;
                }

                // check running node
                let Some(node_name) =
                    get_node_from_consistent_hash(&stream_name, &Role::FlattenCompactor, None)
                        .await
                else {
                    continue; // no compactor node
                };
                if LOCAL_NODE.name.ne(&node_name) {
                    continue; // not this node
                }

                let org_id = org_id.clone();
                let permit = semaphore.clone().acquire_owned().await.unwrap();
                let worker_tx = worker_tx.clone();
                let task = tokio::task::spawn(async move {
                    if let Err(e) =
                        generate_by_stream(worker_tx, &org_id, stream_type, &stream_name).await
                    {
                        log::error!(
                            "[FLATTEN_COMPACTOR] generate_by_stream [{org_id}/{stream_type}/{stream_name}] error: {e}"
                        );
                    }
                    drop(permit);
                });
                tasks.push(task);
            }
            for task in tasks {
                task.await?;
            }
        }
    }

    Ok(())
}

pub async fn generate_by_stream(
    worker_tx: mpsc::Sender<FileKey>,
    org_id: &str,
    stream_type: StreamType,
    stream_name: &str,
) -> Result<(), anyhow::Error> {
    let start = std::time::Instant::now();

    // get pending flatten files for this stream
    let files = infra_file_list::query(
        org_id,
        stream_type,
        stream_name,
        PartitionTimeLevel::Hourly,
        (BASE_TIME.timestamp_micros(), now_micros()),
        Some(false),
    )
    .await?;

    if files.is_empty() {
        return Ok(()); // no files need to generate
    }

    log::info!(
        "[FLATTEN_COMPACTOR] generate_by_stream [{}/{}/{}] got files: {}, took: {} ms",
        org_id,
        stream_type,
        stream_name,
        files.len(),
        start.elapsed().as_millis()
    );

    for file in files {
        if PROCESSING_FILES.read().contains(&file.key) {
            continue;
        }
        // add into queue
        PROCESSING_FILES.write().insert(file.key.clone());
        worker_tx.send(file).await?;
    }

    Ok(())
}

pub async fn generate_file(file: &FileKey) -> Result<(), anyhow::Error> {
    let start = std::time::Instant::now();
    log::debug!("[FLATTEN_COMPACTOR] generate flatten file for {}", file.key);

    let data = storage::get_bytes(&file.account, &file.key).await?;
    let (_, batches) = read_recordbatch_from_bytes(&data)
        .await
        .map_err(|e| anyhow::anyhow!("read_recordbatch_from_bytes error: {}", e))?;
    let new_batches = generate_vertical_partition_recordbatch(&batches)
        .map_err(|e| anyhow::anyhow!("generate_vertical_partition_recordbatch error: {}", e))?;

    if new_batches.is_empty() {
        storage::del(vec![(&file.account, &file.key)]).await?;
        return Ok(());
    }
    let columns = file.key.splitn(9, '/').collect::<Vec<&str>>();
    if columns.len() < 9 {
        return Err(anyhow::anyhow!(
            "[FLATTEN_COMPACTOR] Invalid file path: {}",
            file.key
        ));
    }
    let org_id = columns[1];
    let stream_type = StreamType::from(columns[2]);
    let stream_name = columns[3];
    let stream_setting = infra::schema::get_settings(org_id, stream_name, stream_type)
        .await
        .unwrap_or_default();
    let bloom_filter_fields = stream_setting.bloom_filter_fields;
    let new_file = format!(
        "files{}/{}",
        get_config().common.column_all,
        file.key.strip_prefix("files/").unwrap()
    );
    let new_schema = new_batches.first().unwrap().schema();
    let new_data =
        write_recordbatch_to_parquet(new_schema, &new_batches, &bloom_filter_fields, &file.meta)
            .await
            .map_err(|e| anyhow::anyhow!("write_recordbatch_to_parquet error: {}", e))?;
    // upload filee
    storage::put(&file.account, &new_file, new_data.into()).await?;
    // delete from queue
    PROCESSING_FILES.write().remove(&file.key);
    log::info!(
        "[FLATTEN_COMPACTOR] generated flatten new file {}, took {} ms",
        new_file,
        start.elapsed().as_millis()
    );
    // update file list
    infra_file_list::update_flattened(&file.key, true).await?;
    Ok(())
}

fn generate_vertical_partition_recordbatch(
    batches: &[RecordBatch],
) -> Result<Vec<RecordBatch>, anyhow::Error> {
    if batches.is_empty() {
        return Ok(Vec::new());
    }
    let schema = batches.first().unwrap().schema();
    let batches = arrow::compute::concat_batches(&schema, batches)?;
    let records_len = batches.num_rows();
    if records_len == 0 {
        return Ok(Vec::new());
    }
    let Ok(all_field_idx) = schema.index_of(&get_config().common.column_all) else {
        return Ok(vec![batches]);
    };

    let mut builders: FxIndexMap<String, Box<dyn ArrayBuilder>> = Default::default();
    let Some(all_values) = batches
        .column(all_field_idx)
        .as_any()
        .downcast_ref::<StringArray>()
    else {
        return Ok(vec![batches]);
    };

    let mut inserted_fields = HashSet::with_capacity(128);
    for i in 0..records_len {
        inserted_fields.clear();
        let value = all_values.value(i);
        let data = if value.is_empty() {
            json::Value::Object(Default::default())
        } else {
            json::from_str(value).map_err(|e| {
                anyhow::anyhow!("parse all fields value error: {}, value: {}", e, value)
            })?
        };
        let items = data.as_object().unwrap();
        for (key, val) in items {
            let builder = builders.entry(key.to_string()).or_insert_with(|| {
                let mut builder = make_builder(&DataType::Utf8, records_len);
                if i > 0 {
                    let b = builder
                        .as_any_mut()
                        .downcast_mut::<StringBuilder>()
                        .unwrap();
                    for _ in 0..i {
                        b.append_null();
                    }
                }
                builder
            });
            let b = builder
                .as_any_mut()
                .downcast_mut::<StringBuilder>()
                .unwrap();
            if val.is_null() {
                b.append_null();
            } else {
                b.append_value(json::get_string_value(val));
            }
            inserted_fields.insert(key.to_string());
        }
        for (key, builder) in builders.iter_mut() {
            if !inserted_fields.contains(key) {
                let b = builder
                    .as_any_mut()
                    .downcast_mut::<StringBuilder>()
                    .unwrap();
                b.append_null();
            }
        }
    }

    let mut fields = schema.fields().iter().cloned().collect::<Vec<_>>();
    let mut cols: Vec<ArrayRef> = Vec::with_capacity(schema.fields().len() + builders.len());
    for i in 0..schema.fields().len() {
        if i == all_field_idx {
            cols.push(new_null_array(&DataType::Utf8, records_len));
        } else {
            cols.push(batches.column(i).clone());
        }
    }
    for (key, builder) in builders.iter_mut() {
        fields.push(Arc::new(Field::new(key, DataType::Utf8, true)));
        cols.push(builder.finish());
    }

    let schema = Arc::new(Schema::new(fields));
    Ok(vec![RecordBatch::try_new(schema, cols)?])
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use arrow::{
        array::{Array, ArrayRef, StringArray},
        record_batch::RecordBatch,
    };
    use arrow_schema::{DataType, Field, Schema};

    use super::*;

    // Helper function to create a record batch with the "_all" field
    fn create_test_batch_with_all_field(
        all_field_values: Vec<Option<&str>>,
        additional_fields: Vec<(&str, Vec<Option<&str>>)>,
    ) -> RecordBatch {
        let mut fields = vec![Field::new("_all", DataType::Utf8, true)];
        let mut columns: Vec<ArrayRef> = vec![Arc::new(StringArray::from(all_field_values))];

        for (field_name, field_values) in additional_fields {
            fields.push(Field::new(field_name, DataType::Utf8, true));
            columns.push(Arc::new(StringArray::from(field_values)));
        }

        let schema = Arc::new(Schema::new(fields));
        RecordBatch::try_new(schema, columns).unwrap()
    }

    // Helper function to create a record batch without the "_all" field
    fn create_test_batch_without_all_field(
        fields_and_values: Vec<(&str, Vec<Option<&str>>)>,
    ) -> RecordBatch {
        let mut fields = vec![];
        let mut columns: Vec<ArrayRef> = vec![];

        for (field_name, field_values) in fields_and_values {
            fields.push(Field::new(field_name, DataType::Utf8, true));
            columns.push(Arc::new(StringArray::from(field_values)));
        }

        let schema = Arc::new(Schema::new(fields));
        RecordBatch::try_new(schema, columns).unwrap()
    }

    #[test]
    fn test_generate_vertical_partition_recordbatch_empty_batches() {
        let batches = vec![];
        let result = generate_vertical_partition_recordbatch(&batches);
        assert!(result.is_ok());
        assert!(result.unwrap().is_empty());
    }

    #[test]
    fn test_generate_vertical_partition_recordbatch_no_all_field() {
        let batch = create_test_batch_without_all_field(vec![
            ("field1", vec![Some("value1"), Some("value2")]),
            ("field2", vec![Some("100"), Some("200")]),
        ]);
        let batches = vec![batch.clone()];

        let result = generate_vertical_partition_recordbatch(&batches);
        assert!(result.is_ok());

        let output_batches = result.unwrap();
        assert_eq!(output_batches.len(), 1);

        // Should return the original batch unchanged since there's no "_all" field
        let output_batch = &output_batches[0];
        assert_eq!(output_batch.num_rows(), batch.num_rows());
        assert_eq!(output_batch.num_columns(), batch.num_columns());
    }

    #[test]
    fn test_generate_vertical_partition_recordbatch_simple_json() {
        let json_values = vec![
            Some(r#"{"name": "Alice", "age": "30"}"#),
            Some(r#"{"name": "Bob", "age": "25"}"#),
        ];

        let batch =
            create_test_batch_with_all_field(json_values, vec![("id", vec![Some("1"), Some("2")])]);
        let batches = vec![batch];

        let result = generate_vertical_partition_recordbatch(&batches);
        assert!(result.is_ok());

        let output_batches = result.unwrap();
        assert_eq!(output_batches.len(), 1);

        let output_batch = &output_batches[0];
        assert_eq!(output_batch.num_rows(), 2);

        // Should have original fields + extracted JSON fields
        let schema = output_batch.schema();
        let field_names: Vec<&str> = schema.fields().iter().map(|f| f.name().as_str()).collect();

        assert!(field_names.contains(&"_all")); // Should be null column now
        assert!(field_names.contains(&"id")); // Original field
        assert!(field_names.contains(&"name")); // Extracted from JSON
        assert!(field_names.contains(&"age")); // Extracted from JSON

        // Check that "_all" field is now null
        let all_field_index = schema.index_of("_all").unwrap();
        let all_column = output_batch.column(all_field_index);
        assert!(all_column.is_null(0));
        assert!(all_column.is_null(1));

        // Check extracted values
        let name_index = schema.index_of("name").unwrap();
        let name_column = output_batch
            .column(name_index)
            .as_any()
            .downcast_ref::<StringArray>()
            .unwrap();
        assert_eq!(name_column.value(0), "Alice");
        assert_eq!(name_column.value(1), "Bob");

        let age_index = schema.index_of("age").unwrap();
        let age_column = output_batch
            .column(age_index)
            .as_any()
            .downcast_ref::<StringArray>()
            .unwrap();
        assert_eq!(age_column.value(0), "30");
        assert_eq!(age_column.value(1), "25");
    }

    #[test]
    fn test_generate_vertical_partition_recordbatch_missing_fields() {
        let json_values = vec![
            Some(r#"{"name": "Alice", "age": "30", "city": "NYC"}"#),
            Some(r#"{"name": "Bob", "country": "USA"}"#), // Missing age and city, has country
            Some(r#"{"age": "35"}"#),                     // Missing name, city, and country
        ];

        let batch = create_test_batch_with_all_field(json_values, vec![]);
        let batches = vec![batch];

        let result = generate_vertical_partition_recordbatch(&batches);
        assert!(result.is_ok());

        let output_batches = result.unwrap();
        assert_eq!(output_batches.len(), 1);

        let output_batch = &output_batches[0];
        assert_eq!(output_batch.num_rows(), 3);

        let schema = output_batch.schema();

        // Check name field
        let name_index = schema.index_of("name").unwrap();
        let name_column = output_batch
            .column(name_index)
            .as_any()
            .downcast_ref::<StringArray>()
            .unwrap();
        assert_eq!(name_column.value(0), "Alice");
        assert_eq!(name_column.value(1), "Bob");
        assert!(name_column.is_null(2)); // Missing in third row

        // Check age field
        let age_index = schema.index_of("age").unwrap();
        let age_column = output_batch
            .column(age_index)
            .as_any()
            .downcast_ref::<StringArray>()
            .unwrap();
        assert_eq!(age_column.value(0), "30");
        assert!(age_column.is_null(1)); // Missing in second row
        assert_eq!(age_column.value(2), "35");

        // Check city field
        let city_index = schema.index_of("city").unwrap();
        let city_column = output_batch
            .column(city_index)
            .as_any()
            .downcast_ref::<StringArray>()
            .unwrap();
        assert_eq!(city_column.value(0), "NYC");
        assert!(city_column.is_null(1)); // Missing in second row
        assert!(city_column.is_null(2)); // Missing in third row

        // Check country field
        let country_index = schema.index_of("country").unwrap();
        let country_column = output_batch
            .column(country_index)
            .as_any()
            .downcast_ref::<StringArray>()
            .unwrap();
        assert!(country_column.is_null(0)); // Missing in first row
        assert_eq!(country_column.value(1), "USA");
        assert!(country_column.is_null(2)); // Missing in third row
    }

    #[test]
    fn test_generate_vertical_partition_recordbatch_empty_json() {
        let json_values = vec![
            Some(""),                     // Empty string
            Some("{}"),                   // Empty JSON object
            Some(r#"{"name": "Alice"}"#), // Normal JSON
        ];

        let batch = create_test_batch_with_all_field(json_values, vec![]);
        let batches = vec![batch];

        let result = generate_vertical_partition_recordbatch(&batches);
        assert!(result.is_ok());

        let output_batches = result.unwrap();
        assert_eq!(output_batches.len(), 1);

        let output_batch = &output_batches[0];
        assert_eq!(output_batch.num_rows(), 3);

        let schema = output_batch.schema();

        // Should only have _all field and name field (name appears in row 3)
        assert!(schema.index_of("name").is_ok());

        let name_index = schema.index_of("name").unwrap();
        let name_column = output_batch
            .column(name_index)
            .as_any()
            .downcast_ref::<StringArray>()
            .unwrap();
        assert!(name_column.is_null(0)); // Empty string -> empty object -> no name
        assert!(name_column.is_null(1)); // Empty object -> no name
        assert_eq!(name_column.value(2), "Alice"); // Has name
    }

    #[test]
    fn test_generate_vertical_partition_recordbatch_null_values_in_json() {
        let json_values = vec![
            Some(r#"{"name": "Alice", "age": null, "city": "NYC"}"#),
            Some(r#"{"name": null, "age": "25"}"#),
        ];

        let batch = create_test_batch_with_all_field(json_values, vec![]);
        let batches = vec![batch];

        let result = generate_vertical_partition_recordbatch(&batches);
        assert!(result.is_ok());

        let output_batches = result.unwrap();
        assert_eq!(output_batches.len(), 1);

        let output_batch = &output_batches[0];
        assert_eq!(output_batch.num_rows(), 2);

        let schema = output_batch.schema();

        // Check name field (Alice in first row, null in second)
        let name_index = schema.index_of("name").unwrap();
        let name_column = output_batch
            .column(name_index)
            .as_any()
            .downcast_ref::<StringArray>()
            .unwrap();
        assert_eq!(name_column.value(0), "Alice");
        assert!(name_column.is_null(1)); // null in JSON becomes null in column

        // Check age field (null in first row, 25 in second)
        let age_index = schema.index_of("age").unwrap();
        let age_column = output_batch
            .column(age_index)
            .as_any()
            .downcast_ref::<StringArray>()
            .unwrap();
        assert!(age_column.is_null(0)); // null in JSON becomes null in column
        assert_eq!(age_column.value(1), "25");
    }

    #[test]
    fn test_generate_vertical_partition_recordbatch_invalid_json() {
        let json_values = vec![
            Some(r#"{"name": "Alice"}"#), // Valid JSON
            Some(r#"invalid json"#),      // Invalid JSON
        ];

        let batch = create_test_batch_with_all_field(json_values, vec![]);
        let batches = vec![batch];

        let result = generate_vertical_partition_recordbatch(&batches);
        assert!(result.is_err());

        // Should return an error due to invalid JSON parsing
        let error = result.unwrap_err();
        assert!(error.to_string().contains("parse all fields value error"));
    }

    #[test]
    fn test_generate_vertical_partition_recordbatch_complex_json_values() {
        let json_values = vec![
            Some(r#"{"user": {"name": "Alice", "details": {"age": 30}}, "active": true}"#),
            Some(r#"{"score": 95.5, "tags": ["tag1", "tag2"], "metadata": {"version": "1.0"}}"#),
        ];

        let batch = create_test_batch_with_all_field(json_values, vec![]);
        let batches = vec![batch];

        let result = generate_vertical_partition_recordbatch(&batches);
        assert!(result.is_ok());

        let output_batches = result.unwrap();
        assert_eq!(output_batches.len(), 1);

        let output_batch = &output_batches[0];
        assert_eq!(output_batch.num_rows(), 2);

        let schema = output_batch.schema();

        // Complex JSON values should be converted to strings
        let user_index = schema.index_of("user").unwrap();
        let user_column = output_batch
            .column(user_index)
            .as_any()
            .downcast_ref::<StringArray>()
            .unwrap();
        // The nested object should be converted to a string representation
        assert!(!user_column.is_null(0));
        assert!(user_column.is_null(1)); // Not present in second row
    }

    #[test]
    fn test_generate_vertical_partition_recordbatch_zero_rows() {
        let json_values: Vec<Option<&str>> = vec![]; // No rows

        let batch = create_test_batch_with_all_field(json_values, vec![]);
        let batches = vec![batch];

        let result = generate_vertical_partition_recordbatch(&batches);
        assert!(result.is_ok());

        let output_batches = result.unwrap();
        assert!(output_batches.is_empty()); // Should return empty vec when no rows
    }

    #[test]
    fn test_generate_vertical_partition_recordbatch_all_field_not_string_array() {
        // Create a batch where the "_all" field is not a StringArray
        let fields = vec![
            Field::new("_all", DataType::Int64, true), // Not a string array
            Field::new("id", DataType::Utf8, true),
        ];
        let schema = Arc::new(Schema::new(fields));

        let columns: Vec<ArrayRef> = vec![
            Arc::new(arrow::array::Int64Array::from(vec![Some(1), Some(2)])),
            Arc::new(StringArray::from(vec![Some("a"), Some("b")])),
        ];

        let batch = RecordBatch::try_new(schema, columns).unwrap();
        let batches = vec![batch.clone()];

        let result = generate_vertical_partition_recordbatch(&batches);
        assert!(result.is_ok());

        let output_batches = result.unwrap();
        assert_eq!(output_batches.len(), 1);

        // Should return the original batch unchanged since "_all" is not a StringArray
        let output_batch = &output_batches[0];
        assert_eq!(output_batch.num_rows(), batch.num_rows());
        assert_eq!(output_batch.num_columns(), batch.num_columns());
    }

    #[test]
    fn test_generate_vertical_partition_recordbatch_multiple_batches() {
        let batch1 = create_test_batch_with_all_field(
            vec![Some(r#"{"name": "Alice", "age": "30"}"#)],
            vec![("id", vec![Some("1")])],
        );

        let batch2 = create_test_batch_with_all_field(
            vec![Some(r#"{"name": "Bob", "city": "NYC"}"#)],
            vec![("id", vec![Some("2")])],
        );

        let batches = vec![batch1, batch2];

        let result = generate_vertical_partition_recordbatch(&batches);
        assert!(result.is_ok());

        let output_batches = result.unwrap();
        assert_eq!(output_batches.len(), 1); // Should concatenate into one batch

        let output_batch = &output_batches[0];
        assert_eq!(output_batch.num_rows(), 2); // Combined rows from both batches

        let schema = output_batch.schema();

        // Should have all fields from both batches
        assert!(schema.index_of("name").is_ok());
        assert!(schema.index_of("age").is_ok());
        assert!(schema.index_of("city").is_ok());
        assert!(schema.index_of("id").is_ok());

        // Check that missing fields are properly handled with nulls
        let age_index = schema.index_of("age").unwrap();
        let age_column = output_batch
            .column(age_index)
            .as_any()
            .downcast_ref::<StringArray>()
            .unwrap();
        assert_eq!(age_column.value(0), "30"); // From first batch
        assert!(age_column.is_null(1)); // Missing in second batch

        let city_index = schema.index_of("city").unwrap();
        let city_column = output_batch
            .column(city_index)
            .as_any()
            .downcast_ref::<StringArray>()
            .unwrap();
        assert!(city_column.is_null(0)); // Missing in first batch
        assert_eq!(city_column.value(1), "NYC"); // From second batch
    }

    #[test]
    fn test_generate_vertical_partition_recordbatch_preserve_original_fields() {
        let batch = create_test_batch_with_all_field(
            vec![Some(r#"{"extracted": "value"}"#)],
            vec![
                ("original_field1", vec![Some("orig1")]),
                ("original_field2", vec![Some("orig2")]),
            ],
        );
        let batches = vec![batch];

        let result = generate_vertical_partition_recordbatch(&batches);
        assert!(result.is_ok());

        let output_batches = result.unwrap();
        assert_eq!(output_batches.len(), 1);

        let output_batch = &output_batches[0];
        let schema = output_batch.schema();

        // Should preserve original fields
        assert!(schema.index_of("original_field1").is_ok());
        assert!(schema.index_of("original_field2").is_ok());

        // Should add extracted fields
        assert!(schema.index_of("extracted").is_ok());

        // Check values are preserved
        let orig1_index = schema.index_of("original_field1").unwrap();
        let orig1_column = output_batch
            .column(orig1_index)
            .as_any()
            .downcast_ref::<StringArray>()
            .unwrap();
        assert_eq!(orig1_column.value(0), "orig1");

        let extracted_index = schema.index_of("extracted").unwrap();
        let extracted_column = output_batch
            .column(extracted_index)
            .as_any()
            .downcast_ref::<StringArray>()
            .unwrap();
        assert_eq!(extracted_column.value(0), "value");
    }
}
