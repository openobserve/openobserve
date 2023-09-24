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
use std::sync::Arc;
use tokio::sync::mpsc;

use crate::common::{
    infra::{
        config::CONFIG,
        db::sqlite::CLIENT,
        errors::{Error, Result},
    },
    meta::{
        common::{FileKey, FileMeta},
        stream::{PartitionTimeLevel, StreamStats},
        StreamType,
    },
};

pub struct SqliteFileList {
    tx: Arc<mpsc::Sender<Event>>,
}

enum Event {
    FileList(EventFileList),
    StreamStats(EventStreamStats),
    CreateTable,
    CreateTableIndex,
}

enum EventFileList {
    Add(Vec<FileKey>),
    Remove(Vec<String>),
}

enum EventStreamStats {
    Set(String, Vec<(String, StreamStats)>),
    ResetMinTS(String, i64),
}

impl SqliteFileList {
    pub fn new() -> Self {
        let (tx, mut rx) = mpsc::channel::<Event>(10000);
        let client = CLIENT.clone();
        tokio::task::spawn(async move {
            while let Some(event) = rx.recv().await {
                match event {
                    Event::FileList(EventFileList::Add(files)) => {
                        if let Err(e) = batch_add(&client, &files).await {
                            log::error!("[SQLITE] batch add file list error: {}", e);
                        }
                    }
                    Event::FileList(EventFileList::Remove(files)) => {
                        if let Err(e) = batch_remove(&client, &files).await {
                            log::error!("[SQLITE] batch remove file list error: {}", e);
                        }
                    }
                    Event::StreamStats(EventStreamStats::Set(org_id, streams)) => {
                        if let Err(e) = set_stream_stats(&client, &org_id, &streams).await {
                            log::error!("[SQLITE] set stream stats error: {}", e);
                        }
                    }
                    Event::StreamStats(EventStreamStats::ResetMinTS(stream, min_ts)) => {
                        if let Err(e) = reset_stream_stats_min_ts(&client, &stream, min_ts).await {
                            log::error!("[SQLITE] reset stream stats min_ts error: {}", e);
                        }
                    }
                    Event::CreateTable => {
                        if let Err(e) = create_table_inner(&client).await {
                            log::error!("[SQLITE] create table error: {}", e);
                        }
                    }
                    Event::CreateTableIndex => {
                        if let Err(e) = create_table_index_inner(&client).await {
                            log::error!("[SQLITE] create table index error: {}", e);
                        }
                    }
                }
            }
            log::info!("[SQLITE] file list event loop exit");
        });
        Self { tx: Arc::new(tx) }
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
        let tx = self.tx.clone();
        tx.send(Event::CreateTable)
            .await
            .map_err(|e| Error::Message(e.to_string()))?;
        Ok(())
    }
    async fn create_table_index(&self) -> Result<()> {
        let tx = self.tx.clone();
        tx.send(Event::CreateTableIndex)
            .await
            .map_err(|e| Error::Message(e.to_string()))?;
        Ok(())
    }
    async fn add(&self, file: &str, meta: &FileMeta) -> Result<()> {
        let tx = self.tx.clone();
        tx.send(Event::FileList(EventFileList::Add(vec![FileKey::new(
            file,
            meta.to_owned(),
            false,
        )])))
        .await
        .map_err(|e| Error::Message(e.to_string()))?;
        Ok(())
    }

    async fn remove(&self, file: &str) -> Result<()> {
        let tx = self.tx.clone();
        tx.send(Event::FileList(EventFileList::Remove(vec![
            file.to_string()
        ])))
        .await
        .map_err(|e| Error::Message(e.to_string()))?;
        Ok(())
    }

    async fn batch_add(&self, files: &[FileKey]) -> Result<()> {
        let tx = self.tx.clone();
        tx.send(Event::FileList(EventFileList::Add(files.to_vec())))
            .await
            .map_err(|e| Error::Message(e.to_string()))?;
        Ok(())
    }

