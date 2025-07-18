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

use std::{collections::HashMap, sync::Arc};

use anyhow::Result;
use config::{
    ALL_VALUES_COL_NAME, ID_COL_NAME, ORIGINAL_DATA_COL_NAME, SQL_FULL_TEXT_SEARCH_FIELDS,
    TIMESTAMP_COL_NAME,
    cluster::LOCAL_NODE_ID,
    get_config,
    ider::SnowflakeIdGenerator,
    meta::{
        promql::METADATA_LABEL,
        stream::{DataField, DataType as StreamDataType, StreamType},
    },
    metrics,
    utils::{json, schema::infer_json_schema_from_map, schema_ext::SchemaExt, time::now_micros},
};
use datafusion::arrow::datatypes::{Field, Schema};
use hashbrown::HashSet;
use infra::schema::{
    STREAM_RECORD_ID_GENERATOR, STREAM_SCHEMAS_LATEST, STREAM_SETTINGS, SchemaCache,
    unwrap_stream_settings,
};
use serde_json::{Map, Value};

use super::logs::bulk::SCHEMA_CONFORMANCE_FAILED;
use crate::{
    common::meta::{authz::Authz, ingestion::StreamSchemaChk, stream::SchemaEvolution},
    service::db,
};

pub(crate) fn get_upto_discard_error() -> anyhow::Error {
    anyhow::anyhow!(
        "Too old data, only last {} hours data can be ingested. Data discarded. You can adjust ingestion max time by setting the environment variable ZO_INGEST_ALLOWED_UPTO=<max_hours>",
        get_config().limit.ingest_allowed_upto
    )
}

pub(crate) fn get_future_discard_error() -> anyhow::Error {
    anyhow::anyhow!(
        "Too far data, only future {} hours data can be ingested. Data discarded. You can adjust ingestion max time by setting the environment variable ZO_INGEST_ALLOWED_IN_FUTURE=<max_hours>",
        get_config().limit.ingest_allowed_in_future
    )
}

pub(crate) fn get_request_columns_limit_error(
    stream_name: &str,
    num_fields: usize,
) -> anyhow::Error {
    anyhow::anyhow!(
        "Got {num_fields} columns for stream {stream_name}, only {} columns accept. Data discarded. You can adjust ingestion columns limit by setting the environment variable ZO_COLS_PER_RECORD_LIMIT=<max_columns>",
        get_config().limit.req_cols_per_record_limit
    )
}

