// Copyright 2023 Zinc Labs Inc.
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

use std::{
    collections::{HashMap, HashSet},
    fs::File,
    io::{BufReader, Seek, SeekFrom},
    sync::Arc,
};

use anyhow::Result;
use config::{
    meta::stream::StreamType,
    utils::{
        schema::{infer_json_schema, infer_json_schema_from_map},
        schema_ext::SchemaExt,
    },
    CONFIG,
};
use datafusion::arrow::{
    datatypes::{DataType, Field, Schema},
    error::ArrowError,
};
use itertools::Itertools;
use serde_json::{Map, Value};

use crate::{
    common::{
        infra::{config::LOCAL_SCHEMA_LOCKER, db::etcd},
        meta::{
            authz::Authz, ingestion::StreamSchemaChk, prom::METADATA_LABEL, stream::SchemaEvolution,
        },
        utils::json,
    },
    service::{db, search::server_internal_error},
};

pub(crate) fn get_upto_discard_error() -> anyhow::Error {
    anyhow::anyhow!(
        "Too old data, only last {} hours data can be ingested. Data discarded. You can adjust ingestion max time by setting the environment variable ZO_INGEST_ALLOWED_UPTO=<max_hours>",
        CONFIG.limit.ingest_allowed_upto
    )
}

pub(crate) fn get_request_columns_limit_error() -> anyhow::Error {
    anyhow::anyhow!(
        "Too many cloumns, only {} columns accept. Data discarded. You can adjust ingestion columns limit by setting the environment variable ZO_COLS_PER_RECORD_LIMIT=<max_cloumns>",
        CONFIG.limit.req_cols_per_record_limit
    )
}

#[tracing::instrument(name = "service:schema:schema_evolution", skip(inferred_schema))]
pub async fn schema_evolution(
    org_id: &str,
    stream_name: &str,
    stream_type: StreamType,
    inferred_schema: Arc<Schema>,
    min_ts: i64,
) {
    let schema = db::schema::get(org_id, stream_name, stream_type)
        .await
        .unwrap();

    if schema == Schema::empty() {
        let mut metadata = HashMap::new();
        metadata.insert("created_at".to_string(), min_ts.to_string());
        log::info!("schema_evolution: setting schema for {:?}", stream_name);
        db::schema::set(
            org_id,
            stream_name,
            stream_type,
            &Arc::into_inner(inferred_schema)
                .unwrap()
                .with_metadata(metadata),
            Some(min_ts),
            false,
        )
        .await
        .unwrap();
    } else if !inferred_schema.fields().eq(schema.fields()) {
        let schema_fields: HashSet<_> = schema.fields().iter().collect();
        let mut field_datatype_delta: Vec<_> = vec![];
        let mut new_field_delta: Vec<_> = vec![];

        for item in inferred_schema.fields.iter() {
            let item_name = item.name();
            let item_data_type = item.data_type();

            match schema_fields.iter().find(|f| f.name() == item_name) {
                Some(existing_field) => {
                    if existing_field.data_type() != item_data_type
                        && existing_field.data_type() != &DataType::Utf8
                    {
                        field_datatype_delta.push(format!("{}:[{}]", item_name, item_data_type));
                    }
                }
                None => {
                    new_field_delta.push(format!("{}:[{}]", item_name, item_data_type));
                }
            }
        }
        if field_datatype_delta.is_empty() && new_field_delta.is_empty() {
            return;
        }
        log::info!(
            "schema_evolution: updating schema for {:?} field data type delta is {:?} ,newly added fields are {:?}",
            stream_name,
            field_datatype_delta,
            new_field_delta
        );
        match try_merge(vec![schema, Arc::into_inner(inferred_schema).unwrap()]) {
            Err(e) => {
                log::error!(
                    "schema_evolution: schema merge failed for {:?} err: {:?}",
                    stream_name,
                    e
                );
            }
            Ok(merged) => {
                if !field_datatype_delta.is_empty() || !new_field_delta.is_empty() {
                    let is_field_delta = !field_datatype_delta.is_empty();
                    let mut final_fields = vec![];

                    let metadata = merged.metadata().clone();

                    for mut field in merged.to_cloned_fields().into_iter() {
                        if field.metadata().contains_key("zo_cast") {
                            let mut new_meta = field.metadata().clone();
                            new_meta.remove_entry("zo_cast");
                            field.set_metadata(new_meta);
                        }
                        final_fields.push(field);
                    }
                    let final_schema = Schema::new(final_fields.to_vec()).with_metadata(metadata);
                    db::schema::set(
                        org_id,
                        stream_name,
                        stream_type,
                        &final_schema,
                        Some(min_ts),
                        is_field_delta,
                    )
                    .await
                    .unwrap();
                }
            }
        };
    }
}

