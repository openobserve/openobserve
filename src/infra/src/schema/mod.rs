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

use chrono::Utc;
use config::{
    meta::stream::{PartitionTimeLevel, StreamSettings, StreamType},
    utils::json,
    RwAHashMap, CONFIG,
};
use datafusion::arrow::datatypes::{DataType, Field, Schema};
use once_cell::sync::Lazy;

use crate::{
    db as infra_db,
    errors::{DbError, Error},
};

pub static STREAM_SCHEMAS: Lazy<RwAHashMap<String, Vec<Schema>>> = Lazy::new(Default::default);
pub static STREAM_SCHEMAS_LATEST: Lazy<RwAHashMap<String, Schema>> = Lazy::new(Default::default);
pub static STREAM_SCHEMAS_FIELDS: Lazy<RwAHashMap<String, (i64, Vec<String>)>> =
    Lazy::new(Default::default);
pub static STREAM_SETTINGS: Lazy<RwAHashMap<String, StreamSettings>> = Lazy::new(Default::default);

pub fn mk_key(org_id: &str, stream_type: StreamType, stream_name: &str) -> String {
    format!("/schema/{org_id}/{stream_type}/{stream_name}")
}

pub async fn get(
    org_id: &str,
    stream_name: &str,
    stream_type: StreamType,
) -> Result<Schema, anyhow::Error> {
    let key = mk_key(org_id, stream_type, stream_name);
    let cache_key = key.strip_prefix("/schema/").unwrap();

    let r = STREAM_SCHEMAS_LATEST.read().await;
    if let Some(schema) = r.get(cache_key) {
        return Ok(schema.clone());
    }
    drop(r);
    // if not found in cache, get from db
    get_from_db(org_id, stream_name, stream_type).await
}

pub async fn get_from_db(
    org_id: &str,
    stream_name: &str,
    stream_type: StreamType,
) -> Result<Schema, anyhow::Error> {
    let key = mk_key(org_id, stream_type, stream_name);
    let db = infra_db::get_db().await;
    Ok(match db.get(&key).await {
        Err(e) => {
            if let Error::DbError(DbError::KeyNotExists(_)) = e {
                Schema::empty()
            } else {
                return Err(anyhow::anyhow!("Error getting schema: {}", e));
            }
        }
        Ok(v) => {
            let schemas: Result<Vec<Schema>, _> = json::from_slice(&v);
            if let Ok(mut schemas) = schemas {
                if schemas.is_empty() {
                    Schema::empty()
                } else {
                    schemas.remove(schemas.len() - 1)
                }
            } else {
                json::from_slice(&v)?
            }
        }
    })
}

pub async fn get_versions(
    org_id: &str,
    stream_name: &str,
    stream_type: StreamType,
) -> Result<Vec<Schema>, anyhow::Error> {
    let key = mk_key(org_id, stream_type, stream_name);
    let cache_key = key.strip_prefix("/schema/").unwrap();

    let r = STREAM_SCHEMAS.read().await;
    if let Some(schema) = r.get(cache_key) {
        return Ok(schema.clone());
    }

    let db = infra_db::get_db().await;
    Ok(match db.get(&key).await {
        Err(e) => {
            if let Error::DbError(DbError::KeyNotExists(_)) = e {
                vec![]
            } else {
                return Err(anyhow::anyhow!("Error getting schema versions: {}", e));
            }
        }
        Ok(v) => {
            let schemas: Result<Vec<Schema>, _> = json::from_slice(&v);
            if let Ok(schemas) = schemas {
                schemas
            } else {
                vec![json::from_slice(&v)?]
            }
        }
    })
}

pub async fn get_settings(
    org_id: &str,
    stream_name: &str,
    stream_type: StreamType,
) -> Option<StreamSettings> {
    let key = format!("{}/{}/{}", org_id, stream_type, stream_name);
    let r = STREAM_SETTINGS.read().await;
    if let Some(v) = r.get(&key) {
        return Some(v.clone());
    }
    // if not found in cache, get from db
    get(org_id, stream_name, stream_type)
        .await
        .ok()
        .and_then(|schema| unwrap_stream_settings(&schema))
}

