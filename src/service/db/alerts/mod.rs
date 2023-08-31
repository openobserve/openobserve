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

use crate::common::infra::config::{CONFIG, STREAM_ALERTS, TRIGGERS_IN_PROCESS};
use crate::common::infra::db::{Event, CLUSTER_COORDINATOR};
use crate::common::meta::alert::{Alert, AlertList};
use crate::common::meta::meta_store::MetaStore;
use crate::common::meta::StreamType;
use crate::common::utils::json;

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
        let db = &crate::common::infra::db::DEFAULT;
        let key = format!("/alerts/{org_id}/{stream_type}/{stream_name}/{name}");
        match db.get(&key).await {
            Ok(val) => json::from_slice(&val).unwrap(),
            Err(_) => None,
        }
    };
    Ok(value)
}

pub async fn set(
    org_id: &str,
    stream_name: &str,
    stream_type: StreamType,
    name: &str,
    alert: Alert,
) -> Result<(), anyhow::Error> {
    let db = &crate::common::infra::db::DEFAULT;
    let key = format!("/alerts/{org_id}/{stream_type}/{stream_name}/{name}");
    match db.put(&key, json::to_vec(&alert).unwrap().into()).await {
        Ok(_) => {
            if CONFIG
                .common
                .meta_store
                .eq(&MetaStore::DynamoDB.to_string())
            {
                CLUSTER_COORDINATOR
                    .put(&key, CONFIG.common.meta_store.clone().into())
                    .await?
            }
        }
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
    let db = &crate::common::infra::db::DEFAULT;
    let key = format!("/alerts/{org_id}/{stream_type}/{stream_name}/{name}");
    match db.delete(&key, false).await {
        Ok(_) => {
            // Remove trigger from in-process list as alert is deleted
            TRIGGERS_IN_PROCESS.remove(name);
            if CONFIG
                .common
                .meta_store
                .eq(&MetaStore::DynamoDB.to_string())
            {
                CLUSTER_COORDINATOR.delete(&key, false).await?
            }
            Ok(())
        }
        Err(e) => Err(anyhow::anyhow!(e)),
    }
}

pub async fn list(
    org_id: &str,
    stream_name: Option<&str>,
    stream_type: Option<StreamType>,
) -> Result<Vec<Alert>, anyhow::Error> {
    let db = &crate::common::infra::db::DEFAULT;

    let loc_stream_type = if stream_type.is_some() {
        stream_type.unwrap()
    } else {
        StreamType::Logs
    };

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
    let db = &crate::common::infra::db::CLUSTER_COORDINATOR;
    let key = "/alerts/";
    let mut events = db.watch(key).await?;
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
            Event::Put(ev) => {
                let item_key = ev.key.strip_prefix(key).unwrap();
                let alert_key = item_key[0..item_key.rfind('/').unwrap()].to_string();
                let item_value: Alert = if CONFIG
                    .common
                    .meta_store
                    .eq(&MetaStore::DynamoDB.to_string())
                {
                    let dynamo = &crate::common::infra::db::DEFAULT;
                    let ret = dynamo.get(&ev.key).await?;
                    json::from_slice(&ret).unwrap()
                } else {
                    json::from_slice(&ev.value.unwrap()).unwrap()
                };

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
            Event::Delete(ev) => {
                let item_key = ev.key.strip_prefix(key).unwrap();
                let alert_key = item_key[0..item_key.rfind('/').unwrap()].to_string();
                let item_name = item_key[item_key.rfind('/').unwrap() + 1..].to_string();
                if alert_key.contains('/') {
                    let mut group = STREAM_ALERTS.get(&alert_key.to_string()).unwrap().clone();
                    group.list.retain(|trans| !trans.name.eq(&item_name));
                    STREAM_ALERTS.insert(alert_key.to_string(), group);
                } else {
                    STREAM_ALERTS.remove(item_key);
                }
            }
            Event::Empty => {}
        }
    }
    Ok(())
}

pub async fn cache() -> Result<(), anyhow::Error> {
    let db = &crate::common::infra::db::DEFAULT;
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
    let db = &crate::common::infra::db::DEFAULT;
    let key = "/alerts/";
    Ok(db.delete(key, true).await?)
}
