use std::sync::Arc;

use crate::common::json;
use crate::infra::config::{QUERY_TRANSFORMS, STREAM_TRANSFORMS};
use crate::infra::db::Event;
use crate::meta::transform::{Transform, TransformList};

pub async fn watch() -> Result<(), anyhow::Error> {
    let db = &crate::infra::db::DEFAULT;
    let key = "/transform/";
    let mut events = db.watch(key).await?;
    let events = Arc::get_mut(&mut events).unwrap();
    log::info!("[TRACE] Start watching transform");
    loop {
        let ev = match events.recv().await {
            Some(ev) => ev,
            None => {
                log::error!("watch_transforms: event channel closed");
                break;
            }
        };
        match ev {
            Event::Put(ev) => {
                let item_key = ev.key.strip_prefix(key).unwrap();
                let trans_key = item_key[0..item_key.rfind('/').unwrap()].to_string();
                let item_value: Transform = json::from_slice(&ev.value.unwrap()).unwrap();
                if !item_value.stream_name.is_empty() {
                    let mut group = STREAM_TRANSFORMS
                        .entry(trans_key.to_string())
                        .or_insert(TransformList { list: vec![] });
                    if group.list.contains(&item_value) {
                        let stream_name =
                            group.list.iter().position(|x| x.eq(&item_value)).unwrap();
                        let _ = std::mem::replace(&mut group.list[stream_name], item_value);
                    } else {
                        group.list.push(item_value);
                    }
                } else {
                    QUERY_TRANSFORMS.insert(item_key.to_owned(), item_value);
                }
            }
            Event::Delete(ev) => {
                let item_key = ev.key.strip_prefix(key).unwrap();
                let trans_key = item_key[0..item_key.rfind('/').unwrap()].to_string();
                let item_name = item_key[item_key.rfind('/').unwrap() + 1..].to_string();
                if trans_key.contains('/') {
                    let mut group = STREAM_TRANSFORMS
                        .get(&trans_key.to_string())
                        .unwrap()
                        .clone();
                    group.list.retain(|trans| !trans.name.eq(&item_name));
                    STREAM_TRANSFORMS.insert(trans_key.to_string(), group);
                } else {
                    STREAM_TRANSFORMS.remove(item_key);
                }
            }
        }
    }
    Ok(())
}

pub async fn cache() -> Result<(), anyhow::Error> {
    let db = &crate::infra::db::DEFAULT;
    let key = "/transform/";
    let ret = db.list(key).await?;
    for (item_key, item_value) in ret {
        let item_key = item_key.strip_prefix(key).unwrap();
        let json_val: Transform = json::from_slice(&item_value).unwrap();
        let stream_key = &item_key[0..item_key.rfind('/').unwrap()];
        if !json_val.stream_name.is_empty() {
            let mut group = STREAM_TRANSFORMS
                .entry(stream_key.to_string())
                .or_insert(TransformList { list: vec![] });
            group.list.push(json_val);
        } else {
            QUERY_TRANSFORMS.insert(item_key.to_string(), json_val);
        }
    }
    log::info!("[TRACE] Transforms Cached");
    Ok(())
}
