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

use crate::infra::config::CONFIG;
use crate::meta::StreamType;

pub async fn set(
    org_id: &str,
    stream_type: StreamType,
    stream_name: &str,
    days: i64,
) -> Result<(), anyhow::Error> {
    let db = &crate::infra::db::DEFAULT;
    let key = format!("/compact/retention/{org_id}/{stream_type}/{stream_name}");
    db.put(&key, days.to_string().into()).await?;
    Ok(())
}

pub async fn get(
    org_id: &str,
    stream_name: &str,
    stream_type: StreamType,
) -> Result<i64, anyhow::Error> {
    let db = &crate::infra::db::DEFAULT;
    let key = format!("/compact/retention/{org_id}/{stream_type}/{stream_name}");
    let days: i64 = match db.get(&key).await {
        Ok(ret) => String::from_utf8_lossy(&ret).to_string().parse().unwrap(),
        Err(_) => CONFIG.compact.data_retention_days,
    };
    Ok(days)
}

pub async fn del(
    org_id: &str,
    stream_name: &str,
    stream_type: StreamType,
) -> Result<(), anyhow::Error> {
    let db = &crate::infra::db::DEFAULT;
    let key = format!("/compact/retention/{org_id}/{stream_type}/{stream_name}");
    db.delete_if_exists(&key, false).await.map_err(Into::into)
}