pub async fn check_for_schema(
    org_id: &str,
    stream_name: &str,
    stream_type: StreamType,
    stream_schema_map: &mut HashMap<String, SchemaCache>,
    record_vals: Vec<&Map<String, Value>>,
    record_ts: i64,
    is_derived: bool,
) -> Result<(SchemaEvolution, Option<Schema>)> {
    if !stream_schema_map.contains_key(stream_name) {
        let schema = infra::schema::get_cache(org_id, stream_name, stream_type).await?;
        stream_schema_map.insert(stream_name.to_string(), schema);
    }
    let cfg = get_config();
    let schema = stream_schema_map.get(stream_name).unwrap();

    // get infer schema
    let value_iter = record_vals.into_iter();
    let inferred_schema = infer_json_schema_from_map(value_iter, stream_type)?;

    // fast path
    if schema.schema().fields.eq(&inferred_schema.fields) {
        return Ok((
            SchemaEvolution {
                is_schema_changed: false,
                types_delta: None,
            },
            None,
        ));
    }

    if inferred_schema.fields.len() > cfg.limit.req_cols_per_record_limit {
        metrics::INGEST_ERRORS
            .with_label_values(&[
                org_id,
                stream_type.as_str(),
                stream_name,
                SCHEMA_CONFORMANCE_FAILED,
            ])
            .inc();
        return Err(get_request_columns_limit_error(
            &format!("{org_id}/{stream_type}/{stream_name}"),
            inferred_schema.fields.len(),
        ));
    }

    let mut need_insert_new_latest = false;
    let is_new = schema.schema().fields().is_empty();
    if !is_new {
        let (is_schema_changed, field_datatype_delta) =
            get_schema_changes(schema, &inferred_schema);
        if !is_schema_changed {
            // check defined_schema_fields
            let stream_setting = unwrap_stream_settings(schema.schema());
            let (defined_schema_fields, need_original, index_original_data, index_all_values) =
                match stream_setting {
                    Some(s) => (
                        s.defined_schema_fields,
                        s.store_original_data,
                        s.index_original_data,
                        s.index_all_values,
                    ),
                    None => (Vec::new(), false, false, false),
                };
            if !defined_schema_fields.is_empty() {
                let schema = generate_schema_for_defined_schema_fields(
                    schema,
                    &defined_schema_fields,
                    need_original,
                    index_original_data,
                    index_all_values,
                );
                stream_schema_map.insert(stream_name.to_string(), schema);
            }
            return Ok((
                SchemaEvolution {
                    is_schema_changed: false,
                    types_delta: Some(field_datatype_delta),
                },
                Some(inferred_schema),
            ));
        }
        if !field_datatype_delta.is_empty() {
            // check if the min_ts < current_version_created_at
            let schema_metadata = schema.schema().metadata();
            if let Some(start_dt) = schema_metadata.get("start_dt") {
                let created_at = start_dt.parse().unwrap_or_default();
                if record_ts <= created_at {
                    need_insert_new_latest = true;
                }
            }
        }
    }

    // slow path
    let ret = handle_diff_schema(
        org_id,
        stream_name,
        stream_type,
        is_new,
        &inferred_schema,
        record_ts,
        stream_schema_map,
        is_derived,
    )
    .await?
    .unwrap_or(SchemaEvolution {
        is_schema_changed: false,
        types_delta: None,
    });

    // if need_insert_new_latest, create a new version with start_dt = now
    if need_insert_new_latest {
        _ = handle_diff_schema(
            org_id,
            stream_name,
            stream_type,
            is_new,
            &inferred_schema,
            now_micros(),
            stream_schema_map,
            is_derived,
        )
        .await?;
    }

    Ok((ret, Some(inferred_schema)))
}

pub async fn get_merged_schema(
    org_id: &str,
    stream_name: &str,
    stream_type: StreamType,
    inferred_schema: &Schema,
) -> Option<(Vec<Field>, Schema)> {
    let mut db_schema = infra::schema::get_from_db(org_id, stream_name, stream_type)
        .await
        .unwrap();

    let (is_schema_changed, field_datatype_delta, merged_fields) =
        infra::schema::get_merge_schema_changes(&db_schema, inferred_schema);

    if !is_schema_changed {
        return None;
    }

    let metadata = std::mem::take(&mut db_schema.metadata);
    Some((
        field_datatype_delta,
        Schema::new(merged_fields).with_metadata(metadata),
    ))
}

