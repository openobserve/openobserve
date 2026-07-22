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

//! Runtime watcher for schema cache updates.

use std::{
    sync::{Arc, atomic::Ordering},
    time::Duration,
};

use arrow_schema::Schema;
use config::{
    cluster::LOCAL_NODE_ID,
    get_config,
    ider::SnowflakeIdGenerator,
    is_local_disk_storage,
    meta::stream::StreamType,
    utils::{json, time::now_micros},
};
use infra::{
    cache,
    schema::{
        STREAM_RECORD_ID_GENERATOR, STREAM_SCHEMAS, STREAM_SCHEMAS_LATEST, STREAM_SETTINGS,
        SchemaCache, unwrap_stream_settings,
    },
};
#[cfg(feature = "enterprise")]
use o2_enterprise::enterprise::common::config::get_config as get_o2_config;

use crate::{
    common::infra::config::ORGANIZATIONS,
    service::{db, organization::check_and_create_org},
};

pub async fn watch() -> Result<(), anyhow::Error> {
    #[cfg(feature = "enterprise")]
    let audit_enabled = get_o2_config().common.audit_enabled;
    #[cfg(not(feature = "enterprise"))]
    let audit_enabled = false;
    let cfg = get_config();
    let key = "/schema/";
    let cluster_coordinator = db::get_coordinator().await;
    let mut events = cluster_coordinator.watch(key).await?;
    let events = Arc::get_mut(&mut events).unwrap();
    log::info!("[Schema:watch] Start watching stream schema");
    loop {
        let ev = match events.recv().await {
            Some(ev) => ev,
            None => {
                log::error!("[Schema:watch] Event channel closed");
                break;
            }
        };
        log::debug!("[Schema:watch] Received event: {ev:?}");
        match ev {
            db::Event::Put(ev) => {
                let key_columns = ev.key.split('/').collect::<Vec<&str>>();
                let (ev_key, mut ev_start_dt) = if key_columns.len() > 5 {
                    (
                        key_columns[..5].join("/"),
                        key_columns[5].parse::<i64>().unwrap_or(0),
                    )
                } else {
                    (ev.key.to_string(), ev.start_dt.unwrap_or_default())
                };
                if ev_start_dt == 0
                    && let Some(start_dt) = ev.start_dt
                {
                    ev_start_dt = start_dt;
                }

                let item_key = ev_key.strip_prefix(key).unwrap();
                let r = STREAM_SCHEMAS.read().await;
                let prev_start_dt = if let Some(schemas) = r.get(&item_key.to_owned()) {
                    let idx = if schemas.len() >= 2 {
                        schemas.len() - 2
                    } else {
                        0
                    };
                    schemas[idx].0
                } else {
                    0
                };
                drop(r);
                let ts_range = if ev_start_dt == 0 && prev_start_dt == 0 {
                    None
                } else if ev_start_dt == 0 || (prev_start_dt > 0 && ev_start_dt > prev_start_dt) {
                    Some((prev_start_dt, now_micros()))
                } else {
                    Some((ev_start_dt, now_micros()))
                };

                let mut schema_versions =
                    match db::list_values_by_start_dt(&format!("{ev_key}/"), ts_range).await {
                        Ok(val) => val,
                        Err(e) => {
                            log::error!("[Schema:watch] Error getting value: {e}");
                            continue;
                        }
                    };
                if schema_versions.is_empty() {
                    log::warn!("[Schema:watch] No schema versions found, skip");
                    continue;
                }
                let latest_start_dt = schema_versions.last().unwrap().0;
                let mut latest_schema: Vec<Schema> =
                    match json::from_slice(&schema_versions.last().unwrap().1) {
                        Ok(val) => val,
                        Err(e) => {
                            log::error!(
                                "[Schema:watch] Error parsing schema, key: {item_key}, error: {e}"
                            );
                            continue;
                        }
                    };
                if latest_schema.is_empty() {
                    log::warn!("[Schema:watch] Latest schema is empty, skip");
                    continue;
                }
                let latest_schema = latest_schema.pop().unwrap();
                let settings = unwrap_stream_settings(&latest_schema).unwrap_or_default();
                if (settings.store_original_data || settings.index_original_data)
                    && let dashmap::Entry::Vacant(entry) =
                        STREAM_RECORD_ID_GENERATOR.entry(item_key.to_string())
                {
                    entry.insert(SnowflakeIdGenerator::new(
                        LOCAL_NODE_ID.load(Ordering::Relaxed),
                    ));
                }
                let mut w = STREAM_SETTINGS.write().await;
                w.insert(item_key.to_string(), settings);
                infra::schema::set_stream_settings_atomic(w.clone());
                drop(w);
                let mut w = STREAM_SCHEMAS_LATEST.write().await;
                w.insert(
                    item_key.to_string(),
                    SchemaCache::new(latest_schema.clone()),
                );
                drop(w);
                // remove latest, already parsed it
                _ = schema_versions.pop().unwrap();
                // parse other versions
                let schema_versions = itertools::chain(
                    schema_versions.into_iter().map(|(start_dt, data)| {
                        (
                            start_dt,
                            json::from_slice::<Vec<Schema>>(&data)
                                .unwrap()
                                .pop()
                                .unwrap(),
                        )
                    }),
                    // add latest version here
                    vec![(latest_start_dt, latest_schema)],
                )
                .collect::<Vec<_>>();
                let mut w = STREAM_SCHEMAS.write().await;
                w.entry(item_key.to_string())
                    .and_modify(|existing_vec| {
                        existing_vec.retain(|(v, _)| schema_versions.iter().all(|(v1, _)| v1 != v));
                        existing_vec.extend(schema_versions.clone())
                    })
                    .or_insert(schema_versions);
                drop(w);
                let keys = item_key.split('/').collect::<Vec<&str>>();
                let org_id = keys[0];

                #[cfg(feature = "enterprise")]
                let usage_enabled = true;
                #[cfg(not(feature = "enterprise"))]
                let usage_enabled = cfg.common.usage_enabled;

                // if create_org_through_ingestion is enabled, we need to create the org
                // if it doesn't exist. Hence, we need to check if the org exists in the cache
                if (cfg.common.create_org_through_ingestion || usage_enabled || audit_enabled)
                    && !ORGANIZATIONS.read().await.contains_key(org_id)
                    && let Err(e) = check_and_create_org(org_id).await
                {
                    log::error!("Failed to save organization in database: {e}");
                }
            }
            db::Event::Delete(ev) => {
                let item_key = ev.key.strip_prefix(key).unwrap();
                let columns = item_key.split('/').collect::<Vec<&str>>();
                let org_id = columns[0];
                let stream_type = StreamType::from(columns[1]);
                let stream_name = columns[2];
                let start_dt = match columns.get(3) {
                    Some(start_dt) => start_dt.parse::<i64>().unwrap_or_default(),
                    None => ev.start_dt.unwrap_or_default(),
                };
                log::warn!(
                    "[Schema:watch] Deleting schema cache for {org_id}/{stream_type}/{stream_name} with start_dt {start_dt}",
                );
                if start_dt > 0 {
                    // delete only one version
                    continue;
                }
                let mut w = STREAM_SCHEMAS.write().await;
                w.remove(item_key);
                w.shrink_to_fit();
                drop(w);
                let mut w = STREAM_SCHEMAS_LATEST.write().await;
                w.remove(item_key);
                w.shrink_to_fit();
                drop(w);
                {
                    STREAM_RECORD_ID_GENERATOR.remove(item_key);
                    STREAM_RECORD_ID_GENERATOR.shrink_to_fit();
                }
                let mut w = STREAM_SETTINGS.write().await;
                w.remove(item_key);
                w.shrink_to_fit();
                infra::schema::set_stream_settings_atomic(w.clone());
                drop(w);
                cache::stats::remove_stream_stats(org_id, stream_name, stream_type);
                if let Err(e) =
                    ::db::compact::files::del_offset(org_id, stream_type, stream_name).await
                {
                    log::error!("[Schema:watch] del_offset: {e}");
                }

                if stream_type.eq(&StreamType::EnrichmentTables) && is_local_disk_storage() {
                    let data_dir = format!(
                        "{}files/{org_id}/{stream_type}/{stream_name}",
                        get_config().common.data_wal_dir
                    );
                    let path = std::path::Path::new(&data_dir);
                    if path.exists()
                        && let Err(e) = tokio::fs::remove_dir_all(path).await
                    {
                        log::error!("[Schema:watch] remove_dir_all: {e}");
                    };
                }
                if stream_type.eq(&StreamType::EnrichmentTables)
                    && let Err(e) =
                        config::utils::enrichment_local_cache::delete(org_id, stream_name).await
                {
                    log::error!("[Schema:watch] delete local enrichment file error: {e}");
                }

                // flush cache for the stream
                let org_id = org_id.to_string();
                let stream_name = stream_name.to_string();
                tokio::task::spawn(async move {
                    match flush_cache_for_stream(&org_id, stream_type, &stream_name).await {
                        Ok(()) => {
                            log::info!(
                                "[Schema:watch] flushed cache for stream {org_id}/{stream_type}/{stream_name}"
                            );
                        }
                        Err(e) => {
                            log::error!("[Schema:watch] flush cache for stream error: {e}");
                        }
                    }
                });
            }
            db::Event::Empty => {}
        }
    }
    Ok(())
}

