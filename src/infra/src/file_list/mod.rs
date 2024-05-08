// Copyright 2024 Zinc Labs Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

use async_trait::async_trait;
use config::{
    meta::{
        meta_store::MetaStore,
        stream::{FileKey, FileMeta, PartitionTimeLevel, StreamStats, StreamType},
    },
    CONFIG,
};
use once_cell::sync::Lazy;

use crate::errors::{Error, Result};

pub mod mysql;
pub mod postgres;
pub mod sqlite;

static CLIENT: Lazy<Box<dyn FileList>> = Lazy::new(connect);

pub fn connect() -> Box<dyn FileList> {
    match CONFIG.common.meta_store.as_str().into() {
        MetaStore::Sqlite => Box::<sqlite::SqliteFileList>::default(),
        MetaStore::Etcd => Box::<sqlite::SqliteFileList>::default(),
        MetaStore::Nats => Box::<sqlite::SqliteFileList>::default(),
        MetaStore::MySQL => Box::<mysql::MysqlFileList>::default(),
        MetaStore::PostgreSQL => Box::<postgres::PostgresFileList>::default(),
    }
}

#[async_trait]
pub trait FileList: Sync + Send + 'static {
    async fn create_table(&self) -> Result<()>;
    async fn create_table_index(&self) -> Result<()>;
    async fn add(&self, file: &str, meta: &FileMeta) -> Result<()>;
    async fn add_history(&self, file: &str, meta: &FileMeta) -> Result<()>;
    async fn remove(&self, file: &str) -> Result<()>;
    async fn batch_add(&self, files: &[FileKey]) -> Result<()>;
    async fn batch_add_history(&self, files: &[FileKey]) -> Result<()>;
    async fn batch_remove(&self, files: &[String]) -> Result<()>;
    async fn batch_add_deleted(
        &self,
        org_id: &str,
        created_at: i64,
        files: &[String],
    ) -> Result<()>;
    async fn batch_remove_deleted(&self, files: &[String]) -> Result<()>;
    async fn get(&self, file: &str) -> Result<FileMeta>;
    async fn contains(&self, file: &str) -> Result<bool>;
    async fn list(&self) -> Result<Vec<(String, FileMeta)>>;
    async fn query(
        &self,
        org_id: &str,
        stream_type: StreamType,
        stream_name: &str,
        time_level: PartitionTimeLevel,
        time_range: (i64, i64),
    ) -> Result<Vec<(String, FileMeta)>>;
    async fn query_deleted(&self, org_id: &str, time_max: i64, limit: i64) -> Result<Vec<String>>;
    async fn get_min_ts(
        &self,
        org_id: &str,
        stream_type: StreamType,
        stream_name: &str,
    ) -> Result<i64>;
    async fn get_max_pk_value(&self) -> Result<i64>;
    async fn stats(
        &self,
        org_id: &str,
        stream_type: Option<StreamType>,
        stream_name: Option<&str>,
        pk_value: Option<(i64, i64)>,
    ) -> Result<Vec<(String, StreamStats)>>;
    async fn get_stream_stats(
        &self,
        org_id: &str,
        stream_type: Option<StreamType>,
        stream_name: Option<&str>,
    ) -> Result<Vec<(String, StreamStats)>>;
    async fn del_stream_stats(
        &self,
        org_id: &str,
        stream_type: StreamType,
        stream_name: &str,
    ) -> Result<()>;
    async fn set_stream_stats(&self, org_id: &str, streams: &[(String, StreamStats)])
    -> Result<()>;
    async fn reset_stream_stats(&self) -> Result<()>;
    async fn reset_stream_stats_min_ts(
        &self,
        org_id: &str,
        stream: &str,
        min_ts: i64,
    ) -> Result<()>;
    async fn len(&self) -> usize;
    async fn is_empty(&self) -> bool;
    async fn clear(&self) -> Result<()>;
}

pub async fn create_table() -> Result<()> {
    CLIENT.create_table().await
}

pub async fn create_table_index() -> Result<()> {
    CLIENT.create_table_index().await
}

#[inline]
pub async fn add(file: &str, meta: &FileMeta) -> Result<()> {
    CLIENT.add(file, meta).await
}

#[inline]
pub async fn add_history(file: &str, meta: &FileMeta) -> Result<()> {
    CLIENT.add_history(file, meta).await
}

#[inline]
pub async fn remove(file: &str) -> Result<()> {
    CLIENT.remove(file).await
}

#[inline]
pub async fn batch_add(files: &[FileKey]) -> Result<()> {
    CLIENT.batch_add(files).await
}

#[inline]
pub async fn batch_add_history(files: &[FileKey]) -> Result<()> {
    CLIENT.batch_add_history(files).await
}

#[inline]
pub async fn batch_remove(files: &[String]) -> Result<()> {
    CLIENT.batch_remove(files).await
}

