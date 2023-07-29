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

use dashmap::DashMap;
use once_cell::sync::Lazy;

use crate::common::{infra::config::RwHashMap, meta::StreamType};

static CACHES: Lazy<RwHashMap<String, i64>> = Lazy::new(DashMap::default);

fn mk_key(org_id: &str, stream_type: StreamType, stream_name: &str) -> String {
    format!("/compact/files/{org_id}/{stream_type}/{stream_name}")
}

pub async fn get_offset(org_id: &str, stream_name: &str, stream_type: StreamType) -> (i64, String) {
    let key = mk_key(org_id, stream_type, stream_name);
    if let Some(offset) = CACHES.get(&key) {
        return (*offset, "".to_string());
    }

    let db = &crate::common::infra::db::DEFAULT;
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
    CACHES.insert(key.clone(), offset);
    (offset, node)
}

pub async fn set_offset(
    org_id: &str,
    stream_name: &str,
    stream_type: StreamType,
    offset: i64,
) -> Result<(), anyhow::Error> {
    let key = mk_key(org_id, stream_type, stream_name);
    CACHES.insert(key, offset);
    Ok(())
}

pub async fn del_offset(
    org_id: &str,
    stream_name: &str,
    stream_type: StreamType,
) -> Result<(), anyhow::Error> {
    let key = mk_key(org_id, stream_type, stream_name);
    CACHES.remove(&key);
    let db = &crate::common::infra::db::DEFAULT;
    db.delete_if_exists(&key, false).await.map_err(Into::into)
}

pub async fn list_offset() -> Result<Vec<(String, i64)>, anyhow::Error> {
    let mut items = Vec::new();
    let db = &crate::common::infra::db::DEFAULT;
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
    let db = &crate::common::infra::db::DEFAULT;
    for item in CACHES.clone().iter() {
        let key = item.key().to_string();
        let offset = item.value();
        if *offset > 0 {
            db.put(&key, offset.to_string().into()).await?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[actix_web::test]
    async fn test_files() {
        const OFFSET: i64 = 100;
        set_offset("nexus", "default", "logs".into(), OFFSET)
            .await
            .unwrap();
        sync_cache_to_db().await.unwrap();
        assert_eq!(
            get_offset("nexus", "default", "logs".into()).await,
            (OFFSET, "".to_string())
        );
        assert!(!list_offset().await.unwrap().is_empty());
    }
}
