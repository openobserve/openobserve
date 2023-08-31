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
use bytes::Bytes;
use once_cell::sync::Lazy;
use sqlx::{
    sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions, SqliteSynchronous},
    ConnectOptions, Pool, Sqlite,
};
use std::{str::FromStr, sync::Arc};
use tokio::{sync::mpsc, task::JoinHandle, time};

use crate::common::infra::{cluster, config::CONFIG, errors::*};

pub(crate) static CLIENT: Lazy<Pool<Sqlite>> = Lazy::new(connect);

fn connect() -> Pool<Sqlite> {
    let url = format!("{}{}", CONFIG.common.data_db_dir, "metadata.sqlite");
    if !CONFIG.common.local_mode && std::path::Path::new(&url).exists() {
        std::fs::remove_file(&url).expect("remove file failed");
    }
    let db_opts = SqliteConnectOptions::from_str(&url)
        .expect("sqlite connect options create failed")
        .journal_mode(SqliteJournalMode::Memory)
        .synchronous(SqliteSynchronous::Off)
        .disable_statement_logging()
        .create_if_missing(true);

    let pool_opts = SqlitePoolOptions::new();
    let pool_opts = pool_opts.min_connections(CONFIG.limit.cpu_num as u32);
    let pool_opts = pool_opts.max_connections(CONFIG.limit.query_thread_num as u32);
    pool_opts.connect_lazy_with(db_opts)
}

pub struct SqliteDb {}

impl SqliteDb {
    pub fn new() -> Self {
        Self {}
    }
}

