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

use crate::common::{
    infra::{config::TRIGGERS, db as infra_db},
    meta::{alerts::triggers::Trigger, StreamType},
    utils::json,
};

pub async fn get(
    org_id: &str,
    stream_type: StreamType,
    stream_name: &str,
    alert_name: &str,
) -> Result<Trigger, anyhow::Error> {
    let db = infra_db::get_db().await;
    let key = format!("/trigger/{org_id}/{stream_type}/{stream_name}/{alert_name}");
    let val = db.get(&key).await?;
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
    let db = infra_db::get_db().await;
    let key = format!("/trigger/{org_id}/{stream_type}/{stream_name}/{alert_name}");
    match db
        .put(
            &key.clone(),
            json::to_vec(trigger).unwrap().into(),
            infra_db::NEED_WATCH,
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
    let db = infra_db::get_db().await;
    let key = format!("/trigger/{org_id}/{stream_type}/{stream_name}/{alert_name}");
    Ok(db.delete(&key.clone(), false, infra_db::NEED_WATCH).await?)
}

pub async fn cache() -> Result<(), anyhow::Error> {
    let key = "/trigger/";
    let mut cacher = TRIGGERS.write().await;
    let db = infra_db::get_db().await;
    for (item_key, item_value) in db.list(key).await? {
        let item_key = item_key.strip_prefix(key).unwrap();
        let json_val: Trigger = json::from_slice(&item_value).unwrap();
        cacher.insert(item_key.to_owned(), json_val);
    }
    log::info!("Triggers Cached");
    Ok(())
}

pub async fn watch() -> Result<(), anyhow::Error> {
    let key = "/trigger/";
    let cluster_coordinator = infra_db::get_coordinator().await;
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
            infra_db::Event::Put(ev) => {
                let item_key = ev.key.strip_prefix(key).unwrap();
                let item_value: Trigger = json::from_slice(&ev.value.unwrap()).unwrap();
                TRIGGERS
                    .write()
                    .await
                    .insert(item_key.to_string(), item_value.clone());
            }
            infra_db::Event::Delete(ev) => {
                let item_key = ev.key.strip_prefix(key).unwrap();
                TRIGGERS.write().await.remove(item_key);
            }
            infra_db::Event::Empty => {}
        }
    }
    Ok(())
}