// handle_diff_schema is a slow path, it acquires a lock to update schema
// steps:
// 1. get schema from db, if schema is empty, set schema and return
// 2. get schema from db for update,
// 3. if db_schema is identical to inferred_schema, return (means another thread has updated schema)
// 4. if db_schema is not identical to inferred_schema, merge schema and update db
#[allow(clippy::too_many_arguments)]
async fn handle_diff_schema(
    org_id: &str,
    stream_name: &str,
    stream_type: StreamType,
    is_new: bool,
    inferred_schema: &Schema,
    record_ts: i64,
    stream_schema_map: &mut HashMap<String, SchemaCache>,
    is_derived: bool,
) -> Result<Option<SchemaEvolution>> {
    let start = std::time::Instant::now();
    let cfg = get_config();

    log::debug!(
        "handle_diff_schema start for [{org_id}/{stream_type}/{stream_name}] start_dt: {record_ts}"
    );

    // acquire a local_lock to ensure only one thread can update schema
    let cache_key = format!("{org_id}/{stream_type}/{stream_name}");
    let local_lock = infra::local_lock::lock(&cache_key).await?;
    let _guard = local_lock.lock().await;

    // check if the schema has been updated by another thread
    let read_cache = STREAM_SCHEMAS_LATEST.read().await;
    if let Some(updated_schema) = read_cache.get(&cache_key)
        && let (false, _) = get_schema_changes(updated_schema, inferred_schema)
    {
        return Ok(None);
    }
    drop(read_cache);

    // first update thread cache
    if is_new {
        let mut metadata = HashMap::with_capacity(1);
        metadata.insert("created_at".to_string(), record_ts.to_string());
        if is_derived {
            metadata.insert("is_derived".to_string(), "true".to_string());
        }
        stream_schema_map.insert(
            stream_name.to_string(),
            SchemaCache::new(inferred_schema.clone().with_metadata(metadata)),
        );
    }

    let mut retries = 0;
    let mut err: Option<anyhow::Error> = None;
    let mut ret: Option<_> = None;
    // retry x times for update schema
    while retries < cfg.limit.meta_transaction_retries {
        let schema_for_merge = if is_derived {
            let mut metadata = HashMap::with_capacity(1);
            metadata.insert("is_derived".to_string(), "true".to_string());
            &inferred_schema.clone().with_metadata(metadata)
        } else {
            inferred_schema
        };
        match db::schema::merge(
            org_id,
            stream_name,
            stream_type,
            schema_for_merge,
            Some(record_ts),
        )
        .await
        {
            Err(e) => {
                log::error!(
                    "handle_diff_schema [{}/{}/{}] with hash {}, start_dt {}, error: {}, retrying...{}",
                    org_id,
                    stream_type,
                    stream_name,
                    inferred_schema.hash_key(),
                    record_ts,
                    e,
                    retries
                );
                err = Some(e);
                retries += 1;
                continue;
            }
            Ok(v) => {
                ret = v;
                err = None;
                break;
            }
        };
    }
    if let Some(e) = err {
        log::error!(
            "handle_diff_schema [{}/{}/{}] with hash {}, start_dt {}, abort after retry {} times, error: {}",
            org_id,
            stream_type,
            stream_name,
            inferred_schema.hash_key(),
            record_ts,
            retries,
            e
        );
        return Err(e);
    }
    let Some((mut final_schema, field_datatype_delta)) = ret else {
        return Ok(None);
    };

    if is_new {
        crate::common::utils::auth::set_ownership(
            org_id,
            stream_type.as_str(),
            Authz::new(stream_name),
        )
        .await;
    }

    // check defined_schema_fields
    let mut stream_setting = unwrap_stream_settings(&final_schema).unwrap_or_default();
    let mut defined_schema_fields = stream_setting.defined_schema_fields.clone();

    // For new streams, if defined_schema_fields are provided, add them directly to schema
    if is_new && !defined_schema_fields.is_empty() {
        // Add each defined field to the schema with specified data type
        let mut new_fields = final_schema.fields().to_vec();
        for field in &defined_schema_fields {
            if final_schema.field_with_name(&field.name).is_err() {
                let arrow_data_type = field.r#type.into();
                let field = Arc::new(Field::new(&field.name, arrow_data_type, true));
                new_fields.push(field);
            }
        }
        final_schema = Schema::new_with_metadata(new_fields, final_schema.metadata().clone());

        // Clear defined_schema_fields since they're now part of the main schema
        stream_setting.defined_schema_fields.clear();
        defined_schema_fields.clear();

        // Update the schema metadata with cleared settings
        final_schema.metadata.insert(
            "settings".to_string(),
            json::to_string(&stream_setting).unwrap(),
        );

        // Save the updated settings
        if let Err(e) = super::stream::save_stream_settings(
            org_id,
            stream_name,
            stream_type,
            stream_setting.clone(),
        )
        .await
        {
            log::error!("save_stream_settings [{org_id}/{stream_type}/{stream_name}] error: {e}");
        }
    }

    // For existing streams with UDS enabled, add new fields to both schema and UDS
    if !is_new && !defined_schema_fields.is_empty() {
        // Get the original schema to compare with
        let original_schema = if let Some(stream_schema) = stream_schema_map.get(stream_name) {
            stream_schema.schema().as_ref().clone()
        } else {
            // If we can't get the original schema, skip this logic
            final_schema.clone()
        };

        // Find new fields that are in final_schema but not in original_schema
        let original_field_names: HashSet<String> = original_schema
            .fields()
            .iter()
            .map(|f| f.name().to_string())
            .collect();

        let new_field_names: Vec<String> = final_schema
            .fields()
            .iter()
            .filter_map(|f| {
                let field_name = f.name().to_string();
                if !original_field_names.contains(&field_name)
                    && !defined_schema_fields.iter().any(|f| f.name == field_name)
                {
                    Some(field_name)
                } else {
                    None
                }
            })
            .collect();

        if !new_field_names.is_empty() {
            log::info!(
                "Adding {} new fields to both schema and UDS for existing stream [{}/{}/{}]: {:?}",
                new_field_names.len(),
                org_id,
                stream_type,
                stream_name,
                new_field_names
            );

            // Add new fields to defined_schema_fields (UDS)
            for field_name in &new_field_names {
                if !defined_schema_fields
                    .iter()
                    .any(|f| f.name.as_str() == field_name)
                {
                    defined_schema_fields.push(DataField::new(field_name, StreamDataType::Utf8));
                }
            }

            // Update the settings with new UDS fields
            stream_setting.defined_schema_fields = defined_schema_fields.clone();
            final_schema.metadata.insert(
                "settings".to_string(),
                json::to_string(&stream_setting).unwrap(),
            );

            // Save the updated settings
            if let Err(e) = super::stream::save_stream_settings(
                org_id,
                stream_name,
                stream_type,
                stream_setting.clone(),
            )
            .await
            {
                log::error!(
                    "save_stream_settings [{org_id}/{stream_type}/{stream_name}] error: {e}"
                );
            }
        }
    }

    // Automatically enable User-defined schema when
    // 1. allow_user_defined_schemas is enabled
    // 2. log ingestion
    // 3. user defined schema is not already enabled
    // 4. final schema fields count exceeds schema_max_fields_to_enable_uds
    // user-defined schema does not include _timestamp or _all columns
    if cfg.common.allow_user_defined_schemas
        && cfg.limit.schema_max_fields_to_enable_uds > 0
        && stream_type == StreamType::Logs
        && defined_schema_fields.is_empty()
        && final_schema.fields().len() > cfg.limit.schema_max_fields_to_enable_uds
    {
        let mut uds_fields = HashSet::with_capacity(cfg.limit.schema_max_fields_to_enable_uds);

        // Helper to check if a field should be skipped
        let should_skip = |field_name: &str| {
            field_name == TIMESTAMP_COL_NAME
                || field_name == ID_COL_NAME
                || field_name == ORIGINAL_DATA_COL_NAME
                || field_name == ALL_VALUES_COL_NAME
                || field_name == cfg.common.column_all
        };

        // Add FTS fields first
        for field in SQL_FULL_TEXT_SEARCH_FIELDS.iter() {
            if final_schema.field_with_name(field).is_ok()
                && !should_skip(field)
                && uds_fields.insert(field.to_string())
                && uds_fields.len() >= cfg.limit.schema_max_fields_to_enable_uds
            {
                break;
            }
        }

        // Add fields from current schema if available
        if let Some(stream_schema) = stream_schema_map.get(stream_name) {
            for field in stream_schema.schema().fields() {
                let field = field.name();
                if !should_skip(field)
                    && uds_fields.insert(field.to_string())
                    && uds_fields.len() >= cfg.limit.schema_max_fields_to_enable_uds
                {
                    break;
                }
            }
        }

        // Add remaining fields from final schema
        if uds_fields.len() < cfg.limit.schema_max_fields_to_enable_uds {
            for field in final_schema.fields() {
                let field = field.name();
                if !should_skip(field)
                    && uds_fields.insert(field.to_string())
                    && uds_fields.len() >= cfg.limit.schema_max_fields_to_enable_uds
                {
                    break;
                }
            }
        }

        defined_schema_fields = uds_fields
            .into_iter()
            .map(|field_name| DataField::new(&field_name, StreamDataType::Utf8))
            .collect();
        stream_setting.defined_schema_fields = defined_schema_fields.clone();
        final_schema.metadata.insert(
            "settings".to_string(),
            json::to_string(&stream_setting).unwrap(),
        );

        // save the new settings
        if let Err(e) = super::stream::save_stream_settings(
            org_id,
            stream_name,
            stream_type,
            stream_setting.clone(),
        )
        .await
        {
            log::error!("save_stream_settings [{org_id}/{stream_type}/{stream_name}] error: {e}");
        }
    }

    // update node cache
    let final_schema = SchemaCache::new(final_schema);
    let mut w = STREAM_SCHEMAS_LATEST.write().await;
    w.insert(cache_key.clone(), final_schema.clone());
    drop(w);
    let need_original = stream_setting.store_original_data;
    let index_original_data = stream_setting.index_original_data;
    let index_all_values = stream_setting.index_all_values;
    if (need_original || index_original_data)
        && let dashmap::Entry::Vacant(entry) = STREAM_RECORD_ID_GENERATOR.entry(cache_key.clone())
    {
        entry.insert(SnowflakeIdGenerator::new(unsafe { LOCAL_NODE_ID }));
    }
    let mut w = STREAM_SETTINGS.write().await;
    w.insert(cache_key.clone(), stream_setting);
    infra::schema::set_stream_settings_atomic(w.clone());
    drop(w);

    // update thread cache
    let final_schema = generate_schema_for_defined_schema_fields(
        &final_schema,
        &defined_schema_fields,
        need_original,
        index_original_data,
        index_all_values,
    );
    stream_schema_map.insert(stream_name.to_string(), final_schema);

    log::debug!(
        "handle_diff_schema end for [{}/{}/{}] start_dt: {}, elapsed: {} ms",
        org_id,
        stream_type,
        stream_name,
        record_ts,
        start.elapsed().as_millis()
    );

    Ok(Some(SchemaEvolution {
        is_schema_changed: true,
        types_delta: Some(field_datatype_delta),
    }))
}

