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
    infra::{config::ALERTS_DESTINATIONS, db as infra_db},
    meta::alert::{AlertDestination, AlertDestinationResponse},
    utils::json,
};
use crate::service::db;

pub async fn get(
    org_id: &str,
    name: &str,
) -> Result<Option<AlertDestinationResponse>, anyhow::Error> {
    let map_key = format!("{org_id}/{name}");
    let value: Option<AlertDestinationResponse> = if ALERTS_DESTINATIONS.contains_key(&map_key) {
        let dest = ALERTS_DESTINATIONS.get(&map_key).unwrap().clone();
        let template = db::alerts::templates::get(org_id, &dest.template).await?;
        Some(dest.to_dest_resp(template))
    } else {
        let db = &infra_db::DEFAULT;
        let key = format!("/destinations/{org_id}/{name}");
        match db.get(&key).await {
            Ok(val) => {
                let dest: AlertDestination = json::from_slice(&val).unwrap();
                let template = db::alerts::templates::get(org_id, &dest.template).await?;
                Some(dest.to_dest_resp(template))
            }
            Err(_) => None,
        }
    };

    Ok(value)
}

pub async fn set(
    org_id: &str,
    name: &str,
    mut destination: AlertDestination,
) -> Result<(), anyhow::Error> {
    let db = &infra_db::DEFAULT;
    destination.name = Some(name.to_owned());
    let key = format!("/destinations/{org_id}/{name}");
    Ok(db
        .put(
            &key,
            json::to_vec(&destination).unwrap().into(),
            infra_db::NEED_WATCH,
        )
        .await?)
}

pub async fn delete(org_id: &str, name: &str) -> Result<(), anyhow::Error> {
    let db = &infra_db::DEFAULT;
    let key = format!("/destinations/{org_id}/{name}");
    Ok(db.delete(&key, false, infra_db::NEED_WATCH).await?)
}

pub async fn list(org_id: &str) -> Result<Vec<AlertDestinationResponse>, anyhow::Error> {
    let db = &infra_db::DEFAULT;
    let key = format!("/destinations/{org_id}");
    let mut temp_list: Vec<AlertDestinationResponse> = Vec::new();
    for item_value in db.list_values(&key).await? {
        let dest: AlertDestination = json::from_slice(&item_value).unwrap();
        let template = db::alerts::templates::get(org_id, &dest.template).await?;
        temp_list.push(dest.to_dest_resp(template))
    }
    Ok(temp_list)
}

pub async fn watch() -> Result<(), anyhow::Error> {
    let key = "/destinations/";
    let db = &infra_db::CLUSTER_COORDINATOR;
    let mut events = db.watch(key).await?;
    let events = Arc::get_mut(&mut events).unwrap();
    log::info!("Start watching alert destinations");
    loop {
        let ev = match events.recv().await {
            Some(ev) => ev,
            None => {
                log::error!("watch_alert_destinations: event channel closed");
                break;
            }
        };
        match ev {
            infra_db::Event::Put(ev) => {
                let item_key = ev.key.strip_prefix(key).unwrap();
                let item_value: AlertDestination = json::from_slice(&ev.value.unwrap()).unwrap();
                ALERTS_DESTINATIONS.insert(item_key.to_owned(), item_value);
            }
            infra_db::Event::Delete(ev) => {
                let item_key = ev.key.strip_prefix(key).unwrap();
                ALERTS_DESTINATIONS.remove(item_key);
            }
            infra_db::Event::Empty => {}
        }
    }
    Ok(())
}

pub async fn cache() -> Result<(), anyhow::Error> {
    let db = &infra_db::DEFAULT;
    let key = "/destinations/";
    let ret = db.list(key).await?;
    for (item_key, item_value) in ret {
        let item_key = item_key.strip_prefix(key).unwrap();
        let json_val: AlertDestination = json::from_slice(&item_value).unwrap();
        ALERTS_DESTINATIONS.insert(item_key.to_owned(), json_val);
    }
    log::info!("Alert destinations Cached");
    Ok(())
}