impl Default for SqliteDb {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl super::Db for SqliteDb {
    async fn stats(&self) -> Result<super::Stats> {
        let pool = CLIENT.clone();
        let keys_count: i64 = sqlx::query_scalar(r#"SELECT COUNT(*) as num FROM meta;"#)
            .fetch_one(&pool)
            .await
            .unwrap_or_default();
        let bytes_len: i64 =   sqlx::query_scalar(r#"SELECT (page_count * page_size) as size FROM pragma_page_count(), pragma_page_size();"#)
        .fetch_one(&pool)
        .await.unwrap_or_default();
        Ok(super::Stats {
            bytes_len,
            keys_count,
        })
    }

    async fn get(&self, key: &str) -> Result<Bytes> {
        let (module, key1, key2) = parse_key(key);
        let pool = CLIENT.clone();
        let value: Vec<u8> = match sqlx::query_scalar(
            r#"SELECT value FROM meta WHERE module = $1 AND key1 = $2 AND key2 = $3;"#,
        )
        .bind(module)
        .bind(key1)
        .bind(key2)
        .fetch_one(&pool)
        .await
        {
            Ok(v) => v,
            Err(_) => {
                return Err(Error::from(DbError::KeyNotExists(key.to_string())));
            }
        };
        Ok(Bytes::from(value))
    }

    async fn put(&self, key: &str, value: Bytes) -> Result<()> {
        let (module, key1, key2) = parse_key(key);
        let pool = CLIENT.clone();
        let mut tx = pool.begin().await?;
        sqlx::query(
            r#"INSERT OR IGNORE INTO meta (module, key1, key2, value) VALUES ($1, $2, $3, '');"#,
        )
        .bind(&module)
        .bind(&key1)
        .bind(&key2)
        .execute(&mut *tx)
        .await?;
        sqlx::query(r#"UPDATE meta SET value=$4 WHERE module = $1 AND key1 = $2 AND key2 = $3;"#)
            .bind(&module)
            .bind(&key1)
            .bind(&key2)
            .bind(value.to_vec())
            .execute(&mut *tx)
            .await?;
        if let Err(e) = tx.commit().await {
            log::error!("[SQLITE] commit stream stats error: {}", e);
        }

        Ok(())
    }

    async fn delete(&self, key: &str, _with_prefix: bool) -> Result<()> {
        let (module, key1, key2) = parse_key(key);
        let pool = CLIENT.clone();
        sqlx::query(r#"DELETE FROM meta WHERE module = $1 AND key1 = $2 AND key2 = $3;"#)
            .bind(module)
            .bind(key1)
            .bind(key2)
            .execute(&pool)
            .await?;
        Ok(())
    }

    async fn list(&self, prefix: &str) -> Result<HashMap<String, Bytes>> {
        let (module, key1, key2) = parse_key(prefix);
        let mut sql = "SELECT module, key1, key2, value FROM meta".to_string();
        if !module.is_empty() {
            sql = format!("{} WHERE module = '{}'", sql, module);
        }
        if !key1.is_empty() {
            sql = format!("{} AND key1 = '{}'", sql, key1);
        }
        if !key2.is_empty() {
            sql = format!("{} AND key2 LIKE '{}%'", sql, key2);
        }
        println!("[SQLITE] list sql: {}", sql);
        let pool = CLIENT.clone();
        let ret = sqlx::query_as::<_, super::MetaRecord>(&sql)
            .fetch_all(&pool)
            .await?;
        Ok(ret
            .into_iter()
            .map(|r| (build_key(&r.module, &r.key1, &r.key2), Bytes::from(r.value)))
            .collect())
    }

    async fn list_keys(&self, prefix: &str) -> Result<Vec<String>> {
        let (module, key1, key2) = parse_key(prefix);
        let mut sql = "SELECT module, key1, key2 FROM meta".to_string();
        if !module.is_empty() {
            sql = format!("{} WHERE module = '{}'", sql, module);
        }
        if !key1.is_empty() {
            sql = format!("{} AND key1 = '{}'", sql, key1);
        }
        if !key2.is_empty() {
            sql = format!("{} AND key2 LIKE '{}%'", sql, key2);
        }
        println!("[SQLITE] list sql: {}", sql);
        let pool = CLIENT.clone();
        let ret = sqlx::query_as::<_, super::MetaRecord>(&sql)
            .fetch_all(&pool)
            .await?;
        Ok(ret
            .into_iter()
            .map(|r| format!("/{}/{}/{}", r.module, r.key1, r.key2))
            .collect())
    }

    async fn list_values(&self, prefix: &str) -> Result<Vec<Bytes>> {
        let items = self.list(prefix).await?;
        Ok(items.into_values().collect())
    }

    async fn count(&self, prefix: &str) -> Result<i64> {
        let (module, key1, key2) = parse_key(prefix);
        let mut sql = "SELECT COUNT(*) AS num FROM meta".to_string();
        if !module.is_empty() {
            sql = format!("{} WHERE module = '{}'", sql, module);
        }
        if !key1.is_empty() {
            sql = format!("{} AND key1 = '{}'", sql, key1);
        }
        if !key2.is_empty() {
            sql = format!("{} AND key2 LIKE '{}%'", sql, key2);
        }
        println!("[SQLITE] list sql: {}", sql);
        let pool = CLIENT.clone();
        let count: i64 = sqlx::query_scalar(&sql).fetch_one(&pool).await?;
        Ok(count)
    }

    async fn watch(&self, _prefix: &str) -> Result<Arc<mpsc::Receiver<super::Event>>> {
        let (tx, rx) = mpsc::channel(1024);
        let _task: JoinHandle<Result<()>> = tokio::task::spawn(async move {
            loop {
                if cluster::is_offline() {
                    break;
                }
                tx.send(super::Event::Empty).await.unwrap();
                time::sleep(time::Duration::from_secs(10)).await;
            }
            Ok(())
        });

        Ok(Arc::new(rx))
    }
}

fn parse_key(mut key: &str) -> (String, String, String) {
    let mut module = "".to_string();
    let mut key1 = "".to_string();
    let mut key2 = "".to_string();
    if key.starts_with('/') {
        key = &key[1..];
    }
    if key.is_empty() {
        return (module, key1, key2);
    }
    let columns = key.split('/').collect::<Vec<&str>>();
    match columns.len() {
        0 => {}
        1 => {
            module = columns[0].to_string();
        }
        2 => {
            module = columns[0].to_string();
            key1 = columns[1].to_string();
        }
        3 => {
            module = columns[0].to_string();
            key1 = columns[1].to_string();
            key2 = columns[2].to_string();
        }
        _ => {
            module = columns[0].to_string();
            key1 = columns[1].to_string();
            key2 = columns[2..].join("/");
        }
    }
    (module, key1, key2)
}

fn build_key(module: &str, key1: &str, key2: &str) -> String {
    if key1.is_empty() {
        return module.to_string();
    }
    if key2.is_empty() {
        return format!("/{}/{}", module, key1);
    }
    format!("/{}/{}/{}", module, key1, key2)
}

pub async fn create_table() -> Result<()> {
    let pool = CLIENT.clone();
    // create table
    sqlx::query(
        r#"
CREATE TABLE IF NOT EXISTS meta
(
    id      INTEGER  not null primary key autoincrement,
    module  VARCHAR  not null,
    key1    VARCHAR not null,
    key2    VARCHAR not null,
    value   BLOB not null
);
        "#,
    )
    .execute(&pool)
    .await?;
    // create table index
    sqlx::query(
        r#"
CREATE INDEX IF NOT EXISTS meta_module_idx on meta (module);
CREATE INDEX IF NOT EXISTS meta_module_key1_idx on meta (module, key1);
CREATE UNIQUE INDEX IF NOT EXISTS meta_module_key2_idx on meta (module, key1, key2);
        "#,
    )
    .execute(&pool)
    .await?;
    Ok(())
}