// if defined_schema_fields is not empty, and schema fields greater than defined_schema_fields + 10,
// then we will use defined_schema_fields
pub fn generate_schema_for_defined_schema_fields(
    schema: &SchemaCache,
    fields: &[DataField],
    need_original: bool,
    index_original_data: bool,
    index_all_values: bool,
) -> SchemaCache {
    if fields.is_empty() || schema.fields_map().len() < fields.len() + 10 {
        return schema.clone();
    }

    let cfg = get_config();
    let timestamp_col = TIMESTAMP_COL_NAME.to_string();
    let o2_id_col = ID_COL_NAME.to_string();
    let original_col = ORIGINAL_DATA_COL_NAME.to_string();
    let all_values_col = ALL_VALUES_COL_NAME.to_string();

    let mut field_names: HashSet<&String> = fields.iter().map(|f| &f.name).collect();
    if !field_names.contains(&timestamp_col) {
        field_names.insert(&timestamp_col);
    }
    if !field_names.contains(&cfg.common.column_all) {
        field_names.insert(&cfg.common.column_all);
    }
    if need_original || index_original_data {
        if !field_names.contains(&o2_id_col) {
            field_names.insert(&o2_id_col);
        }
        if !field_names.contains(&original_col) {
            field_names.insert(&original_col);
        }
    }
    if index_all_values && !field_names.contains(&all_values_col) {
        field_names.insert(&all_values_col);
    }

    let mut new_fields = Vec::with_capacity(field_names.len());
    for field_name in field_names {
        if let Some(f) = schema.fields_map().get(field_name) {
            new_fields.push(schema.schema().fields()[*f].clone());
        }
    }

    // sort the fields by name to make sure the order is consistent
    new_fields.sort_by(|a, b| a.name().cmp(b.name()));

    SchemaCache::new(Schema::new_with_metadata(
        new_fields,
        schema.schema().metadata().clone(),
    ))
}

