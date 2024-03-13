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

use config::{
    cluster::{is_alert_manager, LOCAL_NODE_ROLE},
    meta::stream::StreamType,
    utils::json,
};
use infra::db as infra_db;

use crate::common::{
    infra::config::STREAM_ALERTS,
    meta::alerts::{triggers::Trigger, Alert},
};

pub mod alert_manager;
pub mod destinations;
pub mod templates;
pub mod triggers;

pub async fn get(
    org_id: &str,
    stream_type: StreamType,
    stream_name: &str,
    name: &str,
) -> Result<Option<Alert>, anyhow::Error> {
    let stream_key = format!("{org_id}/{stream_type}/{stream_name}");
    let value: Option<Alert> = if let Some(v) = STREAM_ALERTS.read().await.get(&stream_key) {
        v.iter().find(|x| x.name.eq(name)).cloned()
    } else {
        let db = infra_db::get_db().await;
        let key = format!("/alerts/{org_id}/{stream_type}/{stream_name}/{name}");
        match db.get(&key).await {
            Ok(val) => json::from_slice(&val)?,
            Err(_) => None,
        }
    };
    if value.is_none() { Ok(None) } else { Ok(value) }
}

pub async fn set(
    org_id: &str,
    stream_type: StreamType,
    stream_name: &str,
    alert: &Alert,
) -> Result<(), anyhow::Error> {
    let db = infra_db::get_db().await;
    let key = format!(
        "/alerts/{org_id}/{stream_type}/{stream_name}/{}",
        alert.name
    );
    if let Err(e) = db
        .put(
            &key,
            json::to_vec(alert).unwrap().into(),
            infra_db::NEED_WATCH,
            chrono::Utc::now().timestamp_micros(),
        )
        .await
    {
        return Err(anyhow::anyhow!("Error save alert: {}", e));
    }
    Ok(())
}

pub async fn delete(
    org_id: &str,
    stream_type: StreamType,
    stream_name: &str,
    name: &str,
) -> Result<(), anyhow::Error> {
    let db = infra_db::get_db().await;
    let key = format!("/alerts/{org_id}/{stream_type}/{stream_name}/{name}");
    db.delete(&key, false, infra_db::NEED_WATCH, None)
        .await
        .map_err(|e| anyhow::anyhow!("Error deleting alert: {}", e))
}

pub async fn list(
    org_id: &str,
    stream_type: Option<StreamType>,
    stream_name: Option<&str>,
) -> Result<Vec<Alert>, anyhow::Error> {
    let db = infra_db::get_db().await;

    let loc_stream_type = stream_type.unwrap_or_default();
    let key = match stream_name {
        Some(stream_name) => format!("/alerts/{org_id}/{loc_stream_type}/{stream_name}"),
        None => format!("/alerts/{org_id}/"),
    };
    let ret = db.list_values(&key).await?;
    let mut items: Vec<Alert> = Vec::with_capacity(ret.len());
    for item_value in ret {
        let json_val = json::from_slice(&item_value)?;
        items.push(json_val)
    }
    items.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(items)
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
                let stream_key = item_key[0..item_key.rfind('/').unwrap()].to_string();
                let item_value: Alert = if config::CONFIG.common.meta_store_external {
                    let db = infra_db::get_db().await;
                    match db.get(&ev.key).await {
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
                let is_realtime = item_value.is_real_time;
                let mut cacher = STREAM_ALERTS.write().await;
                let group = cacher.entry(stream_key.to_string()).or_default();
                if group.contains(&item_value) {
                    let idx = group.iter().position(|x| x.eq(&item_value)).unwrap();
                    let _ = std::mem::replace(&mut group[idx], item_value);
                } else {
                    group.push(item_value);
                }
                drop(cacher);

                // add to triggers
                if is_alert_manager(&LOCAL_NODE_ROLE) {
                    let columns = item_key.split('/').collect::<Vec<&str>>();
                    let org_id = columns[0];
                    let stream_type: StreamType = columns[1].into();
                    let stream_name = columns[2];
                    let alert_name = columns[3];
                    let trigger = Trigger {
                        next_run_at: chrono::Utc::now().timestamp_micros(),
                        is_realtime,
                        is_silenced: false,
                    };
                    if let Err(e) = crate::service::alerts::triggers::save(
                        org_id,
                        stream_type,
                        stream_name,
                        alert_name,
                        &trigger,
                    )
                    .await
                    {
                        log::error!("Failed to save trigger: {}", e);
                    }
                }
            }
            infra_db::Event::Delete(ev) => {
                let item_key = ev.key.strip_prefix(key).unwrap();
                let stream_key = item_key[0..item_key.rfind('/').unwrap()].to_string();
                let alert_name = item_key[item_key.rfind('/').unwrap() + 1..].to_string();
                let mut cacher = STREAM_ALERTS.write().await;
                if stream_key.contains('/') {
                    let group = match cacher.get_mut(&stream_key) {
                        Some(v) => v,
                        None => continue,
                    };
                    group.retain(|v| !v.name.eq(&alert_name));
                } else {
                    cacher.remove(&stream_key);
                }
                drop(cacher);

                // delete from triggers
                if is_alert_manager(&LOCAL_NODE_ROLE) {
                    let columns = item_key.split('/').collect::<Vec<&str>>();
                    let org_id = columns[0];
                    let stream_type: StreamType = columns[1].into();
                    let stream_name = columns[2];
                    let alert_name = columns[3];
                    _ = triggers::delete(org_id, stream_type, stream_name, alert_name).await;
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
        let new_key = item_key.strip_prefix(key).unwrap();
        let json_val: Alert = match json::from_slice(&item_value) {
            Ok(v) => v,
            Err(_) => {
                // HACK: for old version, write it back to up
                let data: json::Value = json::from_slice(&item_value).unwrap();
                let data = data.as_object().unwrap();
                let destinations = if let Some(dest) = data.get("destination") {
                    vec![dest.as_str().unwrap().to_string()]
                } else {
                    vec![]
                };
                let alert = Alert {
                    name: data.get("name").unwrap().as_str().unwrap().to_string(),
                    stream_type: data.get("stream_type").unwrap().as_str().unwrap().into(),
                    stream_name: match data.get("stream") {
                        Some(v) => v.as_str().unwrap().to_string(),
                        None => data
                            .get("stream_name")
                            .unwrap()
                            .as_str()
                            .unwrap()
                            .to_string(),
                    },
                    destinations,
                    ..Default::default()
                };
                _ = db
                    .put(
                        &item_key,
                        json::to_vec(&alert).unwrap().into(),
                        infra_db::NO_NEED_WATCH,
                        chrono::Utc::now().timestamp_micros(),
                    )
                    .await;
                alert
            }
        };
        let stream_key = &new_key[0..new_key.rfind('/').unwrap()];

        let mut cacher = STREAM_ALERTS.write().await;
        let group = cacher.entry(stream_key.to_string()).or_default();
        group.push(json_val);
    }
    log::info!("Alerts Cached");
    Ok(())
}

pub async fn reset() -> Result<(), anyhow::Error> {
    let db = infra_db::get_db().await;
    let key = "/alerts/";
    Ok(db.delete(key, true, infra_db::NO_NEED_WATCH, None).await?)
}
