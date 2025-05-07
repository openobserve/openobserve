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

use config::{
    meta::stream::{EnrichmentTableMetaStreamStats, StreamType},
    utils::{
        json,
        time::{BASE_TIME, now_micros},
    },
};
use infra::{cache::stats, db as infra_db};
use vrl::prelude::NotNan;

use crate::{
    common::infra::config::ENRICHMENT_TABLES,
    service::{db as db_service, enrichment::StreamTable, search as SearchService},
};

/// Will no longer be used as we are using the meta stream stats to store start, end time and size
pub const ENRICHMENT_TABLE_SIZE_KEY: &str = "/enrichment_table_size";
pub const ENRICHMENT_TABLE_META_STREAM_STATS_KEY: &str = "/enrichment_table_meta_stream_stats";

pub async fn get(org_id: &str, name: &str) -> Result<Vec<vrl::value::Value>, anyhow::Error> {
    let start_time = get_start_time(org_id, name).await;
    let end_time = now_micros();

    let query = config::meta::search::Query {
        sql: format!("SELECT * FROM \"{name}\""),
        start_time,
        end_time,
        ..Default::default()
    };

    let req = config::meta::search::Request {
        query,
        encoding: config::meta::search::RequestEncoding::Empty,
        regions: vec![],
        clusters: vec![],
        timeout: 0,
        search_type: None,
        search_event_context: None,
        use_cache: None,
        local_mode: Some(true),
    };
    // do search
    match SearchService::search("", org_id, StreamType::EnrichmentTables, None, &req).await {
        Ok(res) => {
            if !res.hits.is_empty() {
                Ok(res.hits.iter().map(convert_to_vrl).collect())
            } else {
                Ok(vec![])
            }
        }
        Err(err) => {
            log::error!("get enrichment table data error: {:?}", err);
            Ok(vec![])
        }
    }
}

fn convert_to_vrl(value: &json::Value) -> vrl::value::Value {
    match value {
        json::Value::Null => vrl::value::Value::Null,
        json::Value::Bool(b) => vrl::value::Value::Boolean(*b),
        json::Value::Number(n) => {
            if let Some(i) = n.as_i64() {
                vrl::value::Value::Integer(i)
            } else if let Some(f) = n.as_f64() {
                vrl::value::Value::Float(NotNan::new(f).unwrap_or(NotNan::new(0.0).unwrap()))
            } else {
                unimplemented!("handle other number types")
            }
        }
        json::Value::String(s) => vrl::value::Value::from(s.as_str()),
        json::Value::Array(arr) => {
            vrl::value::Value::Array(arr.iter().map(convert_to_vrl).collect())
        }
        json::Value::Object(obj) => vrl::value::Value::Object(
            obj.iter()
                .map(|(k, v)| (k.to_string().into(), convert_to_vrl(v)))
                .collect(),
        ),
    }
}

/// Delete the size of the enrichment table in bytes
pub async fn delete_table_size(org_id: &str, name: &str) -> Result<(), infra::errors::Error> {
    db_service::delete(
        &format!("{ENRICHMENT_TABLE_SIZE_KEY}/{org_id}/{name}"),
        false,
        false,
        None,
    )
    .await
}

/// Get the size of the enrichment table in bytes
pub async fn get_table_size(org_id: &str, name: &str) -> f64 {
    match get_meta_table_stats(org_id, name).await {
        Some(meta_stats) if meta_stats.size > 0 => meta_stats.size as f64,
        _ => match db_service::get(&format!("{ENRICHMENT_TABLE_SIZE_KEY}/{org_id}/{name}")).await {
            Ok(size) => {
                let size = String::from_utf8_lossy(&size);
                size.parse::<f64>().unwrap_or(0.0)
            }
            Err(e) => {
                log::error!("get_table_size error: {:?}", e);
                stats::get_stream_stats(org_id, name, StreamType::EnrichmentTables).storage_size
            }
        },
    }
}