pub fn get_schema_changes(schema: &SchemaCache, inferred_schema: &Schema) -> (bool, Vec<Field>) {
    let mut is_schema_changed = false;
    let mut field_datatype_delta: Vec<Field> = vec![];

    let stream_setting = unwrap_stream_settings(schema.schema());
    let defined_schema_fields = stream_setting
        .map(|s| s.defined_schema_fields)
        .unwrap_or_default();

    for item in inferred_schema.fields.iter() {
        let item_name = item.name();
        let item_data_type = item.data_type();

        match schema.fields_map().get(item_name) {
            None => {
                is_schema_changed = true;
            }
            Some(idx) => {
                if !defined_schema_fields.is_empty()
                    && !defined_schema_fields.iter().any(|f| f.name == *item_name)
                {
                    continue;
                }
                let existing_field: Arc<Field> = schema.schema().fields()[*idx].clone();
                if existing_field.data_type() != item_data_type {
                    if infra::schema::is_widening_conversion(
                        existing_field.data_type(),
                        item_data_type,
                    ) {
                        is_schema_changed = true;
                        field_datatype_delta.push((**item).clone());
                    } else {
                        let mut meta = existing_field.metadata().clone();
                        meta.insert("zo_cast".to_owned(), true.to_string());
                        field_datatype_delta
                            .push(existing_field.as_ref().clone().with_metadata(meta));
                    }
                }
            }
        }
    }

    (is_schema_changed, field_datatype_delta)
}

