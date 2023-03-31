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

use crate::{
    common::json,
    meta::dashboards::{Dashboard, NamedDashboard},
};

pub async fn get(org_id: &str, name: &str) -> Result<Option<NamedDashboard>, anyhow::Error> {
    let db = &crate::infra::db::DEFAULT;
    let key = format!("/dashboard/{org_id}/{name}");
    let val = db.get(&key).await?;
    let details: Dashboard = json::from_slice(&val).with_context(|| {
        format!("Failed to deserialize the value for key {key:?} as `Dashboard`")
    })?;
    Ok(Some(NamedDashboard {
        name: name.to_string(),
        details,
    }))
}

pub async fn set(org_id: &str, name: &str, dashboard: &Dashboard) -> Result<(), anyhow::Error> {
    let db = &crate::infra::db::DEFAULT;
    let key = format!("/dashboard/{org_id}/{name}");
    Ok(db.put(&key, json::to_vec(dashboard)?.into()).await?)
}

pub async fn delete(org_id: &str, name: &str) -> Result<(), anyhow::Error> {
    let db = &crate::infra::db::DEFAULT;
    let key = format!("/dashboard/{org_id}/{name}");
    Ok(db.delete(&key, false).await?)
}

pub async fn list(org_id: &str) -> Result<Vec<NamedDashboard>, anyhow::Error> {
    let db = &crate::infra::db::DEFAULT;
    let db_key = format!("/dashboard/{org_id}/");
    db.list(&db_key)
        .await?
        .into_iter()
        .map(|(k, v)| {
            let name = k
                .strip_prefix(&db_key)
                .expect("BUG: key {k:?} doesn't start with {db_key:?}")
                .to_string();
            let details: Dashboard = json::from_slice(&v).with_context(|| {
                format!("Failed to deserialize the value for key {db_key:?} as `Dashboard`")
            })?;
            Ok(NamedDashboard { name, details })
        })
        .collect()
}
