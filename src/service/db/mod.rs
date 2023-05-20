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

use tracing::info_span;

use crate::common::json;

pub mod alerts;
pub mod compact;
pub mod dashboard;
pub mod file_list;
pub mod functions;
pub mod kv;
pub mod metrics;
pub mod schema;
pub mod syslog;
pub mod triggers;
pub mod user;
pub mod version;

pub async fn get_instance() -> Result<Option<String>, anyhow::Error> {
    let db_span = info_span!("db:get_instance");
    let _guard = db_span.enter();
    let db = &crate::infra::db::DEFAULT;
    let key = "/instance/";
    let ret = db.get(key).await?;
    let loc_value = json::from_slice(&ret).unwrap();
    let value = Some(loc_value);
    Ok(value)
}

pub async fn set_instance(id: &str) -> Result<(), anyhow::Error> {
    let db_span = info_span!("db:set_instance");
    let _guard = db_span.enter();
    let db = &crate::infra::db::DEFAULT;
    let key = "/instance/";
    match db.put(key, json::to_vec(&id).unwrap().into()).await {
        Ok(_) => Ok(()),
        Err(e) => Err(anyhow::anyhow!(e)),
    }
}