pub fn unwrap_stream_settings(schema: &Schema) -> Option<StreamSettings> {
    if schema.metadata().is_empty() {
        return None;
    }
    schema
        .metadata()
        .get("settings")
        .map(|v| StreamSettings::from(v.as_str()))
}

pub fn unwrap_partition_time_level(
    level: Option<PartitionTimeLevel>,
    stream_type: StreamType,
) -> PartitionTimeLevel {
    let level = level.unwrap_or_default();
    if level != PartitionTimeLevel::Unset {
        level
    } else {
        match stream_type {
            StreamType::Logs => PartitionTimeLevel::from(CONFIG.limit.logs_file_retention.as_str()),
            StreamType::Metrics => {
                PartitionTimeLevel::from(CONFIG.limit.metrics_file_retention.as_str())
            }
            StreamType::Traces => {
                PartitionTimeLevel::from(CONFIG.limit.traces_file_retention.as_str())
            }
            _ => PartitionTimeLevel::default(),
        }
    }
}

pub async fn set(
    org_id: &str,
    stream_name: &str,
    stream_type: StreamType,
    schema: &Schema,
    min_ts: Option<i64>,
    new_version: bool,
) -> Result<(), anyhow::Error> {
    let db = crate::db::get_db().await;
    if min_ts.is_some() && new_version {
        let last_schema = get(org_id, stream_name, stream_type).await?;
        let min_ts = min_ts.unwrap_or_else(|| Utc::now().timestamp_micros());
        if !last_schema.fields().is_empty() {
            let mut last_meta = last_schema.metadata().clone();
            let created_at: i64 = last_meta.get("start_dt").unwrap().clone().parse().unwrap();
            let key = format!("/schema/{org_id}/{stream_type}/{stream_name}",);
            last_meta.insert("end_dt".to_string(), min_ts.to_string());
            let prev_schema = vec![last_schema.clone().with_metadata(last_meta)];
            let _ = db
                .put(
                    &key,
                    json::to_vec(&prev_schema).unwrap().into(),
                    crate::db::NO_NEED_WATCH,
                    Some(created_at),
                )
                .await;
        }

        let mut metadata = last_schema.metadata().clone();
        if metadata.contains_key("created_at") {
            metadata.insert(
                "created_at".to_string(),
                metadata.get("created_at").unwrap().clone(),
            );
        } else {
            metadata.insert("created_at".to_string(), min_ts.to_string());
        }

        metadata.insert("start_dt".to_string(), min_ts.to_string());

        let new_schema = vec![schema.to_owned().with_metadata(metadata)];

        let key = format!("/schema/{org_id}/{stream_type}/{stream_name}");
        let _ = db
            .put(
                &key,
                json::to_vec(&new_schema).unwrap().into(),
                infra_db::NEED_WATCH,
                Some(min_ts),
            )
            .await;

        Ok(())
    } else {
        let incoming_meta = schema.metadata();
        let meta = if incoming_meta.is_empty() {
            let current_schema = get(org_id, stream_name, stream_type).await?;
            let mut current_meta = current_schema.metadata().clone();
            let min_ts = min_ts.unwrap_or_else(|| Utc::now().timestamp_micros());
            if current_meta.contains_key("created_at") {
                if !current_meta.contains_key("start_dt") {
                    current_meta.insert(
                        "start_dt".to_string(),
                        current_meta.get("created_at").unwrap().clone(),
                    );
                }
            } else {
                current_meta.insert("start_dt".to_string(), min_ts.to_string());
                current_meta.insert("created_at".to_string(), min_ts.to_string());
            };
            current_meta
        } else {
            incoming_meta.clone()
        };
        let start_dt = meta
            .get("start_dt")
            .unwrap_or(&Utc::now().timestamp_micros().to_string())
            .parse()
            .unwrap();
        let key = format!("/schema/{org_id}/{stream_type}/{stream_name}",);
        let new_schema = vec![schema.to_owned().with_metadata(meta)];
        let _ = db
            .put(
                &key,
                json::to_vec(&new_schema).unwrap().into(),
                infra_db::NEED_WATCH,
                Some(start_dt),
            )
            .await;
        Ok(())
    }
}

