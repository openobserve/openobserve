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

use crate::common::json;
use crate::meta::functions::Transform;
use crate::meta::StreamType;

pub async fn set(
    org_id: &str,
    stream_name: Option<String>,
    name: &str,
    js_func: Transform,
) -> Result<(), anyhow::Error> {
    let db = &crate::infra::db::DEFAULT;
    let key = match stream_name {
        Some(idx_name) => format!(
            "/transform/{}/{}/{}/{}",
            org_id,
            StreamType::Logs,
            idx_name,
            name
        ),
        None => format!("/transform/{}/{}", org_id, name),
    };
    db.put(&key, json::to_vec(&js_func).unwrap().into()).await?;
    Ok(())
}

pub async fn delete(
    org_id: &str,
    stream_name: Option<String>,
    name: &str,
) -> Result<(), anyhow::Error> {
    let db = &crate::infra::db::DEFAULT;
    let key = match stream_name {
        Some(idx_name) => format!(
            "/transform/{}/{}/{}/{}",
            org_id,
            StreamType::Logs,
            idx_name,
            name
        ),
        None => format!("/transform/{}/{}", org_id, name),
    };
    match db.delete(&key, false).await {
        Ok(_) => Ok(()),
        Err(_) => Err(anyhow::anyhow!("transform not found")),
    }
}

pub async fn list(
    org_id: &str,
    stream_name: Option<String>,
) -> Result<Vec<Transform>, anyhow::Error> {
    let db = &crate::infra::db::DEFAULT;
    let mut udf_list: Vec<Transform> = Vec::new();
    let key = match stream_name {
        Some(idx_name) => format!("/transform/{}/{}/{}", org_id, StreamType::Logs, idx_name),
        None => format!("/transform/{}", org_id),
    };
    let result = db.list_values(&key).await?;
    for item in result {
        let json_val = json::from_slice(&item).unwrap();
        udf_list.push(json_val)
    }
    Ok(udf_list)
}
