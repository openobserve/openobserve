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
    sqlite::{
        SqliteConnectOptions, SqliteJournalMode, SqliteLockingMode, SqlitePoolOptions,
        SqliteSynchronous,
    },
    ConnectOptions, Pool, Sqlite,
};
use std::{str::FromStr, sync::Arc, time::Duration};
use tokio::sync::{mpsc, RwLock};

use crate::common::infra::{
    cluster,
    config::{FxIndexMap, CONFIG},
    db::{Event, EventData},
    errors::*,
};

static CLIENT: Lazy<Pool<Sqlite>> = Lazy::new(connect);
static CHANNEL: Lazy<SqliteDbChannel> = Lazy::new(SqliteDbChannel::new);

static WATCHERS: Lazy<RwLock<FxIndexMap<String, EventChannel>>> =
    Lazy::new(|| RwLock::new(Default::default()));

type EventChannel = Arc<mpsc::Sender<Event>>;

fn connect() -> Pool<Sqlite> {
    let url = format!("{}{}", CONFIG.common.data_db_dir, "file_list.sqlite");
    if !CONFIG.common.local_mode && std::path::Path::new(&url).exists() {
        std::fs::remove_file(&url).expect("remove file sqlite failed");
        std::fs::remove_file(format!("{url}-shm")).expect("remove file sqlite-shm failed");
        std::fs::remove_file(format!("{url}-wal")).expect("remove file sqlite-wal failed");
    }
    let db_opts = SqliteConnectOptions::from_str(&url)
        .expect("sqlite connect options create failed")
        .journal_mode(SqliteJournalMode::Wal)
        .synchronous(SqliteSynchronous::Normal)
        .locking_mode(SqliteLockingMode::Exclusive)
        .busy_timeout(Duration::from_secs(10))
        .disable_statement_logging()
        .create_if_missing(true);

    let pool_opts = SqlitePoolOptions::new()
        .min_connections(1)
        .max_connections(1)
        .acquire_timeout(Duration::from_secs(60))
        .after_connect(|_, _| {
            Box::pin(async move {
                log::info!("[SQLITE] meta db connected");
                Ok(())
            })
        })
        .after_release(|_, _| {
            Box::pin(async move {
                log::info!("[SQLITE] meta db connected");
                Ok(true)
            })
        });
    pool_opts.connect_lazy_with(db_opts)
}

struct SqliteDbChannel {
    watch_tx: EventChannel,
}

impl SqliteDbChannel {
    fn new() -> Self {
        Self {
            watch_tx: SqliteDbChannel::handle_watch_channel(),
        }
    }

    fn handle_watch_channel() -> EventChannel {
        let (tx, mut rx) = mpsc::channel::<Event>(10000);
        tokio::task::spawn(async move {
            loop {
                if cluster::is_offline() {
                    break;
                }
                let event = match rx.recv().await {
                    Some(v) => v,
                    None => {
                        log::info!("[SQLITE] watch event channel closed");
                        break;
                    }
                };
                if CONFIG.common.print_key_event {
                    log::info!("[SQLITE] watch event: {:?}", event);
                }
                for (prefix, tx) in WATCHERS.read().await.iter() {
                    match event.clone() {
                        Event::Put(e) => {
                            if e.key.starts_with(prefix) {
                                if let Err(e) = tx.send(Event::Put(e)).await {
                                    log::error!("[SQLITE] send event error: {}", e);
                                }
                            }
                        }
                        Event::Delete(e) => {
                            if e.key.starts_with(prefix) {
                                if let Err(e) = tx.send(Event::Delete(e)).await {
                                    log::error!("[SQLITE] send event error: {}", e);
                                }
                            }
                        }
                        Event::Empty => {}
                    }
                }
            }
            log::info!("[SQLITE] watch event loop exit");
        });
        Arc::new(tx)
    }
}