// Hack to allow widening conversion, method overrides Schema::try_merge
fn try_merge(schemas: impl IntoIterator<Item = Schema>) -> Result<Schema, ArrowError> {
    let mut merged_metadata: HashMap<String, String> = HashMap::new();
    let mut merged_fields: Vec<Field> = Vec::new();
    // TODO : this dummy initialization is to avoid compiler complaining for
    // uninitialized value
    let mut temp_field = Field::new("dummy", DataType::Utf8, false);

    for schema in schemas {
        for (key, value) in schema.metadata() {
            // merge metadata
            if let Some(old_val) = merged_metadata.get(key) {
                if old_val != value {
                    return Err(ArrowError::SchemaError(
                        "Fail to merge schema due to conflicting metadata.".to_string(),
                    ));
                }
            }
            merged_metadata.insert(key.to_string(), value.to_string());
        }

        // merge fields
        let mut found_at = 0;
        for field in schema.to_cloned_fields().iter().sorted_by_key(|v| v.name()) {
            let mut new_field = true;
            let mut allowed = false;
            for (stream, mut merged_field) in merged_fields.iter_mut().enumerate() {
                if field.name() != merged_field.name() {
                    continue;
                }
                new_field = false;
                if merged_field.data_type() != field.data_type() {
                    if !CONFIG.common.widening_schema_evolution {
                        return Err(ArrowError::SchemaError(format!(
                            "Fail to merge schema due to conflicting data type[{}:{}].",
                            merged_field.data_type(),
                            field.data_type()
                        )));
                    }
                    allowed = is_widening_conversion(merged_field.data_type(), field.data_type());
                    if allowed {
                        temp_field = Field::new(
                            merged_field.name(),
                            field.data_type().to_owned(),
                            merged_field.is_nullable(),
                        );
                        merged_field = &mut temp_field;
                    }
                }
                found_at = stream;
                match merged_field.try_merge(field) {
                    Ok(_) => {}
                    Err(_) => {
                        let mut meta = field.metadata().clone();
                        meta.insert("zo_cast".to_owned(), true.to_string());
                        merged_field.set_metadata(meta);
                    }
                };
            }
            // found a new field, add to field list
            if new_field {
                merged_fields.push(field.clone());
            }
            if allowed {
                let _ = std::mem::replace(&mut merged_fields[found_at], temp_field.to_owned());
            }
        }
    }
    let merged = Schema::new_with_metadata(merged_fields, merged_metadata);
    Ok(merged)
}

fn is_widening_conversion(from: &DataType, to: &DataType) -> bool {
    let allowed_type = match from {
        DataType::Boolean => vec![DataType::Utf8],
        DataType::Int8 => vec![
            DataType::Utf8,
            DataType::Int16,
            DataType::Int32,
            DataType::Int64,
            DataType::Float16,
            DataType::Float32,
            DataType::Float64,
        ],
        DataType::Int16 => vec![
            DataType::Utf8,
            DataType::Int32,
            DataType::Int64,
            DataType::Float16,
            DataType::Float32,
            DataType::Float64,
        ],
        DataType::Int32 => vec![
            DataType::Utf8,
            DataType::Int64,
            DataType::UInt32,
            DataType::UInt64,
            DataType::Float32,
            DataType::Float64,
        ],
        DataType::Int64 => vec![DataType::Utf8, DataType::UInt64, DataType::Float64],
        DataType::UInt8 => vec![
            DataType::Utf8,
            DataType::UInt16,
            DataType::UInt32,
            DataType::UInt64,
        ],
        DataType::UInt16 => vec![DataType::Utf8, DataType::UInt32, DataType::UInt64],
        DataType::UInt32 => vec![DataType::Utf8, DataType::UInt64],
        DataType::UInt64 => vec![DataType::Utf8],
        DataType::Float16 => vec![DataType::Utf8, DataType::Float32, DataType::Float64],
        DataType::Float32 => vec![DataType::Utf8, DataType::Float64],
        DataType::Float64 => vec![DataType::Utf8],
        _ => vec![DataType::Utf8],
    };
    allowed_type.contains(to)
}

