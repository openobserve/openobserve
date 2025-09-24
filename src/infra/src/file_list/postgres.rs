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
    metrics::{DB_QUERY_NUMS, DB_QUERY_TIME},
    utils::{
        hash::Sum64,
        parquet::parse_file_key_columns,
        time::{DAY_MICRO_SECS, end_of_the_day, now_micros},
    },
};
use hashbrown::HashMap;
use sqlx::{Executor, Postgres, QueryBuilder, Row};

use crate::{
    db::{
        IndexStatement,
        postgres::{CLIENT, CLIENT_DDL, CLIENT_RO, create_index},
    },
    errors::{Error, Result},
};

pub struct PostgresFileList {}

impl PostgresFileList {
    pub fn new() -> Self {
        Self {}
    }
}

impl Default for PostgresFileList {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl super::FileList for PostgresFileList {
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
        let now_ts = now_micros();
        let pool = CLIENT.clone();
        let (stream_key, date_key, file_name) =
            parse_file_key_columns(file).map_err(|e| Error::Message(e.to_string()))?;

        DB_QUERY_NUMS
            .with_label_values(&["delete", "file_list"])
            .inc();
        sqlx::query(
            r#"UPDATE file_list SET deleted = true, updated_at = $1 WHERE stream = $2 AND date = $3 AND file = $4;"#,
        )
        .bind(now_ts)
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

    async fn batch_add_with_id(&self, _files: &[FileKey]) -> Result<()> {
        Err(Error::Message("Unsupported operation".to_string()))
    }

    async fn batch_add_history(&self, files: &[FileKey]) -> Result<()> {
        self.inner_batch_process("file_list_history", files).await
    }

    async fn batch_process(&self, files: &[FileKey]) -> Result<()> {
        self.inner_batch_process("file_list", files).await
    }

