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

use std::sync::Arc;

use chrono::Utc;
use config::{is_local_disk_storage, meta::stream::StreamType, utils::json, CONFIG};
use datafusion::arrow::datatypes::Schema;
use hashbrown::{HashMap, HashSet};
use infra::{
    cache,
    db::{self as infra_db},
};

use crate::{
    common::{
        infra::{
            cluster::get_cached_online_querier_nodes,
            config::{ENRICHMENT_TABLES, STREAM_SCHEMAS, STREAM_SCHEMAS_LATEST, STREAM_SETTINGS},
        },
        meta::stream::{StreamSchema, StreamSettings},
    },
    service::{enrichment::StreamTable, stream::stream_settings},
};

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

    let r = STREAM_SCHEMAS_LATEST.read().await;
    if let Some(schema) = r.get(map_key) {
        return Ok(schema.clone());
    }
    drop(r);

    let db = infra_db::get_db().await;
    Ok(match db.get(&key).await {
        Err(err) => {
            if !err.to_string().ends_with("does not exist") {
                log::error!("get schema from db error: {}, {}", key, err);
            }
            let r = STREAM_SCHEMAS_LATEST.read().await;
            if let Some(schema) = r.get(map_key) {
                return Ok(schema.clone());
            }
            drop(r);
            Schema::empty()
        }
        Ok(v) => {
            let local_val: json::Value = json::from_slice(&v).unwrap();
            // for backward compatibility check if value in etcd is vec or schema based on
            // it return value
            if local_val.is_array() {
                let local_vec: Vec<Schema> = json::from_slice(&v).unwrap();
                local_vec.last().unwrap().clone()
            } else {
                json::from_slice(&v).unwrap()
            }
        }
    })
}

pub async fn get_settings(
    org_id: &str,
    stream_type: &StreamType,
    stream_name: &str,
) -> Option<StreamSettings> {
    let key = format!("{}/{}/{}", org_id, stream_type, stream_name);
    let r = STREAM_SETTINGS.read().await;
    r.get(&key).cloned()
}