pub async fn merge(
    org_id: &str,
    stream_name: &str,
    stream_type: StreamType,
    schema: &Schema,
    min_ts: Option<i64>,
) -> Result<Option<(Schema, Vec<Field>)>, anyhow::Error> {
    let start_dt = min_ts;
    let key = mk_key(org_id, stream_type, stream_name);
    #[cfg(feature = "enterprise")]
    let key_for_update = key.clone();
    let inferred_schema = schema.clone();
    let (tx, rx) = tokio::sync::oneshot::channel();
    let db = infra_db::get_db().await;
    db.get_for_update(
        &key.clone(),
        infra_db::NEED_WATCH,
        None,
        Box::new(move |value| {
            match value {
                None => Ok(Some((
                    None,
                    Some((
                        key,
                        json::to_vec(&vec![{
                            // there is no schema, just set the new schema
                            let schema_metadata = inferred_schema.metadata();
                            tx.send(None).unwrap();
                            if schema_metadata.contains_key("created_at")
                                && schema_metadata.contains_key("start_dt")
                            {
                                inferred_schema
                            } else {
                                let start_dt =
                                    start_dt.unwrap_or_else(|| Utc::now().timestamp_micros());
                                let mut schema_metadata = inferred_schema.metadata().clone();
                                if !schema_metadata.contains_key("created_at") {
                                    schema_metadata
                                        .insert("created_at".to_string(), start_dt.to_string());
                                }
                                if !schema_metadata.contains_key("start_dt") {
                                    schema_metadata
                                        .insert("start_dt".to_string(), start_dt.to_string());
                                }
                                inferred_schema.with_metadata(schema_metadata)
                            }
                        }])
                        .unwrap()
                        .into(),
                        start_dt,
                    )),
                ))),
                Some(value) => {
                    // there is schema, merge the schema
                    // parse latest schema
                    let mut schemas: Vec<Schema> = json::from_slice(&value)?;
                    let latest_schema = match schemas.last_mut() {
                        Some(s) => s,
                        None => {
                            return Err(Error::Message(format!(
                                "Error parsing latest schema for schema: {}",
                                key
                            )));
                        }
                    };
                    // merge schema
                    let (is_schema_changed, field_datatype_delta, merged_fields) =
                        get_merge_schema_changes(latest_schema, &inferred_schema);
                    if !is_schema_changed {
                        tx.send(None).unwrap();
                        return Ok(None); // no change, return
                    }
                    let metadata = latest_schema.metadata().clone();
                    let final_schema = Schema::new(merged_fields).with_metadata(metadata);
                    let need_new_version = !field_datatype_delta.is_empty();
                    if need_new_version && start_dt.is_some() {
                        // update old version end_dt
                        let mut metadata = latest_schema.metadata().clone();
                        metadata.insert("end_dt".to_string(), start_dt.unwrap().to_string());
                        let prev_schema = vec![latest_schema.clone().with_metadata(metadata)];
                        let mut new_metadata = latest_schema.metadata().clone();
                        new_metadata.insert("start_dt".to_string(), start_dt.unwrap().to_string());
                        let new_schema = vec![final_schema.clone().with_metadata(new_metadata)];
                        tx.send(Some((final_schema, field_datatype_delta))).unwrap();
                        Ok(Some((
                            Some(json::to_vec(&prev_schema).unwrap().into()),
                            Some((key, json::to_vec(&new_schema).unwrap().into(), start_dt)),
                        )))
                    } else {
                        // just update the latest schema
                        tx.send(Some((final_schema.clone(), vec![]))).unwrap();
                        Ok(Some((
                            Some(json::to_vec(&vec![final_schema]).unwrap().into()),
                            None,
                        )))
                    }
                }
            }
        }),
    )
    .await?;

    // super cluster
    #[cfg(feature = "enterprise")]
    if O2_CONFIG.super_cluster.enabled {
        o2_enterprise::enterprise::super_cluster::queue::schema_merge(
            &key_for_update,
            json::to_vec(&schema).unwrap().into(),
            infra::db::NEED_WATCH,
            start_dt,
        )
        .await
        .map_err(|e| Error::Message(e.to_string()))?;
    }

    Ok(rx.await?)
}

