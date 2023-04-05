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
use tracing::instrument;

use crate::{common::json, infra::db, meta::dashboards::Dashboard};

/// # Panics
///
/// Panics if [`Dashboard::dashboard_id`] stored in the database is not equal to
/// `dashboard_id` argument.
#[instrument(err)]
pub(crate) async fn get(org_id: &str, dashboard_id: &str) -> Result<Dashboard, anyhow::Error> {
    let key = format!("/dashboard/{org_id}/{dashboard_id}");
    let bytes = db::DEFAULT.get(&key).await?;
    json::from_slice(&bytes)
        .with_context(|| format!("Failed to deserialize the value for key {key:?} as `Dashboard`"))
}

#[instrument(err, skip(dashboard))]
pub(crate) async fn put(org_id: &str, dashboard: &Dashboard) -> Result<(), anyhow::Error> {
    let key = format!("/dashboard/{org_id}/{}", dashboard.dashboard_id);
    Ok(db::DEFAULT
        .put(&key, json::to_vec(dashboard)?.into())
        .await?)
}

#[instrument(err)]
pub(crate) async fn list(org_id: &str) -> Result<Vec<Dashboard>, anyhow::Error> {
    let db_key = format!("/dashboard/{org_id}/");
    db::DEFAULT
        .list(&db_key)
        .await?
        .into_values()
        .map(|val| {
            json::from_slice(&val).with_context(|| {
                format!("Failed to deserialize the value for key {db_key:?} as `Dashboard`")
            })
        })
        .collect()
}

#[instrument(err)]
pub(crate) async fn delete(org_id: &str, dashboard_id: &str) -> Result<(), anyhow::Error> {
    let key = format!("/dashboard/{org_id}/{dashboard_id}");
    Ok(db::DEFAULT.delete(&key, false).await?)
}

#[instrument(err)]
pub async fn reset() -> Result<(), anyhow::Error> {
    let key = "/dashboard/";
    Ok(db::DEFAULT.delete(key, true).await?)
}
