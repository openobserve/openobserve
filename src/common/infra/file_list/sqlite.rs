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

use ahash::HashMap;
use async_trait::async_trait;
use chrono::Utc;
use sqlx::{Pool, QueryBuilder, Row, Sqlite};
use std::sync::atomic::AtomicBool;

use crate::common::{
    infra::{
        config::CONFIG,
        db::{
            sqlite::{CHANNEL, CLIENT_RO as CLIENT},
            DbEvent, DbEventFileList, DbEventFileListDeleted, DbEventStreamStats,
        },
        errors::{Error, Result},
    },
    meta::{
        common::{FileKey, FileMeta},
        stream::{PartitionTimeLevel, StreamStats},
        StreamType,
    },
};

/// Table file_list inited flag
static FILE_LIST_INITED: AtomicBool = AtomicBool::new(false);

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
    async fn create_table(&self) -> Result<()> {
        let tx = CHANNEL.db_tx.clone();
        tx.send(DbEvent::CreateTableFileList)
            .await
            .map_err(|e| Error::Message(e.to_string()))?;
        Ok(())
    }

    async fn create_table_index(&self) -> Result<()> {
        let tx = CHANNEL.db_tx.clone();
        tx.send(DbEvent::CreateTableFileListIndex)
            .await
            .map_err(|e| Error::Message(e.to_string()))?;
        Ok(())
    }

    async fn set_initialised(&self) -> Result<()> {
        let tx = CHANNEL.db_tx.clone();
        tx.send(DbEvent::FileList(DbEventFileList::Initialized))
            .await
            .map_err(|e| Error::Message(e.to_string()))?;
        Ok(())
    }

    async fn get_initialised(&self) -> Result<bool> {
        Ok(FILE_LIST_INITED.load(std::sync::atomic::Ordering::Relaxed))
    }

    async fn add(&self, file: &str, meta: &FileMeta) -> Result<()> {
        let tx = CHANNEL.db_tx.clone();
        tx.send(DbEvent::FileList(DbEventFileList::Add(
            file.to_string(),
            meta.to_owned(),
        )))
        .await
        .map_err(|e| Error::Message(e.to_string()))?;
        Ok(())
    }

    async fn remove(&self, file: &str) -> Result<()> {
        let tx = CHANNEL.db_tx.clone();
        tx.send(DbEvent::FileList(DbEventFileList::BatchRemove(vec![
            file.to_string()
        ])))
        .await
        .map_err(|e| Error::Message(e.to_string()))?;
        Ok(())
    }

    async fn batch_add(&self, files: &[FileKey]) -> Result<()> {
        if files.is_empty() {
            return Ok(());
        }
        let tx = CHANNEL.db_tx.clone();
        tx.send(DbEvent::FileList(DbEventFileList::BatchAdd(files.to_vec())))
            .await
            .map_err(|e| Error::Message(e.to_string()))?;
        Ok(())
    }

    async fn batch_remove(&self, files: &[String]) -> Result<()> {
        if files.is_empty() {
            return Ok(());
        }
        let tx = CHANNEL.db_tx.clone();
        tx.send(DbEvent::FileList(DbEventFileList::BatchRemove(
            files.to_vec(),
        )))
        .await
        .map_err(|e| Error::Message(e.to_string()))?;
        Ok(())
    }

    async fn batch_add_deleted(
        &self,
        org_id: &str,
        created_at: i64,
        files: &[String],
    ) -> Result<()> {
        if files.is_empty() {
            return Ok(());
        }
        let tx = CHANNEL.db_tx.clone();
        tx.send(DbEvent::FileListDeleted(DbEventFileListDeleted::BatchAdd(
            org_id.to_string(),
            created_at,
            files.to_vec(),
        )))
        .await
        .map_err(|e| Error::Message(e.to_string()))?;
        Ok(())
    }

    async fn batch_remove_deleted(&self, files: &[String]) -> Result<()> {
        if files.is_empty() {
            return Ok(());
        }
        let tx = CHANNEL.db_tx.clone();
        tx.send(DbEvent::FileListDeleted(
            DbEventFileListDeleted::BatchRemove(files.to_vec()),
        ))
        .await
        .map_err(|e| Error::Message(e.to_string()))?;
        Ok(())
    }

    async fn get(&self, file: &str) -> Result<FileMeta> {
        let pool = CLIENT.clone();
        let (stream_key, date_key, file_name) = super::parse_file_key_columns(file)?;
        let ret = sqlx::query_as::<_, super::FileRecord>(
            r#"
SELECT stream, date, file, deleted, min_ts, max_ts, records, original_size, compressed_size
    FROM file_list WHERE stream = $1 AND date = $2 AND file = $3;
            "#,
        )
        .bind(stream_key)
        .bind(date_key)
        .bind(file_name)
        .fetch_one(&pool)
        .await?;
        Ok(FileMeta::from(&ret))
    }

    async fn contains(&self, file: &str) -> Result<bool> {
        let pool = CLIENT.clone();
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
        .fetch_one(&pool)
        .await;
        if let Err(sqlx::Error::RowNotFound) = ret {
            return Ok(false);
        }
        Ok(!ret.unwrap().is_empty())
    }

    async fn list(&self) -> Result<Vec<(String, FileMeta)>> {
        let pool = CLIENT.clone();
        let ret = sqlx::query_as::<_, super::FileRecord>(r#"SELECT stream, date, file, deleted, min_ts, max_ts, records, original_size, compressed_size FROM file_list;"#)
        .fetch_all(&pool)
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
        _time_level: PartitionTimeLevel,
        time_range: (i64, i64),
    ) -> Result<Vec<(String, FileMeta)>> {
        let (time_start, mut time_end) = time_range;
        if time_end == 0 {
            time_end = Utc::now().timestamp_micros();
        }

        let stream_key = format!("{org_id}/{stream_type}/{stream_name}");

        let pool = CLIENT.clone();
        let ret = sqlx::query_as::<_, super::FileRecord>(
            r#"
SELECT stream, date, file, deleted, min_ts, max_ts, records, original_size, compressed_size
    FROM file_list 
    WHERE stream = $1 AND min_ts <= $2 AND max_ts >= $3;
            "#,
        )
        .bind(stream_key)
        .bind(time_end)
        .bind(time_start)
        .fetch_all(&pool)
        .await?;
        Ok(ret
            .iter()
            .map(|r| {
                (
                    format!("files/{}/{}/{}", r.stream, r.date, r.file),
                    r.into(),
                )
            })
            .collect())
    }

    async fn query_deleted(&self, org_id: &str, time_max: i64) -> Result<Vec<String>> {
        if time_max == 0 {
            return Ok(Vec::new());
        }
        let pool = CLIENT.clone();
        let ret = sqlx::query_as::<_, super::FileDeletedRecord>(
            r#"SELECT stream, date, file FROM file_list_deleted WHERE org = $1 AND created_at < $2;"#,
        )
        .bind(org_id)
        .bind(time_max)
        .fetch_all(&pool)
        .await?;
        Ok(ret
            .iter()
            .map(|r| format!("files/{}/{}/{}", r.stream, r.date, r.file))
            .collect())
    }

    async fn get_max_pk_value(&self) -> Result<i64> {
        let pool = CLIENT.clone();
        let ret: Option<i64> = sqlx::query_scalar(r#"SELECT MAX(id) AS id FROM file_list;"#)
            .fetch_one(&pool)
            .await?;
        Ok(ret.unwrap_or_default())
    }

    async fn stats(
        &self,
        org_id: &str,
        stream_type: Option<StreamType>,
        stream_name: Option<&str>,
        pk_value: Option<(i64, i64)>,
    ) -> Result<Vec<(String, StreamStats)>> {
        let (field, value) = if stream_type.is_some() && stream_name.is_some() {
            (
                "stream",
                format!(
                    "{}/{}/{}",
                    org_id,
                    stream_type.unwrap(),
                    stream_name.unwrap()
                ),
            )
        } else {
            ("org", org_id.to_string())
        };
        let sql = format!(
            r#"
SELECT stream, MIN(min_ts) as min_ts, MAX(max_ts) as max_ts, COUNT(*) as file_num, SUM(records) as records, SUM(original_size) as original_size, SUM(compressed_size) as compressed_size
    FROM file_list 
    WHERE {field} = '{value}'
            "#,
        );
        let sql = match pk_value {
            None => format!("{} GROUP BY stream", sql),
            Some((0, 0)) => format!("{} GROUP BY stream", sql),
            Some((min, max)) => {
                format!("{} AND id > {} AND id <= {} GROUP BY stream", sql, min, max)
            }
        };
        let pool = CLIENT.clone();
        let ret = sqlx::query_as::<_, super::StatsRecord>(&sql)
            .fetch_all(&pool)
            .await?;
        Ok(ret
            .iter()
            .map(|r| (r.stream.to_owned(), r.into()))
            .collect())
    }

    async fn get_stream_stats(
        &self,
        org_id: &str,
        stream_type: Option<StreamType>,
        stream_name: Option<&str>,
    ) -> Result<Vec<(String, StreamStats)>> {
        let sql = if stream_type.is_some() && stream_name.is_some() {
            format!(
                "SELECT * FROM stream_stats WHERE stream = '{}/{}/{}';",
                org_id,
                stream_type.unwrap(),
                stream_name.unwrap()
            )
        } else {
            format!("SELECT * FROM stream_stats WHERE org = '{}';", org_id)
        };
        let pool = CLIENT.clone();
        let ret = sqlx::query_as::<_, super::StatsRecord>(&sql)
            .fetch_all(&pool)
            .await?;
        Ok(ret
            .iter()
            .map(|r| (r.stream.to_owned(), r.into()))
            .collect())
    }

    async fn set_stream_stats(
        &self,
        org_id: &str,
        streams: &[(String, StreamStats)],
    ) -> Result<()> {
        let tx = CHANNEL.db_tx.clone();
        tx.send(DbEvent::StreamStats(DbEventStreamStats::Set(
            org_id.to_string(),
            streams.to_vec(),
        )))
        .await
        .map_err(|e| Error::Message(e.to_string()))?;
        Ok(())
    }

    async fn reset_stream_stats_min_ts(
        &self,
        _org_id: &str,
        stream: &str,
        min_ts: i64,
    ) -> Result<()> {
        let tx = CHANNEL.db_tx.clone();
        tx.send(DbEvent::StreamStats(DbEventStreamStats::ResetMinTS(
            stream.to_string(),
            min_ts,
        )))
        .await
        .map_err(|e| Error::Message(e.to_string()))?;
        Ok(())
    }

    async fn reset_stream_stats(&self) -> Result<()> {
        let tx = CHANNEL.db_tx.clone();
        tx.send(DbEvent::StreamStats(DbEventStreamStats::ResetAll))
            .await
            .map_err(|e| Error::Message(e.to_string()))?;
        Ok(())
    }

    async fn len(&self) -> usize {
        let pool = CLIENT.clone();
        let ret = match sqlx::query(r#"SELECT COUNT(*) as num FROM file_list;"#)
            .fetch_one(&pool)
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
        Ok(())
    }
}

pub async fn add(client: &Pool<Sqlite>, file: &str, meta: &FileMeta) -> Result<()> {
    let (stream_key, date_key, file_name) = super::parse_file_key_columns(file)?;
    let org_id = stream_key[..stream_key.find('/').unwrap()].to_string();
    match  sqlx::query(
            r#"
INSERT INTO file_list (org, stream, date, file, deleted, min_ts, max_ts, records, original_size, compressed_size)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10);
        "#,
    )
        .bind(org_id)
        .bind(stream_key)
        .bind(date_key)
        .bind(file_name)
        .bind(false)
        .bind(meta.min_ts)
        .bind(meta.max_ts)
        .bind(meta.records)
        .bind(meta.original_size)
        .bind(meta.compressed_size)
        .execute(client)
        .await {
            Err(sqlx::Error::Database(e)) => if e.is_unique_violation() {
                  Ok(())
            } else {
                  Err(Error::Message(e.to_string()))
            },
            Err(e) =>  Err(e.into()),
            Ok(_) => Ok(()),
        }
}

pub async fn batch_add(client: &Pool<Sqlite>, files: &[FileKey]) -> Result<()> {
    let chunks = files.chunks(100);
    for files in chunks {
        let mut tx = client.begin().await?;
        let mut query_builder: QueryBuilder<Sqlite> = QueryBuilder::new("INSERT INTO file_list (org, stream, date, file, deleted, min_ts, max_ts, records, original_size, compressed_size)");
        query_builder.push_values(files, |mut b, item| {
            let (stream_key, date_key, file_name) =
                super::parse_file_key_columns(&item.key).expect("parse file key failed");
            let org_id = stream_key[..stream_key.find('/').unwrap()].to_string();
            b.push_bind(org_id)
                .push_bind(stream_key)
                .push_bind(date_key)
                .push_bind(file_name)
                .push_bind(false)
                .push_bind(item.meta.min_ts)
                .push_bind(item.meta.max_ts)
                .push_bind(item.meta.records)
                .push_bind(item.meta.original_size)
                .push_bind(item.meta.compressed_size);
        });
        let need_single_insert = match query_builder.build().execute(&mut *tx).await {
            Ok(_) => false,
            Err(sqlx::Error::Database(e)) => {
                if e.is_unique_violation() {
                    true
                } else {
                    if let Err(e) = tx.rollback().await {
                        log::error!("[SQLITE] rollback file_list batch add error: {}", e);
                    }
                    return Err(Error::Message(e.to_string()));
                }
            }
            Err(e) => {
                if let Err(e) = tx.rollback().await {
                    log::error!("[SQLITE] rollback file_list batch add error: {}", e);
                }
                return Err(e.into());
            }
        };
        if need_single_insert {
            if let Err(e) = tx.rollback().await {
                log::error!("[SQLITE] rollback file_list batch add error: {}", e);
                return Err(e.into());
            }
            for item in files {
                if let Err(e) = add(client, &item.key, &item.meta).await {
                    log::error!("[SQLITE] single insert file_list add error: {}", e);
                    return Err(e);
                }
            }
        } else if let Err(e) = tx.commit().await {
            log::error!("[SQLITE] commit file_list batch add error: {}", e);
            return Err(e.into());
        }
    }
    Ok(())
}

pub async fn batch_remove(client: &Pool<Sqlite>, files: &[String]) -> Result<()> {
    let chunks = files.chunks(100);
    for files in chunks {
        let mut tx = client.begin().await?;
        for file in files {
            let (stream_key, date_key, file_name) = super::parse_file_key_columns(file)?;
            let rows_affected = match sqlx::query(
                r#"DELETE FROM file_list WHERE stream = $1 AND date = $2 AND file = $3;"#,
            )
            .bind(stream_key)
            .bind(date_key)
            .bind(file_name)
            .execute(&mut *tx)
            .await
            {
                Ok(ret) => ret.rows_affected(),
                Err(e) => {
                    if let Err(e) = tx.rollback().await {
                        log::error!("[SQLITE] rollback file_list batch remove error: {}", e);
                    }
                    return Err(e.into());
                }
            };
            if CONFIG.common.print_key_event {
                log::info!(
                    "[SQLITE] delete file from file_list: {}, affected: {}",
                    file,
                    rows_affected
                );
            }
        }
        if let Err(e) = tx.commit().await {
            log::error!("[SQLITE] commit file_list batch remove error: {}", e);
            return Err(e.into());
        }
    }
    Ok(())
}

pub async fn batch_add_deleted(
    client: &Pool<Sqlite>,
    org_id: &str,
    created_at: i64,
    files: &[String],
) -> Result<()> {
    let chunks = files.chunks(100);
    for files in chunks {
        let mut tx = client.begin().await?;
        let mut query_builder: QueryBuilder<Sqlite> = QueryBuilder::new(
            "INSERT INTO file_list_deleted (org, stream, date, file, created_at)",
        );
        query_builder.push_values(files, |mut b, item: &String| {
            let (stream_key, date_key, file_name) =
                super::parse_file_key_columns(item).expect("parse file key failed");
            b.push_bind(org_id)
                .push_bind(stream_key)
                .push_bind(date_key)
                .push_bind(file_name)
                .push_bind(created_at);
        });
        if let Err(e) = query_builder.build().execute(&mut *tx).await {
            if let Err(e) = tx.rollback().await {
                log::error!("[SQLITE] rollback file_list_deleted batch add error: {}", e);
            }
            return Err(e.into());
        };
        if let Err(e) = tx.commit().await {
            log::error!("[SQLITE] commit file_list_deleted batch add error: {}", e);
            return Err(e.into());
        }
    }
    Ok(())
}

pub async fn batch_remove_deleted(client: &Pool<Sqlite>, files: &[String]) -> Result<()> {
    let chunks = files.chunks(100);
    for files in chunks {
        let mut tx = client.begin().await?;
        for file in files {
            let (stream_key, date_key, file_name) = super::parse_file_key_columns(file)?;
            let rows_affected = match sqlx::query(
                r#"DELETE FROM file_list_deleted WHERE stream = $1 AND date = $2 AND file = $3;"#,
            )
            .bind(stream_key)
            .bind(date_key)
            .bind(file_name)
            .execute(&mut *tx)
            .await
            {
                Ok(ret) => ret.rows_affected(),
                Err(e) => {
                    if let Err(e) = tx.rollback().await {
                        log::error!(
                            "[SQLITE] rollback file_list_deleted batch remove error: {}",
                            e
                        );
                    }
                    return Err(e.into());
                }
            };
            if CONFIG.common.print_key_event {
                log::info!(
                    "[SQLITE] delete file from file_list_deleted: {}, affected: {}",
                    file,
                    rows_affected
                );
            }
        }
        if let Err(e) = tx.commit().await {
            log::error!(
                "[SQLITE] commit file_list_deleted batch remove error: {}",
                e
            );
            return Err(e.into());
        }
    }
    Ok(())
}

pub async fn set_stream_stats(
    client: &Pool<Sqlite>,
    org_id: &str,
    streams: &[(String, StreamStats)],
) -> Result<()> {
    let old_stats = super::get_stream_stats(org_id, None, None).await?;
    let old_stats = old_stats.into_iter().collect::<HashMap<_, _>>();
    let mut new_streams = Vec::new();
    let mut update_streams = Vec::with_capacity(streams.len());
    for (stream_key, item) in streams {
        let mut stats = match old_stats.get(stream_key) {
            Some(s) => s.to_owned(),
            None => {
                new_streams.push(stream_key);
                StreamStats::default()
            }
        };
        stats.add_stream_stats(item);
        update_streams.push((stream_key, stats));
    }

    let mut tx = client.begin().await?;
    for stream_key in new_streams {
        let org_id = stream_key[..stream_key.find('/').unwrap()].to_string();
        if let Err(e) = sqlx::query(
            r#"
INSERT INTO stream_stats 
(org, stream, file_num, min_ts, max_ts, records, original_size, compressed_size)
VALUES ($1, $2, 0, 0, 0, 0, 0, 0);
            "#,
        )
        .bind(org_id)
        .bind(stream_key)
        .execute(&mut *tx)
        .await
        {
            if let Err(e) = tx.rollback().await {
                log::error!("[SQLITE] rollback insert stream stats error: {}", e);
            }
            return Err(e.into());
        }
    }
    if let Err(e) = tx.commit().await {
        log::error!("[SQLITE] commit set stream stats error: {}", e);
        return Err(e.into());
    }

    let mut tx = client.begin().await?;
    for (stream_key, stats) in update_streams {
        if let Err(e) = sqlx::query(
            r#"
UPDATE stream_stats 
SET file_num = $1, min_ts = $2, max_ts = $3, records = $4, original_size = $5, compressed_size = $6
WHERE stream = $7;
            "#,
        )
        .bind(stats.file_num)
        .bind(stats.doc_time_min)
        .bind(stats.doc_time_max)
        .bind(stats.doc_num)
        .bind(stats.storage_size as i64)
        .bind(stats.compressed_size as i64)
        .bind(stream_key)
        .execute(&mut *tx)
        .await
        {
            if let Err(e) = tx.rollback().await {
                log::error!("[SQLITE] rollback set stream stats error: {}", e);
            }
            return Err(e.into());
        }
    }
    if let Err(e) = tx.commit().await {
        log::error!("[SQLITE] commit set stream stats error: {}", e);
        return Err(e.into());
    }

    Ok(())
}

pub async fn reset_stream_stats_min_ts(
    client: &Pool<Sqlite>,
    stream: &str,
    min_ts: i64,
) -> Result<()> {
    sqlx::query(r#"UPDATE stream_stats SET min_ts = $1 WHERE stream = $2;"#)
        .bind(min_ts)
        .bind(stream)
        .execute(client)
        .await?;
    Ok(())
}

pub async fn reset_stream_stats(client: &Pool<Sqlite>) -> Result<()> {
    sqlx::query(r#"UPDATE stream_stats SET file_num = 0, min_ts = 0, max_ts = 0, records = 0, original_size = 0, compressed_size = 0;"#)
         .execute(client)
        .await?;
    Ok(())
}

pub async fn create_table(client: &Pool<Sqlite>) -> Result<()> {
    sqlx::query(
        r#"
CREATE TABLE IF NOT EXISTS file_list
(
    id      INTEGER not null primary key autoincrement,
    org     VARCHAR not null,
    stream  VARCHAR not null,
    date    VARCHAR not null,
    file    VARCHAR not null,
    deleted BOOLEAN default false not null,
    min_ts   BIGINT not null,
    max_ts   BIGINT not null,
    records  BIGINT not null,
    original_size   BIGINT not null,
    compressed_size BIGINT not null
);
        "#,
    )
    .execute(client)
    .await?;

    sqlx::query(
        r#"
CREATE TABLE IF NOT EXISTS file_list_deleted
(
    id        INTEGER not null primary key autoincrement,
    org       VARCHAR not null,
    stream    VARCHAR not null,
    date      VARCHAR not null,
    file      VARCHAR not null,
    created_at BIGINT not null
);
        "#,
    )
    .execute(client)
    .await?;

    sqlx::query(
        r#"
CREATE TABLE IF NOT EXISTS stream_stats
(
    id      INTEGER not null primary key autoincrement,
    org     VARCHAR not null,
    stream  VARCHAR not null,
    file_num BIGINT not null,
    min_ts   BIGINT not null,
    max_ts   BIGINT not null,
    records  BIGINT not null,
    original_size   BIGINT not null,
    compressed_size BIGINT not null
);
        "#,
    )
    .execute(client)
    .await?;

    Ok(())
}

pub async fn create_table_index(client: &Pool<Sqlite>) -> Result<()> {
    let sqls = vec![
        (
            "file_list", 
            "CREATE INDEX IF NOT EXISTS file_list_org_idx on file_list (org);"),
        (
            "file_list",
            "CREATE INDEX IF NOT EXISTS file_list_stream_ts_idx on file_list (stream, min_ts, max_ts);",
        ),
        // (
        //     "file_list",
        //     "CREATE UNIQUE INDEX IF NOT EXISTS file_list_stream_file_idx on file_list (stream, date, file);",
        // ),
        (
            "file_list_deleted",
            "CREATE INDEX IF NOT EXISTS file_list_deleted_stream_idx on file_list_deleted (stream);",
        ),
        (
            "file_list_deleted",
            "CREATE INDEX IF NOT EXISTS file_list_deleted_created_at_idx on file_list_deleted (org, created_at);",
        ),
        (
            "stream_stats",
            "CREATE INDEX IF NOT EXISTS stream_stats_org_idx on stream_stats (org);",
        ),
        (
            "stream_stats",
            "CREATE UNIQUE INDEX IF NOT EXISTS stream_stats_stream_idx on stream_stats (stream);",
        ),
    ];
    for (table, sql) in sqls {
        if let Err(e) = sqlx::query(sql).execute(client).await {
            log::error!("[SQLITE] create table {} index error: {}", table, e);
            return Err(e.into());
        }
    }

    // create UNIQUE index for file_list
    let unique_index_sql = r#"CREATE UNIQUE INDEX IF NOT EXISTS file_list_stream_file_idx on file_list (stream, date, file);"#;
    if let Err(e) = sqlx::query(unique_index_sql).execute(client).await {
        if e.to_string().contains("UNIQUE constraint failed") {
            // delete duplicate records
            let ret = sqlx::query(
                r#"SELECT stream, date, file, min(id) as id FROM file_list GROUP BY stream, date, file HAVING COUNT(*) > 1;"#,
            ).fetch_all(client).await?;
            for r in ret {
                let stream = r.get::<String, &str>("stream");
                let date = r.get::<String, &str>("date");
                let file = r.get::<String, &str>("file");
                let id = r.get::<i64, &str>("id");
                if CONFIG.common.print_key_event {
                    log::info!(
                        "[SQLITE] delete duplicate file: {}/{}/{}",
                        stream,
                        date,
                        file
                    );
                }
                sqlx::query(
                    r#"DELETE FROM file_list WHERE id != $1 AND stream = $2 AND date = $3 AND file = $4;"#,
                ).bind(id).bind(stream).bind(date).bind(file).execute(client).await?;
            }
            // create index again
            sqlx::query(unique_index_sql).execute(client).await?;
        } else {
            return Err(e.into());
        }
    }

    // delete trigger for old version
    // compitable for old version <= 0.6.4
    sqlx::query(r#"DROP TRIGGER IF EXISTS update_stream_stats_delete;"#)
        .execute(client)
        .await?;

    Ok(())
}

/// set file list inited flag
pub fn set_initialised() {
    FILE_LIST_INITED.store(true, std::sync::atomic::Ordering::Relaxed);
}
