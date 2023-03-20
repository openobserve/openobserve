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

use crate::service::db::kv;

pub async fn get(org_id: &str, key: &str) -> Result<bytes::Bytes, anyhow::Error> {
    let val = kv::get(org_id, key).await?;
    Ok(val)
}

pub async fn set(org_id: &str, key: &str, val: bytes::Bytes) -> Result<(), anyhow::Error> {
    kv::set(org_id, key, val).await?;
    Ok(())
}

pub async fn delete(org_id: &str, key: &str) -> Result<(), anyhow::Error> {
    kv::delete(org_id, key).await?;
    Ok(())
}

pub async fn list(org_id: &str, prefix: &str) -> Result<Vec<String>, anyhow::Error> {
    let items = kv::list(org_id, prefix).await?;
    Ok(items)
}
