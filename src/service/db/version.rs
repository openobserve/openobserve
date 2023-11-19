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

use crate::common::infra::{config, db as infra_db};

pub async fn get() -> Result<String, anyhow::Error> {
    let db = infra_db::get_db().await;
    let ret = db.get("/meta/kv/version").await?;
    let version = std::str::from_utf8(&ret).unwrap();
    Ok(version.to_string())
}

pub async fn set() -> Result<(), anyhow::Error> {
    let db = infra_db::get_db().await;
    db.put(
        "/meta/kv/version",
        bytes::Bytes::from(config::VERSION),
        infra_db::NO_NEED_WATCH,
    )
    .await?;
    Ok(())
}
