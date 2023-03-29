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

use bytes::Bytes;

use crate::meta::dashboards::Dashboard;

pub async fn get(org_id: &str, name: &str) -> Result<Option<Dashboard>, anyhow::Error> {
    let db = &crate::infra::db::DEFAULT;
    let key = format!("/dashboard/{org_id}/{name}");
    let ret = db.get(&key).await?;
    let details = String::from_utf8(ret.to_vec()).unwrap();
    Ok(Some(Dashboard {
        name: name.to_string(),
        details,
    }))
}

pub async fn set(org_id: &str, name: &str, details: &str) -> Result<(), anyhow::Error> {
    let db = &crate::infra::db::DEFAULT;
    let key = format!("/dashboard/{org_id}/{name}");
    Ok(db.put(&key, Bytes::from(details.to_string())).await?)
}

pub async fn delete(org_id: &str, name: &str) -> Result<(), anyhow::Error> {
    let db = &crate::infra::db::DEFAULT;
    let key = format!("/dashboard/{org_id}/{name}");
    Ok(db.delete(&key, false).await?)
}

pub async fn list(org_id: &str) -> Result<Vec<Dashboard>, anyhow::Error> {
    let db = &crate::infra::db::DEFAULT;
    let key = format!("/dashboard/{org_id}/");
    let ret = db.list(&key).await?;
    let mut udf_list: Vec<Dashboard> = Vec::new();
    for (item_key, item_value) in ret {
        let name = item_key.strip_prefix(&key).unwrap().to_string();
        let details = String::from_utf8(item_value.to_vec()).unwrap();
        udf_list.push(Dashboard { name, details })
    }
    Ok(udf_list)
}
