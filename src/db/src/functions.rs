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

use common::infra::config::QUERY_FUNCTIONS;
use config::{meta::function::Transform, utils::json};

use crate as db;

#[derive(Debug)]
pub struct FunctionCacheError {
    pub org_id: String,
    pub function_name: String,
    pub message: String,
}

/// Load function definitions into the shared function cache.
///
/// Invalid entries are returned to the application service so it can publish
/// self-reporting events without introducing a dependency from `db` to Core.
pub async fn load_cache() -> Result<Vec<FunctionCacheError>, anyhow::Error> {
    let key = "/function/";
    let functions = db::list(key).await?;
    let mut errors = Vec::new();

    for (item_key, item_value) in functions {
        let item_key = item_key.strip_prefix(key).unwrap();
        let function: Transform = match json::from_slice(&item_value) {
            Ok(function) => function,
            Err(err) => {
                log::error!("Error deserializing function {item_key}: {err}");
                let mut parts = item_key.splitn(2, '/');
                errors.push(FunctionCacheError {
                    org_id: parts.next().unwrap_or_default().to_string(),
                    function_name: parts.next().unwrap_or(item_key).to_string(),
                    message: format!("Error deserializing function: {err}"),
                });
                continue;
            }
        };
        QUERY_FUNCTIONS.insert(item_key.to_string(), function);
    }

    log::info!("Functions Cached");
    Ok(errors)
}

pub async fn set(org_id: &str, name: &str, func_val: &Transform) -> Result<(), anyhow::Error> {
    let key = format!("/function/{org_id}/{name}");
    let val = json::to_vec(func_val)?;
    if val.is_empty() {
        return Err(anyhow::anyhow!("Function value is empty"));
    }
    match db::put(&key, val.into(), db::NEED_WATCH, None).await {
        Ok(_) => {}
        Err(e) => {
            log::error!("Error saving function: {e}");
            return Err(anyhow::anyhow!("Error saving function: {}", e));
        }
    }

    Ok(())
}

pub async fn get(org_id: &str, name: &str) -> Result<Transform, anyhow::Error> {
    let val = db::get(&format!("/function/{org_id}/{name}")).await?;
    Ok(json::from_slice(&val)?)
}

pub async fn delete(org_id: &str, name: &str) -> Result<(), anyhow::Error> {
    let key = format!("/function/{org_id}/{name}");
    match db::delete(&key, false, db::NEED_WATCH, None).await {
        Ok(_) => {}
        Err(e) => {
            log::error!("Error deleting function: {e}");
            return Err(anyhow::anyhow!("Error deleting function: {}", e));
        }
    }
    Ok(())
}

pub async fn list(org_id: &str) -> Result<Vec<Transform>, anyhow::Error> {
    Ok(db::list(&format!("/function/{org_id}/"))
        .await?
        .values()
        .filter_map(|val| json::from_slice(val).ok())
        .collect())
}

pub async fn watch() -> Result<(), anyhow::Error> {
    let key = "/function/";
    let cluster_coordinator = db::get_coordinator().await;
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
            db::Event::Put(ev) => {
                let item_key = ev.key.strip_prefix(key).unwrap();
                let item_value: Transform = match db::get(&ev.key).await {
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
            db::Event::Delete(ev) => {
                let item_key = ev.key.strip_prefix(key).unwrap();
                QUERY_FUNCTIONS.remove(item_key);
            }
            db::Event::Empty => {}
        }
    }
    Ok(())
}

pub async fn reset() -> Result<(), anyhow::Error> {
    let key = "/function/";
    db::delete(key, true, db::NO_NEED_WATCH, None).await?;
    let key = "/transform/";
    db::delete(key, true, db::NO_NEED_WATCH, None).await?;
    Ok(())
}
