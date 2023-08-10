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

use async_once::AsyncOnce;
use async_trait::async_trait;
use chrono::{DateTime, Datelike, TimeZone, Utc};
use sqlx::{migrate::Migrator, sqlite::SqliteConnectOptions, Pool, Row, Sqlite, SqlitePool};
use std::str::FromStr;

use crate::common::infra::{config::CONFIG, errors::Result};
use crate::common::meta::{common::FileMeta, stream::PartitionTimeLevel, StreamType};

lazy_static! {
    pub static ref CLIENT: AsyncOnce<Pool<Sqlite>> = AsyncOnce::new(async { connect().await });
}

async fn connect() -> Pool<Sqlite> {
    let opts = SqliteConnectOptions::from_str(&format!(
        "{}{}",
        CONFIG.common.data_cache_dir, "file_list.sqlite"
    ))
    .expect("sqlite connect options create failed")
    .create_if_missing(true);

    let pool = SqlitePool::connect_with(opts)
        .await
        .expect("sqlite pool create failed");
    let migrator = Migrator::new(std::path::Path::new("./migrations"))
        .await
        .unwrap();
    migrator.run(&pool).await.expect("sqlite migration failed");
    pool
}

pub struct SqliteFileList {}

impl SqliteFileList {
    pub fn new() -> Self {
        Self {}
    }
}

impl Default for SqliteFileList {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl super::FileList for SqliteFileList {
    async fn add(&self, file: &str, meta: &FileMeta) -> Result<()> {
        let (stream_key, date_key, file_name) = super::parse_file_key_columns(file)?;
        sqlx::query(
            r#"
INSERT INTO file_list (stream, date, file, deleted, min_ts, max_ts, records, original_size, compressed_size)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9);
        "#,
        )
        .bind(stream_key)
        .bind(date_key)
        .bind(file_name)
        .bind(false)
        .bind(meta.min_ts)
        .bind(meta.max_ts)
        .bind(meta.records as i64)
        .bind(meta.original_size as i64)
        .bind(meta.compressed_size as i64)
        .execute(CLIENT.get().await)
        .await?;
        Ok(())
    }

    async fn remove(&self, file: &str) -> Result<()> {
        let (stream_key, date_key, file_name) = super::parse_file_key_columns(file)?;
        sqlx::query(
            r#"
DELETE FROM file_list 
    WHERE stream = $1 AND date = $2 AND file = $3;"#,
        )
        .bind(stream_key)
        .bind(date_key)
        .bind(file_name)
        .execute(CLIENT.get().await)
        .await?;
        Ok(())
    }

    async fn get(&self, file: &str) -> Result<FileMeta> {
        let (stream_key, date_key, file_name) = super::parse_file_key_columns(file)?;
        let ret = sqlx::query_as::<_, FileRecord>(
            r#"
SELECT stream, date, file, deleted, min_ts, max_ts, records, original_size, compressed_size
    FROM file_list WHERE stream = $1 AND date = $2 AND file = $3;
        "#,
        )
        .bind(stream_key)
        .bind(date_key)
        .bind(file_name)
        .fetch_one(CLIENT.get().await)
        .await?;
        Ok(FileMeta::from(&ret))
    }

    async fn list(&self) -> Result<Vec<(String, FileMeta)>> {
        let ret = sqlx::query_as::<_, FileRecord>(
            r#"
SELECT stream, date, file, deleted, min_ts, max_ts, records, original_size, compressed_size
    FROM file_list;
        "#,
        )
        .fetch_all(CLIENT.get().await)
        .await?;
        Ok(ret
            .into_iter()
            .map(|r| {
                (
                    format!("files/{}/{}/{}", r.stream, r.date, r.file),
                    FileMeta::from(&r),
                )
            })
            .collect())
    }

    async fn query(
        &self,
        org_id: &str,
        stream_type: StreamType,
        stream_name: &str,
        time_level: PartitionTimeLevel,
        time_range: (i64, i64),
    ) -> Result<Vec<(String, FileMeta)>> {
        let stream_key = format!("{org_id}/{stream_type}/{stream_name}");
        let (mut time_start, mut time_end) = time_range;
        if time_end == 0 {
            time_end = Utc::now().timestamp_micros();
        }
        if time_start > 0 && time_level == PartitionTimeLevel::Daily {
            let t: DateTime<Utc> = Utc.timestamp_nanos(time_start * 1000);
            let t = Utc
                .with_ymd_and_hms(t.year(), t.month(), t.day(), 0, 0, 0)
                .unwrap();
            time_start = t.timestamp_micros();
        }
        let ret = sqlx::query_as::<_, FileRecord>(
            r#"
SELECT stream, date, file, deleted, min_ts, max_ts, records, original_size, compressed_size
    FROM file_list 
    WHERE stream = $1 AND min_ts >= $2 AND max_ts <= $3;
        "#,
        )
        .bind(stream_key)
        .bind(time_start)
        .bind(time_end)
        .fetch_all(CLIENT.get().await)
        .await?;
        Ok(ret
            .into_iter()
            .map(|r| {
                (
                    format!("files/{}/{}/{}", r.stream, r.date, r.file),
                    FileMeta::from(&r),
                )
            })
            .collect())
    }

    async fn contains(&self, file: &str) -> Result<bool> {
        let (stream_key, date_key, file_name) = super::parse_file_key_columns(file)?;
        let ret = sqlx::query(
            r#"
SELECT stream, date, file, deleted, min_ts, max_ts, records, original_size, compressed_size
    FROM file_list WHERE stream = $1 AND date = $2 AND file = $3;
        "#,
        )
        .bind(stream_key)
        .bind(date_key)
        .bind(file_name)
        .fetch_one(CLIENT.get().await)
        .await;
        if let Err(sqlx::Error::RowNotFound) = ret {
            return Ok(false);
        }
        Ok(!ret.unwrap().is_empty())
    }

    async fn len(&self) -> usize {
        let ret = match sqlx::query(r#"SELECT COUNT(*) as num FROM file_list;"#)
            .fetch_one(CLIENT.get().await)
            .await
        {
            Ok(r) => r,
            Err(e) => {
                log::error!("[SQLITE] get file list len error: {}", e);
                return 0;
            }
        };
        match ret.try_get::<i64, &str>("num") {
            Ok(v) => v as usize,
            _ => 0,
        }
    }

    async fn is_empty(&self) -> bool {
        self.len().await == 0
    }

    async fn clear(&self) -> Result<()> {
        sqlx::query(r#"DELETE FROM file_list;"#)
            .execute(CLIENT.get().await)
            .await?;
        Ok(())
    }

    async fn switch_db(&self) -> Result<()> {
        Ok(())
    }
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
            records: record.records as u64,
            original_size: record.original_size as u64,
            compressed_size: record.compressed_size as u64,
        }
    }
}
