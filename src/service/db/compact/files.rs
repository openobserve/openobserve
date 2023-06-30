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

use crate::meta::StreamType;

fn mk_key(org_id: &str, stream_type: StreamType, stream_name: &str) -> String {
    format!("/compact/files/{org_id}/{stream_type}/{stream_name}")
}

pub async fn get_offset(org_id: &str, stream_name: &str, stream_type: StreamType) -> (i64, String) {
    let db = &crate::infra::db::DEFAULT;
    let key = mk_key(org_id, stream_type, stream_name);
    let value = match db.get(&key).await {
        Ok(ret) => String::from_utf8_lossy(&ret).to_string(),
        Err(_) => String::from("0"),
    };
    if value.contains(';') {
        let mut parts = value.split(';');
        let offset: i64 = parts.next().unwrap().parse().unwrap();
        let node = parts.next().unwrap().to_string();
        (offset, node)
    } else {
        (value.parse().unwrap(), String::from(""))
    }
}

pub async fn set_offset(
    org_id: &str,
    stream_name: &str,
    stream_type: StreamType,
    offset: i64,
    node: Option<&str>,
) -> Result<(), anyhow::Error> {
    let db = &crate::infra::db::DEFAULT;
    let key = mk_key(org_id, stream_type, stream_name);
    let val = if let Some(node) = node {
        format!("{};{}", offset, node)
    } else {
        offset.to_string()
    };
    Ok(db.put(&key, val.into()).await?)
}

pub async fn del_offset(
    org_id: &str,
    stream_name: &str,
    stream_type: StreamType,
) -> Result<(), anyhow::Error> {
    let db = &crate::infra::db::DEFAULT;
    let key = mk_key(org_id, stream_type, stream_name);
    db.delete_if_exists(&key, false).await.map_err(Into::into)
}

pub async fn list_offset() -> Result<Vec<(String, i64)>, anyhow::Error> {
    let mut items = Vec::new();
    let db = &crate::infra::db::DEFAULT;
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

#[cfg(test)]
mod tests {
    use super::*;

    #[actix_web::test]
    async fn test_files() {
        const OFFSET: i64 = 100;

        set_offset("nexus", "default", "logs".into(), OFFSET, None)
            .await
            .unwrap();
        assert_eq!(
            get_offset("nexus", "default", "logs".into()).await,
            (OFFSET, "".to_string())
        );
        assert!(!list_offset().await.unwrap().is_empty());

        // set offset with node
        set_offset("nexus", "default", "logs".into(), OFFSET, Some("node1"))
            .await
            .unwrap();
        assert_eq!(
            get_offset("nexus", "default", "logs".into()).await,
            (OFFSET, "node1".to_string())
        );
    }
}