pub async fn stream_schema_exists(
    org_id: &str,
    stream_name: &str,
    stream_type: StreamType,
    stream_schema_map: &mut HashMap<String, SchemaCache>,
) -> StreamSchemaChk {
    let mut schema_chk = StreamSchemaChk {
        conforms: true,
        has_fields: false,
        has_partition_keys: false,
        has_metadata: false,
    };
    let schema = match stream_schema_map.get(stream_name) {
        Some(schema) => schema.schema().clone(),
        None => {
            let schema_cache = infra::schema::get_cache(org_id, stream_name, stream_type)
                .await
                .unwrap();
            let db_schema = schema_cache.schema().clone();
            stream_schema_map.insert(stream_name.to_string(), schema_cache);
            db_schema
        }
    };
    if !schema.fields().is_empty() {
        schema_chk.has_fields = true;
    }

    let settings = unwrap_stream_settings(&schema);
    if let Some(stream_setting) = settings
        && !stream_setting.partition_keys.is_empty()
    {
        schema_chk.has_partition_keys = true;
    }
    if schema.metadata().contains_key(METADATA_LABEL) {
        schema_chk.has_metadata = true;
    }
    schema_chk
}

#[cfg(test)]
mod tests {
    use std::str::FromStr;

    use config::meta::stream::{DataType as StreamDataType, StreamSettings};
    use datafusion::arrow::datatypes::DataType;

    use super::*;

