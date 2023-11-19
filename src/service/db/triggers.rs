// Copyright 2023 Zinc Labs Inc.
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

use std::sync::Arc;

use crate::common::{
    infra::{config::TRIGGERS, db as infra_db},
    meta::alert::Trigger,
    utils::json,
};

pub async fn get(alert_name: &str) -> Result<Option<Trigger>, anyhow::Error> {
    let db = infra_db::get_db().await;
    let key = format!("/trigger/{alert_name}");
    Ok(db
        .get(&key)
        .await
        .map(|val| json::from_slice(&val).unwrap())
        .ok())
}

pub async fn set(alert_name: &str, trigger: &Trigger) -> Result<(), anyhow::Error> {
    let db = infra_db::get_db().await;
    let key = format!("/trigger/{alert_name}");
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

pub async fn delete(alert_name: &str) -> Result<(), anyhow::Error> {
    let db = infra_db::get_db().await;
    let key = format!("/trigger/{alert_name}");
    Ok(db.delete(&key.clone(), false, infra_db::NEED_WATCH).await?)
}

pub async fn cache() -> Result<(), anyhow::Error> {
    let db = infra_db::get_db().await;
    let key = "/trigger/";
    for (item_key, item_value) in db.list(key).await? {
        let item_key = item_key.strip_prefix(key).unwrap();
        let json_val: Trigger = json::from_slice(&item_value).unwrap();
        TRIGGERS.insert(item_key.to_owned(), json_val);
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
                TRIGGERS.insert(item_key.to_string(), item_value.clone());
            }
            infra_db::Event::Delete(ev) => {
                let item_key = ev.key.strip_prefix(key).unwrap();
                TRIGGERS.remove(item_key);
            }
            infra_db::Event::Empty => {}
        }
    }
    Ok(())
}