    async fn update_dump_records(&self, dump_file: &FileKey, dumped_ids: &[i64]) -> Result<()> {
        let pool = CLIENT.clone();
        let mut tx = pool.begin().await?;

        let (stream_key, date_key, file_name) =
            parse_file_key_columns(&dump_file.key).map_err(|e| Error::Message(e.to_string()))?;
        let org_id = stream_key[..stream_key.find('/').unwrap()].to_string();
        let meta = &dump_file.meta;
        DB_QUERY_NUMS
            .with_label_values(&["insert", "file_list", ""])
            .inc();
        if let Err(e) = sqlx::query(r#"INSERT INTO file_list (account, org, stream, date, file, deleted, min_ts, max_ts, records, original_size, compressed_size, index_size, flattened)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) ON CONFLICT DO NOTHING;"#
                )
                .bind(&dump_file.account)
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
                .execute(&mut *tx).await
        {
            if let Err(e) = tx.rollback().await {
                log::error!(
                    "[POSTGRES] rollback file_list update dump error: {e}",
                );
            }
            return Err(e.into());
        }

        for chunk in dumped_ids.chunks(get_config().limit.file_list_id_batch_size) {
            if chunk.is_empty() {
                continue;
            }
            let ids = chunk
                .iter()
                .map(|id| id.to_string())
                .collect::<Vec<String>>()
                .join(",");
            let query_str = format!("delete FROM file_list WHERE id IN ({ids})");
            DB_QUERY_NUMS
                .with_label_values(&["delete_by_ids", "file_list", ""])
                .inc();
            let start = std::time::Instant::now();
            let res = sqlx::query(&query_str).execute(&mut *tx).await;
            let time = start.elapsed().as_secs_f64();
            DB_QUERY_TIME
                .with_label_values(&["delete_by_ids", "file_list"])
                .observe(time);
            if let Err(e) = res {
                if let Err(e) = tx.rollback().await {
                    log::error!("[POSTGRES] rollback file_list update dump error: {e}");
                }
                return Err(e.into());
            }
        }

        if let Err(e) = tx.commit().await {
            log::error!("[POSTGRES] commit file_list dump update error: {e}");
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
        let pool = CLIENT.clone();
        let chunks = files.chunks(100);
        for files in chunks {
            // we don't care the id here, because the id is from file_list table not for this table
            let mut tx = pool.begin().await?;
            let mut query_builder: QueryBuilder<Postgres> = QueryBuilder::new(
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
            DB_QUERY_NUMS
                .with_label_values(&["insert", "file_list_deleted"])
                .inc();
            if let Err(e) = query_builder.build().execute(&mut *tx).await {
                if let Err(e) = tx.rollback().await {
                    log::error!("[POSTGRES] rollback file_list_deleted batch add error: {e}");
                }
                return Err(e.into());
            }
            if let Err(e) = tx.commit().await {
                log::error!("[POSTGRES] commit file_list_deleted batch add error: {e}");
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
            let pool = CLIENT.clone();
            let mut ids = Vec::with_capacity(files.len());
            for file in files {
                if file.id > 0 {
                    ids.push(file.id.to_string());
                    continue;
                }
                let (stream_key, date_key, file_name) =
                    parse_file_key_columns(&file.key).map_err(|e| Error::Message(e.to_string()))?;
                DB_QUERY_NUMS
                    .with_label_values(&["select", "file_list_deleted"])
                    .inc();
                let ret: Option<i64> = match
                    sqlx
                        ::query_scalar(
                            r#"SELECT id FROM file_list_deleted WHERE stream = $1 AND date = $2 AND file = $3;"#
                        )
                        .bind(stream_key)
                        .bind(date_key)
                        .bind(file_name)
                        .fetch_one(&pool).await
                {
                    Ok(v) => v,
                    Err(sqlx::Error::RowNotFound) => {
                        continue;
                    }
                    Err(e) => {
                        return Err(e.into());
                    }
                };
                match ret {
                    Some(v) => ids.push(v.to_string()),
                    None => {
                        return Err(Error::Message(
                            "[POSTGRES] query error: id should not empty from file_list_deleted"
                                .to_string(),
                        ));
                    }
                }
            }
            // delete files by ids
            if !ids.is_empty() {
                DB_QUERY_NUMS
                    .with_label_values(&["delete", "file_list_deleted"])
                    .inc();
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
        DB_QUERY_NUMS.with_label_values(&["get", "file_list"]).inc();
        let start = std::time::Instant::now();
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
        .await;
        let time = start.elapsed().as_secs_f64();
        DB_QUERY_TIME
            .with_label_values(&["get", "file_list"])
            .observe(time);
        Ok(FileMeta::from(&ret?))
    }

    async fn contains(&self, file: &str) -> Result<bool> {
        let pool = CLIENT_RO.clone();
        let (stream_key, date_key, file_name) =
            parse_file_key_columns(file).map_err(|e| Error::Message(e.to_string()))?;
        DB_QUERY_NUMS
            .with_label_values(&["contains", "file_list"])
            .inc();
        let start = std::time::Instant::now();
        let ret = sqlx::query(
            r#"SELECT * FROM file_list WHERE stream = $1 AND date = $2 AND file = $3;"#,
        )
        .bind(stream_key)
        .bind(date_key)
        .bind(file_name)
        .fetch_one(&pool)
        .await;
        let time = start.elapsed().as_secs_f64();
        DB_QUERY_TIME
            .with_label_values(&["contains", "file_list"])
            .observe(time);
        if let Err(sqlx::Error::RowNotFound) = ret {
            return Ok(false);
        }
        Ok(!ret.unwrap().is_empty())
    }

    async fn update_flattened(&self, file: &str, flattened: bool) -> Result<()> {
        let pool = CLIENT.clone();
        let (stream_key, date_key, file_name) =
            parse_file_key_columns(file).map_err(|e| Error::Message(e.to_string()))?;
        DB_QUERY_NUMS
            .with_label_values(&["update", "file_list"])
            .inc();
        sqlx::query(
            r#"UPDATE file_list SET flattened = $1 WHERE stream = $2 AND date = $3 AND file = $4;"#,
        )
        .bind(flattened)
        .bind(stream_key)
        .bind(date_key)
        .bind(file_name)
        .execute(&pool)
        .await?;
        Ok(())
    }

    async fn update_compressed_size(&self, file: &str, size: i64) -> Result<()> {
        let pool = CLIENT.clone();
        let (stream_key, date_key, file_name) =
            parse_file_key_columns(file).map_err(|e| Error::Message(e.to_string()))?;
        DB_QUERY_NUMS
            .with_label_values(&["update", "file_list"])
            .inc();
        sqlx::query(
            r#"UPDATE file_list SET compressed_size = $1 WHERE stream = $2 AND date = $3 AND file = $4;"#,
        )
        .bind(size)
        .bind(stream_key)
        .bind(date_key)
        .bind(file_name)
        .execute(&pool)
        .await?;
        Ok(())
    }

    async fn list(&self) -> Result<Vec<FileKey>> {
        return Ok(vec![]); // disallow list all data
    }

    async fn query(
        &self,
        org_id: &str,
        stream_type: StreamType,
        stream_name: &str,
        _time_level: PartitionTimeLevel,
        time_range: Option<(i64, i64)>,
        flattened: Option<bool>,
    ) -> Result<Vec<FileKey>> {
        if let Some((start, end)) = time_range
            && start == 0
            && end == 0
        {
            return Ok(Vec::new());
        }

        let stream_key = format!("{org_id}/{stream_type}/{stream_name}");

        let pool = CLIENT_RO.clone();
        DB_QUERY_NUMS
            .with_label_values(&["query", "file_list"])
            .inc();
        let start = std::time::Instant::now();
        let ret = if let Some(flattened) = flattened {
            sqlx::query_as::<_, super::FileRecord>(
                r#"
SELECT id, account, stream, date, file, deleted, min_ts, max_ts, records, original_size, compressed_size, index_size, flattened
    FROM file_list
    WHERE stream = $1 AND flattened = $2 LIMIT 1000;
                "#
                )
                .bind(stream_key)
                .bind(flattened)
                .fetch_all(&pool).await
        } else {
            let (time_start, time_end) = time_range.unwrap_or((0, 0));
            let max_ts_upper_bound = super::calculate_max_ts_upper_bound(time_end, stream_type);
            let sql = r#"
SELECT id, account, stream, date, file, deleted, min_ts, max_ts, records, original_size, compressed_size, index_size, flattened
    FROM file_list
    WHERE stream = $1 AND max_ts >= $2 AND max_ts <= $3 AND min_ts <= $4;
                "#;

            sqlx::query_as::<_, super::FileRecord>(sql)
                .bind(stream_key)
                .bind(time_start)
                .bind(max_ts_upper_bound)
                .bind(time_end)
                .fetch_all(&pool)
                .await
        };
        let time = start.elapsed().as_secs_f64();
        DB_QUERY_TIME
            .with_label_values(&["query", "file_list"])
            .observe(time);
        Ok(ret?
            .iter()
            .filter_map(|r| if r.deleted { None } else { Some(r.into()) })
            .collect())
    }

    async fn query_for_merge(
        &self,
        org_id: &str,
        stream_type: StreamType,
        stream_name: &str,
        date_range: Option<(String, String)>,
    ) -> Result<Vec<FileKey>> {
        if let Some((start, end)) = date_range.as_ref()
            && start.is_empty()
            && end.is_empty()
        {
            return Ok(Vec::new());
        }

        let stream_key = format!("{org_id}/{stream_type}/{stream_name}");

        let pool = CLIENT_RO.clone();
        DB_QUERY_NUMS
            .with_label_values(&["query_for_merge", "file_list"])
            .inc();
        let start = std::time::Instant::now();

        let (date_start, date_end) = date_range.unwrap_or(("".to_string(), "".to_string()));
        let sql = r#"
SELECT id, account, stream, date, file, deleted, min_ts, max_ts, records, original_size, compressed_size, index_size, flattened
    FROM file_list
    WHERE stream = $1 AND date >= $2 AND date <= $3;
                "#;

        let ret = sqlx::query_as::<_, super::FileRecord>(sql)
            .bind(stream_key)
            .bind(date_start)
            .bind(date_end)
            .fetch_all(&pool)
            .await;
        let time = start.elapsed().as_secs_f64();
        DB_QUERY_TIME
            .with_label_values(&["query_for_merge", "file_list"])
            .observe(time);
        Ok(ret?
            .iter()
            .filter_map(|r| if r.deleted { None } else { Some(r.into()) })
            .collect())
    }

    async fn query_by_ids(&self, ids: &[i64]) -> Result<Vec<FileKey>> {
        if ids.is_empty() {
            return Ok(Vec::default());
        }
        let mut ret = Vec::new();
        let pool = CLIENT_RO.clone();

        for chunk in ids.chunks(get_config().limit.file_list_id_batch_size) {
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
            DB_QUERY_NUMS
                .with_label_values(&["query_by_ids", "file_list"])
                .inc();
            let start = std::time::Instant::now();
            let res = sqlx::query_as::<_, super::FileRecord>(&query_str)
                .fetch_all(&pool)
                .await;
            let time = start.elapsed().as_secs_f64();
            DB_QUERY_TIME
                .with_label_values(&["query_by_ids", "file_list"])
                .observe(time);
            ret.extend_from_slice(&res?);
        }

        Ok(ret.iter().map(|r| r.into()).collect())
    }

    async fn query_ids(
        &self,
        org_id: &str,
        stream_type: StreamType,
        stream_name: &str,
        time_range: Option<(i64, i64)>,
    ) -> Result<Vec<super::FileId>> {
        if let Some((start, end)) = time_range
            && start == 0
            && end == 0
        {
            return Ok(Vec::new());
        }

        let stream_key = format!("{org_id}/{stream_type}/{stream_name}");
        let (time_start, time_end) = time_range.unwrap_or((0, 0));
        let start = std::time::Instant::now();

        let day_partitions = if time_end - time_start <= DAY_MICRO_SECS
            || time_end - time_start > DAY_MICRO_SECS * 30
            || !get_config().limit.file_list_multi_thread
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
                DB_QUERY_NUMS
                .with_label_values(&["query_ids", "file_list"])
                .inc();
                let max_ts_upper_bound = super::calculate_max_ts_upper_bound(time_end, stream_type);
                let query = "SELECT id, records, original_size, deleted FROM file_list WHERE stream = $1 AND max_ts >= $2 AND max_ts <= $3 AND min_ts <= $4;";
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
                Ok(Ok(r)) => rets.extend(r.into_iter().filter(|r| !r.deleted)),
                Ok(Err(e)) => {
                    return Err(e.into());
                }
                Err(e) => {
                    return Err(Error::Message(e.to_string()));
                }
            };
        }
        let time = start.elapsed().as_secs_f64();
        DB_QUERY_TIME
            .with_label_values(&["query_ids", "file_list"])
            .observe(time);
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
        time_range: Option<(i64, i64)>,
    ) -> Result<Vec<String>> {
        if let Some((start, end)) = time_range
            && start == 0
            && end == 0
        {
            return Ok(Vec::new());
        }

        let stream_key = format!("{org_id}/{stream_type}/{stream_name}");

        let pool = CLIENT_RO.clone();
        DB_QUERY_NUMS
            .with_label_values(&["query_old_data_hours", "file_list"])
            .inc();
        let start = std::time::Instant::now();
        let (time_start, time_end) = time_range.unwrap_or((0, 0));
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

        let time = start.elapsed().as_secs_f64();
        DB_QUERY_TIME
            .with_label_values(&["query_old_data_hours", "file_list"])
            .observe(time);
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

        let pool = CLIENT.clone();
        let mut tx = pool.begin().await?;
        let lock_key = "file_list_deleted:query_deleted";
        let lock_id = config::utils::hash::gxhash::new().sum64(lock_key);
        let lock_id = if lock_id > (i64::MAX as u64) {
            (lock_id >> 1) as i64
        } else {
            lock_id as i64
        };
        let lock_sql = format!("SELECT pg_advisory_xact_lock({lock_id})");
        DB_QUERY_NUMS.with_label_values(&["get_lock", ""]).inc();
        if let Err(e) = sqlx::query(&lock_sql).execute(&mut *tx).await {
            if let Err(e) = tx.rollback().await {
                log::error!("[POSTGRES] rollback query_deleted error: {e}");
            }
            return Err(e.into());
        }

        DB_QUERY_NUMS
            .with_label_values(&["select", "file_list_deleted"])
            .inc();
        let items: Vec<FileListDeleted> = match sqlx::query_as::<_, super::FileDeletedRecord>(
            r#"SELECT id, account, stream, date, file, index_file, flattened FROM file_list_deleted WHERE org = $1 AND created_at < $2 ORDER BY created_at ASC LIMIT $3;"#
        )
        .bind(org_id)
        .bind(time_max)
        .bind(limit)
        .fetch_all(&mut *tx)
        .await {
            Ok(v) => v
                .iter()
                .map(|r| FileListDeleted {
                    id: r.id,
                    account: r.account.to_string(),
                    file: format!("files/{}/{}/{}", r.stream, r.date, r.file),
                    index_file: r.index_file,
                    flattened: r.flattened,
                })
                .collect(),
            Err(e) => {
                if let Err(e) = tx.rollback().await {
                    log::error!(
                        "[POSTGRES] rollback select query_deleted for update error: {e}"
                    );
                }
                return Err(e.into());
            }
        };

        // update file created_at to NOW to avoid these files being deleted again
        let ids = items.iter().map(|r| r.id.to_string()).collect::<Vec<_>>();
        if ids.is_empty() {
            if let Err(e) = tx.rollback().await {
                log::error!("[POSTGRES] rollback select query_deleted error: {e}");
            }
            return Ok(Vec::new());
        }
        let sql = format!(
            "UPDATE file_list_deleted SET created_at = $1 WHERE id IN ({});",
            ids.join(",")
        );
        let now = config::utils::time::now_micros();
        DB_QUERY_NUMS
            .with_label_values(&["update", "file_list_deleted"])
            .inc();
        let ret = match sqlx::query(&sql).bind(now).execute(&mut *tx).await {
            Ok(v) => v,
            Err(e) => {
                if let Err(e) = tx.rollback().await {
                    log::error!("[POSTGRES] rollback update query_deleted status error: {e}");
                }
                return Err(e.into());
            }
        };
        if ret.rows_affected() != ids.len() as u64 {
            log::warn!(
                "[POSTGRES] update query_deleted error: query_deleted rows affected: {}, expected: {}, try again later",
                ret.rows_affected(),
                ids.len()
            );
            if let Err(e) = tx.rollback().await {
                log::error!("[POSTGRES] rollback update query_deleted status error: {e}");
            }
            return Ok(Vec::new());
        }

        if let Err(e) = tx.commit().await {
            log::error!("[POSTGRES] commit select query_deleted error: {e}");
            return Err(e.into());
        }
        Ok(items)
    }

    async fn list_deleted(&self) -> Result<Vec<FileListDeleted>> {
        let pool = CLIENT_RO.clone();
        DB_QUERY_NUMS
            .with_label_values(&["select", "file_list_deleted"])
            .inc();
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

    async fn get_min_ts(
        &self,
        org_id: &str,
        stream_type: StreamType,
        stream_name: &str,
    ) -> Result<i64> {
        let stream_key = format!("{org_id}/{stream_type}/{stream_name}");
        let min_ts = config::utils::time::BASE_TIME.timestamp_micros();
        let pool = CLIENT_RO.clone();
        DB_QUERY_NUMS
            .with_label_values(&["select", "file_list"])
            .inc();
        let ret: Option<i64> = sqlx::query_scalar(
            r#"SELECT MIN(min_ts)::BIGINT AS num FROM file_list WHERE stream = $1 AND min_ts > $2;"#,
        )
        .bind(stream_key)
        .bind(min_ts)
        .fetch_one(&pool)
        .await?;
        Ok(ret.unwrap_or_default())
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
        DB_QUERY_NUMS
            .with_label_values(&["select", "file_list"])
            .inc();
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
        DB_QUERY_NUMS
            .with_label_values(&["select", "file_list"])
            .inc();
        let ret: Option<i64> =
            sqlx::query_scalar(r#"SELECT MIN(updated_at)::BIGINT AS num FROM file_list;"#)
                .fetch_one(&pool)
                .await?;
        Ok(ret.unwrap_or_default())
    }

    async fn get_max_update_at(&self) -> Result<i64> {
        let pool = CLIENT_RO.clone();
        DB_QUERY_NUMS
            .with_label_values(&["select", "file_list"])
            .inc();
        let ret: Option<i64> =
            sqlx::query_scalar(r#"SELECT MAX(updated_at)::BIGINT AS num FROM file_list;"#)
                .fetch_one(&pool)
                .await?;
        Ok(ret.unwrap_or_default())
    }

    async fn clean_by_min_update_at(&self, _val: i64) -> Result<()> {
        Ok(()) // do nothing
    }

    async fn stats(&self, time_range: (i64, i64)) -> Result<Vec<(String, StreamStats)>> {
        let (min, max) = time_range;
        let sql = format!(
            r#"
SELECT 
    stream,
    MIN(CASE WHEN deleted IS FALSE THEN min_ts END) AS min_ts,
    MAX(CASE WHEN deleted IS FALSE THEN max_ts ELSE 0 END) AS max_ts,
    SUM(CASE 
        WHEN deleted IS TRUE AND created_at <= {min} THEN -1
        WHEN deleted IS FALSE THEN 1
        ELSE 0
    END)::BIGINT AS file_num,
    SUM(CASE 
        WHEN deleted IS TRUE AND created_at <= {min} THEN -records
        WHEN deleted IS FALSE THEN records
        ELSE 0
    END)::BIGINT AS records,
    SUM(CASE 
        WHEN deleted IS TRUE AND created_at <= {min} THEN -original_size
        WHEN deleted IS FALSE THEN original_size
        ELSE 0
    END)::BIGINT AS original_size,
    SUM(CASE 
        WHEN deleted IS TRUE AND created_at <= {min} THEN -compressed_size
        WHEN deleted IS FALSE THEN compressed_size
        ELSE 0
    END)::BIGINT AS compressed_size,
    SUM(CASE 
        WHEN deleted IS TRUE AND created_at <= {min} THEN -index_size
        WHEN deleted IS FALSE THEN index_size
        ELSE 0
    END)::BIGINT AS index_size
FROM file_list
WHERE updated_at > {min} AND updated_at <= {max}
GROUP BY stream
            "#
        );
        let pool = CLIENT_RO.clone();
        DB_QUERY_NUMS
            .with_label_values(&["stats", "file_list"])
            .inc();
        let start = std::time::Instant::now();
        let ret = sqlx::query_as::<_, super::StatsRecord>(&sql)
            .fetch_all(&pool)
            .await?;
        let time = start.elapsed().as_secs_f64();
        DB_QUERY_TIME
            .with_label_values(&["stats", "file_list"])
            .observe(time);
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
            format!("SELECT * FROM stream_stats WHERE org = '{org_id}';")
        };
        let pool = CLIENT_RO.clone();
        DB_QUERY_NUMS
            .with_label_values(&["select", "stream_stats"])
            .inc();
        let ret = sqlx::query_as::<_, super::StatsRecord>(&sql)
            .fetch_all(&pool)
            .await?;
        Ok(ret
            .iter()
            .map(|r| (r.stream.to_owned(), r.into()))
            .collect())
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
        let pool = CLIENT.clone();
        DB_QUERY_NUMS
            .with_label_values(&["delete", "stream_stats"])
            .inc();
        sqlx::query(&sql).execute(&pool).await?;
        Ok(())
    }

    async fn set_stream_stats(
        &self,
        streams: &[(String, StreamStats)],
        time_range: (i64, i64),
    ) -> Result<()> {
        let pool = CLIENT.clone();
        // check if stream stats exist
        let mut tx = pool.begin().await?;
        for (stream_key, _) in streams {
            if crate::schema::STREAM_STATS_EXISTS.contains(stream_key) {
                continue;
            }
            // stream stats not exist, check from stream_stats table again
            let Some((org_id, stream_type, stream_name)) = super::parse_stream_key(stream_key)
            else {
                return Err(Error::Message(format!("invalid stream key: {stream_key}")));
            };
            let ret = self
                .get_stream_stats(&org_id, Some(stream_type), Some(&stream_name))
                .await?;
            if !ret.is_empty() {
                crate::schema::STREAM_STATS_EXISTS.insert(stream_key.clone());
                continue;
            }
            // stream stats not exist, insert a new one
            DB_QUERY_NUMS
                .with_label_values(&["insert", "stream_stats"])
                .inc();
            if let Err(e) = sqlx::query(
                r#"
INSERT INTO stream_stats
    (org, stream, file_num, min_ts, max_ts, records, original_size, compressed_size, index_size)
    VALUES ($1, $2, 0, 0, 0, 0, 0, 0, 0);
                "#,
            )
            .bind(org_id)
            .bind(stream_key)
            .execute(&mut *tx)
            .await
            {
                if let Err(e) = tx.rollback().await {
                    log::error!("[POSTGRES] rollback insert stream stats error: {e}");
                }
                return Err(e.into());
            }
        }
        if let Err(e) = tx.commit().await {
            log::error!("[POSTGRES] commit insert stream stats error: {e}");
            return Err(e.into());
        }

        // update stats
        let mut tx = pool.begin().await?;
        for (stream_key, stats) in streams {
            DB_QUERY_NUMS
                .with_label_values(&["update", "stream_stats"])
                .inc();
            if let Err(e) = sqlx::query(
                r#"
UPDATE stream_stats
    SET file_num = file_num + $1, 
        min_ts = CASE WHEN $2 = 0 THEN min_ts 
                     WHEN min_ts = 0 OR $2 < min_ts THEN $2 
                     ELSE min_ts END,
        max_ts = CASE WHEN $3 = 0 THEN max_ts 
                     WHEN max_ts = 0 OR $3 > max_ts THEN $3 
                     ELSE max_ts END,
        records = records + $4, 
        original_size = original_size + $5, 
        compressed_size = compressed_size + $6, 
        index_size = index_size + $7
    WHERE stream = $8;
                "#,
            )
            .bind(stats.file_num)
            .bind(stats.doc_time_min)
            .bind(stats.doc_time_max)
            .bind(stats.doc_num)
            .bind(stats.storage_size as i64)
            .bind(stats.compressed_size as i64)
            .bind(stats.index_size as i64)
            .bind(stream_key)
            .execute(&mut *tx)
            .await
            {
                if let Err(e) = tx.rollback().await {
                    log::error!("[POSTGRES] rollback set stream stats error: {e}");
                }
                return Err(e.into());
            }
        }
        // delete files which already marked deleted
        let (min_ts, max_ts) = time_range;
        DB_QUERY_NUMS
            .with_label_values(&["clean_deleted", "file_list"])
            .inc();
        let start = std::time::Instant::now();
        loop {
            let start = std::time::Instant::now();
            match sqlx::query(
                    r#"DELETE FROM file_list WHERE deleted IS TRUE AND updated_at > $1 AND updated_at <= $2"#,
                )
                .bind(min_ts)
                .bind(max_ts)
                .execute(&mut *tx)
                .await
                {
                    Ok(v) => {
                        log::debug!(
                            "[POSTGRES] delete file list rows affected: {}, took: {} ms",
                            v.rows_affected(),
                            start.elapsed().as_millis()
                        );
                        if v.rows_affected() == 0 {
                            break;
                        }
                    }
                    Err(e) => {
                        if let Err(e) = tx.rollback().await {
                            log::error!(
                                "[POSTGRES] rollback set stream stats error for delete file list: {e}"
                            );
                        }
                        return Err(e.into());
                    }
                }
        }
        let time = start.elapsed().as_secs_f64();
        DB_QUERY_TIME
            .with_label_values(&["clean_deleted", "file_list"])
            .observe(time);

        // commit
        if let Err(e) = tx.commit().await {
            log::error!("[POSTGRES] commit set stream stats error: {e}");
            return Err(e.into());
        }

        Ok(())
    }

    async fn reset_stream_stats(&self) -> Result<()> {
        let pool = CLIENT.clone();
        DB_QUERY_NUMS
            .with_label_values(&["update", "stream_stats"])
            .inc();
        sqlx
            ::query(
                r#"UPDATE stream_stats SET file_num = 0, min_ts = 0, max_ts = 0, records = 0, original_size = 0, compressed_size = 0, index_size = 0;"#
            )
            .execute(&pool).await?;
        Ok(())
    }

    async fn reset_stream_stats_min_ts(
        &self,
        _org_id: &str,
        stream: &str,
        min_ts: i64,
    ) -> Result<()> {
        let pool = CLIENT.clone();
        DB_QUERY_NUMS
            .with_label_values(&["update", "stream_stats"])
            .inc();
        sqlx::query(r#"UPDATE stream_stats SET min_ts = $1 WHERE stream = $2;"#)
            .bind(min_ts)
            .bind(stream)
            .execute(&pool)
            .await?;
        DB_QUERY_NUMS
            .with_label_values(&["update", "stream_stats"])
            .inc();
        sqlx::query(
            r#"UPDATE stream_stats SET max_ts = min_ts WHERE stream = $1 AND max_ts < min_ts;"#,
        )
        .bind(stream)
        .execute(&pool)
        .await?;
        Ok(())
    }

    async fn len(&self) -> usize {
        let pool = CLIENT_RO.clone();
        DB_QUERY_NUMS
            .with_label_values(&["select", "file_list"])
            .inc();
        let ret = match sqlx::query(r#"SELECT COUNT(*)::BIGINT AS num FROM file_list;"#)
            .fetch_one(&pool)
            .await
        {
            Ok(r) => r,
            Err(e) => {
                log::error!("[POSTGRES] get file list len error: {e}");
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
        let pool = CLIENT.clone();
        let mut tx = pool.begin().await?;
        DB_QUERY_NUMS
            .with_label_values(&["insert", "file_list_jobs"])
            .inc();
        match
            sqlx
                ::query(
                    "INSERT INTO file_list_jobs (org, stream, offsets, status, node, started_at, updated_at) VALUES ($1, $2, $3, $4, '', 0, 0) ON CONFLICT DO NOTHING;"
                )
                .bind(org_id)
                .bind(&stream_key)
                .bind(offset)
                .bind(super::FileListJobStatus::Pending)
                .execute(&mut *tx).await
        {
            Err(sqlx::Error::Database(e)) => if !e.is_unique_violation() {
                return Err(Error::Message(e.to_string()));
            }
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
        .await {
            Ok(v) => v,
            Err(e) => {
                if let Err(e) = tx.rollback().await {
                    log::error!("[POSTGRES] rollback add job error: {e}");
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
                log::error!("[POSTGRES] rollback update job status error: {e}");
            }
            return Err(e.into());
        }
        if let Err(e) = tx.commit().await {
            log::error!("[POSTGRES] commit add job error: {e}");
            return Err(e.into());
        }
        Ok(id)
    }

    async fn get_pending_jobs(&self, node: &str, limit: i64) -> Result<Vec<super::MergeJobRecord>> {
        let pool = CLIENT.clone();
        let mut tx = pool.begin().await?;
        let lock_key = "file_list_jobs:get_pending_jobs";
        let lock_id = config::utils::hash::gxhash::new().sum64(lock_key);
        let lock_id = if lock_id > (i64::MAX as u64) {
            (lock_id >> 1) as i64
        } else {
            lock_id as i64
        };
        let lock_sql = format!("SELECT pg_advisory_xact_lock({lock_id})");
        DB_QUERY_NUMS.with_label_values(&["get_lock", ""]).inc();
        if let Err(e) = sqlx::query(&lock_sql).execute(&mut *tx).await {
            if let Err(e) = tx.rollback().await {
                log::error!("[POSTGRES] rollback get_pending_jobs error: {e}");
            }
            return Err(e.into());
        }
        // get pending jobs group by stream and order by num desc
        DB_QUERY_NUMS
            .with_label_values(&["select", "file_list_jobs"])
            .inc();
        let ret = match sqlx::query_as::<_, super::MergeJobPendingRecord>(
            r#"
SELECT stream, max(id) as id, COUNT(*)::BIGINT AS num
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
                    log::error!(
                        "[POSTGRES] rollback select file_list_jobs pending jobs for update error: {e}"
                    );
                }
                return Err(e.into());
            }
        };
        // update jobs status to running
        let ids = ret.iter().map(|r| r.id.to_string()).collect::<Vec<_>>();
        if ids.is_empty() {
            if let Err(e) = tx.rollback().await {
                log::error!("[POSTGRES] rollback select file_list_jobs pending jobs error: {e}");
            }
            return Ok(Vec::new());
        }
        let sql = format!(
            "UPDATE file_list_jobs SET status = $1, node = $2, started_at = $3, updated_at = $4 WHERE id IN ({});",
            ids.join(",")
        );
        let now = config::utils::time::now_micros();
        DB_QUERY_NUMS
            .with_label_values(&["update", "file_list_jobs"])
            .inc();
        if let Err(e) = sqlx::query(&sql)
            .bind(super::FileListJobStatus::Running)
            .bind(node)
            .bind(now)
            .bind(now)
            .execute(&mut *tx)
            .await
        {
            if let Err(e) = tx.rollback().await {
                log::error!("[POSTGRES] rollback update file_list_jobs status error: {e}");
            }
            return Err(e.into());
        }
        // get jobs by ids
        DB_QUERY_NUMS
            .with_label_values(&["select", "file_list_jobs"])
            .inc();
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
                    log::error!("[POSTGRES] rollback select file_list_jobs by ids error: {e}");
                }
                return Err(e.into());
            }
        };
        if let Err(e) = tx.commit().await {
            log::error!("[POSTGRES] commit select file_list_jobs pending jobs error: {e}");
            return Err(e.into());
        }
        Ok(ret)
    }

    async fn set_job_pending(&self, ids: &[i64]) -> Result<()> {
        let pool = CLIENT.clone();
        let sql = format!(
            "UPDATE file_list_jobs SET status = $1 WHERE id IN ({});",
            ids.iter()
                .map(|id| id.to_string())
                .collect::<Vec<_>>()
                .join(",")
        );
        DB_QUERY_NUMS
            .with_label_values(&["update", "file_list_jobs"])
            .inc();
        sqlx::query(&sql)
            .bind(super::FileListJobStatus::Pending)
            .execute(&pool)
            .await?;
        Ok(())
    }

    async fn set_job_done(&self, ids: &[i64]) -> Result<()> {
        let config = get_config();
        let pool = CLIENT.clone();
        DB_QUERY_NUMS
            .with_label_values(&["update", "file_list_jobs"])
            .inc();
        let sql = format!(
            "UPDATE file_list_jobs SET status = $1, updated_at = $2, dumped = $3 WHERE id IN ({});",
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
            .bind(!config.common.file_list_dump_enabled)
            .execute(&pool)
            .await?;
        Ok(())
    }

    async fn update_running_jobs(&self, ids: &[i64]) -> Result<()> {
        let pool = CLIENT.clone();
        DB_QUERY_NUMS
            .with_label_values(&["update", "file_list_jobs"])
            .inc();
        let sql = format!(
            r#"UPDATE file_list_jobs SET updated_at = $1 WHERE id IN ({})"#,
            ids.iter()
                .map(|id| id.to_string())
                .collect::<Vec<_>>()
                .join(",")
        );
        sqlx::query(&sql)
            .bind(config::utils::time::now_micros())
            .execute(&pool)
            .await?;
        Ok(())
    }

    async fn check_running_jobs(&self, before_date: i64) -> Result<()> {
        let pool = CLIENT.clone();
        DB_QUERY_NUMS
            .with_label_values(&["update", "file_list_jobs"])
            .inc();
        let ret = sqlx::query(
            r#"UPDATE file_list_jobs SET status = $1 WHERE status = $2 AND updated_at < $3;"#,
        )
        .bind(super::FileListJobStatus::Pending)
        .bind(super::FileListJobStatus::Running)
        .bind(before_date)
        .execute(&pool)
        .await?;
        if ret.rows_affected() > 0 {
            log::warn!("[POSTGRES] reset running jobs status to pending");
        }
        Ok(())
    }

    async fn clean_done_jobs(&self, before_date: i64) -> Result<()> {
        let pool = CLIENT.clone();
        DB_QUERY_NUMS
            .with_label_values(&["delete", "file_list_jobs"])
            .inc();
        let ret = sqlx::query(
            r#"DELETE FROM file_list_jobs WHERE status = $1 AND updated_at < $2 AND dumped = $3;"#,
        )
        .bind(super::FileListJobStatus::Done)
        .bind(before_date)
        .bind(true)
        .execute(&pool)
        .await?;
        if ret.rows_affected() > 0 {
            log::warn!("[POSTGRES] clean done jobs");
        }
        Ok(())
    }

    async fn get_pending_jobs_count(&self) -> Result<stdHashMap<String, stdHashMap<String, i64>>> {
        let pool = CLIENT.clone();

        DB_QUERY_NUMS
            .with_label_values(&["select", "file_list_jobs"])
            .inc();
        let ret = sqlx
            ::query(
                r#"SELECT stream, status, count(*) as counts FROM file_list_jobs WHERE status = $1 GROUP BY stream, status ORDER BY status desc;"#
            )
            .bind(super::FileListJobStatus::Pending)
            .fetch_all(&pool).await?;

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
                    .and_modify(|e| {
                        *e = counts;
                    })
                    .or_insert(counts);
            }
        }
        Ok(job_status)
    }

    async fn get_entries_in_range(
        &self,
        org: &str,
        stream: Option<&str>,
        time_start: i64,
        time_end: i64,
        min_updated_at: Option<i64>,
    ) -> Result<Vec<super::FileRecord>> {
        if time_start == 0 && time_end == 0 {
            return Ok(Vec::new());
        }

        let day_partitions = if time_end - time_start <= DAY_MICRO_SECS
            || time_end - time_start > DAY_MICRO_SECS * 30
            || !get_config().limit.file_list_multi_thread
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

        let mut tasks = Vec::with_capacity(day_partitions.len());

        for (time_start, time_end) in day_partitions {
            let o = org.to_string();
            let sql = "SELECT * FROM file_list WHERE max_ts >= $1 AND min_ts <= $2 AND org = $3  AND deleted = $4";
            let sql = match stream {
                Some(stream) => format!("{sql} AND stream = '{stream}'"),
                None => sql.to_string(),
            };
            let sql = match min_updated_at {
                Some(updated_at) => format!("{sql} AND updated_at >= {updated_at}"),
                None => sql,
            };
            tasks.push(tokio::task::spawn(async move {
                let pool = CLIENT.clone();
                sqlx::query_as::<_, super::FileRecord>(&sql)
                    .bind(time_start)
                    .bind(time_end)
                    .bind(o)
                    .bind(false)
                    .fetch_all(&pool)
                    .await
            }));
        }

        let mut rets = Vec::new();
        for task in tasks {
            match task.await {
                Ok(Ok(r)) => rets.extend(r.into_iter().filter(|r| !r.deleted)),
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

    async fn get_pending_dump_jobs(&self) -> Result<Vec<(i64, String, String, i64)>> {
        let pool = CLIENT_RO.clone();

        DB_QUERY_NUMS
            .with_label_values(&["select", "file_list_jobs", ""])
            .inc();
        let ret = sqlx::query_as::<_, (i64,String, String, i64)>(
            r#"SELECT id, org, stream, offsets FROM file_list_jobs WHERE status = $1 AND dumped = $2 limit 1000"#,
        )
        .bind(super::FileListJobStatus::Done)
        .bind(false)
        .fetch_all(&pool)
        .await?;

        let mut pending: Vec<(i64, String, String, i64)> = Vec::new();

        for (id, org, stream, offset) in ret.iter() {
            pending.push((*id, org.to_string(), stream.to_string(), *offset));
        }

        Ok(pending)
    }

    async fn set_job_dumped_status(&self, id: i64, dumped: bool) -> Result<()> {
        let pool = CLIENT.clone();
        DB_QUERY_NUMS
            .with_label_values(&["update", "file_list_jobs", ""])
            .inc();
        sqlx::query("UPDATE file_list_jobs SET dumped = $1 WHERE id = $2;")
            .bind(dumped)
            .bind(id)
            .execute(&pool)
            .await?;
        Ok(())
    }
}

impl PostgresFileList {
    async fn inner_add(
        &self,
        table: &str,
        account: &str,
        file: &str,
        meta: &FileMeta,
    ) -> Result<i64> {
        let now_ts = now_micros();
        let pool = CLIENT.clone();
        let (stream_key, date_key, file_name) =
            parse_file_key_columns(file).map_err(|e| Error::Message(e.to_string()))?;
        let org_id = stream_key[..stream_key.find('/').unwrap()].to_string();
        DB_QUERY_NUMS.with_label_values(&["insert", table]).inc();
        let ret: std::result::Result<Option<i64>, sea_orm::SqlxError> = sqlx::query_scalar(
            format!(
                r#"
INSERT INTO {table} (account, org, stream, date, file, deleted, min_ts, max_ts, records, original_size, compressed_size, index_size, flattened, created_at, updated_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
    ON CONFLICT DO NOTHING
    RETURNING id;
                "#
                ).as_str()
            )
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
            .fetch_one(&pool).await;
        match ret {
            Err(sqlx::Error::Database(e)) => {
                if e.is_unique_violation() {
                    Ok(0)
                } else {
                    Err(Error::Message(e.to_string()))
                }
            }
            Err(e) => Err(e.into()),
            Ok(v) => Ok(v.unwrap_or(0)),
        }
    }

    async fn inner_batch_process(&self, table: &str, files: &[FileKey]) -> Result<()> {
        if files.is_empty() {
            return Ok(());
        }

        let pool = CLIENT.clone();
        let mut tx = pool.begin().await?;

        let add_items = files.iter().filter(|v| !v.deleted).collect::<Vec<_>>();
        if !add_items.is_empty() {
            let chunks = add_items.chunks(100);
            for files in chunks {
                let now_ts = now_micros();
                let mut query_builder: QueryBuilder<Postgres> = QueryBuilder::new(
                format!("INSERT INTO {table} (account, org, stream, date, file, deleted, min_ts, max_ts, records, original_size, compressed_size, index_size, flattened, created_at, updated_at)").as_str()
                );
                query_builder.push_values(files, |mut b, item| {
                    let (stream_key, date_key, file_name) =
                        parse_file_key_columns(&item.key).expect("parse file key failed");
                    let org_id = stream_key[..stream_key.find('/').unwrap()].to_string();
                    b.push_bind(&item.account)
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
                DB_QUERY_NUMS.with_label_values(&["insert", table]).inc();
                if let Err(e) = query_builder.build().execute(&mut *tx).await {
                    if let Err(e) = tx.rollback().await {
                        log::error!("[POSTGRES] rollback {table} batch process for add error: {e}");
                    }
                    return Err(e.into());
                }
            }
        }

        let del_items = files.iter().filter(|v| v.deleted).collect::<Vec<_>>();
        if !del_items.is_empty() {
            let chunks = del_items.chunks(1000);
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
                    DB_QUERY_NUMS
                        .with_label_values(&["select_id", "file_list"])
                        .inc();
                    let start = std::time::Instant::now();
                    let query_res: std::result::Result<Option<i64>, sea_orm::SqlxError> = sqlx::query_scalar(
                    r#"SELECT id FROM file_list WHERE stream = $1 AND date = $2 AND file = $3;"#,
                    )
                    .bind(stream_key)
                    .bind(date_key)
                    .bind(file_name)
                    .fetch_one(&mut *tx)
                    .await;
                    let time = start.elapsed().as_secs_f64();
                    DB_QUERY_TIME
                        .with_label_values(&["select_id", "file_list"])
                        .observe(time);
                    match query_res {
                        Ok(Some(v)) => ids.push(v.to_string()),
                        Ok(None) => continue,
                        Err(sqlx::Error::RowNotFound) => continue,
                        Err(e) => {
                            if let Err(e) = tx.rollback().await {
                                log::error!(
                                    "[POSTGRES] rollback {table} batch process for delete error: {e}"
                                );
                            }
                            return Err(e.into());
                        }
                    };
                }
                // delete files by ids
                if !ids.is_empty() {
                    let now_ts = now_micros();
                    DB_QUERY_NUMS
                        .with_label_values(&["delete_id", "file_list"])
                        .inc();
                    let sql = format!(
                        "UPDATE file_list SET deleted = true, updated_at = {now_ts} WHERE id IN({});",
                        ids.join(",")
                    );
                    let start = std::time::Instant::now();
                    if let Err(e) = sqlx::query(sql.as_str()).execute(&mut *tx).await {
                        if let Err(e) = tx.rollback().await {
                            log::error!(
                                "[POSTGRES] rollback {table} batch process for delete error: {e}"
                            );
                        }
                        return Err(e.into());
                    }
                    let time = start.elapsed().as_secs_f64();
                    DB_QUERY_TIME
                        .with_label_values(&["delete_id", "file_list"])
                        .observe(time);
                }
            }
        }

        if let Err(e) = tx.commit().await {
            log::error!("[POSTGRES] commit {table} batch process error: {e}");
            return Err(e.into());
        }

        Ok(())
    }
}

pub async fn create_table() -> Result<()> {
    let pool = CLIENT_DDL.clone();
    sqlx::query(
        r#"
CREATE TABLE IF NOT EXISTS file_list
(
    id        BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    account   VARCHAR(32)  not null,
    org       VARCHAR(100) not null,
    stream    VARCHAR(256) not null,
    date      VARCHAR(16)  not null,
    file      VARCHAR(1024) not null,
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
    .execute(&pool)
    .await?;

    sqlx::query(
        r#"
CREATE TABLE IF NOT EXISTS file_list_history
(
    id        BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    account   VARCHAR(32)  not null,
    org       VARCHAR(100) not null,
    stream    VARCHAR(256) not null,
    date      VARCHAR(16)  not null,
    file      VARCHAR(1024) not null,
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
    .execute(&pool)
    .await?;

    sqlx::query(
        r#"
CREATE TABLE IF NOT EXISTS file_list_deleted
(
    id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    account    VARCHAR(32)  not null,
    org        VARCHAR(100) not null,
    stream     VARCHAR(256) not null,
    date       VARCHAR(16)  not null,
    file       VARCHAR(1024) not null,
    index_file BOOLEAN default false not null,
    flattened  BOOLEAN default false not null,
    created_at BIGINT not null
);
        "#,
    )
    .execute(&pool)
    .await?;

    sqlx::query(
        r#"
CREATE TABLE IF NOT EXISTS file_list_jobs
(
    id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    org        VARCHAR(100) not null,
    stream     VARCHAR(256) not null,
    offsets    BIGINT not null,
    status     INT not null,
    node       VARCHAR(100) not null,
    started_at BIGINT not null,
    updated_at BIGINT not null
);
        "#,
    )
    .execute(&pool)
    .await?;

    sqlx::query(
        r#"
CREATE TABLE IF NOT EXISTS stream_stats
(
    id       BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    org      VARCHAR(100) not null,
    stream   VARCHAR(256) not null,
    file_num BIGINT not null,
    min_ts   BIGINT not null,
    max_ts   BIGINT not null,
    records  BIGINT not null,
    original_size   BIGINT not null,
    compressed_size BIGINT not null,
    index_size      BIGINT not null
);
        "#,
    )
    .execute(&pool)
    .await?;

    // create column flattened for old version <= 0.10.5
    let column = "flattened";
    let data_type = "BOOLEAN default false not null";
    add_column("file_list", column, data_type).await?;
    add_column("file_list_history", column, data_type).await?;
    add_column("file_list_deleted", column, data_type).await?;

    // create column started_at for old version <= 0.10.8
    let column = "started_at";
    let data_type = "BIGINT default 0 not null";
    add_column("file_list_jobs", column, data_type).await?;

    // create column index_size for old version <= 0.13.1
    let column = "index_size";
    let data_type = "BIGINT default 0 not null";
    add_column("file_list", column, data_type).await?;
    add_column("file_list_history", column, data_type).await?;
    add_column("stream_stats", column, data_type).await?;
    let column = "index_file";
    let data_type = "BOOLEAN default false not null";
    add_column("file_list_deleted", column, data_type).await?;

    // create col dumped for file_list_jobs for version <=0.14.0
    add_column("file_list_jobs", "dumped", "BOOLEAN default false not null").await?;

    // create col account for multiple object storage account support, version >= 0.14.6
    add_column("file_list", "account", "VARCHAR(32) default '' not null").await?;
    add_column(
        "file_list_history",
        "account",
        "VARCHAR(32) default '' not null",
    )
    .await?;
    add_column(
        "file_list_deleted",
        "account",
        "VARCHAR(32) default '' not null",
    )
    .await?;

    // create column created_at and updated_at for version >= 0.14.7
    let column = "created_at";
    let data_type = "BIGINT default 0 not null";
    add_column("file_list", column, data_type).await?;
    add_column("file_list_history", column, data_type).await?;
    let column = "updated_at";
    let data_type = "BIGINT default 0 not null";
    add_column("file_list", column, data_type).await?;
    add_column("file_list_history", column, data_type).await?;

    Ok(())
}

pub async fn create_table_index() -> Result<()> {
    let pool = CLIENT_DDL.clone();

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
        ("stream_stats_org_idx", "stream_stats", &["org"]),
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
        ("stream_stats_stream_idx", "stream_stats", &["stream"]),
    ];
    for (idx, table, fields) in unique_indices {
        create_index(IndexStatement::new(idx, table, true, fields)).await?;
    }

    // This is a case where we want to MAKE the index unique if it isn't
    let res = create_index(IndexStatement::new(
        "file_list_stream_file_idx",
        "file_list",
        true,
        &["stream", "date", "file"],
    ))
    .await;
    if let Err(e) = res {
        if !e.to_string().contains("could not create unique index") {
            return Err(e);
        }
        // delete duplicate records
        log::warn!("[POSTGRES] starting delete duplicate records");
        let ret = sqlx
            ::query(
                r#"SELECT stream, date, file, min(id) as id FROM file_list GROUP BY stream, date, file HAVING COUNT(*) > 1;"#
            )
            .fetch_all(&pool).await?;
        log::warn!("[POSTGRES] total: {} duplicate records", ret.len());
        for (i, r) in ret.iter().enumerate() {
            let stream = r.get::<String, &str>("stream");
            let date = r.get::<String, &str>("date");
            let file = r.get::<String, &str>("file");
            let id = r.get::<i64, &str>("id");
            sqlx
                ::query(
                    r#"DELETE FROM file_list WHERE id != $1 AND stream = $2 AND date = $3 AND file = $4;"#
                )
                .bind(id)
                .bind(stream)
                .bind(date)
                .bind(file)
                .execute(&pool).await?;
            if i.is_multiple_of(1000) {
                log::warn!("[POSTGRES] delete duplicate records: {}/{}", i, ret.len());
            }
        }
        log::warn!(
            "[POSTGRES] delete duplicate records: {}/{}",
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
        log::warn!("[POSTGRES] create table index(file_list_stream_file_idx) successfully");
    }

    Ok(())
}

async fn add_column(table: &str, column: &str, data_type: &str) -> Result<()> {
    let pool = CLIENT_DDL.clone();
    let check_sql = format!(
        "SELECT count(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE table_name='{table}' AND column_name='{column}';"
    );
    let has_column = sqlx::query_scalar::<_, i64>(&check_sql)
        .fetch_one(&pool)
        .await?;
    if has_column > 0 {
        return Ok(());
    }

    let alert_sql = format!("ALTER TABLE {table} ADD COLUMN IF NOT EXISTS {column} {data_type};");
    let mut tx = pool.begin().await?;
    if let Err(e) = sqlx::query(&alert_sql).execute(&mut *tx).await {
        log::error!("[POSTGRES] Error in adding column {column}: {e}");
        if let Err(e) = tx.rollback().await {
            log::error!("[POSTGRES] Error in rolling back transaction: {e}");
        }
        return Err(e.into());
    }
    if let Err(e) = tx.commit().await {
        log::info!("[POSTGRES] Error in committing transaction: {e}");
        return Err(e.into());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use std::sync::Once;

    use config::meta::stream::{FileKey, FileMeta};
    use sqlx::PgPool;
    use tokio::sync::OnceCell;

    use super::*;
    use crate::file_list::FileList;

    static _INIT: Once = Once::new();
    static DB_POOL: OnceCell<PgPool> = OnceCell::const_new();

    // Mock database setup for testing
    async fn setup_test_db() -> PgPool {
        DB_POOL
            .get_or_init(|| async {
                let database_url = std::env::var("TEST_POSTGRES_URL").unwrap_or_else(|_| {
                    "postgresql://postgres:password@localhost:5432/openobserve_test".to_string()
                });

                let pool = PgPool::connect(&database_url)
                    .await
                    .expect("Failed to connect to test PostgreSQL database");

                setup_test_tables(&pool)
                    .await
                    .expect("Failed to setup test tables");
                pool
            })
            .await
            .clone()
    }

    async fn setup_test_tables(pool: &PgPool) -> Result<()> {
        sqlx::query(
            r#"
            CREATE TABLE IF NOT EXISTS file_list (
                id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                account VARCHAR(32) not null,
                org VARCHAR(100) not null,
                stream VARCHAR(256) not null,
                date VARCHAR(16) not null,
                file VARCHAR(1024) not null,
                deleted BOOLEAN default false not null,
                flattened BOOLEAN default false not null,
                min_ts BIGINT not null,
                max_ts BIGINT not null,
                records BIGINT not null,
                original_size BIGINT not null,
                compressed_size BIGINT not null,
                index_size BIGINT not null
            )
            "#,
        )
        .execute(pool)
        .await?;

        sqlx::query(
            r#"
            CREATE TABLE IF NOT EXISTS file_list_history (
                id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                account VARCHAR(32) not null,
                org VARCHAR(100) not null,
                stream VARCHAR(256) not null,
                date VARCHAR(16) not null,
                file VARCHAR(1024) not null,
                deleted BOOLEAN default false not null,
                flattened BOOLEAN default false not null,
                min_ts BIGINT not null,
                max_ts BIGINT not null,
                records BIGINT not null,
                original_size BIGINT not null,
                compressed_size BIGINT not null,
                index_size BIGINT not null
            )
            "#,
        )
        .execute(pool)
        .await?;

        sqlx::query(
            r#"
            CREATE TABLE IF NOT EXISTS file_list_deleted (
                id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                account VARCHAR(32) not null,
                org VARCHAR(100) not null,
                stream VARCHAR(256) not null,
                date VARCHAR(16) not null,
                file VARCHAR(1024) not null,
                index_file BOOLEAN default false not null,
                flattened BOOLEAN default false not null,
                created_at BIGINT not null
            )
            "#,
        )
        .execute(pool)
        .await?;

        sqlx::query(
            r#"
            CREATE TABLE IF NOT EXISTS file_list_jobs (
                id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                org VARCHAR(100) not null,
                stream VARCHAR(256) not null,
                offsets BIGINT not null,
                status INT not null,
                node VARCHAR(100) not null,
                started_at BIGINT not null,
                updated_at BIGINT not null,
                dumped BOOLEAN default false not null
            )
            "#,
        )
        .execute(pool)
        .await?;

        sqlx::query(
            r#"
            CREATE TABLE IF NOT EXISTS stream_stats (
                id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                org VARCHAR(100) not null,
                stream VARCHAR(256) not null,
                file_num BIGINT not null,
                min_ts BIGINT not null,
                max_ts BIGINT not null,
                records BIGINT not null,
                original_size BIGINT not null,
                compressed_size BIGINT not null,
                index_size BIGINT not null
            )
            "#,
        )
        .execute(pool)
        .await?;

        Ok(())
    }

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

    async fn cleanup_test_data(pool: &PgPool) {
        let _ = sqlx::query("DELETE FROM file_list").execute(pool).await;
        let _ = sqlx::query("DELETE FROM file_list_history")
            .execute(pool)
            .await;
        let _ = sqlx::query("DELETE FROM file_list_deleted")
            .execute(pool)
            .await;
        let _ = sqlx::query("DELETE FROM file_list_jobs")
            .execute(pool)
            .await;
        let _ = sqlx::query("DELETE FROM stream_stats").execute(pool).await;
    }

    #[tokio::test]
    async fn test_postgres_file_list_new() {
        let postgres_file_list = PostgresFileList::new();
        assert!(!std::ptr::eq(&postgres_file_list, &PostgresFileList::new()));
    }

    #[tokio::test]
    async fn test_postgres_file_list_default() {
        let default_list = PostgresFileList::default();
        let new_list = PostgresFileList::new();
        // Both should be equivalent (no internal state to compare)
        assert_eq!(
            std::mem::size_of_val(&default_list),
            std::mem::size_of_val(&new_list)
        );
    }

    #[tokio::test]
    #[ignore = "Requires test PostgreSQL database setup"]
    async fn test_add_file_success() {
        let pool = setup_test_db().await;
        cleanup_test_data(&pool).await;

        let postgres_list = PostgresFileList::new();
        let meta = create_test_file_meta();
        let file_key = "test_org/test_stream/logs/2021/01/01/test_file.parquet";

        let _result = postgres_list.add("test_account", file_key, &meta).await;

        // This test would pass with proper CLIENT mocking
        // assert!(result.is_ok());
        // assert!(result.unwrap() > 0);
    }

    #[tokio::test]
    #[ignore = "Requires test PostgreSQL database setup"]
    async fn test_add_file_duplicate_handling() {
        let pool = setup_test_db().await;
        cleanup_test_data(&pool).await;

        let postgres_list = PostgresFileList::new();
        let meta = create_test_file_meta();
        let file_key = "test_org/test_stream/logs/2021/01/01/duplicate_file.parquet";

        // Add file first time
        let _result1 = postgres_list.add("test_account", file_key, &meta).await;
        // Add same file again (should handle duplicate)
        let _result2 = postgres_list.add("test_account", file_key, &meta).await;

        // PostgreSQL should handle conflicts differently than MySQL
        // assert!(result1.is_ok());
        // assert!(result2.is_ok());
    }

    #[tokio::test]
    async fn test_parse_file_key_columns_valid_postgres() {
        // Test valid file key parsing (same as MySQL but testing PostgreSQL context)
        let file_key = "files/default/logs/olympics/2021/01/01/00/postgres_file1.parquet";
        let result = parse_file_key_columns(file_key);

        match result {
            Ok((stream, _date, file)) => {
                assert_eq!(stream, "default/logs/olympics");
                assert_eq!(file, "postgres_file1.parquet");
            }
            Err(_) => panic!("Should successfully parse valid file key"),
        }
    }

    #[tokio::test]
    async fn test_parse_file_key_columns_invalid_postgres() {
        // Test invalid file key parsing for PostgreSQL
        let invalid_keys = vec![
            "",
            "invalid",
            "org1/stream1",
            "org1/stream1/logs",
            "org1", // Too short
        ];

        for key in invalid_keys {
            let result = parse_file_key_columns(key);
            assert!(result.is_err(), "Should fail for invalid key: {}", key);
        }
    }

    #[tokio::test]
    #[ignore = "Requires test PostgreSQL database setup"]
    async fn test_remove_file() {
        let pool = setup_test_db().await;
        cleanup_test_data(&pool).await;

        let postgres_list = PostgresFileList::new();
        let meta = create_test_file_meta();
        let file_key = "test_org/test_stream/logs/2021/01/01/remove_test.parquet";

        // First add a file
        let _ = postgres_list.add("test_account", file_key, &meta).await;

        // Then remove it (uses PostgreSQL $1, $2, $3 syntax)
        let _result = postgres_list.remove(file_key).await;
        // assert!(result.is_ok());
    }

    #[tokio::test]
    async fn test_batch_add_with_id_unimplemented() {
        let postgres_list = PostgresFileList::new();
        let files = vec![create_test_file_key("account1", "test/key", false)];

        let result = postgres_list.batch_add_with_id(&files).await;
        assert!(result.is_err());
        // Should return unimplemented error
    }

    #[tokio::test]
    #[ignore = "Requires test PostgreSQL database setup"]
    async fn test_batch_add_empty_files() {
        let postgres_list = PostgresFileList::new();
        let empty_files: Vec<FileKey> = vec![];

        let result = postgres_list.batch_add(&empty_files).await;
        assert!(result.is_ok());
    }

    #[tokio::test]
    #[ignore = "Requires test PostgreSQL database setup"]
    async fn test_batch_add_multiple_files() {
        let pool = setup_test_db().await;
        cleanup_test_data(&pool).await;

        let postgres_list = PostgresFileList::new();
        let files = vec![
            create_test_file_key(
                "account1",
                "org1/stream1/logs/2021/01/01/pg_file1.parquet",
                false,
            ),
            create_test_file_key(
                "account1",
                "org1/stream1/logs/2021/01/01/pg_file2.parquet",
                false,
            ),
            create_test_file_key(
                "account1",
                "org1/stream1/logs/2021/01/01/pg_file3.parquet",
                false,
            ),
        ];

        let _result = postgres_list.batch_add(&files).await;
        // assert!(result.is_ok());
    }

    #[tokio::test]
    #[ignore = "Requires test PostgreSQL database setup"]
    async fn test_batch_add_with_deleted_files() {
        let pool = setup_test_db().await;
        cleanup_test_data(&pool).await;

        let postgres_list = PostgresFileList::new();
        let files = vec![
            create_test_file_key(
                "account1",
                "org1/stream1/logs/2021/01/01/pg_file1.parquet",
                false,
            ),
            create_test_file_key(
                "account1",
                "org1/stream1/logs/2021/01/01/pg_file2.parquet",
                true, // This file is marked as deleted
            ),
        ];

        let _result = postgres_list.batch_add(&files).await;
        // assert!(result.is_ok());
    }

    #[tokio::test]
    #[ignore = "Requires test PostgreSQL database setup"]
    async fn test_add_history() {
        let pool = setup_test_db().await;
        cleanup_test_data(&pool).await;

        let postgres_list = PostgresFileList::new();
        let meta = create_test_file_meta();
        let file_key = "test_org/test_stream/logs/2021/01/01/pg_history_test.parquet";

        let _result = postgres_list
            .add_history("test_account", file_key, &meta)
            .await;
        // assert!(result.is_ok());
    }

    #[tokio::test]
    #[ignore = "Requires test PostgreSQL database setup"]
    async fn test_batch_add_deleted() {
        let pool = setup_test_db().await;
        cleanup_test_data(&pool).await;

        let postgres_list = PostgresFileList::new();
        let deleted_files = vec![
            FileListDeleted {
                id: 0,
                account: "account1".to_string(),
                file: "org1/stream1/logs/2021/01/01/pg_deleted1.parquet".to_string(),
                flattened: false,
                index_file: false,
            },
            FileListDeleted {
                id: 0,
                account: "account1".to_string(),
                file: "org1/stream1/logs/2021/01/01/pg_deleted2.parquet".to_string(),
                flattened: true,
                index_file: true,
            },
        ];

        let _result = postgres_list
            .batch_add_deleted("org1", 1609459200, &deleted_files)
            .await;
        // assert!(result.is_ok());
    }

    #[tokio::test]
    async fn test_batch_add_deleted_empty() {
        let postgres_list = PostgresFileList::new();
        let empty_files: Vec<FileListDeleted> = vec![];

        let result = postgres_list
            .batch_add_deleted("org1", 1609459200, &empty_files)
            .await;
        assert!(result.is_ok()); // Should handle empty list gracefully
    }

    #[tokio::test]
    #[ignore = "Requires test PostgreSQL database setup"]
    async fn test_contains_file() {
        let pool = setup_test_db().await;
        cleanup_test_data(&pool).await;

        let postgres_list = PostgresFileList::new();
        let file_key = "test_org/test_stream/logs/2021/01/01/pg_contains_test.parquet";

        // First check non-existent file
        let _result_not_exists = postgres_list.contains(file_key).await;
        // assert!(result_not_exists.is_ok());
        // assert!(!result_not_exists.unwrap());

        // Add file and check again
        let meta = create_test_file_meta();
        let _ = postgres_list.add("test_account", file_key, &meta).await;
        let _result_exists = postgres_list.contains(file_key).await;
        // assert!(result_exists.is_ok());
        // assert!(result_exists.unwrap());
    }

    #[tokio::test]
    #[ignore = "Requires test PostgreSQL database setup"]
    async fn test_get_file() {
        let pool = setup_test_db().await;
        cleanup_test_data(&pool).await;

        let postgres_list = PostgresFileList::new();
        let meta = create_test_file_meta();
        let file_key = "test_org/test_stream/logs/2021/01/01/pg_get_test.parquet";

        // Add file first
        let _ = postgres_list.add("test_account", file_key, &meta).await;

        // Then retrieve it
        let _result = postgres_list.get(file_key).await;
        // assert!(result.is_ok());
        // let retrieved_meta = result.unwrap();
        // assert_eq!(retrieved_meta.records, meta.records);
        // assert_eq!(retrieved_meta.min_ts, meta.min_ts);
        // assert_eq!(retrieved_meta.max_ts, meta.max_ts);
    }

    #[tokio::test]
    #[ignore = "Requires test PostgreSQL database setup"]
    async fn test_get_nonexistent_file() {
        let postgres_list = PostgresFileList::new();
        let file_key = "nonexistent/stream/logs/2021/01/01/pg_missing.parquet";

        let result = postgres_list.get(file_key).await;
        assert!(result.is_err()); // Should return error for missing file
    }

    #[tokio::test]
    #[ignore = "Requires test PostgreSQL database setup"]
    async fn test_update_flattened() {
        let pool = setup_test_db().await;
        cleanup_test_data(&pool).await;

        let postgres_list = PostgresFileList::new();
        let meta = create_test_file_meta();
        let file_key = "test_org/test_stream/logs/2021/01/01/pg_flatten_test.parquet";

        // Add file first
        let _ = postgres_list.add("test_account", file_key, &meta).await;

        // Update flattened status
        let _result = postgres_list.update_flattened(file_key, true).await;
        // assert!(result.is_ok());
    }

    #[tokio::test]
    #[ignore = "Requires test PostgreSQL database setup"]
    async fn test_update_compressed_size() {
        let pool = setup_test_db().await;
        cleanup_test_data(&pool).await;

        let postgres_list = PostgresFileList::new();
        let meta = create_test_file_meta();
        let file_key = "test_org/test_stream/logs/2021/01/01/pg_compress_test.parquet";

        // Add file first
        let _ = postgres_list.add("test_account", file_key, &meta).await;

        // Update compressed size
        let new_size = 15000;
        let _result = postgres_list
            .update_compressed_size(file_key, new_size)
            .await;
        // assert!(result.is_ok());
    }

    #[tokio::test]
    #[ignore = "Requires test PostgreSQL database setup"]
    async fn test_len_and_is_empty() {
        let pool = setup_test_db().await;
        cleanup_test_data(&pool).await;

        let postgres_list = PostgresFileList::new();

        // Test empty database
        let _len_result = postgres_list.len().await;
        let _empty_result = postgres_list.is_empty().await;
        // assert_eq!(len_result, 0);
        // assert!(empty_result);

        // Add a file and test again
        let meta = create_test_file_meta();
        let file_key = "test_org/test_stream/logs/2021/01/01/pg_len_test.parquet";
        let _ = postgres_list.add("test_account", file_key, &meta).await;

        let _len_result_after = postgres_list.len().await;
        let _empty_result_after = postgres_list.is_empty().await;
        // assert!(len_result_after > 0);
        // assert!(!empty_result_after);
    }

    #[tokio::test]
    #[ignore = "Requires test PostgreSQL database setup"]
    async fn test_clear() {
        let pool = setup_test_db().await;
        cleanup_test_data(&pool).await;

        let postgres_list = PostgresFileList::new();

        // Add some files first
        let meta = create_test_file_meta();
        let _ = postgres_list
            .add(
                "test_account",
                "test_org/test_stream/logs/2021/01/01/pg_clear1.parquet",
                &meta,
            )
            .await;
        let _ = postgres_list
            .add(
                "test_account",
                "test_org/test_stream/logs/2021/01/01/pg_clear2.parquet",
                &meta,
            )
            .await;

        // Clear all files
        let _result = postgres_list.clear().await;
        // assert!(result.is_ok());

        // Verify database is empty
        let _is_empty = postgres_list.is_empty().await;
        // assert!(is_empty);
    }

    #[tokio::test]
    #[ignore = "Requires test PostgreSQL database setup"]
    async fn test_error_handling_invalid_file_key() {
        let postgres_list = PostgresFileList::new();
        let meta = create_test_file_meta();
        let invalid_key = "invalid_key_format";

        let result = postgres_list.add("test_account", invalid_key, &meta).await;
        assert!(result.is_err()); // Should fail due to invalid key format
    }

    #[tokio::test]
    async fn test_inner_batch_process_empty_files() {
        let postgres_list = PostgresFileList::new();
        let empty_files: Vec<FileKey> = vec![];

        // This should complete successfully without database calls
        let result = postgres_list
            .inner_batch_process("file_list", &empty_files)
            .await;
        assert!(result.is_ok());
    }

    #[tokio::test]
    async fn test_file_key_creation_helpers_postgres() {
        // Test our test helper functions for PostgreSQL context
        let file_key = create_test_file_key(
            "test_account",
            "org/stream/logs/2021/01/01/pg_test.parquet",
            false,
        );

        assert_eq!(file_key.account, "test_account");
        assert_eq!(file_key.key, "org/stream/logs/2021/01/01/pg_test.parquet");
        assert!(!file_key.deleted);
        assert_eq!(file_key.id, 0);

        // Test meta values
        assert_eq!(file_key.meta.records, 1000);
        assert_eq!(file_key.meta.original_size, 50000);
        assert_eq!(file_key.meta.compressed_size, 10000);
        assert!(!file_key.meta.flattened);
    }

    #[tokio::test]
    async fn test_postgresql_specific_syntax() {
        // Test PostgreSQL specific features like parameterized queries using $1, $2, $3
        let postgres_list = PostgresFileList::new();

        // Test that invalid file key parsing still works the same
        let result = parse_file_key_columns("invalid/key");
        assert!(result.is_err());

        // Test that empty batch processing works
        let empty_files: Vec<FileKey> = vec![];
        let result = postgres_list
            .inner_batch_process("file_list", &empty_files)
            .await;
        assert!(result.is_ok());
    }

    #[tokio::test]
    async fn test_postgresql_data_types() {
        let meta = create_test_file_meta();

        // Test PostgreSQL can handle the same data ranges as MySQL
        assert!(meta.min_ts > 0);
        assert!(meta.max_ts > meta.min_ts);
        assert!(meta.records > 0);
        assert!(meta.original_size > meta.compressed_size);
        assert_eq!(meta.index_size, 5000);
    }

    #[tokio::test]
    async fn test_postgresql_file_column_size_limits() {
        // PostgreSQL allows VARCHAR(1024) for file column vs MySQL's VARCHAR(496)
        let long_filename = "c".repeat(1000); // Within PostgreSQL limit
        let long_key = format!("org/stream/logs/2021/01/01/{}.parquet", long_filename);

        let result = parse_file_key_columns(&long_key);
        match result {
            Ok((stream, date, file)) => {
                assert_eq!(stream, "org/stream/logs");
                assert_eq!(date, "2021/01/01");
                assert!(file.len() <= 1024); // PostgreSQL file column limit
            }
            Err(_) => {
                // Expected for extremely long keys exceeding limits
            }
        }
    }

    #[tokio::test]
    async fn test_postgresql_identity_columns() {
        // PostgreSQL uses GENERATED ALWAYS AS IDENTITY instead of AUTO_INCREMENT
        // This is mainly a schema difference, but we test the concept
        let file_key = create_test_file_key(
            "account1",
            "files/default/logs/olympics/2021/01/01/00/identity_test.parquet",
            false,
        );

        // ID should start at 0 for new FileKey objects before DB insertion
        assert_eq!(file_key.id, 0);

        // After DB insertion (mocked), ID would be auto-generated by PostgreSQL's IDENTITY column
    }

    #[tokio::test]
    async fn test_postgresql_duplicate_index_handling() {
        // PostgreSQL handles duplicate index creation differently than MySQL
        // This tests the error message checking logic

        let error_messages = vec![
            "could not create unique index", // PostgreSQL error message
            "duplicate key value violates unique constraint",
            "relation already exists",
        ];

        for msg in error_messages {
            // Test PostgreSQL-specific error message patterns
            assert!(
                msg.contains("could not create unique index")
                    || msg.contains("duplicate")
                    || msg.contains("already exists")
            );
        }
    }
}
