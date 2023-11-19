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

use crate::common::{infra::db as infra_db, meta::dashboards::Folder, utils::json};

#[tracing::instrument]
pub(crate) async fn get(org_id: &str, folder_id: &str) -> Result<Folder, anyhow::Error> {
    let db = infra_db::get_db().await;
    let val = db.get(&format!("/folders/{org_id}/{folder_id}")).await?;
    Ok(json::from_slice(&val).unwrap())
}

#[tracing::instrument(skip(folder))]
pub(crate) async fn put(org_id: &str, folder: Folder) -> Result<Folder, anyhow::Error> {
    let key = format!("/folders/{org_id}/{}", folder.folder_id);
    let db = infra_db::get_db().await;
    match db
        .put(&key, json::to_vec(&folder)?.into(), infra_db::NO_NEED_WATCH)
        .await
    {
        Ok(_) => Ok(folder),
        Err(_) => Err(anyhow::anyhow!("Failed to save folder")),
    }
}

#[tracing::instrument]
pub(crate) async fn list(org_id: &str) -> Result<Vec<Folder>, anyhow::Error> {
    let db_key = format!("/folders/{org_id}/");
    let db = infra_db::get_db().await;
    db.list(&db_key)
        .await?
        .into_values()
        .map(|val| json::from_slice(&val).map_err(|e| anyhow::anyhow!(e)))
        .collect()
}

#[tracing::instrument]
pub(crate) async fn delete(org_id: &str, folder_id: &str) -> Result<(), anyhow::Error> {
    let key = format!("/folders/{org_id}/{folder_id}");
    let db = infra_db::get_db().await;
    Ok(db.delete(&key, false, infra_db::NO_NEED_WATCH).await?)
}
