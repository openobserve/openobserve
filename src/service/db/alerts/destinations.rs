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
    infra::{config::ALERTS_DESTINATIONS, db as infra_db},
    meta::alert::{AlertDestination, AlertDestinationResponse},
    utils::json,
};
use crate::service::db;

pub async fn get(org_id: &str, name: &str) -> Result<AlertDestinationResponse, anyhow::Error> {
    let map_key = format!("{org_id}/{name}");
    if let Some(val) = ALERTS_DESTINATIONS.get(&map_key) {
        let template = db::alerts::templates::get(org_id, &val.template).await?;
        return Ok(val.to_dest_resp(Some(template)));
    }

    let db = infra_db::get_db().await;
    let key = format!("/destinations/{org_id}/{name}");
    let val = db.get(&key).await?;
    let dest: AlertDestination = json::from_slice(&val).unwrap();
    let template = db::alerts::templates::get(org_id, &dest.template).await?;
    Ok(dest.to_dest_resp(Some(template)))
}

pub async fn set(
    org_id: &str,
    name: &str,
    mut destination: AlertDestination,
) -> Result<(), anyhow::Error> {
    let db = infra_db::get_db().await;
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
    let db = infra_db::get_db().await;
    let key = format!("/destinations/{org_id}/{name}");
    Ok(db.delete(&key, false, infra_db::NEED_WATCH).await?)
}

pub async fn list(org_id: &str) -> Result<Vec<AlertDestinationResponse>, anyhow::Error> {
    let db = infra_db::get_db().await;
    let key = format!("/destinations/{org_id}");
    let mut temp_list: Vec<AlertDestinationResponse> = Vec::new();
    for item_value in db.list_values(&key).await? {
        let dest: AlertDestination = json::from_slice(&item_value).unwrap();
        let template = db::alerts::templates::get(org_id, &dest.template).await?;
        temp_list.push(dest.to_dest_resp(Some(template)))
    }
    Ok(temp_list)
}

pub async fn watch() -> Result<(), anyhow::Error> {
    let key = "/destinations/";
    let cluster_coordinator = infra_db::get_coordinator().await;
    let mut events = cluster_coordinator.watch(key).await?;
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
    let db = infra_db::get_db().await;
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
