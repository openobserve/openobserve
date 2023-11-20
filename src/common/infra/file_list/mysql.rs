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
use sqlx::{MySql, QueryBuilder, Row};

use crate::common::{
    infra::{
        db::mysql::CLIENT,
        errors::{Error, Result},
    },
    meta::{
        common::{FileKey, FileMeta},
        stream::{PartitionTimeLevel, StreamStats},
        StreamType,
    },
};

pub struct MysqlFileList {}

impl MysqlFileList {
    pub fn new() -> Self {
        Self {}
    }
}

impl Default for MysqlFileList {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl super::FileList for MysqlFileList {
    async fn create_table(&self) -> Result<()> {
        create_table().await
    }

    async fn create_table_index(&self) -> Result<()> {
        create_table_index().await
    }

    async fn set_initialised(&self) -> Result<()> {
        Ok(())
    }

    async fn get_initialised(&self) -> Result<bool> {
        Ok(true)
    }

    async fn add(&self, file: &str, meta: &FileMeta) -> Result<()> {
        let pool = CLIENT.clone();
        let (stream_key, date_key, file_name) = super::parse_file_key_columns(file)?;
        let org_id = stream_key[..stream_key.find('/').unwrap()].to_string();
        match  sqlx::query(
            r#"
INSERT IGNORE INTO file_list (org, stream, date, file, deleted, min_ts, max_ts, records, original_size, compressed_size)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
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
        .execute(&pool)
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

    async fn remove(&self, file: &str) -> Result<()> {
        let pool = CLIENT.clone();
        let (stream_key, date_key, file_name) = super::parse_file_key_columns(file)?;
        sqlx::query(r#"DELETE FROM file_list WHERE stream = ? AND date = ? AND file = ?;"#)
            .bind(stream_key)
            .bind(date_key)
            .bind(file_name)
            .execute(&pool)
            .await?;
        Ok(())
    }

    async fn batch_add(&self, files: &[FileKey]) -> Result<()> {
        if files.is_empty() {
            return Ok(());
        }
        let pool = CLIENT.clone();
        let chunks = files.chunks(100);
        for files in chunks {
            let mut tx = pool.begin().await?;
            let mut query_builder: QueryBuilder<MySql> = QueryBuilder::new("INSERT INTO file_list (org, stream, date, file, deleted, min_ts, max_ts, records, original_size, compressed_size)");
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
                            log::error!("[MYSQL] rollback file_list batch add error: {}", e);
                        }
                        return Err(Error::Message(e.to_string()));
                    }
                }
                Err(e) => {
                    if let Err(e) = tx.rollback().await {
                        log::error!("[MYSQL] rollback file_list batch add error: {}", e);
                    }
                    return Err(e.into());
                }
            };
            if need_single_insert {
                if let Err(e) = tx.rollback().await {
                    log::error!("[MYSQL] rollback file_list batch add error: {}", e);
                    return Err(e.into());
                }
                for item in files {
                    if let Err(e) = self.add(&item.key, &item.meta).await {
                        log::error!("[MYSQL] single insert file_list add error: {}", e);
                        return Err(e);
                    }
                }
            } else if let Err(e) = tx.commit().await {
                log::error!("[MYSQL] commit file_list batch add error: {}", e);
                return Err(e.into());
            }
        }
        Ok(())
    }

    async fn batch_remove(&self, files: &[String]) -> Result<()> {
        if files.is_empty() {
            return Ok(());
        }
        let pool = CLIENT.clone();
        let chunks = files.chunks(100);
        for files in chunks {
            let mut tx = pool.begin().await?;
            for file in files {
                let (stream_key, date_key, file_name) = super::parse_file_key_columns(file)?;
                let sql = format!("DELETE FROM file_list WHERE stream = '{stream_key}' AND date = '{date_key}' AND file = '{file_name}';");
                match sqlx::query(&sql).execute(&mut *tx).await {
                    Ok(_) => {}
                    Err(e) => {
                        if let Err(e) = tx.rollback().await {
                            log::error!("[MYSQL] rollback batch remove error: {}", e);
                        }
                        return Err(e.into());
                    }
                }
            }
            if let Err(e) = tx.commit().await {
                log::error!("[MYSQL] commit file_list batch remove error: {}", e);
                return Err(e.into());
            }
        }
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
        let pool = CLIENT.clone();
        let chunks = files.chunks(100);
        for files in chunks {
            let mut tx = pool.begin().await?;
            let mut query_builder: QueryBuilder<MySql> = QueryBuilder::new(
                "INSERT INTO file_list_deleted (org, stream, date, file, created_at)",
            );
            query_builder.push_values(files, |mut b, item| {
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
                    log::error!("[MYSQL] rollback file_list_deleted batch add error: {}", e);
                }
                return Err(e.into());
            };
            if let Err(e) = tx.commit().await {
                log::error!("[MYSQL] commit file_list_deleted batch add error: {}", e);
                return Err(e.into());
            }
        }
        Ok(())
    }