pub async fn update_setting(
    org_id: &str,
    stream_name: &str,
    stream_type: StreamType,
    metadata: std::collections::HashMap<String, String>,
) -> Result<(), anyhow::Error> {
    let key = mk_key(org_id, stream_type, stream_name);
    #[cfg(feature = "enterprise")]
    let key_for_update = key.clone();
    #[cfg(feature = "enterprise")]
    let metadata_for_update = metadata.clone();
    let db = infra_db::get_db().await;
    db.get_for_update(
        &key.clone(),
        infra_db::NEED_WATCH,
        None,
        Box::new(move |value| {
            let (latest_schema, not_exists) = match value {
                None => (Schema::empty(), true),
                Some(value) => {
                    let mut schemas: Vec<Schema> = json::from_slice(&value)?;
                    if schemas.is_empty() {
                        (Schema::empty(), false)
                    } else {
                        (schemas.remove(schemas.len() - 1), false)
                    }
                }
            };
            let mut schema_metadata = latest_schema.metadata().clone();
            for (k, v) in metadata.iter() {
                schema_metadata.insert(k.clone(), v.clone());
            }
            let start_dt = match schema_metadata.get("created_at") {
                Some(v) => v.parse().unwrap(),
                None => Utc::now().timestamp_micros(),
            };
            if !schema_metadata.contains_key("created_at") {
                schema_metadata.insert("created_at".to_string(), start_dt.to_string());
            }
            if !schema_metadata.contains_key("start_dt") {
                schema_metadata.insert("start_dt".to_string(), start_dt.to_string());
            }
            let new_schema = vec![latest_schema.with_metadata(schema_metadata)];
            if not_exists {
                Ok(Some((
                    None,
                    Some((
                        key,
                        json::to_vec(&new_schema).unwrap().into(),
                        Some(start_dt),
                    )),
                )))
            } else {
                Ok(Some((
                    Some(json::to_vec(&new_schema).unwrap().into()),
                    None,
                )))
            }
        }),
    )
    .await?;

    // super cluster
    #[cfg(feature = "enterprise")]
    if O2_CONFIG.super_cluster.enabled {
        o2_enterprise::enterprise::super_cluster::queue::schema_setting(
            &key_for_update,
            json::to_vec(&metadata_for_update).unwrap().into(),
            infra::db::NEED_WATCH,
            None,
        )
        .await
        .map_err(|e| Error::Message(e.to_string()))?;
    }
    Ok(())
}