pub async fn get_from_db(
    org_id: &str,
    stream_name: &str,
    stream_type: StreamType,
) -> Result<Schema, anyhow::Error> {
    let key = mk_key(org_id, stream_type, stream_name);
    let db = infra_db::get_db().await;
    Ok(match db.get(&key).await {
        Err(_) => {
            // REVIEW: shouldn't we report the error?
            Schema::empty()
        }
        Ok(v) => {
            let local_val: json::Value = json::from_slice(&v).unwrap();
            // for backward compatibility check if value in etcd is vec or schema based on
            // it return value
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

    let r = STREAM_SCHEMAS.read().await;
    if let Some(schema) = r.get(map_key) {
        return Ok(schema.clone());
    }

    let db = infra_db::get_db().await;
    Ok(match db.get(&key).await {
        Err(_) => {
            // REVIEW: shouldn't we report the error?
            vec![]
        }
        Ok(v) => {
            // for backward compatibility check if value in etcd is vec or schema based on
            // it return value
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
    println!("set schema: {:?}", schema);
    if CONFIG.limit.row_per_schema_version_enabled {
        if min_ts.is_some() {
            let last_schema = get(org_id, stream_name, stream_type).await?;
            let min_ts = min_ts.unwrap_or_else(|| Utc::now().timestamp_micros());
            let db = infra_db::get_db().await;
            if !last_schema.fields().is_empty() {
                let mut last_meta = last_schema.metadata().clone();
                let key = format!(
                    "/schema/{org_id}/{stream_type}/{stream_name}/{}",
                    last_meta.get("start_dt").unwrap().clone()
                );
                last_meta.insert("end_dt".to_string(), min_ts.to_string());
                let prev_schema = vec![last_schema.clone().with_metadata(last_meta)];
                println!("prev_schema: {:?}", prev_schema);
                let _ = db
                    .put(
                        &key,
                        json::to_vec(&prev_schema).unwrap().into(),
                        infra_db::NO_NEED_WATCH,
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

            let key = format!("/schema/{org_id}/{stream_type}/{stream_name}/{min_ts}");
            println!("new schema: {:?}", new_schema);
            let _ = db
                .put(
                    &key,
                    json::to_vec(&new_schema).unwrap().into(),
                    infra_db::NEED_WATCH,
                )
                .await;

            return Ok(());
        }
        return Err(anyhow::anyhow!(
            "Error putting schema: row_per_schema_version_enabled is enabled"
        ));
    }
    let db = infra_db::get_db().await;
    let key = format!("/schema/{org_id}/{stream_type}/{stream_name}");
    let map_key = key.strip_prefix("/schema/").unwrap();
    let r = STREAM_SCHEMAS.read().await;
    if let Some(versions) = r.get(map_key) {
        let mut versions = versions.clone();
        if min_ts.is_some() && new_version {
            // update last schema to add end date
            let last_schema = versions.pop().unwrap();
            if !last_schema.fields.eq(&schema.fields) {
                let mut last_meta = last_schema.metadata().clone();
                let created_at = last_meta.get("created_at").unwrap().to_string();
                last_meta.insert("end_dt".to_string(), min_ts.unwrap().to_string());
                versions.push(last_schema.with_metadata(last_meta));

                // update current schema to add start date
                let mut metadata = schema.metadata().clone();
                metadata.insert("start_dt".to_string(), min_ts.unwrap().to_string());
                metadata.insert("created_at".to_string(), created_at);
                versions.push(schema.clone().with_metadata(metadata));
                let _ = db
                    .put(
                        &key,
                        json::to_vec(&versions).unwrap().into(),
                        infra_db::NEED_WATCH,
                    )
                    .await;
            }
        } else {
            versions.pop().unwrap();
            versions.push(schema.clone());
            let _ = db
                .put(
                    &key,
                    json::to_vec(&versions).unwrap().into(),
                    infra_db::NEED_WATCH,
                )
                .await;
        }
        return Ok(());
    }
    drop(r);

    // create new schema
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
    let values = vec![schema.to_owned().with_metadata(metadata)];
    match db
        .put(
            &key,
            json::to_vec(&values).unwrap().into(),
            infra_db::NEED_WATCH,
        )
        .await
    {
        Ok(_) => {
            let settings = stream_settings(values.last().unwrap()).unwrap_or_default();
            let mut w = STREAM_SCHEMAS.write().await;
            w.insert(map_key.to_string(), values);
            drop(w);
            let mut w = STREAM_SETTINGS.write().await;
            w.insert(map_key.to_string(), settings);
            drop(w);

            Ok(())
        }
        Err(e) => {
            log::error!("Error putting schema: {}", e);
            Err(anyhow::anyhow!("Error putting schema: {}", e))
        }
    }
}

pub async fn delete(
    org_id: &str,
    stream_name: &str,
    stream_type: Option<StreamType>,
) -> Result<(), anyhow::Error> {
    let stream_type = stream_type.unwrap_or(StreamType::Logs);
    let key = format!("/schema/{org_id}/{stream_type}/{stream_name}");
    let db = infra_db::get_db().await;
    match db.delete(&key, false, infra_db::NEED_WATCH).await {
        Ok(_) => {}
        Err(e) => {
            log::error!("Error deleting schema: {}", e);
            return Err(anyhow::anyhow!("Error deleting schema: {}", e));
        }
    }
    Ok(())
}

#[tracing::instrument]
async fn list_stream_schemas(
    org_id: &str,
    stream_type: Option<StreamType>,
    fetch_schema: bool,
) -> Vec<StreamSchema> {
    let r = STREAM_SCHEMAS.read().await;
    if r.is_empty() {
        return vec![];
    }

    let prefix = match stream_type {
        None => format!("{org_id}/"),
        Some(stream_type) => format!("{org_id}/{stream_type}/"),
    };
    r.iter()
        .filter_map(|(key, val)| {
            key.strip_prefix(&prefix).map(|key| {
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
                        val.last().unwrap().clone()
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
    let r = STREAM_SCHEMAS.read().await;
    if !r.is_empty() {
        drop(r);
        return Ok(list_stream_schemas(org_id, stream_type, fetch_schema).await);
    }

    let db = infra_db::get_db().await;
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
    let key = "/schema/";
    let cluster_coordinator = infra_db::get_coordinator().await;
    let mut events = cluster_coordinator.watch(key).await?;
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
            infra_db::Event::Put(ev) => {
                let item_key = ev.key.strip_prefix(key).unwrap();
                let item_value: Vec<Schema> = if CONFIG.common.meta_store_external {
                    let db = infra_db::get_db().await;
                    match db.get(&ev.key).await {
                        Ok(val) => match json::from_slice(&val) {
                            Ok(val) => val,
                            Err(e) => {
                                log::error!("Error getting value: {}", e);
                                continue;
                            }
                        },
                        Err(e) => {
                            log::error!("Error getting value: {}", e);
                            continue;
                        }
                    }
                } else {
                    json::from_slice(&ev.value.unwrap()).unwrap()
                };

                let settings = stream_settings(item_value.last().unwrap()).unwrap_or_default();
                if let Some(last) = item_value.last() {
                    let mut sl = STREAM_SCHEMAS_LATEST.write().await;
                    sl.insert(item_key.to_string(), last.clone());
                    println!("sl: {:?}", sl);
                    drop(sl);
                }
                let mut sa = STREAM_SCHEMAS.write().await;
                sa.insert(item_key.to_string(), item_value.clone());
                drop(sa);
                let mut w = STREAM_SETTINGS.write().await;
                w.insert(item_key.to_string(), settings);
                drop(w);
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
            infra_db::Event::Delete(ev) => {
                let item_key = ev.key.strip_prefix(key).unwrap();
                let columns = item_key.split('/').collect::<Vec<&str>>();
                let org_id = columns[0];
                let stream_type = StreamType::from(columns[1]);
                let stream_name = columns[2];
                let mut sa = STREAM_SCHEMAS.write().await;
                sa.remove(item_key);
                drop(sa);
                let mut sl = STREAM_SCHEMAS_LATEST.write().await;
                sl.remove(item_key);
                drop(sl);
                let mut w = STREAM_SETTINGS.write().await;
                w.remove(item_key);
                drop(w);
                cache::stats::remove_stream_stats(org_id, stream_name, stream_type);
                if let Err(e) =
                    super::compact::files::del_offset(org_id, stream_type, stream_name).await
                {
                    log::error!("del_offset: {}", e);
                }

                if stream_type.eq(&StreamType::EnrichmentTables) && is_local_disk_storage() {
                    let data_dir = format!(
                        "{}files/{org_id}/{stream_type}/{stream_name}",
                        CONFIG.common.data_wal_dir
                    );
                    let path = std::path::Path::new(&data_dir);
                    if path.exists() {
                        if let Err(e) = tokio::fs::remove_dir_all(path).await {
                            log::error!("remove_dir_all: {}", e);
                        };
                    }
                }
            }
            infra_db::Event::Empty => {}
        }
    }
    Ok(())
}

pub async fn cache() -> Result<(), anyhow::Error> {
    let db = infra_db::get_db().await;
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
        let settings = stream_settings(json_val.last().unwrap()).unwrap_or_default();
        if let Some(last) = json_val.last() {
            let mut sl = STREAM_SCHEMAS_LATEST.write().await;
            sl.insert(item_key_str.to_string(), last.clone());
            drop(sl);
        }
        let mut sa = STREAM_SCHEMAS.write().await;
        sa.insert(item_key_str.to_string(), json_val);
        drop(sa);
        let mut w = STREAM_SETTINGS.write().await;
        w.insert(item_key_str.to_string(), settings);
        drop(w);
    }
    log::info!("Stream schemas Cached");
    Ok(())
}

pub async fn cache_enrichment_tables() -> Result<(), anyhow::Error> {
    let r = STREAM_SCHEMAS.read().await;
    let mut tables = HashMap::new();
    for schema_key in r.keys() {
        if !schema_key.contains(format!("/{}/", StreamType::EnrichmentTables).as_str()) {
            continue;
        }
        let columns = schema_key.split('/').collect::<Vec<&str>>();
        let org_id = columns[0];
        let stream_type = StreamType::from(columns[1]);
        let stream_name = columns[2];
        if !stream_type.eq(&StreamType::EnrichmentTables) {
            continue;
        }
        tables.insert(
            schema_key.to_owned(),
            StreamTable {
                org_id: org_id.to_string(),
                stream_name: stream_name.to_string(),
                data: vec![],
            },
        );
    }
    drop(r);
    if tables.is_empty() {
        log::info!("EnrichmentTables Cached");
        return Ok(());
    }

    // waiting for querier to be ready
    let expect_querier_num = CONFIG.limit.starting_expect_querier_num;
    loop {
        let nodes = get_cached_online_querier_nodes().await.unwrap_or_default();
        if nodes.len() >= expect_querier_num {
            break;
        }
        tokio::time::sleep(tokio::time::Duration::from_secs(1)).await;
        log::info!("Waiting for querier to be ready");
    }

    // fill data
    for (key, tbl) in tables {
        let data = super::enrichment_table::get(&tbl.org_id, &tbl.stream_name).await?;
        ENRICHMENT_TABLES.insert(
            key,
            StreamTable {
                org_id: tbl.org_id,
                stream_name: tbl.stream_name,
                data,
            },
        );
    }
    log::info!("EnrichmentTables Cached");
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

pub async fn list_organizations_from_cache() -> Vec<String> {
    let mut names = HashSet::new();
    let r = STREAM_SCHEMAS_LATEST.read().await;
    for schema_key in r.keys() {
        if !schema_key.contains('/') {
            continue;
        }
        let name = schema_key.split('/').collect::<Vec<&str>>()[0].to_string();
        if !names.contains(&name) {
            names.insert(name);
        }
    }
    names.into_iter().collect::<Vec<String>>()
}

pub async fn list_streams_from_cache(org_id: &str, stream_type: StreamType) -> Vec<String> {
    let mut names = HashSet::new();
    let r = STREAM_SCHEMAS_LATEST.read().await;
    for schema_key in r.keys() {
        if !schema_key.contains('/') {
            continue;
        }
        let columns = schema_key.split('/').collect::<Vec<&str>>();
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
