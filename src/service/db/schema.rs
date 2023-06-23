// Copyright 2022 Zinc Labs Inc. and Contributors
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

use ahash::AHashSet;
use chrono::Utc;
use datafusion::arrow::datatypes::Schema;
use std::sync::Arc;

use crate::common::json;
use crate::common::utils::is_local_disk_storage;
use crate::infra::cache;
use crate::infra::config::{CONFIG, ENRICHMENT_TABLES, STREAM_SCHEMAS};
use crate::infra::db::Event;
use crate::meta::stream::StreamSchema;
use crate::meta::StreamType;
use crate::service::enrichment::StreamTable;

fn mk_key(org_id: &str, stream_type: StreamType, stream_name: &str) -> String {
    format!("/schema/{org_id}/{stream_type}/{stream_name}")
}

pub async fn get(
    org_id: &str,
    stream_name: &str,
    stream_type: StreamType,
) -> Result<Schema, anyhow::Error> {
    let key = mk_key(org_id, stream_type, stream_name);
    let map_key = key.strip_prefix("/schema/").unwrap();

    if let Some(schema) = STREAM_SCHEMAS.get(map_key) {
        return Ok(schema.value().clone().last().unwrap().clone());
    }

    let db = &crate::infra::db::DEFAULT;
    Ok(match db.get(&key).await {
        Err(_) => {
            // REVIEW: shouldn't we report the error?
            Schema::empty()
        }
        Ok(v) => {
            let local_val: json::Value = json::from_slice(&v).unwrap();
            // for backward compatibility check if value in etcd is vec or schema based on it return value
            if local_val.is_array() {
                let local_vec: Vec<Schema> = json::from_slice(&v).unwrap();
                local_vec.last().unwrap().clone()
            } else {
                json::from_slice(&v).unwrap()
            }
        }
    })
}

