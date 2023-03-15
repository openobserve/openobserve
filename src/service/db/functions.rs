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
use crate::infra::config::{QUERY_FUNCTIONS, STREAM_FUNCTIONS};
use crate::infra::db::Event;
use crate::meta::functions::{FunctionList, Transform};
use crate::meta::StreamType;

pub async fn set(
    org_id: &str,
    stream_name: Option<String>,
    name: &str,
    js_func: Transform,
) -> Result<(), anyhow::Error> {
    let db = &crate::infra::db::DEFAULT;
    let key = match stream_name {
        Some(idx_name) => format!(
            "/function/{}/{}/{}/{}",
            org_id,
            StreamType::Logs,
            idx_name,
            name
        ),
        None => format!("/function/{}/{}", org_id, name),
    };
    db.put(&key, json::to_vec(&js_func).unwrap().into()).await?;
    Ok(())
}

pub async fn delete(
    org_id: &str,
    stream_name: Option<String>,
    name: &str,
) -> Result<(), anyhow::Error> {
    let db = &crate::infra::db::DEFAULT;
    let key = match stream_name {
        Some(idx_name) => format!(
            "/function/{}/{}/{}/{}",
            org_id,
            StreamType::Logs,
            idx_name,
            name
        ),
        None => format!("/function/{}/{}", org_id, name),
    };
    match db.delete(&key, false).await {
        Ok(_) => Ok(()),
        Err(_) => Err(anyhow::anyhow!("transform not found")),
    }
}

pub async fn list(
    org_id: &str,
    stream_name: Option<String>,
) -> Result<Vec<Transform>, anyhow::Error> {
    let db = &crate::infra::db::DEFAULT;
    let mut udf_list: Vec<Transform> = Vec::new();
    let key = match stream_name {
        Some(idx_name) => format!("/function/{}/{}/{}", org_id, StreamType::Logs, idx_name),
        None => format!("/function/{}", org_id),
    };
    let result = db.list_values(&key).await?;
    for item in result {
        let json_val = json::from_slice(&item).unwrap();
        udf_list.push(json_val)
    }
    Ok(udf_list)
}

pub async fn watch() -> Result<(), anyhow::Error> {
    let db = &crate::infra::db::DEFAULT;
    let key = "/function/";
    let mut events = db.watch(key).await?;
    let events = Arc::get_mut(&mut events).unwrap();
    log::info!("[TRACE] Start watching function");
    loop {
        let ev = match events.recv().await {
            Some(ev) => ev,
            None => {
                log::error!("watch_functions: event channel closed");
                break;
            }
        };
        match ev {
            Event::Put(ev) => {
                let item_key = ev.key.strip_prefix(key).unwrap();
                let trans_key = item_key[0..item_key.rfind('/').unwrap()].to_string();
                let item_value: Transform = json::from_slice(&ev.value.unwrap()).unwrap();
                if !item_value.stream_name.is_empty() {
                    let mut group = STREAM_FUNCTIONS
                        .entry(trans_key.to_string())
                        .or_insert(FunctionList { list: vec![] });
                    if group.list.contains(&item_value) {
                        let stream_name =
                            group.list.iter().position(|x| x.eq(&item_value)).unwrap();
                        let _ = std::mem::replace(&mut group.list[stream_name], item_value);
                    } else {
                        group.list.push(item_value);
                    }
                } else {
                    QUERY_FUNCTIONS.insert(item_key.to_owned(), item_value);
                }
            }
            Event::Delete(ev) => {
                let item_key = ev.key.strip_prefix(key).unwrap();
                let trans_key = item_key[0..item_key.rfind('/').unwrap()].to_string();
                let item_name = item_key[item_key.rfind('/').unwrap() + 1..].to_string();
                if trans_key.contains('/') {
                    let mut group = STREAM_FUNCTIONS
                        .get(&trans_key.to_string())
                        .unwrap()
                        .clone();
                    group.list.retain(|trans| !trans.name.eq(&item_name));
                    STREAM_FUNCTIONS.insert(trans_key.to_string(), group);
                } else {
                    STREAM_FUNCTIONS.remove(item_key);
                }
            }
        }
    }
    Ok(())
}

pub async fn cache() -> Result<(), anyhow::Error> {
    let db = &crate::infra::db::DEFAULT;
    let key = "/function/";
    let ret = db.list(key).await?;
    for (item_key, item_value) in ret {
        let item_key = item_key.strip_prefix(key).unwrap();
        let json_val: Transform = json::from_slice(&item_value).unwrap();
        let stream_key = &item_key[0..item_key.rfind('/').unwrap()];
        if !json_val.stream_name.is_empty() {
            let mut group = STREAM_FUNCTIONS
                .entry(stream_key.to_string())
                .or_insert(FunctionList { list: vec![] });
            group.list.push(json_val);
        } else {
            QUERY_FUNCTIONS.insert(item_key.to_string(), json_val);
        }
    }
    log::info!("[TRACE] Functions Cached");
    Ok(())
}