impl Default for SqliteDbChannel {
    fn default() -> Self {
        Self::new()
    }
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
    async fn create_table(&self) -> Result<()> {
        create_table(&CLIENT.clone()).await
    }

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
        let (module, key1, key2) = super::parse_key(key);
        let pool = CLIENT.clone();
        let value: String = match sqlx::query_scalar(
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

    async fn put(&self, key: &str, value: Bytes, need_watch: bool) -> Result<()> {
        put(&CLIENT.clone(), key, value, need_watch).await
    }

    async fn delete(&self, key: &str, with_prefix: bool, need_watch: bool) -> Result<()> {
        delete(&CLIENT.clone(), key, with_prefix, need_watch).await
    }

    async fn list(&self, prefix: &str) -> Result<HashMap<String, Bytes>> {
        let (module, key1, key2) = super::parse_key(prefix);
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
        let pool = CLIENT.clone();
        let ret = sqlx::query_as::<_, super::MetaRecord>(&sql)
            .fetch_all(&pool)
            .await?;
        Ok(ret
            .into_iter()
            .map(|r| {
                (
                    super::build_key(&r.module, &r.key1, &r.key2),
                    Bytes::from(r.value),
                )
            })
            .collect())
    }

    async fn list_keys(&self, prefix: &str) -> Result<Vec<String>> {
        let (module, key1, key2) = super::parse_key(prefix);
        let mut sql = "SELECT module, key1, key2, '' AS value FROM meta".to_string();
        if !module.is_empty() {
            sql = format!("{} WHERE module = '{}'", sql, module);
        }
        if !key1.is_empty() {
            sql = format!("{} AND key1 = '{}'", sql, key1);
        }
        if !key2.is_empty() {
            sql = format!("{} AND key2 LIKE '{}%'", sql, key2);
        }
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
        let (module, key1, key2) = super::parse_key(prefix);
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
        let pool = CLIENT.clone();
        let count: i64 = sqlx::query_scalar(&sql).fetch_one(&pool).await?;
        Ok(count)
    }

    async fn watch(&self, prefix: &str) -> Result<Arc<mpsc::Receiver<Event>>> {
        let (tx, rx) = mpsc::channel(1024);
        WATCHERS
            .write()
            .await
            .insert(prefix.to_string(), Arc::new(tx));
        Ok(Arc::new(rx))
    }

    async fn close(&self) -> Result<()> {
        Ok(())
    }
}

async fn put(client: &Pool<Sqlite>, key: &str, value: Bytes, need_watch: bool) -> Result<()> {
    let (module, key1, key2) = super::parse_key(key);
    let mut tx = client.begin().await?;
    if let Err(e) = sqlx::query(
        r#"INSERT OR IGNORE INTO meta (module, key1, key2, value) VALUES ($1, $2, $3, '');"#,
    )
    .bind(&module)
    .bind(&key1)
    .bind(&key2)
    .execute(&mut *tx)
    .await
    {
        if let Err(e) = tx.rollback().await {
            log::error!("[SQLITE] rollback put meta error: {}", e);
        }
        return Err(e.into());
    }
    if let Err(e) =
        sqlx::query(r#"UPDATE meta SET value=$4 WHERE module = $1 AND key1 = $2 AND key2 = $3;"#)
            .bind(&module)
            .bind(&key1)
            .bind(&key2)
            .bind(String::from_utf8(value.to_vec()).unwrap_or_default())
            .execute(&mut *tx)
            .await
    {
        if let Err(e) = tx.rollback().await {
            log::error!("[SQLITE] rollback put meta error: {}", e);
        }
        return Err(e.into());
    }
    if let Err(e) = tx.commit().await {
        log::error!("[SQLITE] commit put meta error: {}", e);
        return Err(e.into());
    }

    // event watch
    if need_watch {
        if let Err(e) = CHANNEL
            .watch_tx
            .clone()
            .send(Event::Put(EventData {
                key: key.to_string(),
                value: Some(value),
            }))
            .await
        {
            log::error!("[SQLITE] send event error: {}", e);
        }
    }

    Ok(())
}

async fn delete(
    client: &Pool<Sqlite>,
    key: &str,
    with_prefix: bool,
    need_watch: bool,
) -> Result<()> {
    // event watch
    if need_watch {
        // find all keys then send event
        let items = if with_prefix {
            super::DEFAULT.list_keys(key).await?
        } else {
            vec![key.to_string()]
        };
        let tx = CHANNEL.watch_tx.clone();
        tokio::task::spawn(async move {
            for key in items {
                if let Err(e) = tx
                    .send(Event::Delete(EventData {
                        key: key.to_string(),
                        value: None,
                    }))
                    .await
                {
                    log::error!("[SQLITE] send event error: {}", e);
                }
            }
        });
    }

    let (module, key1, key2) = super::parse_key(key);
    let sql = if with_prefix {
        if key1.is_empty() {
            format!(r#"DELETE FROM meta WHERE module = '{}';"#, module)
        } else if key2.is_empty() {
            format!(
                r#"DELETE FROM meta WHERE module = '{}' AND key1 = '{}';"#,
                module, key1
            )
        } else {
            format!(
                r#"DELETE FROM meta WHERE module = '{}' AND key1 = '{}' AND key2 LIKE '{}%';"#,
                module, key1, key2
            )
        }
    } else {
        format!(
            r#"DELETE FROM meta WHERE module = '{}' AND key1 = '{}' AND key2 = '{}';"#,
            module, key1, key2
        )
    };
    sqlx::query(&sql).execute(client).await?;

    Ok(())
}

async fn create_table(client: &Pool<Sqlite>) -> Result<()> {
    // create table
    sqlx::query(
        r#"
CREATE TABLE IF NOT EXISTS meta
(
    id      INTEGER  not null primary key autoincrement,
    module  VARCHAR  not null,
    key1    VARCHAR not null,
    key2    VARCHAR not null,
    value   TEXT not null
);
        "#,
    )
    .execute(client)
    .await?;
    // create table index
    sqlx::query(
        r#"
CREATE INDEX IF NOT EXISTS meta_module_idx on meta (module);
CREATE INDEX IF NOT EXISTS meta_module_key1_idx on meta (module, key1);
CREATE UNIQUE INDEX IF NOT EXISTS meta_module_key2_idx on meta (module, key1, key2);
        "#,
    )
    .execute(client)
    .await?;
    Ok(())
}
