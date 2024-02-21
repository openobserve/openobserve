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

use config::utils::json;
use infra::db as infra_db;
use itertools::Itertools;

use crate::common::{infra::config::ALERTS_SCRIPTS, meta::alerts::scripts::Script};

pub async fn get(org_id: &str, name: &str) -> Result<Script, anyhow::Error> {
    let map_key = format!("{org_id}/{name}");
    if let Some(v) = ALERTS_SCRIPTS.get(&map_key) {
        return Ok(v.value().clone());
    }

    let db = infra_db::get_db().await;
    let key = format!("/scripts/{org_id}/{name}");
    Ok(json::from_slice(&db.get(&key).await?).unwrap())
}

pub async fn set(org_id: &str, script: &mut Script) -> Result<(), anyhow::Error> {
    let db = infra_db::get_db().await;

    let key = format!("/scripts/{org_id}/{}", script.name);
    Ok(db
        .put(
            &key,
            json::to_vec(script).unwrap().into(),
            infra_db::NEED_WATCH,
        )
        .await?)
}

pub async fn delete(org_id: &str, name: &str) -> Result<(), anyhow::Error> {
    let db = infra_db::get_db().await;
    let key = format!("/scripts/{org_id}/{name}");
    Ok(db.delete(&key, false, infra_db::NEED_WATCH).await?)
}

pub async fn list(org_id: &str) -> Result<Vec<Script>, anyhow::Error> {
    let cache = ALERTS_SCRIPTS.clone();
    if !cache.is_empty() {
        return Ok(cache
            .iter()
            .filter_map(|script| {
                let k = script.key();
                k.starts_with(&format!("{org_id}/"))
                    .then(|| script.value().clone())
            })
            .sorted_by(|a, b| a.name.cmp(&b.name))
            .collect());
    }

    let db = infra_db::get_db().await;
    let key = format!("/scripts/{org_id}/");
    let ret = db.list_values(key.as_str()).await?;
    let mut items = Vec::new();
    for item_value in ret {
        let json_val: Script = json::from_slice(&item_value).unwrap();
        items.push(json_val);
    }
    items.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(items)
}

pub async fn watch() -> Result<(), anyhow::Error> {
    let key = "/scripts/";
    let cluster_coordinator = infra_db::get_coordinator().await;
    let mut events = cluster_coordinator.watch(key).await?;
    let events = Arc::get_mut(&mut events).unwrap();
    log::info!("Start watching alert scripts");
    loop {
        let ev = match events.recv().await {
            Some(ev) => ev,
            None => {
                log::error!("watch_alert_scripts: event channel closed");
                break;
            }
        };
        match ev {
            infra_db::Event::Put(ev) => {
                let item_key = ev.key.strip_prefix(key).unwrap();
                let item_value: Script = json::from_slice(&ev.value.unwrap()).unwrap();
                ALERTS_SCRIPTS.insert(item_key.to_owned(), item_value);
            }
            infra_db::Event::Delete(ev) => {
                let item_key = ev.key.strip_prefix(key).unwrap();
                ALERTS_SCRIPTS.remove(item_key);
            }
            infra_db::Event::Empty => {}
        }
    }
    Ok(())
}

pub async fn cache() -> Result<(), anyhow::Error> {
    let db = infra_db::get_db().await;
    let key = "/scripts/";
    let ret = db.list(key).await?;
    for (item_key, item_value) in ret {
        let item_key = item_key.strip_prefix(key).unwrap();
        let json_val: Script = json::from_slice(&item_value).unwrap();
        ALERTS_SCRIPTS.insert(item_key.to_owned(), json_val);
    }
    log::info!("Alert scripts Cached");
    Ok(())
}