/// Get the start time of the enrichment table
pub async fn get_start_time(org_id: &str, name: &str) -> i64 {
    match get_meta_table_stats(org_id, name).await {
        Some(meta_stats) => meta_stats.start_time,
        None => {
            let stats = stats::get_stream_stats(org_id, name, StreamType::EnrichmentTables);
            if stats.doc_time_min > 0 {
                stats.doc_time_min
            } else {
                BASE_TIME.timestamp_micros()
            }
        }
    }
}

pub async fn get_meta_table_stats(
    org_id: &str,
    name: &str,
) -> Option<EnrichmentTableMetaStreamStats> {
    let size = match db_service::get(&format!(
        "{ENRICHMENT_TABLE_META_STREAM_STATS_KEY}/{org_id}/{name}"
    ))
    .await
    {
        Ok(size) => size,
        Err(e) => {
            log::error!("get_table_size error: {:?}", e);
            return None;
        }
    };
    let stream_meta_stats: EnrichmentTableMetaStreamStats = serde_json::from_slice(&size)
        .map_err(|e| {
            log::error!("Failed to parse meta stream stats: {}", e);
        })
        .ok()?;
    Some(stream_meta_stats)
}

pub async fn update_meta_table_stats(
    org_id: &str,
    name: &str,
    stats: EnrichmentTableMetaStreamStats,
) -> Result<(), infra::errors::Error> {
    db_service::put(
        &format!("{ENRICHMENT_TABLE_META_STREAM_STATS_KEY}/{org_id}/{name}"),
        serde_json::to_string(&stats).unwrap().into(),
        false,
        None,
    )
    .await
}

pub async fn delete_meta_table_stats(org_id: &str, name: &str) -> Result<(), infra::errors::Error> {
    db_service::delete(
        &format!("{ENRICHMENT_TABLE_META_STREAM_STATS_KEY}/{org_id}/{name}"),
        false,
        false,
        None,
    )
    .await
}

pub async fn notify_update(org_id: &str, name: &str) -> Result<(), infra::errors::Error> {
    let cluster_coordinator = infra_db::get_coordinator().await;
    let key: String = format!(
        "/enrichment_table/{org_id}/{}/{}",
        StreamType::EnrichmentTables,
        name
    );
    cluster_coordinator.put(&key, "".into(), true, None).await
}

pub async fn delete(org_id: &str, name: &str) -> Result<(), infra::errors::Error> {
    let cluster_coordinator = infra_db::get_coordinator().await;
    let key: String = format!(
        "/enrichment_table/{org_id}/{}/{}",
        StreamType::EnrichmentTables,
        name
    );
    cluster_coordinator.delete(&key, false, false, None).await
}

pub async fn watch() -> Result<(), anyhow::Error> {
    let key = "/enrichment_table/";
    let cluster_coordinator = infra_db::get_coordinator().await;
    let mut events = cluster_coordinator.watch(key).await?;
    let events = Arc::get_mut(&mut events).unwrap();
    log::info!("Start watching stream enrichment_table");
    loop {
        let ev = match events.recv().await {
            Some(ev) => ev,
            None => {
                log::error!("watch_stream_enrichment_table: event channel closed");
                break;
            }
        };
        match ev {
            infra_db::Event::Put(ev) => {
                let item_key = ev.key.strip_prefix(key).unwrap();
                let keys = item_key.split('/').collect::<Vec<&str>>();
                let org_id = keys[0];
                let stream_name = keys[2];

                let data = super::enrichment_table::get(org_id, stream_name)
                    .await
                    .unwrap();
                ENRICHMENT_TABLES.insert(
                    item_key.to_owned(),
                    StreamTable {
                        org_id: org_id.to_string(),
                        stream_name: stream_name.to_string(),
                        data,
                    },
                );
            }
            infra_db::Event::Delete(ev) => {
                let item_key = ev.key.strip_prefix(key).unwrap();
                if let Some((key, _)) = ENRICHMENT_TABLES.remove(item_key) {
                    log::info!("deleted enrichment table: {}", key);
                }
            }
            infra_db::Event::Empty => {}
        }
    }
    Ok(())
}
