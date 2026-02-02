// Copyright 2025 OpenObserve Inc.
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
    RwHashMap,
    meta::stream::StreamType,
    utils::time::{hour_micros, now_micros},
};
use once_cell::sync::Lazy;

use crate::service::db;

static CACHE: Lazy<RwHashMap<String, i64>> = Lazy::new(Default::default);

#[inline]
pub fn mk_key(
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
// date_range is a tuple of (start, end), eg: (2023-01-02, 2023-01-03)
// return (key, created)
pub async fn delete_stream(
    org_id: &str,
    stream_type: StreamType,
    stream_name: &str,
    date_range: Option<(&str, &str)>,
) -> Result<(String, bool), anyhow::Error> {
    let key = mk_key(org_id, stream_type, stream_name, date_range);
    let db_key = format!("/compact/delete/{key}");

    // write in cache
    if let Some(v) = CACHE.get(&key)
        && v.value() + hour_micros(1) > now_micros()
    {
        return Ok((db_key, false)); // already in cache, don't create same task in one hour
    }

    CACHE.insert(key.clone(), now_micros());
    // only watch if deleting all data
    let need_watch = if date_range.is_none() {
        db::NEED_WATCH
    } else {
        false
    };
    db::put(&db_key, "OK".into(), need_watch, None).await?;
    Ok((key, true)) // return the key and true
}

// set the stream is processing by the node
pub async fn process_stream(
    org_id: &str,
    stream_type: StreamType,
    stream_name: &str,
    date_range: Option<(&str, &str)>,
    node: &str,
) -> Result<(), anyhow::Error> {
    let key = mk_key(org_id, stream_type, stream_name, date_range);
    let db_key = format!("/compact/delete/{key}");
    // only watch if deleting all data
    let need_watch = if date_range.is_none() {
        db::NEED_WATCH
    } else {
        false
    };
    Ok(db::put(&db_key, node.to_string().into(), need_watch, None).await?)
}

// get the stream processing information
pub async fn get_stream(
    org_id: &str,
    stream_type: StreamType,
    stream_name: &str,
    date_range: Option<(&str, &str)>,
) -> String {
    let key = mk_key(org_id, stream_type, stream_name, date_range);
    let db_key = format!("/compact/delete/{key}");
    match db::get(&db_key).await {
        Ok(ret) => String::from_utf8_lossy(&ret).to_string(),
        Err(_) => String::from(""),
    }
}

// check if stream is deleting from cache
pub fn is_deleting_stream(
    org_id: &str,
    stream_type: StreamType,
    stream_name: &str,
    date_range: Option<(&str, &str)>,
) -> bool {
    CACHE.contains_key(&mk_key(org_id, stream_type, stream_name, date_range))
}

pub async fn delete_stream_done(
    org_id: &str,
    stream_type: StreamType,
    stream_name: &str,
    date_range: Option<(&str, &str)>,
) -> Result<(), anyhow::Error> {
    let key = mk_key(org_id, stream_type, stream_name, date_range);
    // only watch if deleting all data
    let need_watch = if date_range.is_none() {
        db::NEED_WATCH
    } else {
        false
    };
    db::delete_if_exists(&format!("/compact/delete/{key}"), false, need_watch).await?;

    // remove in cache
    CACHE.remove(&key);

    Ok(())
}

pub async fn list() -> Result<Vec<String>, anyhow::Error> {
    let mut items = Vec::new();
    let key = "/compact/delete/";
    let ret = db::list(key).await?;
    for (item_key, _) in ret {
        let item_key = item_key.strip_prefix(key).unwrap();
        items.push(item_key.to_string());
    }
    Ok(items)
}

pub async fn watch() -> Result<(), anyhow::Error> {
    let key = "/compact/delete/";
    let cluster_coordinator = db::get_coordinator().await;
    let mut events = cluster_coordinator.watch(key).await?;
    let events = Arc::get_mut(&mut events).unwrap();
    log::info!("Start watching compact deleting");
    loop {
        let ev = match events.recv().await {
            Some(ev) => ev,
            None => {
                log::error!("watch_compact_deleting: event channel closed");
                break;
            }
        };
        match ev {
            db::Event::Put(ev) => {
                let item_key = ev.key.strip_prefix(key).unwrap();
                CACHE.insert(item_key.to_string(), now_micros());
            }
            db::Event::Delete(ev) => {
                let item_key = ev.key.strip_prefix(key).unwrap();
                CACHE.remove(item_key);
            }
            db::Event::Empty => {}
        }
    }
    Ok(())
}

pub async fn cache() -> Result<(), anyhow::Error> {
    let key = "/compact/delete/";
    let ret = db::list(key).await?;
    for (item_key, _) in ret {
        let item_key = item_key.strip_prefix(key).unwrap();
        CACHE.insert(item_key.to_string(), now_micros());
    }
    Ok(())
}
