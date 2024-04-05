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

use std::sync::Arc;

use arrow_schema::{DataType, Field, Schema};
use bytes::Bytes;
use chrono::Utc;
use config::{is_local_disk_storage, meta::stream::StreamType, utils::json, CONFIG};
use hashbrown::{HashMap, HashSet};
use infra::{
    cache,
    errors::{DbError, Error},
};

use crate::{
    common::{
        infra::{
            cluster::get_cached_online_querier_nodes,
            config::{ENRICHMENT_TABLES, STREAM_SCHEMAS, STREAM_SCHEMAS_LATEST, STREAM_SETTINGS},
        },
        meta::stream::{StreamSchema, StreamSettings},
    },
    service::{db, enrichment::StreamTable, stream::stream_settings},
};

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
    Ok(match db::get(&key).await {
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

    Ok(match db::get(&key).await {
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
        .and_then(|schema| stream_settings(&schema))
}

pub async fn set(
    org_id: &str,
    stream_name: &str,
    stream_type: StreamType,
    schema: &Schema,
    min_ts: Option<i64>,
    new_version: bool,
) -> Result<(), anyhow::Error> {
    if min_ts.is_some() && new_version {
        let last_schema = get(org_id, stream_name, stream_type).await?;
        let min_ts = min_ts.unwrap_or_else(|| Utc::now().timestamp_micros());
        if !last_schema.fields().is_empty() {
            let mut last_meta = last_schema.metadata().clone();
            let created_at: i64 = last_meta.get("start_dt").unwrap().clone().parse().unwrap();
            let key = format!("/schema/{org_id}/{stream_type}/{stream_name}",);
            last_meta.insert("end_dt".to_string(), min_ts.to_string());
            let prev_schema = vec![last_schema.clone().with_metadata(last_meta)];
            let _ = db::put(
                &key,
                json::to_vec(&prev_schema).unwrap().into(),
                db::NO_NEED_WATCH,
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
        let _ = db::put(
            &key,
            json::to_vec(&new_schema).unwrap().into(),
            db::NEED_WATCH,
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
        let _ = db::put(
            &key,
            json::to_vec(&new_schema).unwrap().into(),
            db::NEED_WATCH,
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
    let key = mk_key(org_id, stream_type, stream_name);
    let inferred_schema = schema.clone();
    let start_dt = min_ts;
    let (tx, rx) = tokio::sync::oneshot::channel();
    db::get_for_update(
        &key.clone(),
        db::NEED_WATCH,
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
    Ok(rx.await?)
}

pub async fn update_metadata(
    org_id: &str,
    stream_name: &str,
    stream_type: StreamType,
    metadata: std::collections::HashMap<String, String>,
) -> Result<(), anyhow::Error> {
    let key = mk_key(org_id, stream_type, stream_name);
    db::get_for_update(
        &key.clone(),
        db::NEED_WATCH,
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
            let start_dt = Utc::now().timestamp_micros();
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
    Ok(())
}

pub async fn delete_fields(
    org_id: &str,
    stream_name: &str,
    stream_type: StreamType,
    deleted_fields: Vec<String>,
) -> Result<(), anyhow::Error> {
    let key = mk_key(org_id, stream_type, stream_name);
    db::get_for_update(
        &key.clone(),
        db::NEED_WATCH,
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
    Ok(())
}

pub async fn delete(
    org_id: &str,
    stream_name: &str,
    stream_type: Option<StreamType>,
) -> Result<(), anyhow::Error> {
    let stream_type = stream_type.unwrap_or(StreamType::Logs);
    let key = format!("/schema/{org_id}/{stream_type}/{stream_name}");
    match db::delete(&key, false, db::NEED_WATCH, None).await {
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

    let db_key = match stream_type {
        None => format!("/schema/{org_id}/"),
        Some(stream_type) => format!("/schema/{org_id}/{stream_type}/"),
    };
    let items = db::list(&db_key).await?;
    let mut schemas: HashMap<(String, StreamType), Vec<(Bytes, i64)>> =
        HashMap::with_capacity(items.len());
    for (key, val) in items {
        let key = key.strip_prefix(&db_key).unwrap();
        let (stream_type, stream_name, start_dt) = match stream_type {
            Some(stream_type) => {
                let columns = key.split('/').take(2).collect::<Vec<_>>();
                assert_eq!(columns.len(), 2, "BUG");
                (stream_type, columns[0].into(), columns[1].parse().unwrap())
            }
            None => {
                let columns = key.split('/').take(3).collect::<Vec<_>>();
                assert_eq!(columns.len(), 3, "BUG");
                (
                    columns[0].into(),
                    columns[1].into(),
                    columns[2].parse().unwrap(),
                )
            }
        };
        let entry = schemas
            .entry((stream_name, stream_type))
            .or_insert(Vec::new());
        entry.push((val, start_dt));
    }
    Ok(schemas
        .into_iter()
        .map(|((stream_name, stream_type), versions)| StreamSchema {
            stream_name,
            stream_type,
            schema: if fetch_schema {
                versions
                    .iter()
                    .max_by_key(|(_, start_dt)| *start_dt)
                    .map(|(val, _)| {
                        if fetch_schema {
                            let mut schema: Vec<Schema> = json::from_slice(val).unwrap();
                            if !schema.is_empty() {
                                schema.remove(schema.len() - 1)
                            } else {
                                Schema::empty()
                            }
                        } else {
                            Schema::empty()
                        }
                    })
                    .unwrap()
            } else {
                Schema::empty()
            },
        })
        .collect())
}

pub async fn watch() -> Result<(), anyhow::Error> {
    let key = "/schema/";
    let cluster_coordinator = db::get_coordinator().await;
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
            db::Event::Put(ev) => {
                let key_cloumns = ev.key.split('/').collect::<Vec<&str>>();
                let ev_key = if key_cloumns.len() > 5 {
                    key_cloumns[..5].join("/")
                } else {
                    ev.key.to_string()
                };
                let item_key = ev_key.strip_prefix(key).unwrap();
                let schema_versions = match db::list_values(&ev_key).await {
                    Ok(val) => val
                        .iter()
                        .flat_map(|v| json::from_slice::<Vec<Schema>>(v).unwrap())
                        .collect::<Vec<Schema>>(),
                    Err(e) => {
                        log::error!("Error getting value: {}", e);
                        continue;
                    }
                };
                if schema_versions.is_empty() {
                    continue;
                }

                let settings = stream_settings(schema_versions.last().unwrap()).unwrap_or_default();
                let mut w = STREAM_SETTINGS.write().await;
                w.insert(item_key.to_string(), settings);
                drop(w);
                let mut w = STREAM_SCHEMAS_LATEST.write().await;
                w.insert(
                    item_key.to_string(),
                    schema_versions.last().unwrap().clone(),
                );
                drop(w);
                let mut sa = STREAM_SCHEMAS.write().await;
                sa.insert(item_key.to_string(), schema_versions);
                drop(sa);

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
            db::Event::Delete(ev) => {
                let item_key = ev.key.strip_prefix(key).unwrap();
                let columns = item_key.split('/').collect::<Vec<&str>>();
                let org_id = columns[0];
                let stream_type = StreamType::from(columns[1]);
                let stream_name = columns[2];
                let mut w = STREAM_SCHEMAS.write().await;
                w.remove(item_key);
                drop(w);
                let mut w = STREAM_SCHEMAS_LATEST.write().await;
                w.remove(item_key);
                drop(w);
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
            db::Event::Empty => {}
        }
    }
    Ok(())
}

pub async fn cache() -> Result<(), anyhow::Error> {
    let db_key = "/schema/";
    let items = db::list(db_key).await?;
    let mut schemas: HashMap<String, Vec<(Bytes, i64)>> = HashMap::with_capacity(items.len());
    for (key, val) in items {
        let key = key.strip_prefix(db_key).unwrap();
        let columns = key.split('/').take(4).collect::<Vec<_>>();
        assert_eq!(columns.len(), 4, "BUG");
        let item_key = format!("{}/{}/{}", columns[0], columns[1], columns[2]);
        let start_dt: i64 = columns[3].parse().unwrap();
        let entry = schemas.entry(item_key).or_insert(Vec::new());
        entry.push((val, start_dt));
    }
    for (item_key, versions) in schemas.iter_mut() {
        versions.sort_by(|a, b| a.1.cmp(&b.1));
        let mut schema_versions = Vec::with_capacity(versions.len());
        for (val, _) in versions.iter() {
            let schema: Vec<Schema> = json::from_slice(val).map_err(|e| {
                anyhow::anyhow!("Error parsing schema, key: {}, error: {}", item_key, e)
            })?;
            schema_versions.extend(schema);
        }
        if schema_versions.is_empty() {
            continue;
        }
        let settings = stream_settings(schema_versions.last().unwrap()).unwrap_or_default();
        let mut w = STREAM_SETTINGS.write().await;
        w.insert(item_key.to_string(), settings);
        drop(w);
        let mut w = STREAM_SCHEMAS_LATEST.write().await;
        w.insert(
            item_key.to_string(),
            schema_versions.last().unwrap().clone(),
        );
        drop(w);
        let mut w = STREAM_SCHEMAS.write().await;
        w.insert(item_key.to_string(), schema_versions);
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

fn get_merge_schema_changes(
    latest_schema: &Schema,
    inferred_schema: &Schema,
) -> (bool, Vec<Field>, Vec<Field>) {
    let mut is_schema_changed = false;
    let mut field_datatype_delta: Vec<_> = vec![];

    let mut merged_fields = latest_schema.fields().iter().collect::<Vec<_>>();
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
