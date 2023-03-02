use dashmap::DashSet;
use std::sync::Arc;

use crate::{infra::db::Event, meta::StreamType};

lazy_static! {
    static ref DELETING: DashSet<String> = DashSet::new();
}

// delete data from stream
// if time_range is empty, delete all data
// time_range is a tuple of (start, end), eg: (20230102, 20230103)
pub async fn delete_stream(
    org_id: &str,
    stream_name: &str,
    stream_type: StreamType,
    time_range: Option<(&str, &str)>,
) -> Result<(), anyhow::Error> {
    let db = &crate::infra::db::DEFAULT;
    let key = if time_range.is_none() {
        format!(
            "/compact/delete/{}/{}/{}/all",
            org_id, stream_type, stream_name
        )
    } else {
        let (start, end) = time_range.unwrap();
        format!(
            "/compact/delete/{}/{}/{}/{}-{}",
            org_id, stream_type, stream_name, start, end
        )
    };
    db.put(&key, "OK".into()).await?;

    // write in cache
    if time_range.is_none() {
        DELETING.insert(format!("{}/{}/{}/all", org_id, stream_type, stream_name));
    }

    Ok(())
}

// check if stream is deleting from cache
#[inline]
pub fn is_deleting_stream(org_id: &str, stream_name: &str, stream_type: StreamType) -> bool {
    DELETING.contains(&format!("{}/{}/{}/all", org_id, stream_type, stream_name))
}

pub async fn delete_stream_done(
    org_id: &str,
    stream_name: &str,
    stream_type: StreamType,
    time_range: Option<(&str, &str)>,
) -> Result<(), anyhow::Error> {
    let db = &crate::infra::db::DEFAULT;
    let key = if time_range.is_none() {
        format!(
            "/compact/delete/{}/{}/{}/all",
            org_id, stream_type, stream_name
        )
    } else {
        let (start, end) = time_range.unwrap();
        format!(
            "/compact/delete/{}/{}/{}/{}-{}",
            org_id, stream_type, stream_name, start, end
        )
    };
    db.delete(&key, false).await?;

    // remove in cache
    if time_range.is_none() {
        DELETING.remove(format!("{}/{}/{}/all", org_id, stream_type, stream_name).as_str());
    }

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
    log::info!("[TRACE] Start watching stream deleting");
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
                if !item_key.ends_with("/all") {
                    continue;
                }
                DELETING.insert(item_key.to_string());
            }
            Event::Delete(ev) => {
                let item_key = ev.key.strip_prefix(key).unwrap();
                DELETING.remove(item_key);
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
        if !item_key.ends_with("/all") {
            continue;
        }
        let item_key = item_key.strip_prefix(key).unwrap();
        DELETING.insert(item_key.to_string());
    }
    Ok(())
}
