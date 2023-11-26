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
    infra::{config::STREAM_ALERTS, db as infra_db},
    meta::{
        alert::{Alert, AlertList},
        StreamType,
    },
    utils::json,
};

pub mod destinations;
pub mod templates;

pub async fn get(
    org_id: &str,
    stream_name: &str,
    stream_type: StreamType,
    name: &str,
) -> Result<Option<Alert>, anyhow::Error> {
    let map_key = format!("{org_id}/{stream_type}/{stream_name}");
    let value: Option<Alert> = if STREAM_ALERTS.contains_key(&map_key) {
        let mut val = STREAM_ALERTS.get(&map_key).unwrap().clone();
        val.list.retain(|alert| alert.name.eq(name));
        val.list.first().cloned()
    } else {
        let db = infra_db::get_db().await;
        let key = format!("/alerts/{org_id}/{stream_type}/{stream_name}/{name}");
        match db.get(&key).await {
            Ok(val) => json::from_slice(&val).unwrap(),
            Err(_) => None,
        }
    };
    if value.is_none() {
        Err(anyhow::anyhow!("Alert not found"))
    } else {
        Ok(value)
    }
}

pub async fn set(
    org_id: &str,
    stream_name: &str,
    stream_type: StreamType,
    name: &str,
    alert: Alert,
) -> Result<(), anyhow::Error> {
    let db = infra_db::get_db().await;
    let key = format!("/alerts/{org_id}/{stream_type}/{stream_name}/{name}");
    match db
        .put(
            &key,
            json::to_vec(&alert).unwrap().into(),
            infra_db::NEED_WATCH,
        )
        .await
    {
        Ok(_) => {}
        Err(e) => {
            log::error!("Error putting schema: {}", e);
            return Err(anyhow::anyhow!("Error putting schema: {}", e));
        }
    }
    Ok(())
}

pub async fn delete(
    org_id: &str,
    stream_name: &str,
    stream_type: StreamType,
    name: &str,
) -> Result<(), anyhow::Error> {
    let db = infra_db::get_db().await;
    let key = format!("/alerts/{org_id}/{stream_type}/{stream_name}/{name}");
    db.delete(&key, false, infra_db::NEED_WATCH)
        .await
        .map_err(|e| anyhow::anyhow!("Error deleting alert: {}", e))
}

pub async fn list(
    org_id: &str,
    stream_name: Option<&str>,
    stream_type: Option<StreamType>,
) -> Result<Vec<Alert>, anyhow::Error> {
    let db = infra_db::get_db().await;

    let loc_stream_type = stream_type.unwrap_or_default();
    let key = match stream_name {
        Some(stream_name) => format!("/alerts/{org_id}/{loc_stream_type}/{stream_name}"),
        None => format!("/alerts/{org_id}"),
    };
    let ret = db.list_values(&key).await?;
    let mut alerts_list: Vec<Alert> = Vec::new();
    for item_value in ret {
        let json_val = json::from_slice(&item_value).unwrap();
        alerts_list.push(json_val)
    }
    Ok(alerts_list)
}

pub async fn watch() -> Result<(), anyhow::Error> {
    let key = "/alerts/";
    let cluster_coordinator = infra_db::get_coordinator().await;
    let mut events = cluster_coordinator.watch(key).await?;
    let events = Arc::get_mut(&mut events).unwrap();
    log::info!("Start watching alerts");
    loop {
        let ev = match events.recv().await {
            Some(ev) => ev,
            None => {
                log::error!("watch_alerts: event channel closed");
                break;
            }
        };
        match ev {
            infra_db::Event::Put(ev) => {
                let item_key = ev.key.strip_prefix(key).unwrap();
                let alert_key = item_key[0..item_key.rfind('/').unwrap()].to_string();
                let item_value: Alert = json::from_slice(&ev.value.unwrap()).unwrap();
                let mut group = STREAM_ALERTS
                    .entry(alert_key.to_string())
                    .or_insert(AlertList { list: vec![] });
                if group.list.contains(&item_value) {
                    let stream_name = group.list.iter().position(|x| x.eq(&item_value)).unwrap();
                    let _ = std::mem::replace(&mut group.list[stream_name], item_value);
                } else {
                    group.list.push(item_value);
                }
            }
            infra_db::Event::Delete(ev) => {
                let item_key = ev.key.strip_prefix(key).unwrap();
                let alert_key = item_key[0..item_key.rfind('/').unwrap()].to_string();
                let item_name = item_key[item_key.rfind('/').unwrap() + 1..].to_string();
                let org_name = item_key[0..item_key.find('/').unwrap()].to_string();
                if alert_key.contains('/') {
                    let mut group = match STREAM_ALERTS.get(&alert_key) {
                        Some(v) => v.clone(),
                        None => continue,
                    };
                    group.list.retain(|trans| !trans.name.eq(&item_name));
                    STREAM_ALERTS.insert(alert_key.to_string(), group);
                } else {
                    STREAM_ALERTS.remove(item_key);
                }
                let trigger_key = format!("{org_name}/{item_name}");
                if let Ok(Some(mut trigger)) = crate::service::db::triggers::get(&trigger_key).await
                {
                    trigger.parent_alert_deleted = true;
                    let _ = crate::service::db::triggers::set(&trigger_key, &trigger).await;
                }
            }
            infra_db::Event::Empty => {}
        }
    }
    Ok(())
}

pub async fn cache() -> Result<(), anyhow::Error> {
    let db = infra_db::get_db().await;
    let key = "/alerts/";
    let ret = db.list(key).await?;
    for (item_key, item_value) in ret {
        let item_key = item_key.strip_prefix(key).unwrap();
        let json_val: Alert = json::from_slice(&item_value).unwrap();
        let stream_key = &item_key[0..item_key.rfind('/').unwrap()];

        let mut group = STREAM_ALERTS
            .entry(stream_key.to_string())
            .or_insert(AlertList { list: vec![] });
        group.list.push(json_val);
    }
    log::info!("Alerts Cached");
    Ok(())
}

pub async fn reset() -> Result<(), anyhow::Error> {
    let db = infra_db::get_db().await;
    let key = "/alerts/";
    Ok(db.delete(key, true, infra_db::NO_NEED_WATCH).await?)
}
