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

use anyhow::Context as _;

use crate::meta::dashboards::{Dashboard, DashboardXxx};

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

pub async fn set(org_id: &str, name: &str, dashboard: &DashboardXxx) -> Result<(), anyhow::Error> {
    let db = &crate::infra::db::DEFAULT;
    let key = format!("/dashboard/{org_id}/{name}");
    Ok(db.put(&key, serde_json::to_vec(dashboard)?.into()).await?)
}

pub async fn delete(org_id: &str, name: &str) -> Result<(), anyhow::Error> {
    let db = &crate::infra::db::DEFAULT;
    let key = format!("/dashboard/{org_id}/{name}");
    Ok(db.delete(&key, false).await?)
}

pub async fn list(org_id: &str) -> Result<Vec<Dashboard>, anyhow::Error> {
    let db = &crate::infra::db::DEFAULT;
    let db_key = format!("/dashboard/{org_id}/");
    db.list(&db_key)
        .await?
        .into_iter()
        .map(|(k, v)| {
            let name = k
                .strip_prefix(&db_key)
                .ok_or_else(|| anyhow::anyhow!("key {k:?} doesn't start with {db_key:?}"))?
                .to_string();
            let details = String::from_utf8(v.to_vec()).with_context(|| {
                format!("the value by key {k:?} contains non-UTF8 bytes")
            })?;
            Ok(Dashboard { name, details })
        })
        .collect()
}
