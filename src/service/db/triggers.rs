// Copyright 2022 Zinc Labs Inc. and Contributors
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

use crate::common::json;
use crate::infra::config::{TRIGGERS, TRIGGERS_IN_PROCESS};
use crate::infra::db::Event;
use crate::meta::alert::Trigger;

pub async fn get(alert_name: &str) -> Result<Option<Trigger>, anyhow::Error> {
    let db = &crate::infra::db::DEFAULT;
    let key = format!("/trigger/{}", alert_name);
    let value: Option<Trigger> = match db.get(&key).await {
        Ok(val) => json::from_slice(&val).unwrap(),
        Err(_) => None,
    };
    Ok(value)
}

pub async fn set(alert_name: &str, trigger: Trigger) -> Result<(), anyhow::Error> {
    let db = &crate::infra::db::DEFAULT;
    let key = format!("/trigger/{}", alert_name);
    db.put(&key.clone(), json::to_vec(&trigger.clone()).unwrap().into())
        .await?;
    Ok(())
}

pub async fn delete(alert_name: &str) -> Result<(), anyhow::Error> {
    let db = &crate::infra::db::DEFAULT;
    let key = format!("/trigger/{}", alert_name);
    match db.delete(&key.clone(), false).await {
        Ok(_) => Ok(()),
        Err(e) => Err(anyhow::anyhow!(e)),
    }
}

pub async fn cache() -> Result<(), anyhow::Error> {
    let db = &crate::infra::db::DEFAULT;
    let key = "/trigger/";
    let ret = db.list(key).await?;
    for (item_key, item_value) in ret {
        let item_key = item_key.strip_prefix(key).unwrap();
        let json_val: Trigger = json::from_slice(&item_value).unwrap();
        //let trigger_key = &item_key[0..item_key.rfind('/').unwrap()];
        if json_val.is_valid {
            TRIGGERS.insert(item_key.to_owned(), json_val);
        }
    }
    log::info!("[TRACE] Triggers Cached");
    Ok(())
}

pub async fn watch() -> Result<(), anyhow::Error> {
    let db = &crate::infra::db::DEFAULT;
    let key = "/trigger/";
    let mut events = db.watch(key).await?;
    let events = Arc::get_mut(&mut events).unwrap();
    log::info!("[TRACE] Start watching Triggers");
    loop {
        let ev = match events.recv().await {
            Some(ev) => ev,
            None => {
                log::error!("watch_trigger: event channel closed");
                break;
            }
        };
        match ev {
            Event::Put(ev) => {
                let item_key = ev.key.strip_prefix(key).unwrap();
                let item_value: Trigger = json::from_slice(&ev.value.unwrap()).unwrap();
                // to avoid timeour error from etcd
                if item_value.is_valid {
                    TRIGGERS.insert(item_key.to_string(), item_value.clone());
                } else {
                    TRIGGERS_IN_PROCESS.remove(item_key);
                    TRIGGERS.remove(item_key);
                }
            }
            Event::Delete(ev) => {
                let item_key = ev.key.strip_prefix(key).unwrap();
                TRIGGERS.remove(item_key);
            }
        }
    }
    Ok(())
}