    async fn batch_remove(&self, files: &[String]) -> Result<()> {
        let tx = self.tx.clone();
        tx.send(Event::FileList(EventFileList::Remove(files.to_vec())))
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

    async fn get_max_pk_value(&self) -> Result<i64> {
        let pool = CLIENT.clone();
        let ret: i64 = sqlx::query_scalar(r#"SELECT MAX(id) AS id FROM file_list;"#)
            .fetch_one(&pool)
            .await?;
        Ok(ret)
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
        let tx = self.tx.clone();
        tx.send(Event::StreamStats(EventStreamStats::Set(
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
        let tx = self.tx.clone();
        tx.send(Event::StreamStats(EventStreamStats::ResetMinTS(
            stream.to_string(),
            min_ts,
        )))
        .await
        .map_err(|e| Error::Message(e.to_string()))?;
        Ok(())
    }

    async fn reset_stream_stats(&self) -> Result<()> {
        let pool = CLIENT.clone();
        sqlx::query(r#"UPDATE stream_stats SET file_num = 0, min_ts = 0, max_ts = 0, records = 0, original_size = 0, compressed_size = 0;"#)
             .execute(&pool)
            .await?;
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

async fn batch_add(client: &Pool<Sqlite>, files: &[FileKey]) -> Result<()> {
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
        match query_builder.build().execute(&mut *tx).await {
            Ok(_) => {}
            Err(sqlx::Error::Database(e)) => {
                if e.is_unique_violation() {
                    // batch insert got unique error, convert to single insert
                    for file in files {
                        super::add(&file.key, &file.meta).await?;
                    }
                } else {
                    return Err(Error::Message(e.to_string()));
                }
            }
            Err(e) => return Err(e.into()),
        }
        if let Err(e) = tx.commit().await {
            log::error!("[SQLITE] commit file_list add error: {}", e);
        }
    }
    Ok(())
}

async fn batch_remove(client: &Pool<Sqlite>, files: &[String]) -> Result<()> {
    let chunks = files.chunks(100);
    for files in chunks {
        let mut tx = client.begin().await?;
        for file in files {
            let (stream_key, date_key, file_name) = super::parse_file_key_columns(file)?;
            let ret = sqlx::query(
                r#"DELETE FROM file_list WHERE stream = $1 AND date = $2 AND file = $3;"#,
            )
            .bind(stream_key)
            .bind(date_key)
            .bind(file_name)
            .execute(&mut *tx)
            .await?;
            if CONFIG.common.print_key_event {
                log::info!(
                    "[SQLITE] delete file: {}, affected: {}",
                    file,
                    ret.rows_affected()
                );
            }
        }
        if let Err(e) = tx.commit().await {
            log::error!("[SQLITE] commit file_list delete error: {}", e);
        }
    }
    Ok(())
}

async fn set_stream_stats(
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
            log::error!(
                "[SQLITE] insert stream stats error: {}, stream: {}",
                e,
                stream_key
            );
        }
    }
    if let Err(e) = tx.commit().await {
        log::error!("[SQLITE] commit stream stats error: {}", e);
    }

    let mut tx = client.begin().await?;
    for (stream_key, stats) in update_streams {
        sqlx::query(
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
        .await?;
    }
    if let Err(e) = tx.commit().await {
        log::error!("[SQLITE] commit stream stats error: {}", e);
    }

    Ok(())
}

async fn reset_stream_stats_min_ts(client: &Pool<Sqlite>, stream: &str, min_ts: i64) -> Result<()> {
    sqlx::query(r#"UPDATE stream_stats SET min_ts = $1 WHERE stream = $2;"#)
        .bind(min_ts)
        .bind(stream)
        .execute(client)
        .await?;
    Ok(())
}

async fn create_table_inner(client: &Pool<Sqlite>) -> Result<()> {
    sqlx::query(
        r#"
CREATE TABLE IF NOT EXISTS file_list
(
    id      INTEGER  not null primary key autoincrement,
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
CREATE TABLE IF NOT EXISTS stream_stats
(
    id      INTEGER  not null primary key autoincrement,
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

async fn create_table_index_inner(client: &Pool<Sqlite>) -> Result<()> {
    // create index for file_list
    sqlx::query(
        r#"
CREATE INDEX IF NOT EXISTS file_list_org_idx on file_list (org);
CREATE INDEX IF NOT EXISTS file_list_stream_idx on file_list (stream);
CREATE INDEX IF NOT EXISTS file_list_stream_ts_idx on file_list (stream, min_ts, max_ts);
CREATE UNIQUE INDEX IF NOT EXISTS file_list_stream_file_idx on file_list (stream, date, file);
        "#,
    )
    .execute(client)
    .await?;

    // create index for stream_stats
    sqlx::query(
        r#"
CREATE INDEX IF NOT EXISTS stream_stats_org_idx on stream_stats (org);
CREATE UNIQUE INDEX IF NOT EXISTS stream_stats_stream_idx on stream_stats (stream);
        "#,
    )
    .execute(client)
    .await?;

    // create trigger
    sqlx::query(
    r#"
CREATE TRIGGER IF NOT EXISTS update_stream_stats_delete AFTER DELETE ON file_list
    BEGIN
        UPDATE stream_stats SET file_num = file_num - 1, records = records - OLD.records, original_size = original_size - OLD.original_size, compressed_size = compressed_size - OLD.compressed_size WHERE stream = OLD.stream;
    END;
        "#,
    )
    .execute(client)
    .await?;

    Ok(())
}
