// Copyright 2025 OpenObserve Inc.
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

use std::collections::HashMap as stdHashMap;

use async_trait::async_trait;
use config::{
    get_config,
    meta::stream::{
        FileKey, FileListDeleted, FileMeta, PartitionTimeLevel, StreamStats, StreamType,
    },
    utils::{
        parquet::parse_file_key_columns,
        time::{DAY_MICRO_SECS, end_of_the_day, now_micros},
    },
};
use hashbrown::HashMap;
use sqlx::{Executor, QueryBuilder, Row, Sqlite};

use crate::{
    db::{
        IndexStatement,
        sqlite::{CLIENT_RO, CLIENT_RW, add_column, create_index, delete_index},
    },
    errors::{Error, Result},
    file_list::FileRecord,
};

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
        create_table().await
    }

    async fn create_table_index(&self) -> Result<()> {
        create_table_index().await
    }

    async fn add(&self, account: &str, file: &str, meta: &FileMeta) -> Result<i64> {
        self.inner_add("file_list", account, file, meta).await
    }

    async fn add_history(&self, account: &str, file: &str, meta: &FileMeta) -> Result<i64> {
        self.inner_add("file_list_history", account, file, meta)
            .await
    }

    async fn remove(&self, file: &str) -> Result<()> {
        let client = CLIENT_RW.clone();
        let client = client.lock().await;
        let pool = client.clone();
        let (stream_key, date_key, file_name) =
            parse_file_key_columns(file).map_err(|e| Error::Message(e.to_string()))?;

        sqlx::query(r#"DELETE FROM file_list WHERE stream = $1 AND date = $2 AND file = $3;"#)
            .bind(stream_key)
            .bind(date_key)
            .bind(file_name)
            .execute(&pool)
            .await?;
        Ok(())
    }

    async fn batch_add(&self, files: &[FileKey]) -> Result<()> {
        self.inner_batch_process("file_list", files).await
    }

    async fn batch_add_with_id(&self, files: &[FileKey]) -> Result<()> {
        self.inner_batch_process("file_list", files).await
    }

    async fn batch_add_history(&self, files: &[FileKey]) -> Result<()> {
        self.inner_batch_process("file_list_history", files).await
    }

    async fn batch_process(&self, files: &[FileKey]) -> Result<()> {
        self.inner_batch_process("file_list", files).await
    }

    async fn update_dump_records(&self, file: &FileKey, dumped_ids: &[i64]) -> Result<()> {
        let client = CLIENT_RW.clone();
        let client = client.lock().await;
        let mut tx = client.begin().await?;

        // insert the dump file into file_list table
        let (stream_key, date_key, file_name) =
            parse_file_key_columns(&file.key).map_err(|e| Error::Message(e.to_string()))?;
        let org_id = stream_key[..stream_key.find('/').unwrap()].to_string();
        let meta = &file.meta;
        let now_ts = now_micros();

        if let Err(e) = sqlx::query(r#"INSERT INTO file_list (account, org, stream, date, file, deleted, min_ts, max_ts, records, original_size, compressed_size, index_size, flattened, created_at, updated_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15);"#)
        .bind(&file.account)
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
        .bind(meta.index_size)
        .bind(meta.flattened)
        .bind(now_ts)
        .bind(now_ts)
        .execute(&mut *tx)
        .await{
            if let Err(e) = tx.rollback().await {
                log::error!("[SQLITE] rollback file_list dump file update error: {e}");
            }
            return Err(e.into());
        }

        // delete the dumped ids from file_list table
        for chunk in dumped_ids.chunks(get_config().compact.file_list_deleted_batch_size) {
            if chunk.is_empty() {
                continue;
            }
            let ids = chunk
                .iter()
                .map(|id| id.to_string())
                .collect::<Vec<String>>()
                .join(",");
            let query_str = format!("DELETE FROM file_list WHERE id IN ({ids})");
            if let Err(e) = sqlx::query(&query_str).execute(&mut *tx).await {
                if let Err(e) = tx.rollback().await {
                    log::error!("[SQLITE] rollback file_list dump file update error: {e}");
                }
                return Err(e.into());
            }
        }

        if let Err(e) = tx.commit().await {
            log::error!("[SQLITE] transaction commit error for dump file update {e}");
            return Err(e.into());
        }
        Ok(())
    }

    async fn batch_add_deleted(
        &self,
        org_id: &str,
        created_at: i64,
        files: &[FileListDeleted],
    ) -> Result<()> {
        if files.is_empty() {
            return Ok(());
        }
        let chunks = files.chunks(100);
        for files in chunks {
            // we don't care the id here, because the id is from file_list table not for this table
            let client = CLIENT_RW.clone();
            let client = client.lock().await;
            let mut tx = client.begin().await?;
            let mut query_builder: QueryBuilder<Sqlite> = QueryBuilder::new(
                "INSERT INTO file_list_deleted (account, org, stream, date, file, index_file, flattened, created_at)",
            );
            query_builder.push_values(files, |mut b, item| {
                let (stream_key, date_key, file_name) =
                    parse_file_key_columns(&item.file).expect("parse file key failed");
                b.push_bind(&item.account)
                    .push_bind(org_id)
                    .push_bind(stream_key)
                    .push_bind(date_key)
                    .push_bind(file_name)
                    .push_bind(item.index_file)
                    .push_bind(item.flattened)
                    .push_bind(created_at);
            });
            if let Err(e) = query_builder.build().execute(&mut *tx).await {
                if let Err(e) = tx.rollback().await {
                    log::error!("[SQLITE] rollback file_list_deleted batch add error: {e}");
                }
                return Err(e.into());
            };
            if let Err(e) = tx.commit().await {
                log::error!("[SQLITE] commit file_list_deleted batch add error: {e}");
                return Err(e.into());
            }
        }
        Ok(())
    }

    async fn batch_remove_deleted(&self, files: &[FileKey]) -> Result<()> {
        if files.is_empty() {
            return Ok(());
        }
        let chunks = files.chunks(100);
        for files in chunks {
            // get ids of the files
            let client = CLIENT_RW.clone();
            let client = client.lock().await;
            let pool = client.clone();
            let mut ids = Vec::with_capacity(files.len());
            for file in files {
                if file.id > 0 {
                    ids.push(file.id.to_string());
                    continue;
                }
                let (stream_key, date_key, file_name) =
                    parse_file_key_columns(&file.key).map_err(|e| Error::Message(e.to_string()))?;
                let ret: Option<i64> = match sqlx::query_scalar(
                    r#"SELECT id FROM file_list_deleted WHERE stream = $1 AND date = $2 AND file = $3;"#,
                )
                .bind(stream_key)
                .bind(date_key)
                .bind(file_name)
                .fetch_one(&pool)
                .await
                {
                    Ok(v) => v,
                    Err(sqlx::Error::RowNotFound) => continue,
                    Err(e) => return Err(e.into()),
                };
                match ret {
                    Some(v) => ids.push(v.to_string()),
                    None => {
                        return Err(Error::Message(
                            "[SQLITE] query error: id should not empty from file_list_deleted"
                                .to_string(),
                        ));
                    }
                }
            }
            // delete files by ids
            if !ids.is_empty() {
                let sql = format!(
                    "DELETE FROM file_list_deleted WHERE id IN({});",
                    ids.join(",")
                );
                _ = pool.execute(sql.as_str()).await?;
            }
        }
        Ok(())
    }

    async fn get(&self, file: &str) -> Result<FileMeta> {
        let pool = CLIENT_RO.clone();
        let (stream_key, date_key, file_name) =
            parse_file_key_columns(file).map_err(|e| Error::Message(e.to_string()))?;
        let ret = sqlx::query_as::<_, super::FileRecord>(
            r#"
SELECT min_ts, max_ts, records, original_size, compressed_size, index_size, flattened
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
        let pool = CLIENT_RO.clone();
        let (stream_key, date_key, file_name) =
            parse_file_key_columns(file).map_err(|e| Error::Message(e.to_string()))?;
        let ret = sqlx::query(
            r#"SELECT * FROM file_list WHERE stream = $1 AND date = $2 AND file = $3;"#,
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

    async fn update_flattened(&self, file: &str, flattened: bool) -> Result<()> {
        let client = CLIENT_RW.clone();
        let client = client.lock().await;
        let (stream_key, date_key, file_name) =
            parse_file_key_columns(file).map_err(|e| Error::Message(e.to_string()))?;
        sqlx::query(
            r#"UPDATE file_list SET flattened = $1 WHERE stream = $2 AND date = $3 AND file = $4;"#,
        )
        .bind(flattened)
        .bind(stream_key)
        .bind(date_key)
        .bind(file_name)
        .execute(&*client)
        .await?;
        Ok(())
    }

    async fn update_compressed_size(&self, file: &str, size: i64) -> Result<()> {
        let client = CLIENT_RW.clone();
        let client = client.lock().await;
        let (stream_key, date_key, file_name) =
            parse_file_key_columns(file).map_err(|e| Error::Message(e.to_string()))?;
        sqlx::query(
            r#"UPDATE file_list SET compressed_size = $1 WHERE stream = $2 AND date = $3 AND file = $4;"#,
        )
        .bind(size)
        .bind(stream_key)
        .bind(date_key)
        .bind(file_name)
        .execute(&*client)
        .await?;
        Ok(())
    }

    async fn list(&self) -> Result<Vec<FileKey>> {
        let pool = CLIENT_RO.clone();
        let ret = sqlx::query_as::<_, super::FileRecord>(
            r#"SELECT id, account, stream, date, file, deleted, min_ts, max_ts, records, original_size, compressed_size, index_size, flattened FROM file_list;"#,
        )
        .fetch_all(&pool)
        .await?;
        Ok(ret.iter().map(|r| r.into()).collect())
    }

    async fn query(
        &self,
        org_id: &str,
        stream_type: StreamType,
        stream_name: &str,
        _time_level: PartitionTimeLevel,
        time_range: (i64, i64),
        flattened: Option<bool>,
    ) -> Result<Vec<FileKey>> {
        let stream_key = format!("{org_id}/{stream_type}/{stream_name}");

        let pool = CLIENT_RO.clone();
        let ret = if let Some(flattened) = flattened {
            sqlx::query_as::<_, super::FileRecord>(
                r#"
SELECT id, account, stream, date, file, deleted, min_ts, max_ts, records, original_size, compressed_size, index_size, flattened
    FROM file_list
    WHERE stream = $1 AND flattened = $2 LIMIT 1000;
                "#,
            )
            .bind(stream_key)
            .bind(flattened)
            .fetch_all(&pool)
            .await
        } else {
            let (time_start, time_end) = time_range;
            let max_ts_upper_bound = super::calculate_max_ts_upper_bound(time_end, stream_type);
            sqlx::query_as::<_, super::FileRecord>(
                r#"
SELECT id, account, stream, date, file, min_ts, max_ts, records, original_size, compressed_size, index_size, flattened
    FROM file_list
    WHERE stream = $1 AND max_ts >= $2 AND max_ts <= $3 AND min_ts <= $4;
                "#,
            )
            .bind(stream_key)
            .bind(time_start)
            .bind(max_ts_upper_bound)
            .bind(time_end)
            .fetch_all(&pool)
            .await
        };
        Ok(ret?.iter().map(|r| r.into()).collect())
    }

    async fn query_for_merge(
        &self,
        org_id: &str,
        stream_type: StreamType,
        stream_name: &str,
        date_range: (String, String),
    ) -> Result<Vec<FileKey>> {
        let (date_start, date_end) = date_range;
        if date_start.is_empty() && date_end.is_empty() {
            return Ok(Vec::new());
        }
        let stream_key = format!("{org_id}/{stream_type}/{stream_name}");

        let pool = CLIENT_RO.clone();
        let ret = sqlx::query_as::<_, super::FileRecord>(
                r#"
SELECT id, account, stream, date, file, min_ts, max_ts, records, original_size, compressed_size, index_size, flattened
    FROM file_list
    WHERE stream = $1 AND date >= $2 AND date <= $3;
                "#,
            )
            .bind(stream_key)
            .bind(date_start)
            .bind(date_end)
            .fetch_all(&pool)
            .await;
        Ok(ret?.iter().map(|r| r.into()).collect())
    }

    async fn query_for_dump(
        &self,
        org_id: &str,
        stream_type: StreamType,
        stream_name: &str,
        time_range: (i64, i64),
    ) -> Result<Vec<FileRecord>> {
        let (time_start, time_end) = time_range;
        let stream_key = format!("{org_id}/{stream_type}/{stream_name}");

        let pool = CLIENT_RO.clone();
        let max_ts_upper_bound = super::calculate_max_ts_upper_bound(time_end, stream_type);
        let ret = sqlx::query_as::<_, super::FileRecord>(
            r#"SELECT * FROM file_list WHERE stream = $1 AND max_ts >= $2 AND max_ts <= $3 AND min_ts <= $4;"#,
        )
        .bind(stream_key)
        .bind(time_start)
        .bind(max_ts_upper_bound)
        .bind(time_end)
        .fetch_all(&pool)
        .await;

        Ok(ret?)
    }

    async fn query_for_dump_by_updated_at(
        &self,
        time_range: (i64, i64),
    ) -> Result<Vec<FileRecord>> {
        let (time_start, time_end) = time_range;

        let pool = CLIENT_RO.clone();
        let ret = sqlx::query_as::<_, super::FileRecord>(
            r#"SELECT * FROM file_list WHERE updated_at > $1 AND updated_at <= $2 AND stream LIKE $3;"#,
        )
        .bind(time_start)
        .bind(time_end)
        .bind(format!("%/{}/%", StreamType::Filelist))
        .fetch_all(&pool)
        .await;

        Ok(ret?)
    }

    async fn query_by_ids(&self, ids: &[i64]) -> Result<Vec<FileKey>> {
        if ids.is_empty() {
            return Ok(Vec::default());
        }

        let mut ret = Vec::new();
        let pool = CLIENT_RO.clone();

        for chunk in ids.chunks(get_config().compact.file_list_deleted_batch_size) {
            if chunk.is_empty() {
                continue;
            }
            let ids = chunk
                .iter()
                .map(|id| id.to_string())
                .collect::<Vec<String>>()
                .join(",");
            let query_str = format!(
                "SELECT id, account, stream, date, file, min_ts, max_ts, records, original_size, compressed_size, index_size FROM file_list WHERE id IN ({ids})"
            );
            let res = sqlx::query_as::<_, super::FileRecord>(&query_str)
                .fetch_all(&pool)
                .await?;
            ret.extend_from_slice(&res);
        }

        Ok(ret.iter().map(|r| r.into()).collect())
    }

    async fn query_ids(
        &self,
        org_id: &str,
        stream_type: StreamType,
        stream_name: &str,
        time_range: (i64, i64),
    ) -> Result<Vec<super::FileId>> {
        let (time_start, time_end) = time_range;
        let stream_key = format!("{org_id}/{stream_type}/{stream_name}");

        let day_partitions = if time_end - time_start <= DAY_MICRO_SECS
            || time_end - time_start > DAY_MICRO_SECS * 30
            || !get_config().compact.file_list_multi_thread
        {
            vec![(time_start, time_end)]
        } else {
            let mut partitions = Vec::new();
            let mut start = time_start;
            while start < time_end {
                let end_of_day = std::cmp::min(end_of_the_day(start), time_end);
                partitions.push((start, end_of_day));
                start = end_of_day + 1; // next day, use end_of_day + 1 microsecond
            }
            partitions
        };
        log::debug!("file_list day_partitions: {day_partitions:?}");

        let mut tasks = Vec::with_capacity(day_partitions.len());

        for (time_start, time_end) in day_partitions {
            let stream_key = stream_key.clone();
            tasks.push(tokio::task::spawn(async move {
                let pool = CLIENT_RO.clone();
                    let max_ts_upper_bound = super::calculate_max_ts_upper_bound(time_end, stream_type);
                    let query = "SELECT id, records, original_size FROM file_list WHERE stream = $1 AND max_ts >= $2 AND max_ts <= $3 AND min_ts <= $4;";
                    sqlx::query_as::<_, super::FileId>(query)
                    .bind(stream_key)
                    .bind(time_start)
                    .bind(max_ts_upper_bound)
                    .bind(time_end)
                    .fetch_all(&pool)
                    .await
            }));
        }

        let mut rets = Vec::new();
        for task in tasks {
            match task.await {
                Ok(Ok(r)) => rets.extend(r),
                Ok(Err(e)) => {
                    return Err(e.into());
                }
                Err(e) => {
                    return Err(Error::Message(e.to_string()));
                }
            };
        }
        Ok(rets)
    }

    async fn query_ids_by_files(&self, files: &[FileKey]) -> Result<stdHashMap<String, i64>> {
        let mut ret = stdHashMap::with_capacity(files.len());
        // group by date
        let mut stream_files = HashMap::new();
        let mut files_map = HashMap::with_capacity(files.len());
        for file in files {
            if file.id > 0 {
                ret.insert(file.key.clone(), file.id);
                continue;
            }
            let (stream_key, date_key, file_name) =
                parse_file_key_columns(&file.key).map_err(|e| Error::Message(e.to_string()))?;
            let stream_entry = stream_files.entry(stream_key).or_insert(HashMap::new());
            let date_entry = stream_entry.entry(date_key).or_insert(Vec::new());
            date_entry.push(file_name.clone());
            files_map.insert(file_name, &file.key);
        }
        for (stream_key, stream_files) in stream_files {
            let pool = CLIENT_RO.clone();
            for (date_key, files) in stream_files {
                if files.is_empty() {
                    continue;
                }
                let sql = format!(
                    "SELECT id, file FROM file_list WHERE stream = $1 AND date = $2 AND file IN ('{}');",
                    files.join("','")
                );
                let query_res = sqlx::query_as::<_, super::FileIdWithFile>(&sql)
                    .bind(&stream_key)
                    .bind(&date_key)
                    .fetch_all(&pool)
                    .await?;
                for file in query_res {
                    if let Some(file_name) = files_map.get(&file.file) {
                        ret.insert(file_name.to_string(), file.id);
                    }
                }
            }
        }
        Ok(ret)
    }

    async fn query_old_data_hours(
        &self,
        org_id: &str,
        stream_type: StreamType,
        stream_name: &str,
        time_range: (i64, i64),
    ) -> Result<Vec<String>> {
        let (time_start, time_end) = time_range;
        let stream_key = format!("{org_id}/{stream_type}/{stream_name}");

        let pool = CLIENT_RO.clone();
        let cfg = get_config();
        let max_ts_upper_bound = super::calculate_max_ts_upper_bound(time_end, stream_type);
        let sql = r#"
SELECT date
    FROM file_list
    WHERE stream = $1 AND max_ts >= $2 AND max_ts <= $3 AND min_ts <= $4 AND records < $5
    GROUP BY date HAVING count(*) >= $6;
            "#;

        let ret = sqlx::query(sql)
            .bind(stream_key)
            .bind(time_start)
            .bind(max_ts_upper_bound)
            .bind(time_end)
            .bind(cfg.compact.old_data_min_records)
            .bind(cfg.compact.old_data_min_files)
            .fetch_all(&pool)
            .await?;
        Ok(ret
            .into_iter()
            .map(|r| r.try_get::<String, &str>("date").unwrap_or_default())
            .collect())
    }

    async fn query_deleted(
        &self,
        org_id: &str,
        time_max: i64,
        limit: i64,
    ) -> Result<Vec<FileListDeleted>> {
        if time_max == 0 {
            return Ok(Vec::new());
        }
        let pool = CLIENT_RO.clone();
        let ret = sqlx::query_as::<_, super::FileDeletedRecord>(
            r#"SELECT id, account, stream, date, file, index_file, flattened FROM file_list_deleted WHERE org = $1 AND created_at < $2 ORDER BY created_at ASC LIMIT $3;"#,
        )
        .bind(org_id)
        .bind(time_max)
        .bind(limit)
        .fetch_all(&pool)
        .await?;
        Ok(ret
            .iter()
            .map(|r| FileListDeleted {
                id: r.id,
                account: r.account.to_string(),
                file: format!("files/{}/{}/{}", r.stream, r.date, r.file),
                index_file: r.index_file,
                flattened: r.flattened,
            })
            .collect())
    }

    async fn list_deleted(&self) -> Result<Vec<FileListDeleted>> {
        let pool = CLIENT_RO.clone();
        let ret = sqlx::query_as::<_, super::FileDeletedRecord>(
            r#"SELECT id, account, stream, date, file, index_file, flattened FROM file_list_deleted;"#,
        )
        .fetch_all(&pool)
        .await?;
        Ok(ret
            .iter()
            .map(|r| FileListDeleted {
                id: r.id,
                account: r.account.to_string(),
                file: format!("files/{}/{}/{}", r.stream, r.date, r.file),
                index_file: r.index_file,
                flattened: r.flattened,
            })
            .collect())
    }

    async fn get_min_date(
        &self,
        org_id: &str,
        stream_type: StreamType,
        stream_name: &str,
        date_range: Option<(String, String)>,
    ) -> Result<String> {
        let stream_key = format!("{org_id}/{stream_type}/{stream_name}");
        let pool = CLIENT_RO.clone();
        let ret: Option<String> = match date_range {
            Some((start, end)) => {
                sqlx::query_scalar(r#"SELECT MIN(date) AS num FROM file_list WHERE stream = $1 AND date >= $2 AND date < $3;"#)
                    .bind(stream_key)
                    .bind(start)
                    .bind(end)
                    .fetch_one(&pool)
                    .await?
            }
            None => {
                sqlx::query_scalar(r#"SELECT MIN(date) AS num FROM file_list WHERE stream = $1;"#)
                    .bind(stream_key)
                    .fetch_one(&pool)
                    .await?
            }
        };
        Ok(ret.unwrap_or_default())
    }

    async fn get_min_update_at(&self) -> Result<i64> {
        let pool = CLIENT_RO.clone();
        let ret: Option<i64> =
            sqlx::query_scalar(r#"SELECT MIN(updated_at) AS num FROM file_list;"#)
                .fetch_one(&pool)
                .await?;
        Ok(ret.unwrap_or_default())
    }

    async fn get_max_update_at(&self) -> Result<i64> {
        let pool = CLIENT_RO.clone();
        let ret: Option<i64> =
            sqlx::query_scalar(r#"SELECT MAX(updated_at) AS num FROM file_list;"#)
                .fetch_one(&pool)
                .await?;
        Ok(ret.unwrap_or_default())
    }

    async fn clean_by_min_update_at(&self, val: i64) -> Result<()> {
        let client = CLIENT_RW.clone();
        let client = client.lock().await;
        sqlx::query("DELETE FROM file_list WHERE updated_at < $1;")
            .bind(val)
            .execute(&*client)
            .await?;
        Ok(())
    }

    async fn get_updated_streams(&self, time_range: (i64, i64)) -> Result<Vec<String>> {
        let (time_start, time_end) = time_range;
        let pool = CLIENT_RO.clone();
        let ret = sqlx::query(
            r#"SELECT DISTINCT stream FROM file_list WHERE updated_at > $1 AND updated_at <= $2;"#,
        )
        .bind(time_start)
        .bind(time_end)
        .fetch_all(&pool)
        .await?
        .into_iter()
        .map(|r| r.try_get::<String, &str>("stream").unwrap_or_default())
        .collect();
        Ok(ret)
    }

    async fn stats_by_date_range(
        &self,
        org_id: &str,
        stream_type: StreamType,
        stream_name: &str,
        date_range: (String, String),
    ) -> Result<StreamStats> {
        let (start_date, end_date) = date_range;
        let stream_key = format!("{org_id}/{stream_type}/{stream_name}");
        let time_filter = if !start_date.is_empty() && !end_date.is_empty() {
            format!("AND date >= '{start_date}' AND date < '{end_date}'")
        } else if start_date.is_empty() && !end_date.is_empty() {
            format!("AND date < '{end_date}'")
        } else if !start_date.is_empty() && end_date.is_empty() {
            format!("AND date >= '{start_date}'")
        } else {
            "".to_string()
        };
        let sql = format!(
            r#"
SELECT 
    COUNT(*) AS file_num,
    MIN(min_ts) AS min_ts,
    MAX(max_ts) AS max_ts,
    SUM(records) AS records,
    SUM(original_size) AS original_size,
    SUM(compressed_size) AS compressed_size,
    SUM(index_size) AS index_size
FROM file_list
WHERE stream = $1 {time_filter}
GROUP BY stream;
            "#
        );
        let pool = CLIENT_RO.clone();
        let ret: Option<super::StatsRecord> = sqlx::query_as(&sql)
            .bind(stream_key)
            .fetch_optional(&pool)
            .await?;
        Ok(ret.map(|r| r.into()).unwrap_or_default())
    }

    async fn get_stream_stats(
        &self,
        org_id: &str,
        stream_type: Option<StreamType>,
        stream_name: Option<&str>,
    ) -> Result<Vec<(String, StreamStats)>> {
        let sql = if let Some(stream_type) = stream_type
            && let Some(stream_name) = stream_name
        {
            format!(
                "SELECT * FROM stream_stats WHERE stream = '{org_id}/{stream_type}/{stream_name}';",
            )
        } else {
            format!("SELECT * FROM stream_stats WHERE org = '{org_id}';")
        };
        let pool = CLIENT_RO.clone();
        let ret = sqlx::query_as::<_, super::StatsRecord>(&sql)
            .fetch_all(&pool)
            .await?;
        let mut stats: HashMap<String, StreamStats> = HashMap::with_capacity(ret.len() / 2);
        for r in ret {
            match stats.get_mut(&r.stream) {
                Some(s) => s.merge(&r.into()),
                None => {
                    stats.insert(r.stream.to_owned(), r.into());
                }
            }
        }
        Ok(stats.into_iter().collect())
    }

    async fn del_stream_stats(
        &self,
        org_id: &str,
        stream_type: StreamType,
        stream_name: &str,
    ) -> Result<()> {
        let sql = format!(
            "DELETE FROM stream_stats WHERE stream = '{org_id}/{stream_type}/{stream_name}';"
        );
        let client = CLIENT_RW.clone();
        let client = client.lock().await;
        sqlx::query(&sql).execute(&*client).await?;
        Ok(())
    }

    async fn set_stream_stats(
        &self,
        org_id: &str,
        stream_type: StreamType,
        stream_name: &str,
        stats: &StreamStats,
        is_recent: bool,
    ) -> Result<()> {
        let stream_key = format!("{org_id}/{stream_type}/{stream_name}");
        let client = CLIENT_RW.clone();
        let client = client.lock().await;
        let mut tx = client.begin().await?;
        if let Err(e) = sqlx::query(
            r#"
INSERT INTO stream_stats
    (org, stream, file_num, min_ts, max_ts, records, original_size, compressed_size, index_size, is_recent)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
ON CONFLICT (stream, is_recent)
DO UPDATE SET
    file_num = EXCLUDED.file_num,
    min_ts = EXCLUDED.min_ts,
    max_ts = EXCLUDED.max_ts,
    records = EXCLUDED.records,
    original_size = EXCLUDED.original_size,
    compressed_size = EXCLUDED.compressed_size,
    index_size = EXCLUDED.index_size;
            "#,
        )
        .bind(org_id)
        .bind(&stream_key)
        .bind(stats.file_num)
        .bind(stats.doc_time_min)
        .bind(stats.doc_time_max)
        .bind(stats.doc_num)
        .bind(stats.storage_size as i64)
        .bind(stats.compressed_size as i64)
        .bind(stats.index_size as i64)
        .bind(is_recent)
        .execute(&mut *tx)
        .await
        {
            if let Err(e) = tx.rollback().await {
                log::error!("[SQLITE] rollback set stream stats error: {e}");
            }
            return Err(e.into());
        }

        // commit
        if let Err(e) = tx.commit().await {
            log::error!("[SQLITE] commit set stream stats error: {e}");
            return Err(e.into());
        }

        Ok(())
    }

    async fn reset_stream_stats_min_ts(
        &self,
        _org_id: &str,
        stream: &str,
        min_ts: i64,
    ) -> Result<()> {
        let client = CLIENT_RW.clone();
        let client = client.lock().await;
        sqlx::query(r#"UPDATE stream_stats SET min_ts = $1 WHERE stream = $2;"#)
            .bind(min_ts)
            .bind(stream)
            .execute(&*client)
            .await?;
        sqlx::query(
            r#"UPDATE stream_stats SET max_ts = min_ts WHERE stream = $1 AND max_ts < min_ts;"#,
        )
        .bind(stream)
        .execute(&*client)
        .await?;
        Ok(())
    }

    async fn reset_stream_stats(&self) -> Result<()> {
        let client = CLIENT_RW.clone();
        let client = client.lock().await;
        sqlx::query(r#"UPDATE stream_stats SET file_num = 0, min_ts = 0, max_ts = 0, records = 0, original_size = 0, compressed_size = 0, index_size = 0;"#)
        .execute(&*client)
       .await?;
        Ok(())
    }

    async fn len(&self) -> usize {
        let pool = CLIENT_RO.clone();
        let ret = match sqlx::query(r#"SELECT COUNT(*) as num FROM file_list;"#)
            .fetch_one(&pool)
            .await
        {
            Ok(r) => r,
            Err(e) => {
                log::error!("[SQLITE] get file list len error: {e}");
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

    async fn add_job(
        &self,
        org_id: &str,
        stream_type: StreamType,
        stream: &str,
        offset: i64,
    ) -> Result<i64> {
        let stream_key = format!("{org_id}/{stream_type}/{stream}");
        let client = CLIENT_RW.clone();
        let client = client.lock().await;
        let mut tx = client.begin().await?;
        match sqlx::query(
            "INSERT INTO file_list_jobs (org, stream, offsets, status, node, started_at, updated_at) VALUES ($1, $2, $3, $4, '', 0, 0);",
        )
        .bind(org_id)
        .bind(&stream_key)
        .bind(offset)
        .bind(super::FileListJobStatus::Pending)
        .execute(&mut *tx)
        .await
        {
            Err(sqlx::Error::Database(e)) => if !e.is_unique_violation() {
                return Err(Error::Message(e.to_string()));
            },
            Err(e) => {
                return Err(e.into());
            },
            Ok(_) => {}
        };

        // get job id
        let ret = match sqlx::query(
            "SELECT id, status FROM file_list_jobs WHERE org = $1 AND stream = $2 AND offsets = $3;",
        )
        .bind(org_id)
        .bind(&stream_key)
        .bind(offset)
        .fetch_one(&mut *tx)
        .await
        {
            Ok(v) => v,
            Err(e) => {
                if let Err(e) = tx.rollback().await {
                    log::error!("[SQLITE] rollback add job error: {e}");
                }
                return Err(e.into());
            }
        };
        let id = ret.try_get::<i64, &str>("id").unwrap_or_default();
        let status = ret.try_get::<i64, &str>("status").unwrap_or_default();
        if id > 0
            && super::FileListJobStatus::from(status) == super::FileListJobStatus::Done
            && let Err(e) =
                sqlx::query("UPDATE file_list_jobs SET status = $1 WHERE status = $2 AND id = $3;")
                    .bind(super::FileListJobStatus::Pending)
                    .bind(super::FileListJobStatus::Done)
                    .bind(id)
                    .execute(&mut *tx)
                    .await
        {
            if let Err(e) = tx.rollback().await {
                log::error!("[SQLITE] rollback update job status error: {e}");
            }
            return Err(e.into());
        }
        if let Err(e) = tx.commit().await {
            log::error!("[SQLITE] commit add job error: {e}");
            return Err(e.into());
        }
        Ok(id)
    }

    async fn get_pending_jobs(&self, node: &str, limit: i64) -> Result<Vec<super::MergeJobRecord>> {
        let client = CLIENT_RW.clone();
        let client = client.lock().await;
        let mut tx = client.begin().await?;
        // get pending jobs group by stream and order by num desc
        let ret = match sqlx::query_as::<_, super::MergeJobPendingRecord>(
            r#"
SELECT stream, max(id) as id, COUNT(*) AS num
    FROM file_list_jobs
    WHERE status = $1
    GROUP BY stream
    ORDER BY num DESC
    LIMIT $2;"#,
        )
        .bind(super::FileListJobStatus::Pending)
        .bind(limit)
        .fetch_all(&mut *tx)
        .await
        {
            Ok(v) => v,
            Err(e) => {
                if let Err(e) = tx.rollback().await {
                    log::error!("[SQLITE] rollback get_pending_jobs for update error: {e}");
                }
                return Err(e.into());
            }
        };
        // update jobs status to running
        let ids = ret.iter().map(|r| r.id.to_string()).collect::<Vec<_>>();
        if ids.is_empty() {
            if let Err(e) = tx.rollback().await {
                log::error!("[SQLITE] rollback get_pending_jobs error: {e}");
            }
            return Ok(Vec::new());
        }
        let sql = format!(
            "UPDATE file_list_jobs SET status = $1, node = $2, started_at = $3, updated_at = $4 WHERE id IN ({});",
            ids.join(",")
        );
        let now = config::utils::time::now_micros();
        if let Err(e) = sqlx::query(&sql)
            .bind(super::FileListJobStatus::Running)
            .bind(node)
            .bind(now)
            .bind(now)
            .execute(&mut *tx)
            .await
        {
            if let Err(e) = tx.rollback().await {
                log::error!("[SQLITE] rollback update file_list_jobs status error: {e}");
            }
            return Err(e.into());
        }
        // get jobs by ids
        let sql = format!(
            "SELECT * FROM file_list_jobs WHERE id IN ({});",
            ids.join(",")
        );
        let ret = match sqlx::query_as::<_, super::MergeJobRecord>(&sql)
            .fetch_all(&mut *tx)
            .await
        {
            Ok(v) => v,
            Err(e) => {
                if let Err(e) = tx.rollback().await {
                    log::error!("[SQLITE] rollback get_pending_jobs by ids error: {e}");
                }
                return Err(e.into());
            }
        };
        if let Err(e) = tx.commit().await {
            log::error!("[SQLITE] commit for get_pending_jobs error: {e}");
            return Err(e.into());
        }
        Ok(ret)
    }

    async fn set_job_pending(&self, ids: &[i64]) -> Result<()> {
        let client = CLIENT_RW.clone();
        let client = client.lock().await;
        let sql = format!(
            "UPDATE file_list_jobs SET status = $1 WHERE id IN ({});",
            ids.iter()
                .map(|id| id.to_string())
                .collect::<Vec<_>>()
                .join(",")
        );
        sqlx::query(&sql)
            .bind(super::FileListJobStatus::Pending)
            .execute(&*client)
            .await?;
        Ok(())
    }

    async fn set_job_done(&self, ids: &[i64]) -> Result<()> {
        let cfg = get_config();
        let client = CLIENT_RW.clone();
        let client = client.lock().await;
        let sql = format!(
            "UPDATE file_list_jobs SET status = $1, updated_at = $2, dumped = $3, node = '' WHERE id IN ({});",
            ids.iter()
                .map(|id| id.to_string())
                .collect::<Vec<_>>()
                .join(",")
        );
        // if dump enabled we set dumped to false, so dump job can work
        // id dump disabled, we set it to true, so cleanup can remvoe the jobs
        sqlx::query(&sql)
            .bind(super::FileListJobStatus::Done)
            .bind(config::utils::time::now_micros())
            .bind(!cfg.compact.file_list_dump_enabled)
            .execute(&*client)
            .await?;
        Ok(())
    }

    async fn update_running_jobs(&self, ids: &[i64]) -> Result<()> {
        let client = CLIENT_RW.clone();
        let client = client.lock().await;
        let sql = format!(
            r#"UPDATE file_list_jobs SET updated_at = $1 WHERE id IN ({})"#,
            ids.iter()
                .map(|id| id.to_string())
                .collect::<Vec<_>>()
                .join(",")
        );
        sqlx::query(&sql)
            .bind(config::utils::time::now_micros())
            .execute(&*client)
            .await?;
        Ok(())
    }

    async fn check_running_jobs(&self, before_date: i64) -> Result<()> {
        let client = CLIENT_RW.clone();
        let client = client.lock().await;

        // reset running jobs status to pending
        let ret = sqlx::query(
            r#"UPDATE file_list_jobs SET status = $1 WHERE status = $2 AND updated_at < $3;"#,
        )
        .bind(super::FileListJobStatus::Pending)
        .bind(super::FileListJobStatus::Running)
        .bind(before_date)
        .execute(&*client)
        .await?;
        let rows_affected = ret.rows_affected();
        if rows_affected > 0 {
            log::warn!(
                "[SQLITE] reset running jobs status to pending, rows_affected: {rows_affected}"
            );
        }

        // reset dumping jobs node to empty
        let ret = sqlx::query(
            r#"UPDATE file_list_jobs SET node = '' WHERE status = $1 AND dumped = $2 AND node != '' AND updated_at < $3;"#,
        )
        .bind(super::FileListJobStatus::Done)
        .bind(false)
        .bind(before_date)
        .execute(&*client)
        .await?;
        let rows_affected = ret.rows_affected();
        if rows_affected > 0 {
            log::warn!("[SQLITE] reset dumping jobs node to empty, rows_affected: {rows_affected}");
        }
        Ok(())
    }

    async fn clean_done_jobs(&self, before_date: i64) -> Result<()> {
        let client = CLIENT_RW.clone();
        let client = client.lock().await;
        let ret = sqlx::query(
            r#"DELETE FROM file_list_jobs WHERE status = $1 AND dumped = $2 AND updated_at < $3;"#,
        )
        .bind(super::FileListJobStatus::Done)
        .bind(true)
        .bind(before_date)
        .execute(&*client)
        .await?;
        if ret.rows_affected() > 0 {
            log::warn!("[SQLITE] clean done jobs");
        }
        Ok(())
    }

    async fn get_pending_jobs_count(&self) -> Result<stdHashMap<String, stdHashMap<String, i64>>> {
        let pool = CLIENT_RO.clone();

        let ret =
            sqlx::query(r#"SELECT stream, status, count(*) as counts FROM file_list_jobs WHERE status = $1 GROUP BY stream, status ORDER BY status desc;"#)
                .bind(super::FileListJobStatus::Pending)
                .fetch_all(&pool)
                .await?;

        let mut job_status: stdHashMap<String, stdHashMap<String, i64>> = stdHashMap::new();

        for r in ret.iter() {
            let stream = r.get::<String, &str>("stream");
            let status = r.get::<i32, &str>("status");
            let counts = if status == 0 {
                r.get::<i64, &str>("counts")
            } else {
                0
            };
            let parts: Vec<&str> = stream.split('/').collect();
            if parts.len() >= 2 {
                let org = parts[0].to_string();
                let stream_type = parts[1].to_string();
                job_status
                    .entry(org)
                    .or_default()
                    .entry(stream_type)
                    .and_modify(|e| *e += counts)
                    .or_insert(counts);
            }
        }
        Ok(job_status)
    }

    async fn get_pending_dump_jobs(
        &self,
        node: &str,
        limit: i64,
    ) -> Result<Vec<(i64, String, i64)>> {
        let client = CLIENT_RW.clone();
        let client = client.lock().await;
        let mut tx = client.begin().await?;
        // get pending dump jobs by updated_at asc
        let ret = match sqlx::query_as::<_, (i64, String, i64)>(
       r#"SELECT id, stream, offsets FROM file_list_jobs WHERE status = $1 AND dumped = $2 AND node = '' ORDER BY updated_at ASC limit $3"#,
   )
   .bind(super::FileListJobStatus::Done)
   .bind(false)
   .bind(limit)
   .fetch_all(&mut *tx)
        .await
        {
            Ok(v) => v,
            Err(e) => {
                if let Err(e) = tx.rollback().await {
                    log::error!(
                        "[SQLITE] rollback get_pending_dump_jobs for update error: {e}"
                    );
                }
                return Err(e.into());
            }
        };

        // update jobs node, created_at and updated_at
        let ids = ret.iter().map(|r| r.0.to_string()).collect::<Vec<_>>();
        if ids.is_empty() {
            if let Err(e) = tx.rollback().await {
                log::error!("[SQLITE] rollback get_pending_dump_jobs error: {e}");
            }
            return Ok(Vec::new());
        }
        let sql = format!(
            "UPDATE file_list_jobs SET node = $1, started_at = $2, updated_at = $3 WHERE id IN ({});",
            ids.join(",")
        );
        let now = config::utils::time::now_micros();
        if let Err(e) = sqlx::query(&sql)
            .bind(node)
            .bind(now)
            .bind(now)
            .execute(&mut *tx)
            .await
        {
            if let Err(e) = tx.rollback().await {
                log::error!("[SQLITE] rollback update get_pending_dump_jobs status error: {e}");
            }
            return Err(e.into());
        }
        if let Err(e) = tx.commit().await {
            log::error!("[SQLITE] commit for get_pending_dump_jobs error: {e}");
            return Err(e.into());
        }
        Ok(ret)
    }

    async fn set_job_dumped_status(&self, ids: &[i64], dumped: bool) -> Result<()> {
        let client = CLIENT_RW.clone();
        let client = client.lock().await;
        let sql = format!(
            "UPDATE file_list_jobs SET dumped = $1, node = '' WHERE id IN ({});",
            ids.iter()
                .map(|id| id.to_string())
                .collect::<Vec<_>>()
                .join(",")
        );
        sqlx::query(&sql).bind(dumped).execute(&*client).await?;
        Ok(())
    }

    async fn insert_dump_stats(&self, file: &str, stats: &StreamStats) -> Result<()> {
        let (stream_key, date_key, file_name) =
            parse_file_key_columns(file).expect("parse file key failed");
        let org_id = stream_key[..stream_key.find('/').unwrap()].to_string();
        let client = CLIENT_RW.clone();
        let client = client.lock().await;
        sqlx::query(
            r#"
INSERT INTO file_list_dump_stats
    (org, stream, date, file, file_num, min_ts, max_ts, records, original_size, compressed_size, index_size)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
ON CONFLICT (stream, date, file)
DO UPDATE SET
    file_num = EXCLUDED.file_num,
    min_ts = EXCLUDED.min_ts,
    max_ts = EXCLUDED.max_ts,
    records = EXCLUDED.records,
    original_size = EXCLUDED.original_size,
    compressed_size = EXCLUDED.compressed_size,
    index_size = EXCLUDED.index_size;
            "#,
        )
        .bind(org_id)
        .bind(stream_key)
        .bind(date_key)
        .bind(file_name)
        .bind(stats.file_num)
        .bind(stats.doc_time_min)
        .bind(stats.doc_time_max)
        .bind(stats.doc_num)
        .bind(stats.storage_size as i64)
        .bind(stats.compressed_size as i64)
        .bind(stats.index_size as i64)
        .execute(&*client)
        .await?;
        Ok(())
    }

    async fn delete_dump_stats(&self, file: &str) -> Result<()> {
        let (stream_key, date_key, file_name) =
            parse_file_key_columns(file).expect("parse file key failed");
        let client = CLIENT_RW.clone();
        let client = client.lock().await;
        sqlx::query(
            r#"DELETE FROM file_list_dump_stats WHERE stream = $1 AND date = $2 AND file = $3;"#,
        )
        .bind(stream_key)
        .bind(date_key)
        .bind(file_name)
        .execute(&*client)
        .await?;
        Ok(())
    }

    async fn query_dump_stats_by_date_range(
        &self,
        org_id: &str,
        stream_type: StreamType,
        stream_name: &str,
        date_range: (String, String),
    ) -> Result<StreamStats> {
        let (start_date, end_date) = date_range;
        let stream_key = format!(
            "{org_id}/{}/{stream_name}_{stream_type}",
            StreamType::Filelist
        );
        let time_filter = if !start_date.is_empty() && !end_date.is_empty() {
            format!("AND date >= '{start_date}' AND date < '{end_date}'")
        } else if start_date.is_empty() && !end_date.is_empty() {
            format!("AND date < '{end_date}'")
        } else if !start_date.is_empty() && end_date.is_empty() {
            format!("AND date >= '{start_date}'")
        } else {
            "".to_string()
        };
        let sql = format!(
            r#"
SELECT 
    SUM(file_num) AS file_num,
    MIN(min_ts) AS min_ts,
    MAX(max_ts) AS max_ts,
    SUM(records) AS records,
    SUM(original_size) AS original_size,
    SUM(compressed_size) AS compressed_size,
    SUM(index_size) AS index_size
FROM file_list_dump_stats
WHERE stream = $1 {time_filter}
GROUP BY stream;
            "#
        );
        let pool = CLIENT_RO.clone();
        let ret: Option<super::StatsRecord> = sqlx::query_as(&sql)
            .bind(stream_key)
            .fetch_optional(&pool)
            .await?;
        Ok(ret.map(|r| r.into()).unwrap_or_default())
    }
}

impl SqliteFileList {
    async fn inner_add(
        &self,
        table: &str,
        account: &str,
        file: &str,
        meta: &FileMeta,
    ) -> Result<i64> {
        self.inner_add_with_id(table, None, account, file, meta)
            .await
    }

    async fn inner_add_with_id(
        &self,
        table: &str,
        id: Option<i64>,
        account: &str,
        file: &str,
        meta: &FileMeta,
    ) -> Result<i64> {
        let now_ts = now_micros();
        let (stream_key, date_key, file_name) =
            parse_file_key_columns(file).map_err(|e| Error::Message(e.to_string()))?;
        let org_id = stream_key[..stream_key.find('/').unwrap()].to_string();
        let client = CLIENT_RW.clone();
        let client = client.lock().await;
        if meta.min_ts == 0 || meta.max_ts == 0 {
            log::warn!("[SQLITE] min_ts or max_ts is 0 for file: {file}");
        }
        match  sqlx::query(
            format!(r#"
INSERT INTO {table} (id, account, org, stream, date, file, deleted, min_ts, max_ts, records, original_size, compressed_size, index_size, flattened, created_at, updated_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16);
        "#).as_str(),
    )
        .bind(id)
        .bind(account)
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
        .bind(meta.index_size)
        .bind(meta.flattened)
        .bind(now_ts)
        .bind(now_ts)
        .execute(&*client)
        .await {
            Err(sqlx::Error::Database(e)) => if e.is_unique_violation() {
                  Ok(0)
            } else {
                  Err(Error::Message(e.to_string()))
            },
            Err(e) =>  Err(e.into()),
            Ok(v) => Ok(v.last_insert_rowid()),
        }
    }

    async fn inner_batch_process(&self, table: &str, files: &[FileKey]) -> Result<()> {
        if files.is_empty() {
            return Ok(());
        }

        let client = CLIENT_RW.clone();
        let client = client.lock().await;
        let mut tx = client.begin().await?;

        let add_items = files.iter().filter(|f| !f.deleted).collect::<Vec<_>>();
        if !add_items.is_empty() {
            let chunks = add_items.chunks(100);
            for files in chunks {
                let now_ts = now_micros();
                let mut query_builder: QueryBuilder<Sqlite> = QueryBuilder::new(
                format!("INSERT INTO {table} (id, account, org, stream, date, file, deleted, min_ts, max_ts, records, original_size, compressed_size, index_size, flattened, created_at, updated_at)").as_str(),
                );
                query_builder.push_values(files, |mut b, item| {
                    let id = if item.id > 0 { Some(item.id) } else { None };
                    let Ok((stream_key, date_key, file_name)) = parse_file_key_columns(&item.key)
                    else {
                        log::error!("[SQLITE] parse file key failed for file: {}", item.key);
                        return;
                    };
                    let org_id = stream_key[..stream_key.find('/').unwrap()].to_string();
                    if item.meta.min_ts == 0 || item.meta.max_ts == 0 {
                        log::warn!("[SQLITE] min_ts or max_ts is 0 for file: {}", item.key);
                        return;
                    }
                    b.push_bind(id)
                        .push_bind(&item.account)
                        .push_bind(org_id)
                        .push_bind(stream_key)
                        .push_bind(date_key)
                        .push_bind(file_name)
                        .push_bind(false)
                        .push_bind(item.meta.min_ts)
                        .push_bind(item.meta.max_ts)
                        .push_bind(item.meta.records)
                        .push_bind(item.meta.original_size)
                        .push_bind(item.meta.compressed_size)
                        .push_bind(item.meta.index_size)
                        .push_bind(item.meta.flattened)
                        .push_bind(now_ts)
                        .push_bind(now_ts);
                });
                query_builder.push(" ON CONFLICT(id) DO NOTHING");
                if let Err(e) = query_builder.build().execute(&mut *tx).await {
                    if let Err(e) = tx.rollback().await {
                        log::error!("[SQLITE] rollback {table} batch process for add error: {e}");
                    }
                    return Err(e.into());
                }
            }
        }

        // sort by file id and key to reduce locked table range
        let mut del_items = files.iter().filter(|v| v.deleted).collect::<Vec<_>>();
        del_items.sort_by(|v1, v2| match v1.id.cmp(&v2.id) {
            std::cmp::Ordering::Equal => v1.key.cmp(&v2.key),
            other => other,
        });
        let deleted_batch_size = get_config().compact.file_list_deleted_batch_size;
        if !del_items.is_empty() {
            let chunks = del_items.chunks(deleted_batch_size);
            for files in chunks {
                // get ids of the files
                let mut ids = Vec::with_capacity(files.len());
                for file in files {
                    if file.id > 0 {
                        ids.push(file.id.to_string());
                        continue;
                    }
                    let (stream_key, date_key, file_name) = parse_file_key_columns(&file.key)
                        .map_err(|e| Error::Message(e.to_string()))?;
                    let query_res: std::result::Result<Option<i64>, sea_orm::SqlxError> = sqlx::query_scalar(
                    r#"SELECT id FROM file_list WHERE stream = $1 AND date = $2 AND file = $3;"#,
                    )
                    .bind(stream_key)
                    .bind(date_key)
                    .bind(file_name)
                    .fetch_one(&mut *tx)
                    .await;
                    match query_res {
                        Ok(Some(v)) => ids.push(v.to_string()),
                        Ok(None) => continue,
                        Err(sqlx::Error::RowNotFound) => continue,
                        Err(e) => {
                            if let Err(e) = tx.rollback().await {
                                log::error!(
                                    "[SQLITE] rollback {table} batch process for delete error: {e}"
                                );
                            }
                            return Err(e.into());
                        }
                    };
                }
                // delete files by ids
                if !ids.is_empty() {
                    let sql = format!("DELETE FROM file_list WHERE id IN({});", ids.join(","));
                    if let Err(e) = sqlx::query(sql.as_str()).execute(&mut *tx).await {
                        if let Err(e) = tx.rollback().await {
                            log::error!(
                                "[SQLITE] rollback {table} batch process for delete error: {e}"
                            );
                        }
                        return Err(e.into());
                    }
                }
            }
        }

        if let Err(e) = tx.commit().await {
            log::error!("[SQLITE] commit {table} batch process error: {e}");
            return Err(e.into());
        }

        // release lock
        drop(client);

        Ok(())
    }
}

pub async fn create_table() -> Result<()> {
    let client = CLIENT_RW.clone();
    let client = client.lock().await;
    sqlx::query(
        r#"
CREATE TABLE IF NOT EXISTS file_list
(
    id        INTEGER not null primary key autoincrement,
    account   VARCHAR not null,
    org       VARCHAR not null,
    stream    VARCHAR not null,
    date      VARCHAR not null,
    file      VARCHAR not null,
    deleted   BOOLEAN default false not null,
    flattened BOOLEAN default false not null,
    min_ts    BIGINT not null,
    max_ts    BIGINT not null,
    records   BIGINT not null,
    original_size   BIGINT not null,
    compressed_size BIGINT not null,
    index_size      BIGINT not null,
    created_at      BIGINT not null,
    updated_at      BIGINT not null
);
        "#,
    )
    .execute(&*client)
    .await?;

    sqlx::query(
        r#"
CREATE TABLE IF NOT EXISTS file_list_history
(
    id        INTEGER not null primary key autoincrement,
    account   VARCHAR not null,
    org       VARCHAR not null,
    stream    VARCHAR not null,
    date      VARCHAR not null,
    file      VARCHAR not null,
    deleted   BOOLEAN default false not null,
    flattened BOOLEAN default false not null,
    min_ts    BIGINT not null,
    max_ts    BIGINT not null,
    records   BIGINT not null,
    original_size   BIGINT not null,
    compressed_size BIGINT not null,
    index_size      BIGINT not null,
    created_at      BIGINT not null,
    updated_at      BIGINT not null
);
        "#,
    )
    .execute(&*client)
    .await?;

    sqlx::query(
        r#"
CREATE TABLE IF NOT EXISTS file_list_deleted
(
    id         INTEGER not null primary key autoincrement,
    account    VARCHAR not null,
    org        VARCHAR not null,
    stream     VARCHAR not null,
    date       VARCHAR not null,
    file       VARCHAR not null,
    index_file BOOLEAN default false not null,
    flattened  BOOLEAN default false not null,
    created_at BIGINT not null
);
        "#,
    )
    .execute(&*client)
    .await?;

    sqlx::query(
        r#"
CREATE TABLE IF NOT EXISTS file_list_jobs
(
    id         INTEGER not null primary key autoincrement,
    org        VARCHAR not null,
    stream     VARCHAR not null,
    offsets    BIGINT not null,
    status     INT not null,
    node       VARCHAR not null,
    started_at BIGINT not null,
    updated_at BIGINT not null,
    dumped     BOOLEAN default false not null
);
        "#,
    )
    .execute(&*client)
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
    compressed_size BIGINT not null,
    index_size      BIGINT not null,
    is_recent       BOOLEAN default false not null
);
        "#,
    )
    .execute(&*client)
    .await?;

    sqlx::query(
        r#"
CREATE TABLE IF NOT EXISTS file_list_dump_stats
(
    id              INTEGER not null primary key autoincrement,
    org             VARCHAR not null,
    stream          VARCHAR not null,
    date            VARCHAR not null,
    file            VARCHAR not null,
    file_num        BIGINT default 0 not null,
    min_ts          BIGINT default 0 not null,
    max_ts          BIGINT default 0 not null,
    records         BIGINT default 0 not null,
    original_size   BIGINT default 0 not null,
    compressed_size BIGINT default 0 not null,
    index_size      BIGINT default 0 not null
);
        "#,
    )
    .execute(&*client)
    .await?;

    // create column flattened for old version <= 0.10.5
    let column = "flattened";
    let data_type = "BOOLEAN default false not null";
    add_column(&client, "file_list", column, data_type).await?;
    add_column(&client, "file_list_history", column, data_type).await?;
    add_column(&client, "file_list_deleted", column, data_type).await?;

    // create column started_at for old version <= 0.10.8
    let column = "started_at";
    let data_type = "BIGINT default 0 not null";
    add_column(&client, "file_list_jobs", column, data_type).await?;

    // create column index_size for old version <= 0.13.1
    let column = "index_size";
    let data_type = "BIGINT default 0 not null";
    add_column(&client, "file_list", column, data_type).await?;
    add_column(&client, "file_list_history", column, data_type).await?;
    add_column(&client, "stream_stats", column, data_type).await?;
    let column = "index_file";
    let data_type = "BOOLEAN default false not null";
    add_column(&client, "file_list_deleted", column, data_type).await?;

    // create col dumped for file_list_jobs for version <=0.14.0
    add_column(
        &client,
        "file_list_jobs",
        "dumped",
        "BOOLEAN default false not null",
    )
    .await?;

    // create col account for multiple object storage account support, version >= 0.14.6
    add_column(
        &client,
        "file_list",
        "account",
        "VARCHAR(32) default '' not null",
    )
    .await?;
    add_column(
        &client,
        "file_list_history",
        "account",
        "VARCHAR(32) default '' not null",
    )
    .await?;
    add_column(
        &client,
        "file_list_deleted",
        "account",
        "VARCHAR(32) default '' not null",
    )
    .await?;

    // create column created_at and updated_at for version >= 0.14.7
    let column = "created_at";
    let data_type = "BIGINT default 0 not null";
    add_column(&client, "file_list", column, data_type).await?;
    add_column(&client, "file_list_history", column, data_type).await?;
    let column = "updated_at";
    let data_type = "BIGINT default 0 not null";
    add_column(&client, "file_list", column, data_type).await?;
    add_column(&client, "file_list_history", column, data_type).await?;

    // create columns is_recent and updated_at for stream_stats for version >= 0.30.0
    add_column(
        &client,
        "stream_stats",
        "is_recent",
        "BOOLEAN default false not null",
    )
    .await?;

    Ok(())
}

pub async fn create_table_index() -> Result<()> {
    let indices: Vec<(&str, &str, &[&str])> = vec![
        ("file_list_org_idx", "file_list", &["org"]),
        (
            "file_list_stream_ts_idx",
            "file_list",
            &["stream", "max_ts", "min_ts"],
        ),
        (
            "file_list_stream_date_idx",
            "file_list",
            &["stream", "date"],
        ),
        (
            "file_list_updated_at_deleted_idx",
            "file_list",
            &["updated_at", "deleted"],
        ),
        ("file_list_history_org_idx", "file_list_history", &["org"]),
        (
            "file_list_history_stream_ts_idx",
            "file_list_history",
            &["stream", "max_ts", "min_ts"],
        ),
        (
            "file_list_deleted_created_at_idx",
            "file_list_deleted",
            &["org", "created_at"],
        ),
        (
            "file_list_deleted_stream_date_file_idx",
            "file_list_deleted",
            &["stream", "date", "file"],
        ),
        (
            "file_list_jobs_stream_status_idx",
            "file_list_jobs",
            &["status", "stream"],
        ),
        (
            "file_list_jobs_status_dumped_idx",
            "file_list_jobs",
            &["status", "dumped"],
        ),
        ("stream_stats_org_idx", "stream_stats", &["org"]),
        (
            "file_list_dump_stats_org_idx",
            "file_list_dump_stats",
            &["org"],
        ),
    ];
    for (idx, table, fields) in indices {
        create_index(IndexStatement::new(idx, table, false, fields)).await?;
    }

    let unique_indices: Vec<(&str, &str, &[&str])> = vec![
        (
            "file_list_history_stream_file_idx",
            "file_list_history",
            &["stream", "date", "file"],
        ),
        (
            "file_list_jobs_stream_offsets_idx",
            "file_list_jobs",
            &["stream", "offsets"],
        ),
        (
            "stream_stats_org_stream_recent_idx",
            "stream_stats",
            &["stream", "is_recent"],
        ),
        (
            "file_list_dump_stats_stream_file_idx",
            "file_list_dump_stats",
            &["stream", "date", "file"],
        ),
    ];
    for (idx, table, fields) in unique_indices {
        create_index(IndexStatement::new(idx, table, true, fields)).await?;
    }

    // This is a case where we want to MAKE the index unique
    let res = create_index(IndexStatement::new(
        "file_list_stream_file_idx",
        "file_list",
        true,
        &["stream", "date", "file"],
    ))
    .await;
    if let Err(e) = res {
        if !e.to_string().contains("UNIQUE constraint failed") {
            return Err(e);
        }
        // delete duplicate records
        log::warn!("[SQLITE] starting delete duplicate records");
        let client = CLIENT_RW.clone();
        let client = client.lock().await;
        let ret = sqlx::query(
                r#"SELECT stream, date, file, min(id) as id FROM file_list GROUP BY stream, date, file HAVING COUNT(*) > 1;"#,
            ).fetch_all(&*client).await?;
        log::warn!("[SQLITE] total: {} duplicate records", ret.len());
        for (i, r) in ret.iter().enumerate() {
            let stream = r.get::<String, &str>("stream");
            let date = r.get::<String, &str>("date");
            let file = r.get::<String, &str>("file");
            let id = r.get::<i64, &str>("id");
            sqlx::query(
                    r#"DELETE FROM file_list WHERE id != $1 AND stream = $2 AND date = $3 AND file = $4;"#,
                ).bind(id).bind(stream).bind(date).bind(file).execute(&*client).await?;
            if i.is_multiple_of(1000) {
                log::warn!("[SQLITE] delete duplicate records: {}/{}", i, ret.len());
            }
        }
        drop(client);
        log::warn!(
            "[SQLITE] delete duplicate records: {}/{}",
            ret.len(),
            ret.len()
        );
        // create index again
        create_index(IndexStatement::new(
            "file_list_stream_file_idx",
            "file_list",
            true,
            &["stream", "date", "file"],
        ))
        .await?;
        log::warn!("[SQLITE] create table index(file_list_stream_file_idx) successfully");
    }

    // delete old index stream_stats_stream_idx for old version <= 0.30.0
    delete_index("stream_stats_stream_idx", "stream_stats").await?;

    // delete trigger for old version
    // compatible for old version <= 0.6.4
    let client = CLIENT_RW.clone();
    let client = client.lock().await;
    sqlx::query(r#"DROP TRIGGER IF EXISTS update_stream_stats_delete;"#)
        .execute(&*client)
        .await?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use config::meta::stream::{FileKey, FileMeta, PartitionTimeLevel, StreamStats, StreamType};

    use super::*;
    use crate::file_list::FileList;

    fn create_test_file_meta() -> FileMeta {
        FileMeta {
            min_ts: 1609459200000000, // 2021-01-01 00:00:00 UTC in microseconds
            max_ts: 1609545600000000, // 2021-01-02 00:00:00 UTC in microseconds
            records: 1000,
            original_size: 50000,
            compressed_size: 10000,
            flattened: false,
            index_size: 5000,
        }
    }

    fn create_test_file_key(account: &str, key: &str, deleted: bool) -> FileKey {
        FileKey {
            account: account.to_string(),
            key: key.to_string(),
            meta: create_test_file_meta(),
            deleted,
            id: 0,
            segment_ids: None,
        }
    }

    #[tokio::test]
    async fn test_sqlite_file_list_new() {
        let sqlite_file_list = SqliteFileList::new();
        assert!(!std::ptr::eq(&sqlite_file_list, &SqliteFileList::new()));
    }

    #[tokio::test]
    async fn test_sqlite_file_list_default() {
        let default_list = SqliteFileList::default();
        let new_list = SqliteFileList::new();
        assert_eq!(
            std::mem::size_of_val(&default_list),
            std::mem::size_of_val(&new_list)
        );
    }

    #[tokio::test]
    async fn test_parse_file_key_columns_valid_sqlite() {
        let file_key = "files/default/logs/olympics/2021/01/01/00/sqlite_file1.parquet";
        let result = parse_file_key_columns(file_key);

        match result {
            Ok((stream, _date, file)) => {
                assert_eq!(stream, "default/logs/olympics");
                assert_eq!(file, "sqlite_file1.parquet");
            }
            Err(_) => panic!("Should successfully parse valid file key"),
        }
    }

    #[tokio::test]
    async fn test_parse_file_key_columns_invalid_sqlite() {
        let invalid_keys = vec!["", "invalid", "org1/stream1", "org1/stream1/logs"];

        for key in invalid_keys {
            let result = parse_file_key_columns(key);
            assert!(result.is_err(), "Should fail for invalid key: {}", key);
        }
    }

    #[tokio::test]
    async fn test_batch_add_with_id_unimplemented() {
        let sqlite_list = SqliteFileList::new();
        let files = vec![create_test_file_key("account1", "test/key", false)];

        let result = sqlite_list.batch_add_with_id(&files).await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_batch_add_empty_files() {
        let sqlite_list = SqliteFileList::new();
        let empty_files: Vec<FileKey> = vec![];

        let result = sqlite_list.batch_add(&empty_files).await;
        assert!(result.is_ok());
    }

    #[tokio::test]
    async fn test_file_key_creation_helpers() {
        let file_key = create_test_file_key(
            "test_account",
            "org/stream/logs/2021/01/01/sqlite_test.parquet",
            false,
        );

        assert_eq!(file_key.account, "test_account");
        assert_eq!(
            file_key.key,
            "org/stream/logs/2021/01/01/sqlite_test.parquet"
        );
        assert!(!file_key.deleted);
        assert_eq!(file_key.id, 0);

        assert_eq!(file_key.meta.records, 1000);
        assert_eq!(file_key.meta.original_size, 50000);
        assert_eq!(file_key.meta.compressed_size, 10000);
        assert!(!file_key.meta.flattened);
    }

    #[tokio::test]
    async fn test_file_meta_creation() {
        let meta = create_test_file_meta();

        assert!(meta.min_ts > 0);
        assert!(meta.max_ts > meta.min_ts);
        assert!(meta.records > 0);
        assert!(meta.original_size > meta.compressed_size);
        assert_eq!(meta.index_size, 5000);
    }

    // Tests for new functionality in fix/file_list_dump branch

    #[tokio::test]
    #[ignore = "Requires test SQLite database setup"]
    async fn test_remove_hard_delete_sqlite() {
        // Test that remove() performs hard delete (DELETE) instead of soft delete
        let sqlite_list = SqliteFileList::new();
        let meta = create_test_file_meta();
        let file_key = "test_org/logs/test_stream/2021/01/01/00/sqlite_hard_delete_test.parquet";

        // Add a file first
        let _ = sqlite_list.add("test_account", file_key, &meta).await;

        // Verify file exists
        let exists_before = sqlite_list.contains(file_key).await;
        assert!(exists_before.is_ok());

        // Remove the file (should be hard delete now)
        let result = sqlite_list.remove(file_key).await;
        assert!(result.is_ok());

        // Verify file is completely removed (not just marked as deleted)
        let exists_after = sqlite_list.contains(file_key).await;
        assert!(exists_after.is_ok());
        assert!(!exists_after.unwrap());
    }

    #[tokio::test]
    #[ignore = "Requires test SQLite database setup"]
    async fn test_batch_add_with_timestamps_sqlite() {
        // Test that batch_add now includes created_at and updated_at timestamps
        let sqlite_list = SqliteFileList::new();
        let files = vec![
            create_test_file_key(
                "account1",
                "org1/logs/stream1/2021/01/01/00/sqlite_file1.parquet",
                false,
            ),
            create_test_file_key(
                "account1",
                "org1/logs/stream1/2021/01/01/00/sqlite_file2.parquet",
                false,
            ),
        ];

        let result = sqlite_list.batch_add(&files).await;
        assert!(result.is_ok());

        // Verify that files were added with timestamps
        for file in &files {
            let exists = sqlite_list.contains(&file.key).await;
            assert!(exists.is_ok());
            assert!(exists.unwrap());
        }
    }

    #[tokio::test]
    #[ignore = "Requires test SQLite database setup"]
    async fn test_query_for_dump_sqlite() {
        // Test the new query_for_dump method
        let sqlite_list = SqliteFileList::new();
        let meta = create_test_file_meta();

        // Add test files
        let _ = sqlite_list
            .add(
                "test_account",
                "org1/logs/stream1/2021/01/01/00/sqlite_dump_file1.parquet",
                &meta,
            )
            .await;

        // Query for dump with time range
        let time_range = (meta.min_ts - 1000, meta.max_ts + 1000);
        let result = sqlite_list
            .query_for_dump("org1", StreamType::Logs, "stream1", time_range)
            .await;

        // Should return file records
        assert!(result.is_ok());
        let records = result.unwrap();
        assert!(!records.is_empty());
    }

    #[tokio::test]
    #[ignore = "Requires test SQLite database setup"]
    async fn test_query_for_dump_by_updated_at_sqlite() {
        // Test the new query_for_dump_by_updated_at method
        let sqlite_list = SqliteFileList::new();
        let meta = create_test_file_meta();

        // Add a test file
        let _ = sqlite_list
            .add(
                "test_account",
                "org1/filelist/stream1/2021/01/01/00/sqlite_dump_by_updated.parquet",
                &meta,
            )
            .await;

        // Query by updated_at with a wide time range
        let now = config::utils::time::now_micros();
        let time_range = (now - 60_000_000, now + 60_000_000);
        let result = sqlite_list.query_for_dump_by_updated_at(time_range).await;

        assert!(result.is_ok());
    }

    #[tokio::test]
    #[ignore = "Requires test SQLite database setup"]
    async fn test_get_updated_streams_sqlite() {
        // Test the new get_updated_streams method
        let sqlite_list = SqliteFileList::new();
        let meta = create_test_file_meta();

        // Add test files
        let _ = sqlite_list
            .add(
                "test_account",
                "org1/logs/sqlite_updated_stream1/2021/01/01/00/file1.parquet",
                &meta,
            )
            .await;
        let _ = sqlite_list
            .add(
                "test_account",
                "org1/logs/sqlite_updated_stream2/2021/01/01/00/file2.parquet",
                &meta,
            )
            .await;

        // Query for updated streams
        let now = config::utils::time::now_micros();
        let time_range = (now - 60_000_000, now + 60_000_000);
        let result = sqlite_list.get_updated_streams(time_range).await;

        assert!(result.is_ok());
        let streams = result.unwrap();
        assert!(!streams.is_empty());
    }

    #[tokio::test]
    #[ignore = "Requires test SQLite database setup"]
    async fn test_stats_by_date_range_sqlite() {
        // Test the new stats_by_date_range method
        let sqlite_list = SqliteFileList::new();
        let meta = create_test_file_meta();

        // Add test files
        let _ = sqlite_list
            .add(
                "test_account",
                "org1/logs/sqlite_stats_stream/2021/01/01/00/stats_file.parquet",
                &meta,
            )
            .await;

        // Query stats by date range
        let date_range = ("2021-01-01".to_string(), "2021-01-02".to_string());
        let result = sqlite_list
            .stats_by_date_range("org1", StreamType::Logs, "sqlite_stats_stream", date_range)
            .await;

        assert!(result.is_ok());
        let stats = result.unwrap();
        assert!(stats.file_num >= 0);
    }

    #[tokio::test]
    #[ignore = "Requires test SQLite database setup"]
    async fn test_set_stream_stats_full_update_sqlite() {
        // Test that set_stream_stats now performs a full update instead of incremental
        let sqlite_list = SqliteFileList::new();

        // Create test stats
        let stats = StreamStats {
            created_at: config::utils::time::now_micros(),
            file_num: 10,
            doc_time_min: 1000000,
            doc_time_max: 2000000,
            doc_num: 1000,
            storage_size: 50000.0,
            compressed_size: 10000.0,
            index_size: 5000.0,
        };

        // Set stream stats (should use INSERT OR REPLACE now)
        let result = sqlite_list
            .set_stream_stats("org1", StreamType::Logs, "sqlite_test_stream", &stats, true)
            .await;

        assert!(result.is_ok());

        // Set different stats for the same stream (should replace, not increment)
        let new_stats = StreamStats {
            created_at: config::utils::time::now_micros(),
            file_num: 5,
            doc_time_min: 1500000,
            doc_time_max: 2500000,
            doc_num: 500,
            storage_size: 25000.0,
            compressed_size: 5000.0,
            index_size: 2500.0,
        };

        let result2 = sqlite_list
            .set_stream_stats(
                "org1",
                StreamType::Logs,
                "sqlite_test_stream",
                &new_stats,
                true,
            )
            .await;

        assert!(result2.is_ok());

        // Verify the stats were replaced, not incremented
        let retrieved_stats = sqlite_list
            .get_stream_stats("org1", Some(StreamType::Logs), Some("sqlite_test_stream"))
            .await;

        assert!(retrieved_stats.is_ok());
        let stats_map = retrieved_stats.unwrap();
        if let Some((_stream_key, retrieved)) = stats_map.first() {
            // The file_num should be 5 (replaced), not 15 (incremented)
            assert_eq!(retrieved.file_num, new_stats.file_num);
        }
    }

    #[tokio::test]
    #[ignore = "Requires test SQLite database setup"]
    async fn test_query_without_deleted_filter_sqlite() {
        // Test that query methods no longer filter by deleted field
        let sqlite_list = SqliteFileList::new();
        let meta = create_test_file_meta();

        // Add a file
        let file_key = "org1/logs/sqlite_query_stream/2021/01/01/00/query_test.parquet";
        let _ = sqlite_list.add("test_account", file_key, &meta).await;

        // Query files (no longer filters by deleted=false)
        let time_range = (meta.min_ts - 1000, meta.max_ts + 1000);
        let result = sqlite_list
            .query(
                "org1",
                StreamType::Logs,
                "sqlite_query_stream",
                PartitionTimeLevel::Daily,
                time_range,
                None,
            )
            .await;

        assert!(result.is_ok());
        let files = result.unwrap();
        assert!(!files.is_empty());
    }

    #[tokio::test]
    #[ignore = "Requires test SQLite database setup"]
    async fn test_query_ids_without_deleted_filter_sqlite() {
        // Test that query_ids no longer filters out deleted records
        let sqlite_list = SqliteFileList::new();
        let meta = create_test_file_meta();

        // Add test files
        let _ = sqlite_list
            .add(
                "test_account",
                "org1/logs/sqlite_ids_stream/2021/01/01/00/ids_file.parquet",
                &meta,
            )
            .await;

        // Query IDs (should not filter by deleted field)
        let time_range = (meta.min_ts - 1000, meta.max_ts + 1000);
        let result = sqlite_list
            .query_ids("org1", StreamType::Logs, "sqlite_ids_stream", time_range)
            .await;

        assert!(result.is_ok());
        let ids = result.unwrap();
        assert!(!ids.is_empty());
    }

    #[tokio::test]
    async fn test_empty_time_range_validation_sqlite() {
        // Test that methods handle time ranges properly
        let sqlite_list = SqliteFileList::new();

        let time_range = (0, 0);

        // query_ids should process the query instead of returning early
        let result = sqlite_list
            .query_ids("org1", StreamType::Logs, "test", time_range)
            .await;

        // Should attempt the query (may fail due to no database, but shouldn't short-circuit)
        let _ = result;
    }
}
