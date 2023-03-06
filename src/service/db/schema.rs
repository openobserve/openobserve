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

use chrono::Utc;
use datafusion::arrow::datatypes::Schema;
use serde_json::Value;
use std::sync::Arc;

use crate::common::json;
use crate::infra::cache;
use crate::infra::config::STREAM_SCHEMAS;
use crate::infra::db::Event;
use crate::meta::stream::StreamSchema;
use crate::meta::StreamType;

pub async fn get(
    org_id: &str,
    stream_name: &str,
    stream_type: Option<StreamType>,
) -> Result<Schema, anyhow::Error> {
    let mut value = Schema::empty();
    let stream_type = match stream_type {
        Some(v) => v,
        None => StreamType::Logs,
    };
    let key = format!("/schema/{}/{}/{}", org_id, stream_type, stream_name);
    let map_key = key.strip_prefix("/schema/").unwrap();
    if STREAM_SCHEMAS.contains_key(map_key) {
        value = STREAM_SCHEMAS
            .get(map_key)
            .unwrap()
            .value()
            .clone()
            .last()
            .unwrap()
            .clone();
    } else {
        let db = &crate::infra::db::DEFAULT;
        if let Ok(v) = db.get(&key).await {
            // for backward compatibility check if value in etcd is vec or schema based on it return value
            let local_val: Value = json::from_slice(&v).unwrap();
            if local_val.is_array() {
                let local_vec: Vec<Schema> = json::from_slice(&v).unwrap();
                value = local_vec.last().unwrap().clone();
            } else {
                value = json::from_slice(&v).unwrap()
            }
        }
    }
    Ok(value)
}

pub async fn get_versions(
    org_id: &str,
    stream_name: &str,
    stream_type: Option<StreamType>,
) -> Result<Vec<Schema>, anyhow::Error> {
    let mut value = vec![];
    let stream_type = match stream_type {
        Some(v) => v,
        None => StreamType::Logs,
    };
    let key = format!("/schema/{}/{}/{}", org_id, stream_type, stream_name);
    let map_key = key.strip_prefix("/schema/").unwrap();
    if STREAM_SCHEMAS.contains_key(map_key) {
        value = STREAM_SCHEMAS.get(map_key).unwrap().value().clone();
    } else {
        let db = &crate::infra::db::DEFAULT;
        if let Ok(v) = db.get(&key).await {
            // for backward compatibility check if value in etcd is vec or schema based on it return value
            let local_val: Value = json::from_slice(&v).unwrap();
            if local_val.is_array() {
                value = json::from_slice(&v).unwrap()
            } else {
                value = vec![json::from_slice(&v).unwrap()]
            }
        }
    }
    Ok(value)
}

