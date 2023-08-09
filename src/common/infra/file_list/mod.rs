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

use async_trait::async_trait;

use crate::common::infra::errors::{Error, Result};
use crate::common::meta::{common::FileMeta, stream::PartitionTimeLevel, StreamType};

pub mod dynamo;
pub mod sled;

lazy_static! {
    static ref DEFAULT: Box<dyn FileList> = default();
}

pub fn default() -> Box<dyn FileList> {
    Box::<sled::Sled>::default()
}

#[async_trait]
pub trait FileList: Sync + 'static {
    async fn add(&self, file: &str, meta: &FileMeta) -> Result<()>;
    async fn remove(&self, file: &str) -> Result<()>;
    async fn get(&self, file: &str) -> Result<FileMeta>;
    async fn list(&self) -> Result<Vec<(String, FileMeta)>>;
    async fn query(
        &self,
        org_id: &str,
        stream_type: StreamType,
        stream_name: &str,
        time_level: PartitionTimeLevel,
        time_range: (i64, i64),
    ) -> Result<Vec<(String, FileMeta)>>;
    async fn contains(&self, file: &str) -> Result<bool>;
    async fn len(&self) -> usize;
    async fn is_empty(&self) -> bool;
    async fn clear(&self) -> Result<()>;
    async fn switch_db(&self) -> Result<()>;
}

#[inline]
pub async fn add(file: &str, meta: &FileMeta) -> Result<()> {
    DEFAULT.add(file, meta).await
}

#[inline]
pub async fn remove(file: &str) -> Result<()> {
    DEFAULT.remove(file).await
}

#[inline]
pub async fn get(file: &str) -> Result<FileMeta> {
    DEFAULT.get(file).await
}

#[inline]
pub async fn list() -> Result<Vec<(String, FileMeta)>> {
    DEFAULT.list().await
}

#[inline]
pub async fn query(
    org_id: &str,
    stream_type: StreamType,
    stream_name: &str,
    time_level: PartitionTimeLevel,
    time_range: (i64, i64),
) -> Result<Vec<(String, FileMeta)>> {
    DEFAULT
        .query(org_id, stream_type, stream_name, time_level, time_range)
        .await
}

#[inline]
pub async fn contains(file: &str) -> Result<bool> {
    DEFAULT.contains(file).await
}

#[inline]
pub async fn len() -> usize {
    DEFAULT.len().await
}

#[inline]
pub async fn is_empty() -> bool {
    DEFAULT.is_empty().await
}

#[inline]
pub async fn clear() -> Result<()> {
    DEFAULT.clear().await
}

#[inline]
pub async fn switch_db() -> Result<()> {
    DEFAULT.switch_db().await
}

/// parse file key to get stream_key, date_key, file_name
pub fn parse_file_key_columns(key: &str) -> Result<(String, String)> {
    // eg: files/default/logs/olympics/2022/10/03/10/6982652937134804993_1.parquet
    let columns = key.splitn(5, '/').collect::<Vec<&str>>();
    if columns.len() < 5 {
        return Err(Error::Message(format!(
            "[file_list] Invalid file path: {}",
            key
        )));
    }
    // let _ = columns[0].to_string(); // files/
    let org_id = columns[1].to_string();
    let stream_type = columns[2].to_string();
    let stream_name = columns[3].to_string();
    let file_name = columns[4].to_string();
    let stream_key = format!("{org_id}/{stream_type}/{stream_name}");
    Ok((stream_key, file_name))
}