    async fn batch_remove_deleted(&self, files: &[String]) -> Result<()> {
        if files.is_empty() {
            return Ok(());
        }
        let pool = CLIENT.clone();
        let chunks = files.chunks(100);
        for files in chunks {
            let mut tx = pool.begin().await?;
            for file in files {
                let (stream_key, date_key, file_name) = super::parse_file_key_columns(file)?;
                let sql = format!("DELETE FROM file_list_deleted WHERE stream = '{stream_key}' AND date = '{date_key}' AND file = '{file_name}';");
                match sqlx::query(&sql).execute(&mut *tx).await {
                    Ok(_) => {}
                    Err(e) => {
                        if let Err(e) = tx.rollback().await {
                            log::error!(
                                "[MYSQL] rollback file_list_deleted batch remove error: {}",
                                e
                            );
                        }
                        return Err(e.into());
                    }
                }
            }
            if let Err(e) = tx.commit().await {
                log::error!("[MYSQL] commit file_list_deleted batch remove error: {}", e);
                return Err(e.into());
            }
        }
        Ok(())
    }

    async fn get(&self, file: &str) -> Result<FileMeta> {
        let pool = CLIENT.clone();
        let (stream_key, date_key, file_name) = super::parse_file_key_columns(file)?;
        let ret = sqlx::query_as::<_, super::FileRecord>(
            r#"
SELECT stream, date, file, deleted, min_ts, max_ts, records, original_size, compressed_size
    FROM file_list WHERE stream = ? AND date = ? AND file = ?;
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
    FROM file_list WHERE stream = ? AND date = ? AND file = ?;
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
    WHERE stream = ? AND min_ts <= ? AND max_ts >= ?;
            "#,
        )
        .bind(stream_key)
        .bind(time_end)
        .bind(time_start)
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

    async fn query_deleted(&self, org_id: &str, time_max: i64) -> Result<Vec<String>> {
        if time_max == 0 {
            return Ok(Vec::new());
        }
        let pool = CLIENT.clone();
        let ret = sqlx::query_as::<_, super::FileDeletedRecord>(
            r#"SELECT stream, date, file FROM file_list_deleted WHERE org = ? AND created_at < ?;"#,
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
SELECT stream, MIN(min_ts) AS min_ts, MAX(max_ts) AS max_ts, CAST(COUNT(*) AS SIGNED) AS file_num, 
    CAST(SUM(records) AS SIGNED) AS records, CAST(SUM(original_size) AS SIGNED) AS original_size, CAST(SUM(compressed_size) AS SIGNED) AS compressed_size
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
        let pool = CLIENT.clone();
        let old_stats = self.get_stream_stats(org_id, None, None).await?;
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

        let mut tx = pool.begin().await?;
        for stream_key in new_streams {
            let org_id = stream_key[..stream_key.find('/').unwrap()].to_string();
            if let Err(e) = sqlx::query(
                r#"
INSERT INTO stream_stats 
    (org, stream, file_num, min_ts, max_ts, records, original_size, compressed_size)
    VALUES (?, ?, 0, 0, 0, 0, 0, 0);
                "#,
            )
            .bind(org_id)
            .bind(stream_key)
            .execute(&mut *tx)
            .await
            {
                if let Err(e) = tx.rollback().await {
                    log::error!("[MYSQL] rollback insert stream stats error: {}", e);
                }
                return Err(e.into());
            }
        }
        if let Err(e) = tx.commit().await {
            log::error!("[MYSQL] commit set stream stats error: {}", e);
            return Err(e.into());
        }

        let mut tx = pool.begin().await?;
        for (stream_key, stats) in update_streams {
            if let Err(e) = sqlx::query(
                r#"
UPDATE stream_stats 
    SET file_num = ?, min_ts = ?, max_ts = ?, records = ?, original_size = ?, compressed_size = ?
    WHERE stream = ?;
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
                    log::error!("[MYSQL] rollback set stream stats error: {}", e);
                }
                return Err(e.into());
            }
        }
        if let Err(e) = tx.commit().await {
            log::error!("[MYSQL] commit set stream stats error: {}", e);
            return Err(e.into());
        }

        Ok(())
    }

    async fn reset_stream_stats(&self) -> Result<()> {
        let pool = CLIENT.clone();
        sqlx::query(r#"UPDATE stream_stats SET file_num = 0, min_ts = 0, max_ts = 0, records = 0, original_size = 0, compressed_size = 0;"#)
             .execute(&pool)
            .await?;
        Ok(())
    }

    async fn reset_stream_stats_min_ts(
        &self,
        _org_id: &str,
        stream: &str,
        min_ts: i64,
    ) -> Result<()> {
        let pool = CLIENT.clone();
        sqlx::query(r#"UPDATE stream_stats SET min_ts = ? WHERE stream = ?;"#)
            .bind(min_ts)
            .bind(stream)
            .execute(&pool)
            .await?;
        Ok(())
    }

    async fn len(&self) -> usize {
        let pool = CLIENT.clone();
        let ret = match sqlx::query(r#"SELECT CAST(COUNT(*) AS SIGNED) AS num FROM file_list;"#)
            .fetch_one(&pool)
            .await
        {
            Ok(r) => r,
            Err(e) => {
                log::error!("[MYSQL] get file list len error: {}", e);
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

pub async fn create_table() -> Result<()> {
    let pool = CLIENT.clone();
    sqlx::query(
        r#"
CREATE TABLE IF NOT EXISTS file_list
(
    id       BIGINT not null primary key AUTO_INCREMENT,
    org      VARCHAR(100) not null,
    stream   VARCHAR(256) not null,
    date     VARCHAR(16)  not null,
    file     VARCHAR(256) not null,
    deleted  BOOLEAN default false not null,
    min_ts   BIGINT not null,
    max_ts   BIGINT not null,
    records  BIGINT not null,
    original_size   BIGINT not null,
    compressed_size BIGINT not null
);
        "#,
    )
    .execute(&pool)
    .await?;

    sqlx::query(
        r#"
CREATE TABLE IF NOT EXISTS file_list_deleted
(
    id       BIGINT not null primary key AUTO_INCREMENT,
    org      VARCHAR(100) not null,
    stream   VARCHAR(256) not null,
    date     VARCHAR(16)  not null,
    file     VARCHAR(256) not null,
    created_at BIGINT not null
);
        "#,
    )
    .execute(&pool)
    .await?;

    sqlx::query(
        r#"
CREATE TABLE IF NOT EXISTS stream_stats
(
    id       BIGINT not null primary key AUTO_INCREMENT,
    org      VARCHAR(100) not null,
    stream   VARCHAR(256) not null,
    file_num BIGINT not null,
    min_ts   BIGINT not null,
    max_ts   BIGINT not null,
    records  BIGINT not null,
    original_size   BIGINT not null,
    compressed_size BIGINT not null
);
        "#,
    )
    .execute(&pool)
    .await?;

    Ok(())
}

pub async fn create_table_index() -> Result<()> {
    let pool = CLIENT.clone();
    let sqls = vec![
        (
            "file_list",
            "CREATE INDEX file_list_org_idx on file_list (org);",
        ),
        (
            "file_list",
            "CREATE INDEX file_list_stream_ts_idx on file_list (stream, min_ts, max_ts);",
        ),
        (
            "file_list",
            "CREATE UNIQUE INDEX file_list_stream_file_idx on file_list (stream, date, file);",
        ),
        (
            "file_list_deleted",
            "CREATE INDEX file_list_deleted_stream_idx on file_list_deleted (stream);",
        ),
        (
            "file_list_deleted",
            "CREATE INDEX file_list_deleted_created_at_idx on file_list_deleted (org, created_at);",
        ),
        (
            "stream_stats",
            "CREATE INDEX stream_stats_org_idx on stream_stats (org);",
        ),
        (
            "stream_stats",
            "CREATE UNIQUE INDEX stream_stats_stream_idx on stream_stats (stream);",
        ),
    ];
    for (table, sql) in sqls {
        if let Err(e) = sqlx::query(sql).execute(&pool).await {
            if let sqlx::Error::Database(e) = &e {
                if let Some(code) = e.code() {
                    if code == "42000" {
                        // index already exists
                        continue;
                    }
                }
            }
            log::error!("[MYSQL] create table {} index error: {}", table, e);
            return Err(e.into());
        }
    }
    Ok(())
}