    #[tokio::test]
    async fn test_check_for_schema() {
        let stream_name = "Sample";
        let org_name = "nexus";
        let record: json::Value =
            json::from_str(r#"{"Year": 1896, "City": "Athens", "_timestamp": 1234234234234}"#)
                .unwrap();

        let schema = Schema::new(vec![
            Field::new("Year", DataType::Int64, false),
            Field::new("City", DataType::Utf8, false),
            Field::new("_timestamp", DataType::Int64, false),
        ]);
        let mut map: HashMap<String, SchemaCache> = HashMap::new();

        map.insert(stream_name.to_string(), SchemaCache::new(schema));
        let (result, _) = check_for_schema(
            org_name,
            stream_name,
            StreamType::Logs,
            &mut map,
            vec![record.as_object().unwrap()],
            1234234234234,
            false,
        )
        .await
        .unwrap();
        assert!(!result.is_schema_changed);
    }

    #[tokio::test]
    async fn test_infer_schema() {
        let mut record_val: Vec<&Map<String, Value>> = vec![];

        let record1: serde_json::Value = serde_json::Value::from_str(
            r#"{"Year": 1896.99, "City": "Athens", "_timestamp": 1234234234234}"#,
        )
        .unwrap();
        record_val.push(record1.as_object().unwrap());

        let record: serde_json::Value = serde_json::Value::from_str(
            r#"{"Year": 1896, "City": "Athens", "_timestamp": 1234234234234}"#,
        )
        .unwrap();
        record_val.push(record.as_object().unwrap());
        let stream_type = StreamType::Logs;
        let value_iter = record_val.into_iter();
        infer_json_schema_from_map(value_iter, stream_type).unwrap();
    }

    #[test]
    fn test_new_stream_schema_fields_behavior() {
        // Test that our logic correctly handles new stream creation with defined_schema_fields
        // This is a unit test for the logic we added in handle_diff_schema

        // Create a schema with some defined_schema_fields
        let mut metadata = HashMap::new();

        let defined_fields = vec![
            DataField::new("custom_field1", StreamDataType::Utf8),
            DataField::new("custom_field2", StreamDataType::Utf8),
        ];
        let settings = StreamSettings {
            defined_schema_fields: defined_fields,
            ..Default::default()
        };
        metadata.insert("settings".to_string(), json::to_string(&settings).unwrap());

        let schema = Schema::new_with_metadata(
            vec![Arc::new(Field::new("existing_field", DataType::Utf8, true))],
            metadata,
        );

        // Verify that the settings are correctly parsed
        let stream_setting = unwrap_stream_settings(&schema).unwrap_or_default();
        assert_eq!(stream_setting.defined_schema_fields.len(), 2);
        assert!(
            stream_setting
                .defined_schema_fields
                .iter()
                .any(|f| f.name == "custom_field1")
        );
        assert!(
            stream_setting
                .defined_schema_fields
                .iter()
                .any(|f| f.name == "custom_field2")
        );
    }

    #[test]
    fn test_existing_stream_uds_field_addition() {
        // Test that our logic correctly handles existing streams with UDS enabled
        // This tests the logic for adding new fields to both schema and UDS

        // Create an original schema with UDS fields
        let mut original_metadata = HashMap::new();
        let original_defined_fields = vec![
            DataField::new("uds_field1", StreamDataType::Utf8),
            DataField::new("uds_field2", StreamDataType::Utf8),
        ];
        let original_settings = StreamSettings {
            defined_schema_fields: original_defined_fields,
            ..Default::default()
        };
        original_metadata.insert(
            "settings".to_string(),
            json::to_string(&original_settings).unwrap(),
        );

        let original_schema = Schema::new_with_metadata(
            vec![
                Arc::new(Field::new("existing_field", DataType::Utf8, true)),
                Arc::new(Field::new("uds_field1", DataType::Utf8, true)),
                Arc::new(Field::new("uds_field2", DataType::Utf8, true)),
            ],
            original_metadata,
        );

        // Create a new schema with additional fields
        let mut new_metadata = HashMap::new();
        let new_defined_fields = vec![
            DataField::new("uds_field1", StreamDataType::Utf8),
            DataField::new("uds_field2", StreamDataType::Utf8),
        ];
        let new_settings = StreamSettings {
            defined_schema_fields: new_defined_fields,
            ..Default::default()
        };
        new_metadata.insert(
            "settings".to_string(),
            json::to_string(&new_settings).unwrap(),
        );

        let new_schema = Schema::new_with_metadata(
            vec![
                Arc::new(Field::new("existing_field", DataType::Utf8, true)),
                Arc::new(Field::new("uds_field1", DataType::Utf8, true)),
                Arc::new(Field::new("uds_field2", DataType::Utf8, true)),
                Arc::new(Field::new("new_field1", DataType::Utf8, true)),
                Arc::new(Field::new("new_field2", DataType::Utf8, true)),
            ],
            new_metadata,
        );

        // Simulate the logic: find new fields that should be added to UDS
        let original_field_names: HashSet<String> = original_schema
            .fields()
            .iter()
            .map(|f| f.name().to_string())
            .collect();

        let current_uds_fields = vec![
            DataField::new("uds_field1", StreamDataType::Utf8),
            DataField::new("uds_field2", StreamDataType::Utf8),
        ];

        let new_field_names: Vec<String> = new_schema
            .fields()
            .iter()
            .filter_map(|f| {
                let field_name = f.name().to_string();
                if !original_field_names.contains(&field_name)
                    && !current_uds_fields.iter().any(|f| f.name == field_name)
                {
                    Some(field_name)
                } else {
                    None
                }
            })
            .collect();

        // Verify that new fields are detected correctly
        assert_eq!(new_field_names.len(), 2);
        assert!(new_field_names.contains(&"new_field1".to_string()));
        assert!(new_field_names.contains(&"new_field2".to_string()));

        // Verify that existing UDS fields are not included
        assert!(!new_field_names.contains(&"uds_field1".to_string()));
        assert!(!new_field_names.contains(&"uds_field2".to_string()));
    }
}
