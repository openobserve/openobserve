// Copyright 2023 Zinc Labs Inc.
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

use crate::common::{infra::db as infra_db, meta::dashboards::Dashboard, utils::json};

#[tracing::instrument]
pub(crate) async fn get(org_id: &str, dashboard_id: &str) -> Result<Dashboard, anyhow::Error> {
    let key = format!("/dashboard/{org_id}/{dashboard_id}");
    let bytes = infra_db::DEFAULT.get(&key).await?;
    json::from_slice(&bytes).map_err(|_| {
        anyhow::anyhow!("Failed to deserialize the value for key {key:?} as `Dashboard`")
    })
}

#[tracing::instrument(skip(dashboard))]
pub(crate) async fn put(org_id: &str, dashboard: &Dashboard) -> Result<(), anyhow::Error> {
    let key = format!("/dashboard/{org_id}/{}", dashboard.dashboard_id);
    Ok(infra_db::DEFAULT
        .put(
            &key,
            json::to_vec(dashboard)?.into(),
            infra_db::NO_NEED_WATCH,
        )
        .await?)
}

#[tracing::instrument]
pub(crate) async fn list(org_id: &str) -> Result<Vec<Dashboard>, anyhow::Error> {
    let db_key = format!("/dashboard/{org_id}/");
    infra_db::DEFAULT
        .list(&db_key)
        .await?
        .into_values()
        .map(|val| {
            json::from_slice(&val).map_err(|_| {
                anyhow::anyhow!("Failed to deserialize the value for key {db_key:?} as `Dashboard`")
            })
        })
        .collect()
}

#[tracing::instrument]
pub(crate) async fn delete(org_id: &str, dashboard_id: &str) -> Result<(), anyhow::Error> {
    let key = format!("/dashboard/{org_id}/{dashboard_id}");
    Ok(infra_db::DEFAULT
        .delete(&key, false, infra_db::NO_NEED_WATCH)
        .await?)
}

#[tracing::instrument]
pub async fn reset() -> Result<(), anyhow::Error> {
    let key = "/dashboard/";
    Ok(infra_db::DEFAULT
        .delete(key, true, infra_db::NO_NEED_WATCH)
        .await?)
}
