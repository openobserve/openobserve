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

use config::{meta::stream::StreamType, utils::json};

use crate::{
    common::{infra::config::TRIGGERS, meta::alerts::triggers::Trigger},
    service::db,
};

pub async fn get(
    org_id: &str,
    stream_type: StreamType,
    stream_name: &str,
    alert_name: &str,
) -> Result<Trigger, anyhow::Error> {
    let key = format!("/trigger/{org_id}/{stream_type}/{stream_name}/{alert_name}");
    let val = db::get(&key).await?;
    let trigger = json::from_slice(&val)?;
    Ok(trigger)
}

pub async fn set(
    org_id: &str,
    stream_type: StreamType,
    stream_name: &str,
    alert_name: &str,
    trigger: &Trigger,
) -> Result<(), anyhow::Error> {
    // cache the trigger first
    let cache_key = format!("{org_id}/{stream_type}/{stream_name}/{alert_name}");
    let db_key = format!("/trigger/{cache_key}");
    TRIGGERS.write().await.insert(cache_key, trigger.clone());
    // save the trigger
    match db::put(
        &db_key,
        json::to_vec(trigger).unwrap().into(),
        db::NEED_WATCH,
    )
    .await
    {
        Ok(_) => {}
        Err(e) => {
            log::error!("Error saving trigger: {}", e);
            return Err(anyhow::anyhow!("Error saving trigger: {}", e));
        }
    }
    Ok(())
}

pub async fn delete(
    org_id: &str,
    stream_type: StreamType,
    stream_name: &str,
    alert_name: &str,
) -> Result<(), anyhow::Error> {
    let key = format!("/trigger/{org_id}/{stream_type}/{stream_name}/{alert_name}");
    Ok(db::delete(&key.clone(), false, db::NEED_WATCH).await?)
}

pub async fn cache() -> Result<(), anyhow::Error> {
    let key = "/trigger/";
    let mut cacher = TRIGGERS.write().await;
    for (item_key, item_value) in db::list(key).await? {
        let new_key = item_key.strip_prefix(key).unwrap();
        if new_key.split('/').count() < 4 {
            _ = db::delete(&item_key, false, db::NO_NEED_WATCH).await;
            continue;
        }
        let json_val: Trigger = json::from_slice(&item_value).unwrap();
        cacher.insert(new_key.to_owned(), json_val);
    }
    log::info!("Triggers Cached");
    Ok(())
}

pub async fn watch() -> Result<(), anyhow::Error> {
    let key = "/trigger/";
    let cluster_coordinator = db::get_coordinator().await;
    let mut events = cluster_coordinator.watch(key).await?;
    let events = Arc::get_mut(&mut events).unwrap();
    log::info!("Start watching Triggers");
    loop {
        let ev = match events.recv().await {
            Some(ev) => ev,
            None => {
                log::error!("watch_trigger: event channel closed");
                break;
            }
        };
        match ev {
            db::Event::Put(ev) => {
                let item_key = ev.key.strip_prefix(key).unwrap();
                let item_value: Trigger = if config::CONFIG.common.meta_store_external {
                    match db::get(&ev.key).await {
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
                TRIGGERS
                    .write()
                    .await
                    .insert(item_key.to_string(), item_value.clone());
            }
            db::Event::Delete(ev) => {
                let item_key = ev.key.strip_prefix(key).unwrap();
                TRIGGERS.write().await.remove(item_key);
            }
            db::Event::Empty => {}
        }
    }
    Ok(())
}