#[inline]
pub async fn batch_add_deleted(org_id: &str, created_at: i64, files: &[String]) -> Result<()> {
    CLIENT.batch_add_deleted(org_id, created_at, files).await
}

#[inline]
pub async fn batch_remove_deleted(files: &[String]) -> Result<()> {
    CLIENT.batch_remove_deleted(files).await
}

#[inline]
pub async fn get(file: &str) -> Result<FileMeta> {
    CLIENT.get(file).await
}

#[inline]
pub async fn contains(file: &str) -> Result<bool> {
    CLIENT.contains(file).await
}

#[inline]
pub async fn list() -> Result<Vec<(String, FileMeta)>> {
    CLIENT.list().await
}

#[inline]
pub async fn query(
    org_id: &str,
    stream_type: StreamType,
    stream_name: &str,
    time_level: PartitionTimeLevel,
    time_range: (i64, i64),
) -> Result<Vec<(String, FileMeta)>> {
    if time_range.0 > time_range.1 || time_range.0 == 0 || time_range.1 == 0 {
        return Err(Error::Message("[file_list] invalid time range".to_string()));
    }
    CLIENT
        .query(org_id, stream_type, stream_name, time_level, time_range)
        .await
}

#[inline]
pub async fn query_deleted(org_id: &str, time_max: i64, limit: i64) -> Result<Vec<String>> {
    CLIENT.query_deleted(org_id, time_max, limit).await
}

#[inline]
pub async fn get_min_ts(org_id: &str, stream_type: StreamType, stream_name: &str) -> Result<i64> {
    CLIENT.get_min_ts(org_id, stream_type, stream_name).await
}

#[inline]
pub async fn get_max_pk_value() -> Result<i64> {
    CLIENT.get_max_pk_value().await
}

#[inline]
pub async fn stats(
    org_id: &str,
    stream_type: Option<StreamType>,
    stream_name: Option<&str>,
    pk_value: Option<(i64, i64)>,
) -> Result<Vec<(String, StreamStats)>> {
    CLIENT
        .stats(org_id, stream_type, stream_name, pk_value)
        .await
}

#[inline]
pub async fn get_stream_stats(
    org_id: &str,
    stream_type: Option<StreamType>,
    stream_name: Option<&str>,
) -> Result<Vec<(String, StreamStats)>> {
    CLIENT
        .get_stream_stats(org_id, stream_type, stream_name)
        .await
}

#[inline]
pub async fn del_stream_stats(
    org_id: &str,
    stream_type: StreamType,
    stream_name: &str,
) -> Result<()> {
    CLIENT
        .del_stream_stats(org_id, stream_type, stream_name)
        .await
}

#[inline]
pub async fn set_stream_stats(org_id: &str, streams: &[(String, StreamStats)]) -> Result<()> {
    CLIENT.set_stream_stats(org_id, streams).await
}

#[inline]
pub async fn reset_stream_stats() -> Result<()> {
    CLIENT.reset_stream_stats().await
}

#[inline]
pub async fn reset_stream_stats_min_ts(org_id: &str, stream: &str, min_ts: i64) -> Result<()> {
    CLIENT
        .reset_stream_stats_min_ts(org_id, stream, min_ts)
        .await
}

#[inline]
pub async fn len() -> usize {
    CLIENT.len().await
}

#[inline]
pub async fn is_empty() -> bool {
    CLIENT.is_empty().await
}

#[inline]
pub async fn clear() -> Result<()> {
    CLIENT.clear().await
}

#[derive(Debug, Clone, PartialEq, sqlx::FromRow)]
pub struct FileRecord {
    pub stream: String,
    pub date: String,
    pub file: String,
    pub deleted: bool,
    pub min_ts: i64,
    pub max_ts: i64,
    pub records: i64,
    pub original_size: i64,
    pub compressed_size: i64,
}

impl From<&FileRecord> for FileMeta {
    fn from(record: &FileRecord) -> Self {
        Self {
            min_ts: record.min_ts,
            max_ts: record.max_ts,
            records: record.records,
            original_size: record.original_size,
            compressed_size: record.compressed_size,
        }
    }
}

#[derive(Debug, Clone, PartialEq, sqlx::FromRow)]
pub struct StatsRecord {
    pub stream: String,
    pub file_num: i64,
    pub min_ts: i64,
    pub max_ts: i64,
    pub records: i64,
    pub original_size: i64,
    pub compressed_size: i64,
}

impl From<&StatsRecord> for StreamStats {
    fn from(record: &StatsRecord) -> Self {
        Self {
            created_at: 0,
            doc_time_min: record.min_ts,
            doc_time_max: record.max_ts,
            doc_num: record.records,
            file_num: record.file_num,
            storage_size: record.original_size as f64,
            compressed_size: record.compressed_size as f64,
        }
    }
}

#[derive(Debug, Clone, PartialEq, sqlx::FromRow)]
pub struct FileDeletedRecord {
    pub stream: String,
    pub date: String,
    pub file: String,
}
