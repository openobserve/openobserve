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
use once_cell::sync::Lazy;

use crate::infra::config::RwHashMap;
use crate::service::file_list;

pub static FILES: Lazy<RwHashMap<String, Vec<ObjectMeta>>> = Lazy::new(DashMap::default);

pub fn get(session_id: &str) -> Result<Vec<ObjectMeta>, anyhow::Error> {
    let data = match FILES.get(session_id) {
        Some(data) => data,
        None => return Err(anyhow::anyhow!("session_id not found")),
    };
    Ok(data.value().clone())
}

pub fn set(session_id: &str, files: &[String]) {
    let mut values = Vec::with_capacity(files.len());
    for file in files {
        let meta = file_list::get_file_meta(file).unwrap();
        let modified = Utc.timestamp_nanos(meta.max_ts * 1000);
        values.push(ObjectMeta {
            location: file.clone().into(),
            last_modified: modified,
            size: meta.compressed_size as usize,
        });
    }
    FILES.insert(session_id.to_string(), values);
}

pub fn clear(session_id: &str) {
    let keys = FILES
        .iter()
        .filter(|x| x.key().starts_with(session_id))
        .map(|x| x.key().clone())
        .collect::<Vec<_>>();
    for key in keys {
        FILES.remove(&key);
    }
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
        crate::infra::cache::file_list::set_file_to_cache(file_name, meta).unwrap();
        let session_id = "1234";
        set(session_id, &[file_name.to_string()]);

        let get_resp = get(session_id);
        assert!(get_resp.unwrap().len() > 0);

        clear(session_id);
    }
}
