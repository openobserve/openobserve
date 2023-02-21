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

use chrono::{TimeZone, Utc};
use dashmap::DashMap;
use object_store::ObjectMeta;

use crate::service::file_list;

lazy_static! {
    pub static ref FILES: DashMap<String, Vec<ObjectMeta>> = DashMap::new();
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum SessionType {
    Cache,
    Local,
    Remote,
}

pub async fn get(session_id: &str) -> Result<Vec<ObjectMeta>, anyhow::Error> {
    let data = match FILES.get(session_id) {
        Some(data) => data,
        None => return Err(anyhow::anyhow!("session_id not found")),
    };
    Ok(data.value().clone())
}

pub async fn set(session_id: &str, files: &[String]) -> Result<(), anyhow::Error> {
    let mut values = Vec::with_capacity(files.len());
    for file in files {
        let meta = file_list::get_file_meta(file).await.unwrap();
        let modified = Utc.timestamp_nanos(meta.max_ts * 1000);
        values.push(ObjectMeta {
            location: file.clone().into(),
            last_modified: modified,
            size: meta.compressed_size as usize,
        });
    }
    FILES.insert(session_id.to_string(), values);
    Ok(())
}

pub async fn clear(session_id: &str) -> Result<(), anyhow::Error> {
    FILES.remove(session_id);
    Ok(())
}

#[cfg(test)]
mod tests {

    use super::*;

    #[actix_web::test]
    async fn test_storage_file_list() {
        let meta = crate::meta::common::FileMeta {
            min_ts: 100,
            max_ts: 200,
            records: 10000,
            original_size: 1024,
            compressed_size: 1,
        };
        let file_name = "files/default/logs/olympics/2022/10/03/10/6982652937134804993_1.parquet";
        let _ret = crate::infra::cache::file_list::set_file_to_cache(file_name, Some(meta), false)
            .unwrap();
        let session_id = "1234";

        let res = set(session_id, &[file_name.to_string()]).await;
        assert!(res.is_ok());

        let get_resp = get(session_id).await;
        assert!(get_resp.unwrap().len() > 0);
    }
}