pub async fn check_for_schema(
    org_id: &str,
    stream_name: &str,
    stream_type: StreamType,
    stream_schema_map: &mut HashMap<String, Schema>,
    record_val: &Map<String, Value>,
    record_ts: i64,
) -> Result<SchemaEvolution> {
    if !stream_schema_map.contains_key(stream_name) {
        let schema = db::schema::get(org_id, stream_name, stream_type)
            .await
            .unwrap();
        stream_schema_map.insert(stream_name.to_string(), schema);
    }

    let schema = stream_schema_map.get(stream_name).unwrap();

    if !schema.fields().is_empty() && CONFIG.common.skip_schema_validation {
        return Ok(SchemaEvolution {
            schema_compatible: true,
            is_schema_changed: false,
            types_delta: None,
        });
    }

    let value_iter = [record_val].into_iter();
    let inferred_schema = infer_json_schema_from_map(value_iter, stream_type).unwrap();

    // fast path
    if schema.fields.eq(&inferred_schema.fields) {
        // return (true, None, schema.fields().to_vec());
        return Ok(SchemaEvolution {
            schema_compatible: true,
            is_schema_changed: false,
            types_delta: None,
        });
    }

    if inferred_schema.fields.len() > CONFIG.limit.req_cols_per_record_limit {
        return Err(get_request_columns_limit_error());
    }

    let is_new = schema.fields().is_empty();
    if !is_new {
        let (is_schema_changed, field_datatype_delta, _) =
            get_schema_changes(schema, &inferred_schema);
        if !is_schema_changed {
            return Ok(SchemaEvolution {
                schema_compatible: true,
                is_schema_changed: false,
                types_delta: Some(field_datatype_delta),
            });
        }
    }

    // slow path
    Ok(handle_diff_schema(
        org_id,
        stream_name,
        stream_type,
        is_new,
        inferred_schema,
        record_ts,
        stream_schema_map,
    )
    .await
    .unwrap_or(SchemaEvolution {
        schema_compatible: true,
        is_schema_changed: false,
        types_delta: None,
    }))
}

