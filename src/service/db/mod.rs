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

use crate::common::{infra::db as infra_db, utils::json};

pub mod alerts;
pub mod compact;
pub mod dashboards;
pub mod enrichment_table;
pub mod file_list;
pub mod functions;
pub mod kv;
pub mod metrics;
pub mod organization;
pub mod schema;
pub mod syslog;
pub mod triggers;
pub mod user;
pub mod version;

pub async fn get_instance() -> Result<Option<String>, anyhow::Error> {
    let db = infra_db::get_db().await;
    let key = "/instance/";
    let ret = db.get(key).await?;
    let loc_value = json::from_slice(&ret).unwrap();
    let value = Some(loc_value);
    Ok(value)
}

pub async fn set_instance(id: &str) -> Result<(), anyhow::Error> {
    let db = infra_db::get_db().await;
    let key = "/instance/";
    match db
        .put(
            key,
            json::to_vec(&id).unwrap().into(),
            infra_db::NO_NEED_WATCH,
        )
        .await
    {
        Ok(_) => Ok(()),
        Err(e) => Err(anyhow::anyhow!(e)),
    }
}
