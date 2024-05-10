// Copyright 2024 Zinc Labs Inc.
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
    meta::stream::StreamType,
    utils::{json, schema::infer_json_schema_from_map, schema_ext::SchemaExt},
    CONFIG,
};
use datafusion::arrow::datatypes::{Field, Schema};
use infra::schema::unwrap_stream_settings;
use serde_json::{Map, Value};

use crate::{
    common::meta::{
        authz::Authz, ingestion::StreamSchemaChk, prom::METADATA_LABEL, stream::SchemaEvolution,
    },
    service::db,
};

pub(crate) fn get_upto_discard_error() -> anyhow::Error {
    anyhow::anyhow!(
        "Too old data, only last {} hours data can be ingested. Data discarded. You can adjust ingestion max time by setting the environment variable ZO_INGEST_ALLOWED_UPTO=<max_hours>",
        CONFIG.limit.ingest_allowed_upto
    )
}

pub(crate) fn get_invalid_schema_start_dt() -> anyhow::Error {
    anyhow::anyhow!("Schema evolution can't use the past _timestamp")
}

pub(crate) fn get_request_columns_limit_error(
    stream_name: &str,
    num_fields: usize,
) -> anyhow::Error {
    anyhow::anyhow!(
        "Got {num_fields} columns for stream {stream_name}, only {} columns accept. Data discarded. You can adjust ingestion columns limit by setting the environment variable ZO_COLS_PER_RECORD_LIMIT=<max_cloumns>",
        CONFIG.limit.req_cols_per_record_limit
    )
}

pub struct SchemaCache {
    schema: Schema,
    fields_map: HashMap<String, usize>,
    hash_key: String,
}

impl SchemaCache {
    pub fn new(schema: Schema, fields_map: HashMap<String, usize>) -> Self {
        let hash_key = schema.hash_key();
        Self {
            schema,
            fields_map,
            hash_key,
        }
    }

    pub fn hash_key(&self) -> &str {
        &self.hash_key
    }

    pub fn schema(&self) -> &Schema {
        &self.schema
    }

    pub fn fields_map(&self) -> &HashMap<String, usize> {
        &self.fields_map
    }
}