async fn flush_cache_for_stream(
    org_id: &str,
    stream_type: StreamType,
    stream_name: &str,
) -> Result<(), anyhow::Error> {
    let stream_key = format!("{org_id}/{stream_type}/{stream_name}");
    // flush all memtables and persist to disk also delete parquet files from wal on ingester
    if config::cluster::LOCAL_NODE.is_ingester() {
        // get current max memtable id
        let max_memtable_id = ingester::get_max_writer_seq_id().await;
        // flush all writers
        ingester::flush_all().await?;
        let ttl = get_config().limit.mem_persist_interval;
        // wait for max memtable id to be updated, skip it after retry 10 times
        for _ in 0..10 {
            let new_max_id = ingester::get_max_writer_seq_id().await;
            if new_max_id > max_memtable_id {
                break;
            }
            tokio::time::sleep(Duration::from_secs(ttl)).await;
        }
        // wait for persist done, skip it after retry 10 times
        for _ in 0..10 {
            if ingester::check_persist_done(max_memtable_id).await {
                break;
            }
            tokio::time::sleep(Duration::from_secs(ttl)).await;
        }
        // delete parquet files from wal
        let wal_dir = &get_config().common.data_wal_dir;
        let stream_dir = format!("{wal_dir}files/{stream_key}");
        if let Err(e) = tokio::fs::remove_dir_all(&stream_dir).await
            && e.kind() != std::io::ErrorKind::NotFound
        {
            return Err(anyhow::anyhow!(
                "Failed to delete parquet files from wal: {stream_dir}, error: {e}"
            ));
        }
    }

    // remove result cache / agg cache / files cache for the stream on querier
    // also try to remove the cache from ingester, some test case will query from ingester directly
    if config::cluster::LOCAL_NODE.is_ingester() || config::cluster::LOCAL_NODE.is_querier() {
        let cache_dir = &get_config().common.data_cache_dir;
        // remove result cache
        let result_cache_dir = format!("{cache_dir}results/{stream_key}");
        if let Err(e) = tokio::fs::remove_dir_all(&result_cache_dir).await
            && e.kind() != std::io::ErrorKind::NotFound
        {
            return Err(anyhow::anyhow!(
                "Failed to delete result cache: {result_cache_dir}, error: {e}"
            ));
        }
        // remove agg cache
        let agg_cache_dir = format!("{cache_dir}aggregations/{stream_key}");
        if let Err(e) = tokio::fs::remove_dir_all(&agg_cache_dir).await
            && e.kind() != std::io::ErrorKind::NotFound
        {
            return Err(anyhow::anyhow!(
                "Failed to delete agg cache: {agg_cache_dir}, error: {e}"
            ));
        }
        // remove parquet cache
        let parquet_cache_dir = format!("{cache_dir}files/{stream_key}");
        if let Err(e) = tokio::fs::remove_dir_all(&parquet_cache_dir).await
            && e.kind() != std::io::ErrorKind::NotFound
        {
            return Err(anyhow::anyhow!(
                "Failed to delete parquet cache: {parquet_cache_dir}, error: {e}"
            ));
        }
        // remove metrics cache
        // !!! we can't remove metrics cache, because metrics cache doesn't persist with stream name
    }

    Ok(())
}