async fn get_merged_schema(
    org_id: &str,
    stream_name: &str,
    stream_type: StreamType,
    inferred_schema: &Schema,
) -> Option<(Vec<Field>, Schema)> {
    let mut db_schema = db::schema::get_from_db(org_id, stream_name, stream_type)
        .await
        .unwrap();

    let (is_schema_changed, field_datatype_delta, merged_fields) =
        get_schema_changes(&db_schema, inferred_schema);

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
// 2. acquire locks
// 3. get schema from db,
// 4. if db_schema is identical to inferred_schema, return (means another thread has updated schema)
// 5. if db_schema is not identical to inferred_schema, merge schema and update db
// 6. release locks
async fn handle_diff_schema(
    org_id: &str,
    stream_name: &str,
    stream_type: StreamType,
    is_new: bool,
    inferred_schema: Schema,
    record_ts: i64,
    stream_schema_map: &mut HashMap<String, Schema>,
) -> Option<SchemaEvolution> {
    if CONFIG.common.local_mode {
        handle_diff_schema_local_mode(
            org_id,
            stream_name,
            stream_type,
            is_new,
            inferred_schema,
            record_ts,
            stream_schema_map,
        )
        .await
    } else {
        handle_diff_schema_cluster_mode(
            org_id,
            stream_name,
            stream_type,
            is_new,
            inferred_schema,
            record_ts,
            stream_schema_map,
        )
        .await
    }
}

async fn handle_diff_schema_local_mode(
    org_id: &str,
    stream_name: &str,
    stream_type: StreamType,
    is_new: bool,
    inferred_schema: Schema,
    record_ts: i64,
    stream_schema_map: &mut HashMap<String, Schema>,
) -> Option<SchemaEvolution> {
    let key = format!(
        "{}/schema/lock/{org_id}/{stream_type}/{stream_name}",
        &CONFIG.sled.prefix
    );
    let local_map = LOCAL_SCHEMA_LOCKER.clone();
    let mut schema_locker = local_map.write().await;
    let locker = schema_locker
        .entry(key)
        .or_insert_with(|| Arc::new(tokio::sync::RwLock::new(false)));
    let locker = locker.clone();
    drop(schema_locker);
    // lock acquired
    let lock_acquired = locker.write().await;

    let Some((field_datatype_delta, final_schema)) =
        get_merged_schema(org_id, stream_name, stream_type, &inferred_schema).await
    else {
        drop(lock_acquired);
        return None;
    };
    log::info!(
        "Acquired lock for local stream {} to update schema",
        stream_name
    );
    db::schema::set(
        org_id,
        stream_name,
        stream_type,
        &final_schema,
        Some(record_ts),
        !field_datatype_delta.is_empty(),
    )
    .await
    .expect("Failed to update schema");
    if is_new {
        crate::common::utils::auth::set_ownership(org_id, "streams", Authz::new(stream_name)).await;
    }
    // release lock
    drop(lock_acquired);

    stream_schema_map.insert(stream_name.to_string(), final_schema);
    Some(SchemaEvolution {
        schema_compatible: true,
        is_schema_changed: true,
        types_delta: Some(field_datatype_delta),
    })
}

async fn handle_diff_schema_cluster_mode(
    org_id: &str,
    stream_name: &str,
    stream_type: StreamType,
    is_new: bool,
    inferred_schema: Schema,
    record_ts: i64,
    stream_schema_map: &mut HashMap<String, Schema>,
) -> Option<SchemaEvolution> {
    let key = format!("schema/{org_id}/{stream_type}/{stream_name}",);
    let mut lock = etcd::Locker::new(&key);
    lock.lock(0).await.map_err(server_internal_error).unwrap();

    let Some((field_datatype_delta, final_schema)) =
        get_merged_schema(org_id, stream_name, stream_type, &inferred_schema).await
    else {
        lock.unlock().await.map_err(server_internal_error).unwrap();
        return None;
    };

    log::info!(
        "Acquired lock for cluster stream {} to update schema",
        stream_name
    );
    db::schema::set(
        org_id,
        stream_name,
        stream_type,
        &final_schema,
        Some(record_ts),
        !field_datatype_delta.is_empty(),
    )
    .await
    .expect("Failed to update schema");
    if is_new {
        crate::common::utils::auth::set_ownership(org_id, "streams", Authz::new(stream_name)).await;
    }
    // release lock
    lock.unlock().await.map_err(server_internal_error).unwrap();

    stream_schema_map.insert(stream_name.to_string(), final_schema);
    Some(SchemaEvolution {
        schema_compatible: true,
        is_schema_changed: true,
        types_delta: Some(field_datatype_delta),
    })
}

fn get_schema_changes(schema: &Schema, inferred_schema: &Schema) -> (bool, Vec<Field>, Vec<Field>) {
    let mut is_schema_changed = false;
    let mut field_datatype_delta: Vec<_> = vec![];

    let mut merged_fields = schema
        .fields()
        .iter()
        .map(|f| f.as_ref().to_owned())
        .collect::<Vec<_>>();
    let mut merged_fields_chk = hashbrown::HashMap::with_capacity(merged_fields.len());
    for (i, f) in merged_fields.iter().enumerate() {
        merged_fields_chk.insert(f.name().to_string(), i);
    }

    for item in inferred_schema.fields.iter() {
        let item_name = item.name();
        let item_data_type = item.data_type();

        match merged_fields_chk.get(item_name) {
            None => {
                is_schema_changed = true;
                merged_fields.push((**item).clone());
                merged_fields_chk.insert(item_name.to_string(), merged_fields.len() - 1);
            }
            Some(idx) => {
                let existing_field = &merged_fields[*idx];
                if existing_field.data_type() != item_data_type {
                    if !CONFIG.common.widening_schema_evolution {
                        field_datatype_delta.push(existing_field.clone());
                    } else if is_widening_conversion(existing_field.data_type(), item_data_type) {
                        is_schema_changed = true;
                        field_datatype_delta.push((**item).clone());
                        merged_fields[*idx] = (**item).clone();
                    } else {
                        let mut meta = existing_field.metadata().clone();
                        meta.insert("zo_cast".to_owned(), true.to_string());
                        field_datatype_delta.push(existing_field.clone().with_metadata(meta));
                    }
                }
            }
        }
    }

    (is_schema_changed, field_datatype_delta, merged_fields)
}

pub async fn stream_schema_exists(
    org_id: &str,
    stream_name: &str,
    stream_type: StreamType,
    stream_schema_map: &mut HashMap<String, Schema>,
) -> StreamSchemaChk {
    let mut schema_chk = StreamSchemaChk {
        conforms: true,
        has_fields: false,
        has_partition_keys: false,
        has_metadata: false,
    };
    let schema = match stream_schema_map.get(stream_name) {
        Some(schema) => schema.clone(),
        None => {
            let schema = db::schema::get(org_id, stream_name, stream_type)
                .await
                .unwrap();
            stream_schema_map.insert(stream_name.to_string(), schema.clone());
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

pub async fn add_stream_schema(
    org_id: &str,
    stream_name: &str,
    stream_type: StreamType,
    file: &File,
    stream_schema_map: &mut HashMap<String, Schema>,
    min_ts: i64,
) {
    let mut local_file = file;
    local_file.seek(SeekFrom::Start(0)).unwrap();
    let mut schema_reader = BufReader::new(local_file);
    let inferred_schema = infer_json_schema(&mut schema_reader, None, stream_type).unwrap();

    let existing_schema = stream_schema_map.get(&stream_name.to_string());
    let mut metadata = match existing_schema {
        Some(schema) => schema.metadata().clone(),
        None => HashMap::new(),
    };
    metadata.insert("created_at".to_string(), min_ts.to_string());
    if stream_type == StreamType::Traces {
        let settings = crate::common::meta::stream::StreamSettings {
            partition_keys: vec!["service_name".to_string()],
            partition_time_level: None,
            full_text_search_keys: vec![],
            bloom_filter_fields: vec![],
            data_retention: 0,
        };
        metadata.insert(
            "settings".to_string(),
            json::to_string(&settings).unwrap_or_default(),
        );
    }
    db::schema::set(
        org_id,
        stream_name,
        stream_type,
        &inferred_schema.clone().with_metadata(metadata),
        Some(min_ts),
        false,
    )
    .await
    .unwrap();
    stream_schema_map.insert(stream_name.to_string(), inferred_schema.clone());
}

pub async fn set_schema_metadata(
    org_id: &str,
    stream_name: &str,
    stream_type: StreamType,
    extra_metadata: &HashMap<String, String>,
) -> Result<(), anyhow::Error> {
    let schema = db::schema::get(org_id, stream_name, stream_type).await?;
    let mut metadata = schema.metadata().clone();
    let mut updated = false;
    for (key, value) in extra_metadata {
        if metadata.contains_key(key) {
            continue;
        }
        metadata.insert(key.to_owned(), value.to_owned());
        updated = true;
    }
    if !updated {
        return Ok(());
    }
    if !metadata.contains_key("created_at") {
        metadata.insert(
            "created_at".to_string(),
            chrono::Utc::now().timestamp_micros().to_string(),
        );
        crate::common::utils::auth::set_ownership(org_id, "streams", Authz::new(stream_name)).await;
    }
    db::schema::set(
        org_id,
        stream_name,
        stream_type,
        &schema.with_metadata(metadata),
        None,
        false,
    )
    .await
}

#[cfg(test)]
mod tests {
    use datafusion::arrow::datatypes::{DataType, Field, Schema};

    use super::*;

    #[test]
    fn test_is_widening_conversion() {
        assert!(is_widening_conversion(&DataType::Int8, &DataType::Int32));
    }

    #[test]
    fn test_try_merge() {
        let merged = try_merge(vec![
            Schema::new(vec![
                Field::new("c1", DataType::Int64, false),
                Field::new("c2", DataType::Utf8, false),
            ]),
            Schema::new(vec![
                Field::new("c1", DataType::Int64, true),
                Field::new("c2", DataType::Utf8, false),
                Field::new("c3", DataType::Utf8, false),
            ]),
        ])
        .unwrap();

        assert_eq!(
            merged,
            Schema::new(vec![
                Field::new("c1", DataType::Int64, true),
                Field::new("c2", DataType::Utf8, false),
                Field::new("c3", DataType::Utf8, false),
            ]),
        );
    }

    #[actix_web::test]
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
        let mut map: HashMap<String, Schema> = HashMap::new();
        map.insert(stream_name.to_string(), schema);
        let result = check_for_schema(
            org_name,
            stream_name,
            StreamType::Logs,
            &mut map,
            record.as_object().unwrap(),
            1234234234234,
        )
        .await
        .unwrap();
        assert!(result.schema_compatible);
    }
}