pub async fn get_from_db(
    org_id: &str,
    stream_name: &str,
    stream_type: StreamType,
) -> Result<Schema, anyhow::Error> {
    let key = mk_key(org_id, stream_type, stream_name);

    let db = &crate::infra::db::DEFAULT;
    Ok(match db.get(&key).await {
        Err(_) => {
            // REVIEW: shouldn't we report the error?
            Schema::empty()
        }
        Ok(v) => {
            let local_val: json::Value = json::from_slice(&v).unwrap();
            // for backward compatibility check if value in etcd is vec or schema based on it return value
            if local_val.is_array() {
                let local_vec: Vec<Schema> = json::from_slice(&v).unwrap();
                local_vec.last().unwrap().clone()
            } else {
                json::from_slice(&v).unwrap()
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
    let map_key = key.strip_prefix("/schema/").unwrap();

    if STREAM_SCHEMAS.contains_key(map_key) {
        return Ok(STREAM_SCHEMAS.get(map_key).unwrap().value().clone());
    }

    let db = &crate::infra::db::DEFAULT;
    Ok(match db.get(&key).await {
        Err(_) => {
            // REVIEW: shouldn't we report the error?
            vec![]
        }
        Ok(v) => {
            // for backward compatibility check if value in etcd is vec or schema based on it return value
            let local_val: json::Value = json::from_slice(&v).unwrap();
            if local_val.is_array() {
                json::from_slice(&v).unwrap()
            } else {
                vec![json::from_slice(&v).unwrap()]
            }
        }
    })
}

pub async fn set(
    org_id: &str,
    stream_name: &str,
    stream_type: StreamType,
    schema: &Schema,
    min_ts: Option<i64>,
    new_version: bool,
) -> Result<(), anyhow::Error> {
    let db = &crate::infra::db::DEFAULT;
    let mut versions: Vec<Schema>;
    let key = format!("/schema/{org_id}/{stream_type}/{stream_name}");
    let map_key = key.strip_prefix("/schema/").unwrap();
    if STREAM_SCHEMAS.contains_key(map_key) {
        versions = STREAM_SCHEMAS.get(map_key).unwrap().value().clone();
        if min_ts.is_some() && new_version {
            //update last schema to add end date
            let last_schema = versions.pop().unwrap();
            if !last_schema.fields.eq(&schema.fields) {
                let mut last_meta = last_schema.metadata().clone();
                let created_at = last_meta.get("created_at").unwrap().to_string();
                last_meta.insert("end_dt".to_string(), min_ts.unwrap().to_string());
                versions.push(last_schema.with_metadata(last_meta));

                //update current schema to add start date
                let mut metadata = schema.metadata().clone();
                metadata.insert("start_dt".to_string(), min_ts.unwrap().to_string());
                metadata.insert("created_at".to_string(), created_at);
                versions.push(schema.clone().with_metadata(metadata));
                let _ = db.put(&key, json::to_vec(&versions).unwrap().into()).await;
            }
        } else {
            versions.pop().unwrap();
            versions.push(schema.clone());
            let _ = db.put(&key, json::to_vec(&versions).unwrap().into()).await;
        }
    } else {
        let mut metadata = schema.metadata().clone();
        if metadata.contains_key("created_at") {
            metadata.insert(
                "start_dt".to_string(),
                metadata.get("created_at").unwrap().clone(),
            );
        } else {
            let min_ts = min_ts.unwrap_or_else(|| Utc::now().timestamp_micros());
            metadata.insert("start_dt".to_string(), min_ts.to_string());
            metadata.insert("created_at".to_string(), min_ts.to_string());
        }
        let _ = db
            .put(
                &key,
                json::to_vec(&vec![schema.clone().with_metadata(metadata)])
                    .unwrap()
                    .into(),
            )
            .await;
    }
    Ok(())
}

pub async fn delete(
    org_id: &str,
    stream_name: &str,
    stream_type: Option<StreamType>,
) -> Result<(), anyhow::Error> {
    let stream_type = stream_type.unwrap_or(StreamType::Logs);
    let key = format!("/schema/{org_id}/{stream_type}/{stream_name}");
    let db = &crate::infra::db::DEFAULT;
    Ok(db.delete(&key, false).await?)
}

#[tracing::instrument]
fn list_stream_schemas(
    org_id: &str,
    stream_type: Option<StreamType>,
    fetch_schema: bool,
) -> Vec<StreamSchema> {
    assert!(!STREAM_SCHEMAS.is_empty());
    let prefix = match stream_type {
        None => format!("{org_id}/"),
        Some(stream_type) => format!("{org_id}/{stream_type}/"),
    };
    STREAM_SCHEMAS
        .iter()
        .filter_map(|it| {
            it.key().strip_prefix(&prefix).map(|key| {
                let (stream_type, stream_name) = match stream_type {
                    Some(stream_type) => (stream_type, key.into()),
                    None => {
                        let columns = key.split('/').take(2).collect::<Vec<_>>();
                        assert_eq!(columns.len(), 2, "BUG");
                        (columns[0].into(), columns[1].into())
                    }
                };
                StreamSchema {
                    stream_name,
                    stream_type,
                    schema: if fetch_schema {
                        it.value().last().unwrap().clone()
                    } else {
                        Schema::empty()
                    },
                }
            })
        })
        .collect()
}

#[tracing::instrument(name = "db:schema:list")]
pub async fn list(
    org_id: &str,
    stream_type: Option<StreamType>,
    fetch_schema: bool,
) -> Result<Vec<StreamSchema>, anyhow::Error> {
    if !STREAM_SCHEMAS.is_empty() {
        return Ok(list_stream_schemas(org_id, stream_type, fetch_schema));
    }

    let db = &crate::infra::db::DEFAULT;
    let db_key = match stream_type {
        None => format!("/schema/{org_id}/"),
        Some(stream_type) => format!("/schema/{org_id}/{stream_type}/"),
    };
    Ok(db
        .list(&db_key)
        .await?
        .into_iter()
        .map(|(key, val)| {
            let key = key.strip_prefix(&db_key).unwrap();
            let (stream_type, stream_name) = match stream_type {
                Some(stream_type) => (stream_type, key.into()),
                None => {
                    let columns = key.split('/').take(2).collect::<Vec<_>>();
                    assert_eq!(columns.len(), 2, "BUG");
                    (columns[0].into(), columns[1].into())
                }
            };
            StreamSchema {
                stream_name,
                stream_type,
                schema: if fetch_schema {
                    json::from_slice(&val).unwrap()
                } else {
                    Schema::empty()
                },
            }
        })
        .collect())
}

pub async fn watch() -> Result<(), anyhow::Error> {
    let db = &crate::infra::db::DEFAULT;
    let key = "/schema/";
    let mut events = db.watch(key).await?;
    let events = Arc::get_mut(&mut events).unwrap();
    log::info!("Start watching stream schema");
    loop {
        let ev = match events.recv().await {
            Some(ev) => ev,
            None => {
                log::error!("watch_stream_schema: event channel closed");
                break;
            }
        };
        match ev {
            Event::Put(ev) => {
                let item_key = ev.key.strip_prefix(key).unwrap();
                let item_value: Vec<Schema> = json::from_slice(&ev.value.unwrap()).unwrap();
                STREAM_SCHEMAS.insert(item_key.to_owned(), item_value.clone());
                let keys = item_key.split('/').collect::<Vec<&str>>();
                let org_id = keys[0];
                let stream_type = StreamType::from(keys[1]);
                let stream_name = keys[2];

                if stream_type.eq(&StreamType::EnrichmentTables) {
                    ENRICHMENT_TABLES.insert(
                        item_key.to_owned(),
                        StreamTable {
                            org_id: org_id.to_string(),
                            stream_name: stream_name.to_string(),
                            data: super::enrichment_table::get(org_id, stream_name)
                                .await
                                .unwrap(),
                        },
                    );
                }
            }
            Event::Delete(ev) => {
                let item_key = ev.key.strip_prefix(key).unwrap();
                let columns = item_key.split('/').collect::<Vec<&str>>();
                let org_id = columns[0];
                let stream_type = StreamType::from(columns[1]);
                let stream_name = columns[2];
                STREAM_SCHEMAS.remove(item_key);
                cache::stats::remove_stream_stats(org_id, stream_name, stream_type);
                if let Err(e) =
                    super::compact::files::del_offset(org_id, stream_name, stream_type).await
                {
                    log::error!("del_offset: {}", e);
                }

                if stream_type.eq(&StreamType::EnrichmentTables) && is_local_disk_storage() {
                    let data_dir = format!(
                        "{}/files/{org_id}/{stream_type}/{stream_name}",
                        CONFIG.common.data_wal_dir
                    );
                    let path = std::path::Path::new(&data_dir);
                    if path.exists() {
                        std::fs::remove_dir_all(path).unwrap();
                    }
                }
            }
        }
    }
    Ok(())
}

pub async fn cache() -> Result<(), anyhow::Error> {
    let db = &crate::infra::db::DEFAULT;
    let key = "/schema/";
    let ret = db.list(key).await?;
    for (item_key, item_value) in ret {
        let item_key_str = item_key.strip_prefix(key).unwrap();
        // Hack: compatible for DataFusion 15
        let mut item_value = item_value;
        let value_str = std::str::from_utf8(&item_value).unwrap().to_string();
        if !value_str.contains(r#","metadata":{}}"#) {
            let value_str = value_str.replace(
                r#","dict_is_ordered":false}"#,
                r#","dict_is_ordered":false,"metadata":{}}"#,
            );
            item_value = bytes::Bytes::from(value_str);
        }
        // Hack: compatible old version, schema is an object
        if item_value[0] == b'{' {
            let value_str = format!("[{value_str}]");
            item_value = bytes::Bytes::from(value_str);
        }
        // Hack end
        let json_val: Vec<Schema> = match json::from_slice(&item_value) {
            Ok(v) => v,
            Err(e) => {
                return Err(anyhow::anyhow!(
                    "Error parsing schema, key: {}, error: {}",
                    item_key,
                    e
                ));
            }
        };
        STREAM_SCHEMAS.insert(item_key_str.to_string(), json_val);

        let keys = item_key_str.split('/').collect::<Vec<&str>>();
        let org_id = keys[0];
        let stream_type = StreamType::from(keys[1]);
        let stream_name = keys[2];
        if stream_type.eq(&StreamType::EnrichmentTables) {
            ENRICHMENT_TABLES.insert(
                item_key.to_owned(),
                StreamTable {
                    org_id: org_id.to_string(),
                    stream_name: stream_name.to_string(),
                    data: super::enrichment_table::get(org_id, stream_name)
                        .await
                        .unwrap(),
                },
            );
        }
    }
    log::info!("Stream schemas Cached");
    Ok(())
}

pub fn filter_schema_version_id(schemas: &[Schema], _start_dt: i64, end_dt: i64) -> Option<usize> {
    for (i, schema) in schemas.iter().enumerate() {
        let metadata = schema.metadata();
        let schema_end_dt: i64 = metadata
            .get("end_dt")
            .unwrap_or(&"0".to_string())
            .parse()
            .unwrap();
        if schema_end_dt == 0 || end_dt < schema_end_dt {
            return Some(i);
        }
    }
    None
}

pub fn list_organizations_from_cache() -> Vec<String> {
    let mut names = AHashSet::new();
    for schema in STREAM_SCHEMAS.iter() {
        if !schema.key().contains('/') {
            continue;
        }
        let name = schema.key().split('/').collect::<Vec<&str>>()[0].to_string();
        if !names.contains(&name) {
            names.insert(name);
        }
    }
    names.into_iter().collect::<Vec<String>>()
}

pub fn list_streams_from_cache(org_id: &str, stream_type: StreamType) -> Vec<String> {
    let mut names = AHashSet::new();
    for schema in STREAM_SCHEMAS.iter() {
        if !schema.key().contains('/') {
            continue;
        }
        let columns = schema.key().split('/').collect::<Vec<&str>>();
        let cur_org_id = columns[0];
        if !org_id.eq(cur_org_id) {
            continue;
        }
        let cur_stream_type = StreamType::from(columns[1]);
        if !stream_type.eq(&cur_stream_type) {
            continue;
        }
        let cur_stream_name = columns[2].to_string();
        names.insert(cur_stream_name);
    }
    names.into_iter().collect::<Vec<String>>()
}
