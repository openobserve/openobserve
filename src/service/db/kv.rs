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

use crate::infra::config::KVS;
use crate::infra::db::Event;

pub async fn get(org_id: &str, key: &str) -> Result<bytes::Bytes, anyhow::Error> {
    let cache_key = format!("{}/{}", org_id, key);
    let db_key = format!("/kv/{}", cache_key);
    if KVS.contains_key(&cache_key) {
        return Ok(KVS.get(&cache_key).unwrap().value().clone());
    }
    let db = &crate::infra::db::DEFAULT;
    let val = db.get(&db_key).await?;
    KVS.insert(cache_key, val.clone());
    Ok(val)
}

pub async fn set(org_id: &str, key: &str, val: bytes::Bytes) -> Result<(), anyhow::Error> {
    let cache_key = format!("{}/{}", org_id, key);
    let db_key = format!("/kv/{}", cache_key);
    let db = &crate::infra::db::DEFAULT;
    db.put(&db_key, val.clone()).await?;
    KVS.insert(cache_key, val);
    Ok(())
}

pub async fn delete(org_id: &str, key: &str) -> Result<(), anyhow::Error> {
    let cache_key = format!("{}/{}", org_id, key);
    let db_key = format!("/kv/{}", cache_key);
    let db = &crate::infra::db::DEFAULT;
    KVS.remove(&cache_key);
    db.delete(&db_key, false).await?;
    Ok(())
}

pub async fn list(org_id: &str, prefix: &str) -> Result<Vec<String>, anyhow::Error> {
    let db = &crate::infra::db::DEFAULT;
    let mut items = Vec::new();
    let cache_key = if prefix.ends_with('*') {
        format!("{}/{}", org_id, prefix.strip_suffix('*').unwrap())
    } else {
        format!("{}/{}", org_id, prefix)
    };
    let db_key = format!("/kv/{}", cache_key);
    let ret = db.list_keys(&db_key).await?;
    for item_key in ret {
        let item_key = item_key
            .strip_prefix(format!("/kv/{}/", org_id).as_str())
            .unwrap();
        items.push(item_key.to_string());
    }
    Ok(items)
}

pub async fn watch() -> Result<(), anyhow::Error> {
    let db = &crate::infra::db::DEFAULT;
    let key = "/kv/";
    let mut events = db.watch(key).await?;
    let events = Arc::get_mut(&mut events).unwrap();
    log::info!("[TRACE] Start watching kv");
    loop {
        let ev = match events.recv().await {
            Some(ev) => ev,
            None => {
                log::error!("watch_kv: event channel closed");
                break;
            }
        };
        match ev {
            Event::Put(ev) => {
                let item_key = ev.key.strip_prefix(key).unwrap();
                let item_value = ev.value.unwrap();
                KVS.insert(item_key.to_string(), item_value);
            }
            Event::Delete(ev) => {
                let item_key = ev.key.strip_prefix(key).unwrap();
                KVS.remove(item_key);
            }
        }
    }
    Ok(())
}