pub async fn set(
    org_id: &str,
    stream_name: &str,
    stream_type: StreamType,
    schema: &Schema,
    min_ts: Option<i64>,
) -> Result<(), anyhow::Error> {
    let db = &crate::infra::db::DEFAULT;
    let mut versions: Vec<Schema>;
    let key = format!("/schema/{}/{}/{}", org_id, stream_type, stream_name);
    let map_key = key.strip_prefix("/schema/").unwrap();
    if STREAM_SCHEMAS.contains_key(map_key) {
        versions = STREAM_SCHEMAS.get(map_key).unwrap().value().clone();
        if min_ts.is_some() {
            //update last schema to add end date
            let last_schema = versions.pop().unwrap();
            if !last_schema.fields.eq(&schema.fields) {
                let mut last_meta = last_schema.metadata().clone();
                last_meta.insert("end_dt".to_string(), min_ts.unwrap().to_string());
                versions.push(last_schema.with_metadata(last_meta));

                //update current schema to add start date
                let mut metadata = schema.metadata().clone();
                metadata.insert("start_dt".to_string(), min_ts.unwrap().to_string());
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
            let min_ts = match min_ts {
                Some(v) => v,
                None => Utc::now().timestamp_micros(),
            };
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
    let stream_type = match stream_type {
        Some(v) => v,
        None => StreamType::Logs,
    };
    let key = format!("/schema/{}/{}/{}", org_id, stream_type, stream_name);
    let db = &crate::infra::db::DEFAULT;
    match db.delete(&key, false).await {
        Ok(_) => Ok(()),
        Err(e) => Err(anyhow::anyhow!(e)),
    }
}

#[tracing::instrument(name = "db:schema:list")]
pub async fn list(
    org_id: &str,
    stream_type: Option<StreamType>,
    fetch_schema: bool,
) -> Result<Vec<StreamSchema>, anyhow::Error> {
    let mut stream_list: Vec<StreamSchema> = Vec::new();
    if STREAM_SCHEMAS.len() > 0 {
        let map_key = match stream_type {
            Some(stream_type_loc) => format!("{}/{}/", org_id, stream_type_loc),
            None => format!("{}/", org_id),
        };
        let iter = STREAM_SCHEMAS
            .iter()
            .filter(|entry| entry.key().contains(&map_key));
        let mut value;
        for item in iter {
            let item_key = item.key();
            let item_key = item_key.strip_prefix(&map_key).unwrap();
            let stream_name;
            let stream_type_ret: StreamType;
            match stream_type {
                Some(stream_type_loc) => {
                    stream_name = item_key.to_string();
                    stream_type_ret = stream_type_loc;
                }
                None => {
                    let columns = item_key.split('/').collect::<Vec<&str>>();
                    stream_type_ret = StreamType::from(columns[0]);
                    stream_name = columns[1].to_string();
                }
            }
            if fetch_schema {
                value = item.value().last().unwrap().clone();
            } else {
                value = Schema::empty()
            }
            stream_list.push(StreamSchema {
                stream_name,
                stream_type: stream_type_ret,
                schema: value,
            })
        }
    } else {
        let db = &crate::infra::db::DEFAULT;
        let key = match stream_type {
            Some(stream_type_loc) => {
                format!("/schema/{}/{}/", org_id, stream_type_loc)
            }
            None => format!("/schema/{}/", org_id),
        };
        let ret = db.list(&key).await?;
        for (item_key, item_value) in ret {
            let item_key = item_key.strip_prefix(&key).unwrap();
            let stream_name;
            let stream_type_ret: StreamType;
            match stream_type {
                Some(stream_type_loc) => {
                    stream_name = item_key.to_string();
                    stream_type_ret = stream_type_loc;
                }
                None => {
                    let columns = item_key.split('/').collect::<Vec<&str>>();
                    stream_type_ret = StreamType::from(columns[0]);
                    stream_name = columns[1].to_string();
                }
            }

            let value = if fetch_schema {
                json::from_slice(&item_value).unwrap()
            } else {
                Schema::empty()
            };

            stream_list.push(StreamSchema {
                stream_name,
                stream_type: stream_type_ret,
                schema: value,
            })
        }
    }
    Ok(stream_list)
}

pub async fn watch() -> Result<(), anyhow::Error> {
    let db = &crate::infra::db::DEFAULT;
    let key = "/schema/";
    let mut events = db.watch(key).await?;
    let events = Arc::get_mut(&mut events).unwrap();
    log::info!("[TRACE] Start watching stream schema");
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
                STREAM_SCHEMAS.insert(item_key.to_owned(), item_value);
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
        if !value_str.contains(r##","metadata":{}}"##) {
            let value_str = value_str.replace(
                r##","dict_is_ordered":false}"##,
                r##","dict_is_ordered":false,"metadata":{}}"##,
            );
            item_value = bytes::Bytes::from(value_str);
        }
        // Hack: compatible old version, schema is an object
        if item_value[0] == b'{' {
            let value_str = format!("[{}]", value_str);
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
    }
    log::info!("[TRACE] Stream schemas Cached");
    Ok(())
}

pub fn filter_schema_version_id(schemas: &[Schema], start_dt: i64, end_dt: i64) -> Option<usize> {
    for (i, schema) in schemas.iter().enumerate() {
        let metadata = schema.metadata();
        let start_dt_loc: i64 = metadata.get("start_dt").unwrap().parse().unwrap();
        if start_dt < start_dt_loc {
            continue;
        }
        let end_dt_loc: i64 = match metadata.get("end_dt") {
            Some(v) => v.parse().unwrap(),
            None => {
                return Some(i);
            }
        };
        if end_dt > end_dt_loc {
            continue;
        }
        return Some(i);
    }
    None
}
