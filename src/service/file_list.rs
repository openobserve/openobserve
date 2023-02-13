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

use crate::common;
use crate::infra::cache::file_list;
use crate::meta::common::FileMeta;
use crate::meta::StreamType;

#[inline]
#[tracing::instrument(name = "service:file_list:get_file_list")]
pub async fn get_file_list(
    org_id: &str,
    stream_name: &str,
    stream_type: Option<StreamType>,
    time_min: i64,
    time_max: i64,
) -> Result<Vec<String>, anyhow::Error> {
    let stream_type_loc = match stream_type {
        Some(v) => v,
        None => StreamType::Logs,
    };
    file_list::get_file_list(org_id, stream_name, stream_type_loc, time_min, time_max).await
}

#[inline]
#[tracing::instrument(name = "service:file_list:get_file_meta")]
pub async fn get_file_meta(file: &str) -> Result<FileMeta, anyhow::Error> {
    match file_list::get_file_from_cache(file) {
        Ok(v) => Ok(v),
        Err(_) => Ok(FileMeta::default()),
    }
}

#[inline]
#[tracing::instrument(name = "service:file_list:calculate_files_size", skip(files))]
pub async fn calculate_files_size(files: &[String]) -> Result<u64, anyhow::Error> {
    let mut size = 0;
    for file in files {
        let resp = get_file_meta(file).await.unwrap_or_default();
        size += resp.original_size;
    }
    Ok(size)
}

#[inline]
#[tracing::instrument(name = "service:file_list:calculate_local_files_size", skip(files))]
pub async fn calculate_local_files_size(files: &[String]) -> Result<u64, anyhow::Error> {
    let mut size = 0;
    for file in files {
        let file_size = match common::file::get_file_meta(file) {
            Ok(resp) => resp.len(),
            Err(_) => 0,
        };
        size += file_size;
    }
    Ok(size)
}

#[cfg(test)]
mod test {
    use super::*;
    #[actix_web::test]
    async fn test_get_file_meta() {
        let res = get_file_meta(
            "files/default/logs/olympics/2022/10/03/10/6982652937134804993_1.parquet",
        )
        .await;
        // println!("{:?}", res);
        assert!(res.is_ok());
    }
    #[actix_web::test]
    async fn test_get_file_list() {
        let res = get_file_list(
            "default",
            "olympics",
            Some(StreamType::Logs),
            1663064862606912,
            1663064862606912,
        )
        .await;
        assert!(res.is_ok());
    }
}
