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

use config::{meta::stream::StreamType, RwHashMap};
use infra::db as infra_db;
use once_cell::sync::Lazy;

static CACHES: Lazy<RwHashMap<String, (i64, String)>> = Lazy::new(Default::default);

fn mk_key(org_id: &str, stream_type: StreamType, stream_name: &str) -> String {
    format!("/compact/files/{org_id}/{stream_type}/{stream_name}")
}

pub async fn get_offset(org_id: &str, stream_type: StreamType, stream_name: &str) -> (i64, String) {
    let key = mk_key(org_id, stream_type, stream_name);
    if let Some(val) = CACHES.get(&key) {
        return val.value().clone();
    }

    let db = infra_db::get_db().await;
    let value = match db.get(&key).await {
        Ok(ret) => String::from_utf8_lossy(&ret).to_string(),
        Err(_) => String::from("0"),
    };
    let (offset, node) = if value.contains(';') {
        let mut parts = value.split(';');
        let offset: i64 = parts.next().unwrap().parse().unwrap();
        let node = parts.next().unwrap().to_string();
        (offset, node)
    } else {
        (value.parse().unwrap(), String::from(""))
    };
    CACHES.insert(key.clone(), (offset, node.clone()));
    (offset, node)
}

pub async fn set_offset(
    org_id: &str,
    stream_type: StreamType,
    stream_name: &str,
    offset: i64,
    node: Option<&str>,
) -> Result<(), anyhow::Error> {
    let key = mk_key(org_id, stream_type, stream_name);
    let Some(node) = node else {
        // release this key from this node
        let db = infra_db::get_db().await;
        db.put(&key, offset.to_string().into(), infra_db::NO_NEED_WATCH)
            .await?;
        CACHES.remove(&key);
        return Ok(());
    };

    // set this key to this node
    let old_node = CACHES
        .get(&key)
        .map(|x| x.value().1.clone())
        .unwrap_or_default();
    if old_node != node {
        let db = infra_db::get_db().await;
        db.put(
            &key,
            format!("{};{}", offset, node).into(),
            infra_db::NO_NEED_WATCH,
        )
        .await?;
    }
    CACHES.insert(key, (offset, node.to_string()));
    Ok(())
}

pub async fn del_offset(
    org_id: &str,
    stream_type: StreamType,
    stream_name: &str,
) -> Result<(), anyhow::Error> {
    let key = mk_key(org_id, stream_type, stream_name);
    CACHES.remove(&key);
    let db = infra_db::get_db().await;
    db.delete_if_exists(&key, false, infra_db::NO_NEED_WATCH)
        .await
        .map_err(Into::into)
}

pub async fn list_offset() -> Result<Vec<(String, i64)>, anyhow::Error> {
    let mut items = Vec::new();
    let db = infra_db::get_db().await;
    let key = "/compact/files/";
    let ret = db.list(key).await?;
    for (item_key, item_value) in ret {
        let item_key = item_key.strip_prefix(key).unwrap();
        let value = String::from_utf8_lossy(&item_value).to_string();
        let offset = if value.contains(';') {
            let mut parts = value.split(';');
            parts.next().unwrap().parse().unwrap()
        } else {
            value.parse().unwrap()
        };
        items.push((item_key.to_string(), offset));
    }
    Ok(items)
}

pub async fn sync_cache_to_db() -> Result<(), anyhow::Error> {
    let db = infra_db::get_db().await;
    for item in CACHES.clone().iter() {
        let key = item.key().to_string();
        let (offset, node) = item.value();
        if *offset > 0 {
            let val = if !node.is_empty() {
                format!("{};{}", offset, node)
            } else {
                offset.to_string()
            };
            db.put(&key, val.into(), infra_db::NO_NEED_WATCH).await?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_compact_files() {
        const OFFSET: i64 = 100;
        set_offset(
            "default",
            "logs".into(),
            "compact_file",
            OFFSET,
            Some("LOCAL"),
        )
        .await
        .unwrap();
        sync_cache_to_db().await.unwrap();
        assert_eq!(
            get_offset("default", "logs".into(), "compact_file").await,
            (OFFSET, "LOCAL".to_string())
        );
        assert!(!list_offset().await.unwrap().is_empty());
    }
}
