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

use std::sync::Arc;

use bytes::Bytes;
use chrono::Utc;
use config::{
    meta::{
        function::Transform,
        self_reporting::error::{ErrorData, ErrorSource, FunctionError},
        stream::StreamParams,
    },
    utils::json,
};
#[cfg(feature = "enterprise")]
use infra::errors::Error as InfraError;
use infra::{
    db::{self as infra_db, Event, NEED_WATCH, NO_NEED_WATCH},
    errors::Result as InfraResult,
};

use crate::{QUERY_FUNCTIONS, publish_function_error};

async fn db_put(
    key: &str,
    value: Bytes,
    need_watch: bool,
    start_dt: Option<i64>,
) -> InfraResult<()> {
    let db = infra_db::get_db().await;
    db.put(key, value.clone(), need_watch, start_dt).await?;

    #[cfg(feature = "enterprise")]
    if o2_enterprise::enterprise::common::config::get_config()
        .super_cluster
        .enabled
    {
        o2_enterprise::enterprise::super_cluster::queue::put(key, value, need_watch, start_dt)
            .await
            .map_err(|error| InfraError::Message(error.to_string()))?;
    }

    Ok(())
}

async fn db_delete(
    key: &str,
    with_prefix: bool,
    need_watch: bool,
    start_dt: Option<i64>,
) -> InfraResult<()> {
    #[cfg(feature = "enterprise")]
    if o2_enterprise::enterprise::common::config::get_config()
        .super_cluster
        .enabled
    {
        o2_enterprise::enterprise::super_cluster::queue::delete(
            key,
            with_prefix,
            need_watch,
            start_dt,
        )
        .await
        .map_err(|error| InfraError::Message(error.to_string()))?;
    }

    let db = infra_db::get_db().await;
    db.delete(key, with_prefix, need_watch, start_dt).await
}

async fn db_get(key: &str) -> InfraResult<Bytes> {
    infra_db::get_db().await.get(key).await
}

async fn db_list(prefix: &str) -> InfraResult<hashbrown::HashMap<String, Bytes>> {
    infra_db::get_db().await.list(prefix).await
}

pub async fn set(org_id: &str, name: &str, func_val: &Transform) -> Result<(), anyhow::Error> {
    let key = format!("/function/{org_id}/{name}");
    let val = json::to_vec(func_val)?;
    if val.is_empty() {
        return Err(anyhow::anyhow!("Function value is empty"));
    }
    match db_put(&key, val.into(), NEED_WATCH, None).await {
        Ok(_) => {}
        Err(e) => {
            log::error!("Error saving function: {e}");
            return Err(anyhow::anyhow!("Error saving function: {}", e));
        }
    }

    Ok(())
}

pub async fn get(org_id: &str, name: &str) -> Result<Transform, anyhow::Error> {
    let val = db_get(&format!("/function/{org_id}/{name}")).await?;
    Ok(json::from_slice(&val)?)
}

pub async fn delete(org_id: &str, name: &str) -> Result<(), anyhow::Error> {
    let key = format!("/function/{org_id}/{name}");
    match db_delete(&key, false, NEED_WATCH, None).await {
        Ok(_) => {}
        Err(e) => {
            log::error!("Error deleting function: {e}");
            return Err(anyhow::anyhow!("Error deleting function: {}", e));
        }
    }
    Ok(())
}

pub async fn list(org_id: &str) -> Result<Vec<Transform>, anyhow::Error> {
    Ok(db_list(&format!("/function/{org_id}/"))
        .await?
        .values()
        .filter_map(|val| json::from_slice(val).ok())
        .collect())
}

pub async fn watch() -> Result<(), anyhow::Error> {
    let key = "/function/";
    let cluster_coordinator = infra_db::get_coordinator().await;
    let mut events = cluster_coordinator.watch(key).await?;
    let events = Arc::get_mut(&mut events).unwrap();
    log::info!("Start watching function");
    loop {
        let ev = match events.recv().await {
            Some(ev) => ev,
            None => {
                log::error!("watch_functions: event channel closed");
                break;
            }
        };
        match ev {
            Event::Put(ev) => {
                let item_key = ev.key.strip_prefix(key).unwrap();
                let item_value: Transform = match db_get(&ev.key).await {
                    Ok(val) => match json::from_slice(&val) {
                        Ok(val) => val,
                        Err(e) => {
                            log::error!("Error getting value: {e}");
                            continue;
                        }
                    },
                    Err(e) => {
                        log::error!("Error getting value: {e}");
                        continue;
                    }
                };
                QUERY_FUNCTIONS.insert(item_key.to_owned(), item_value);
            }
            Event::Delete(ev) => {
                let item_key = ev.key.strip_prefix(key).unwrap();
                QUERY_FUNCTIONS.remove(item_key);
            }
            Event::Empty => {}
        }
    }
    Ok(())
}

pub async fn cache() -> Result<(), anyhow::Error> {
    let key = "/function/";
    let ret = db_list(key).await?;
    for (item_key, item_value) in ret {
        let item_key = item_key.strip_prefix(key).unwrap();
        let json_val: Transform = match json::from_slice(&item_value) {
            Ok(val) => val,
            Err(e) => {
                log::error!("Error deserializing function {item_key}: {e}");
                // Extract org_id and function_name from item_key (format: org_id/function_name)
                let mut parts = item_key.splitn(2, '/');
                let org_id = parts.next().unwrap_or_default();
                let function_name = parts.next().unwrap_or(item_key);
                publish_function_error(ErrorData {
                    _timestamp: Utc::now().timestamp_micros(),
                    stream_params: StreamParams {
                        org_id: org_id.to_string().into(),
                        ..Default::default()
                    },
                    error_source: ErrorSource::Function(FunctionError::new(
                        function_name.to_string(),
                        format!("Error deserializing function: {e}"),
                    )),
                })
                .await;
                continue;
            }
        };
        QUERY_FUNCTIONS.insert(item_key.to_string(), json_val);
    }
    log::info!("Functions Cached");
    Ok(())
}

pub async fn reset() -> Result<(), anyhow::Error> {
    let key = "/function/";
    db_delete(key, true, NO_NEED_WATCH, None).await?;
    let key = "/transform/";
    db_delete(key, true, NO_NEED_WATCH, None).await?;
    Ok(())
}