pub async fn check_for_schema(
    org_id: &str,
    stream_name: &str,
    stream_type: StreamType,
    stream_schema_map: &mut HashMap<String, SchemaCache>,
    record_val: Vec<&Map<String, Value>>,
    record_ts: i64,
) -> Result<(SchemaEvolution, Option<Schema>)> {
    if !stream_schema_map.contains_key(stream_name) {
        let schema = infra::schema::get(org_id, stream_name, stream_type)
            .await
            .unwrap();
        let fields_map = schema
            .fields()
            .iter()
            .enumerate()
            .map(|(i, f)| (f.name().to_owned(), i))
            .collect();
        stream_schema_map.insert(
            stream_name.to_string(),
            SchemaCache::new(schema, fields_map),
        );
    }
    let schema = stream_schema_map.get(stream_name).unwrap();
    if !schema.schema().fields().is_empty() && CONFIG.common.skip_schema_validation {
        return Ok((
            SchemaEvolution {
                schema_compatible: true,
                is_schema_changed: false,
                types_delta: None,
            },
            None,
        ));
    }

    // get infer schema
    let value_iter = record_val.into_iter();
    let inferred_schema = infer_json_schema_from_map(value_iter, stream_type).unwrap();

    // fast path
    if schema.schema().fields.eq(&inferred_schema.fields) {
        return Ok((
            SchemaEvolution {
                schema_compatible: true,
                is_schema_changed: false,
                types_delta: None,
            },
            None,
        ));
    }

    if inferred_schema.fields.len() > CONFIG.limit.req_cols_per_record_limit {
        return Err(get_request_columns_limit_error(
            &format!("{}/{}/{}", org_id, stream_type, stream_name),
            inferred_schema.fields.len(),
        ));
    }

    let is_new = schema.schema().fields().is_empty();
    if !is_new {
        let (is_schema_changed, field_datatype_delta) =
            get_schema_changes(schema, &inferred_schema);
        if !is_schema_changed {
            // generate new schema
            let inferred_schema = if field_datatype_delta.is_empty() {
                inferred_schema
            } else {
                inferred_schema.cloned_from(schema.schema())
            };
            // check defined_schema_fields
            let meta = unwrap_stream_settings(schema.schema());
            let mut defined_schema_fields = match meta {
                Some(meta) => meta.defined_schema_fields.unwrap_or(vec![]),
                None => vec![],
            };
            let mut fields = Vec::with_capacity(defined_schema_fields.len() + 2);
            let inferred_schema = if !defined_schema_fields.is_empty() {
                defined_schema_fields.extend(vec![
                    CONFIG.common.column_timestamp.to_string(),
                    CONFIG.common.all_fields_name.to_string(),
                ]);
                for field in defined_schema_fields {
                    if let Some(f) = schema.fields_map().get(&field) {
                        fields.push(schema.schema().fields()[*f].clone());
                    }
                }
                Schema::new_with_metadata(fields, schema.schema().metadata().clone())
            } else {
                inferred_schema
            };
            let fields_map = inferred_schema
                .fields()
                .iter()
                .enumerate()
                .map(|(i, f)| (f.name().to_owned(), i))
                .collect();
            stream_schema_map.insert(
                stream_name.to_string(),
                SchemaCache::new(inferred_schema.clone(), fields_map),
            );
            return Ok((
                SchemaEvolution {
                    schema_compatible: true,
                    is_schema_changed: false,
                    types_delta: Some(field_datatype_delta),
                },
                Some(inferred_schema),
            ));
        }
        if !field_datatype_delta.is_empty() {
            // check if the min_ts < current_version_created_at, if yes, discard the data
            let schema_metadata = schema.schema.metadata();
            if let Some(start_dt) = schema_metadata.get("start_dt") {
                let created_at = start_dt.parse().unwrap_or_default();
                if record_ts <= created_at {
                    return Err(get_invalid_schema_start_dt());
                }
            }
        }
    }

    println!("schema: {:?}", inferred_schema);

    // slow path
    let ret = handle_diff_schema(
        org_id,
        stream_name,
        stream_type,
        is_new,
        &inferred_schema,
        record_ts,
        stream_schema_map,
    )
    .await?
    .unwrap_or(SchemaEvolution {
        schema_compatible: true,
        is_schema_changed: false,
        types_delta: None,
    });

    // generate new schema
    let schema_latest = stream_schema_map.get(stream_name).unwrap();
    let inferred_schema = inferred_schema.cloned_from(schema_latest.schema());

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
async fn handle_diff_schema(
    org_id: &str,
    stream_name: &str,
    stream_type: StreamType,
    is_new: bool,
    inferred_schema: &Schema,
    record_ts: i64,
    stream_schema_map: &mut HashMap<String, SchemaCache>,
) -> Result<Option<SchemaEvolution>> {
    // first update thread cache
    if is_new {
        let mut metadata = HashMap::with_capacity(1);
        metadata.insert("created_at".to_string(), record_ts.to_string());
        let fields_map = inferred_schema
            .fields()
            .iter()
            .enumerate()
            .map(|(i, f)| (f.name().to_owned(), i))
            .collect();
        stream_schema_map.insert(
            stream_name.to_string(),
            SchemaCache::new(inferred_schema.clone().with_metadata(metadata), fields_map),
        );
    }

    let mut retries = 0;
    let mut err: Option<anyhow::Error> = None;
    let mut ret: Option<_> = None;
    // retry x times for update schema
    while retries < CONFIG.limit.meta_transaction_retries {
        match db::schema::merge(
            org_id,
            stream_name,
            stream_type,
            inferred_schema,
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
    let Some((final_schema, field_datatype_delta)) = ret else {
        return Ok(None);
    };

    if is_new {
        crate::common::utils::auth::set_ownership(
            org_id,
            &stream_type.to_string(),
            Authz::new(stream_name),
        )
        .await;
    }

    let fields_map = final_schema
        .fields()
        .iter()
        .enumerate()
        .map(|(i, f)| (f.name().to_owned(), i))
        .collect();
    // update thread cache
    stream_schema_map.insert(
        stream_name.to_string(),
        SchemaCache::new(final_schema, fields_map),
    );

    Ok(Some(SchemaEvolution {
        schema_compatible: true,
        is_schema_changed: true,
        types_delta: Some(field_datatype_delta),
    }))
}

fn get_schema_changes(schema: &SchemaCache, inferred_schema: &Schema) -> (bool, Vec<Field>) {
    let mut is_schema_changed = false;
    let mut field_datatype_delta: Vec<Field> = vec![];

    let meta = unwrap_stream_settings(schema.schema());
    let defined_schema_fields = match meta {
        Some(meta) => meta.defined_schema_fields.unwrap_or(vec![]),
        None => vec![],
    };

    for item in inferred_schema.fields.iter() {
        let item_name = item.name();
        let item_data_type = item.data_type();

        match schema.fields_map().get(item_name) {
            None => {
                is_schema_changed = true;
            }
            Some(idx) => {
                if !defined_schema_fields.is_empty() && !defined_schema_fields.contains(item_name) {
                    continue;
                }
                let existing_field: Arc<Field> = schema.schema().fields()[*idx].clone();
                if existing_field.data_type() != item_data_type {
                    if !CONFIG.common.widening_schema_evolution {
                        field_datatype_delta.push(existing_field.as_ref().to_owned());
                    } else if infra::schema::is_widening_conversion(
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
            let schema = infra::schema::get(org_id, stream_name, stream_type)
                .await
                .unwrap();
            let fields_map = schema
                .fields()
                .iter()
                .enumerate()
                .map(|(i, f)| (f.name().to_owned(), i))
                .collect();
            stream_schema_map.insert(
                stream_name.to_string(),
                SchemaCache::new(schema.clone(), fields_map),
            );
            schema
        }
    };
    if !schema.fields().is_empty() {
        schema_chk.has_fields = true;
    }
    if let Some(value) = schema.metadata().get("settings") {
        let settings: json::Value = json::from_slice(value.as_bytes()).unwrap();
        if settings.get("partition_keys").is_some() {
            schema_chk.has_partition_keys = true;
        }
    }
    if schema.metadata().contains_key(METADATA_LABEL) {
        schema_chk.has_metadata = true;
    }
    schema_chk
}

#[cfg(test)]
mod tests {
    use std::str::FromStr;

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
        let fields_map = schema
            .fields()
            .iter()
            .enumerate()
            .map(|(i, f)| (f.name().to_owned(), i))
            .collect();
        map.insert(
            stream_name.to_string(),
            SchemaCache::new(schema, fields_map),
        );
        let result = check_for_schema(
            org_name,
            stream_name,
            StreamType::Logs,
            &mut map,
            vec![record.as_object().unwrap()],
            1234234234234,
        )
        .await
        .unwrap();
        assert!(result.0.schema_compatible);
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
}
