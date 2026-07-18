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

use chrono::Utc;
use common::infra::config::QUERY_FUNCTIONS;
use config::{
    meta::{
        function::Transform,
        self_reporting::error::{ErrorData, ErrorSource, FunctionError},
        stream::StreamParams,
    },
    utils::json,
};
use telemetry::ErrorSink;

use crate::store;

pub async fn set(org_id: &str, name: &str, func_val: &Transform) -> Result<(), anyhow::Error> {
    let key = format!("/function/{org_id}/{name}");
    let val = json::to_vec(func_val)?;
    if val.is_empty() {
        return Err(anyhow::anyhow!("Function value is empty"));
    }
    match store::put(&key, val.into(), infra::db::NEED_WATCH, None).await {
        Ok(_) => {}
        Err(e) => {
            log::error!("Error saving function: {e}");
            return Err(anyhow::anyhow!("Error saving function: {}", e));
        }
    }

    Ok(())
}

pub async fn get(org_id: &str, name: &str) -> Result<Transform, anyhow::Error> {
    let val = store::get(&format!("/function/{org_id}/{name}")).await?;
    Ok(json::from_slice(&val)?)
}

pub async fn delete(org_id: &str, name: &str) -> Result<(), anyhow::Error> {
    let key = format!("/function/{org_id}/{name}");
    match store::delete(&key, false, infra::db::NEED_WATCH, None).await {
        Ok(_) => {}
        Err(e) => {
            log::error!("Error deleting function: {e}");
            return Err(anyhow::anyhow!("Error deleting function: {}", e));
        }
    }
    Ok(())
}

pub async fn list(org_id: &str) -> Result<Vec<Transform>, anyhow::Error> {
    Ok(store::list(&format!("/function/{org_id}/"))
        .await?
        .values()
        .filter_map(|val| json::from_slice(val).ok())
        .collect())
}

pub async fn watch() -> Result<(), anyhow::Error> {
    let key = "/function/";
    let cluster_coordinator = infra::db::get_coordinator().await;
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
            infra::db::Event::Put(ev) => {
                let item_key = ev.key.strip_prefix(key).unwrap();
                let item_value: Transform = match store::get(&ev.key).await {
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
            infra::db::Event::Delete(ev) => {
                let item_key = ev.key.strip_prefix(key).unwrap();
                QUERY_FUNCTIONS.remove(item_key);
            }
            infra::db::Event::Empty => {}
        }
    }
    Ok(())
}

pub async fn cache(error_sink: &dyn ErrorSink) -> Result<(), anyhow::Error> {
    let key = "/function/";
    let ret = store::list(key).await?;
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
                error_sink
                    .emit(ErrorData {
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
    store::delete(key, true, infra::db::NO_NEED_WATCH, None).await?;
    let key = "/transform/";
    store::delete(key, true, infra::db::NO_NEED_WATCH, None).await?;
    Ok(())
}