pub async fn delete_fields(
    org_id: &str,
    stream_name: &str,
    stream_type: StreamType,
    deleted_fields: Vec<String>,
) -> Result<(), anyhow::Error> {
    let key = mk_key(org_id, stream_type, stream_name);
    #[cfg(feature = "enterprise")]
    let key_for_update = key.clone();
    #[cfg(feature = "enterprise")]
    let deleted_fields_for_update = deleted_fields.clone();
    let db = infra_db::get_db().await;
    db.get_for_update(
        &key.clone(),
        infra_db::NEED_WATCH,
        None,
        Box::new(move |value| {
            let Some(value) = value else {
                return Ok(None);
            };
            let mut schemas: Vec<Schema> = json::from_slice(&value)?;
            let latest_schema = if schemas.is_empty() {
                return Ok(None);
            } else {
                schemas.remove(schemas.len() - 1)
            };
            let start_dt = Utc::now().timestamp_micros();
            // update previous version schema
            let mut latest_metadata = latest_schema.metadata().clone();
            latest_metadata.insert("end_dt".to_string(), start_dt.to_string());
            let prev_schema = vec![latest_schema.clone().with_metadata(latest_metadata)];
            // new version schema
            let mut new_metadata = latest_schema.metadata().clone();
            new_metadata.insert("start_dt".to_string(), start_dt.to_string());
            let fields = latest_schema
                .fields()
                .iter()
                .filter_map(|f| {
                    if deleted_fields.contains(&f.name().to_string()) {
                        None
                    } else {
                        Some(f.clone())
                    }
                })
                .collect::<Vec<_>>();
            let new_schema = vec![Schema::new_with_metadata(fields, new_metadata)];
            Ok(Some((
                Some(json::to_vec(&prev_schema).unwrap().into()),
                Some((
                    key,
                    json::to_vec(&new_schema).unwrap().into(),
                    Some(start_dt),
                )),
            )))
        }),
    )
    .await?;

    // super cluster
    #[cfg(feature = "enterprise")]
    if O2_CONFIG.super_cluster.enabled {
        o2_enterprise::enterprise::super_cluster::queue::schema_delete_fields(
            &key_for_update,
            json::to_vec(&deleted_fields_for_update).unwrap().into(),
            infra::db::NEED_WATCH,
            None,
        )
        .await
        .map_err(|e| Error::Message(e.to_string()))?;
    }

    Ok(())
}

pub async fn delete(
    org_id: &str,
    stream_name: &str,
    stream_type: StreamType,
) -> Result<(), anyhow::Error> {
    let key = format!("/schema/{org_id}/{stream_type}/{stream_name}");
    let db = infra_db::get_db().await;
    match db.delete(&key, false, infra_db::NEED_WATCH, None).await {
        Ok(_) => {}
        Err(e) => {
            log::error!("Error deleting schema: {}", e);
            return Err(anyhow::anyhow!("Error deleting schema: {}", e));
        }
    }
    Ok(())
}

pub fn get_merge_schema_changes(
    schema: &Schema,
    inferred_schema: &Schema,
) -> (bool, Vec<Field>, Vec<Field>) {
    let mut is_schema_changed = false;
    let mut field_datatype_delta: Vec<_> = vec![];

    let mut merged_fields = schema.fields().iter().collect::<Vec<_>>();
    let mut merged_fields_chk = hashbrown::HashMap::with_capacity(merged_fields.len());
    for (i, f) in merged_fields.iter().enumerate() {
        merged_fields_chk.insert(f.name(), i);
    }

    for item in inferred_schema.fields.iter() {
        let item_name = item.name();
        let item_data_type = item.data_type();

        match merged_fields_chk.get(item_name) {
            None => {
                is_schema_changed = true;
                merged_fields.push(item);
                merged_fields_chk.insert(item_name, merged_fields.len() - 1);
            }
            Some(idx) => {
                let existing_field = &merged_fields[*idx];
                if existing_field.data_type() != item_data_type {
                    if !CONFIG.common.widening_schema_evolution {
                        field_datatype_delta.push(existing_field.as_ref().clone());
                    } else if is_widening_conversion(existing_field.data_type(), item_data_type) {
                        is_schema_changed = true;
                        merged_fields[*idx] = item;
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
    if !is_schema_changed {
        (false, field_datatype_delta, vec![])
    } else {
        (
            true,
            field_datatype_delta,
            merged_fields
                .into_iter()
                .map(|f| f.as_ref().clone())
                .collect::<Vec<_>>(),
        )
    }
}

pub fn is_widening_conversion(from: &DataType, to: &DataType) -> bool {
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_is_widening_conversion() {
        assert!(is_widening_conversion(&DataType::Int8, &DataType::Int32));
    }
}
