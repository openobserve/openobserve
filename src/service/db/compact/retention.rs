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

use dashmap::DashSet;
use std::sync::Arc;

use crate::{infra::db::Event, meta::StreamType};

lazy_static! {
    static ref CACHE: DashSet<String, ahash::RandomState> = DashSet::default();
}

#[inline]
fn mk_key(
    org_id: &str,
    stream_type: StreamType,
    stream_name: &str,
    date_range: Option<(&str, &str)>,
) -> String {
    match date_range {
        None => format!("{org_id}/{stream_type}/{stream_name}/all"),
        Some((start, end)) => format!("{org_id}/{stream_type}/{stream_name}/{start},{end}"),
    }
}

// delete data from stream
// if date_range is empty, delete all data
// date_range is a tuple of (start, end), eg: (20230102, 20230103)
pub async fn delete_stream(
    org_id: &str,
    stream_name: &str,
    stream_type: StreamType,
    date_range: Option<(&str, &str)>,
) -> Result<(), anyhow::Error> {
    let db = &crate::infra::db::DEFAULT;
    let key = mk_key(org_id, stream_type, stream_name, date_range);

    // write in cache
    if CACHE.contains(&key) {
        return Ok(()); // already in cache, just skip
    }

    let db_key = format!("/compact/delete/{key}");
    CACHE.insert(key);

    Ok(db.put(&db_key, "OK".into()).await?)
}

// set the stream is processing by the node
pub async fn process_stream(
    org_id: &str,
    stream_name: &str,
    stream_type: StreamType,
    date_range: Option<(&str, &str)>,
    node: &str,
) -> Result<(), anyhow::Error> {
    let db = &crate::infra::db::DEFAULT;
    let key = mk_key(org_id, stream_type, stream_name, date_range);
    let db_key = format!("/compact/delete/{key}");
    Ok(db.put(&db_key, node.to_string().into()).await?)
}

// get the stream processing information
pub async fn get_stream(
    org_id: &str,
    stream_name: &str,
    stream_type: StreamType,
    date_range: Option<(&str, &str)>,
) -> String {
    let db = &crate::infra::db::DEFAULT;
    let key = mk_key(org_id, stream_type, stream_name, date_range);
    let db_key = format!("/compact/delete/{key}");
    match db.get(&db_key).await {
        Ok(ret) => String::from_utf8_lossy(&ret).to_string(),
        Err(_) => String::from(""),
    }
}

// check if stream is deleting from cache
pub fn is_deleting_stream(
    org_id: &str,
    stream_name: &str,
    stream_type: StreamType,
    date_range: Option<(&str, &str)>,
) -> bool {
    CACHE.contains(&mk_key(org_id, stream_type, stream_name, date_range))
}

pub async fn delete_stream_done(
    org_id: &str,
    stream_name: &str,
    stream_type: StreamType,
    date_range: Option<(&str, &str)>,
) -> Result<(), anyhow::Error> {
    let db = &crate::infra::db::DEFAULT;
    let key = mk_key(org_id, stream_type, stream_name, date_range);
    db.delete_if_exists(&format!("/compact/delete/{key}"), false)
        .await
        .map_err(|e| anyhow::anyhow!(e))?;

    // remove in cache
    CACHE.remove(&key);

    Ok(())
}

pub async fn list() -> Result<Vec<String>, anyhow::Error> {
    let mut items = Vec::new();
    let db = &crate::infra::db::DEFAULT;
    let key = "/compact/delete/";
    let ret = db.list(key).await?;
    for (item_key, _) in ret {
        let item_key = item_key.strip_prefix(key).unwrap();
        items.push(item_key.to_string());
    }
    Ok(items)
}

pub async fn watch() -> Result<(), anyhow::Error> {
    let db = &crate::infra::db::DEFAULT;
    let key = "/compact/delete/";
    let mut events = db.watch(key).await?;
    let events = Arc::get_mut(&mut events).unwrap();
    log::info!("Start watching stream deleting");
    loop {
        let ev = match events.recv().await {
            Some(ev) => ev,
            None => {
                log::error!("watch_stream_deleting: event channel closed");
                break;
            }
        };
        match ev {
            Event::Put(ev) => {
                let item_key = ev.key.strip_prefix(key).unwrap();
                CACHE.insert(item_key.to_string());
            }
            Event::Delete(ev) => {
                let item_key = ev.key.strip_prefix(key).unwrap();
                CACHE.remove(item_key);
            }
        }
    }
    Ok(())
}

pub async fn cache() -> Result<(), anyhow::Error> {
    let db = &crate::infra::db::DEFAULT;
    let key = "/compact/delete/";
    let ret = db.list(key).await?;
    for (item_key, _) in ret {
        let item_key = item_key.strip_prefix(key).unwrap();
        CACHE.insert(item_key.to_string());
    }
    Ok(())
}
