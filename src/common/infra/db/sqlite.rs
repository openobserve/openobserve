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
use std::{
    str::FromStr,
    sync::{atomic::AtomicBool, Arc},
    time::Duration,
};
use tokio::{
    sync::{mpsc, RwLock},
    time,
};

use crate::common::infra::{
    cluster,
    config::{FxIndexMap, CONFIG},
    db::{DbEvent, DbEventFileList, DbEventMeta, DbEventStreamStats, Event, EventData},
    errors::*,
    file_list::sqlite as sqlite_file_list,
};

/// Database update retry times
const DB_RETRY_TIMES: usize = 5;

/// Database shutdown flag
static DB_SHUTDOWN: AtomicBool = AtomicBool::new(false);

pub static CLIENT: Lazy<Pool<Sqlite>> = Lazy::new(connect);
pub static CHANNEL: Lazy<SqliteDbChannel> = Lazy::new(SqliteDbChannel::new);

static WATCHERS: Lazy<RwLock<FxIndexMap<String, EventChannel>>> =
    Lazy::new(|| RwLock::new(Default::default()));

type EventChannel = Arc<mpsc::Sender<Event>>;
type DbChannel = Arc<mpsc::Sender<DbEvent>>;

fn connect() -> Pool<Sqlite> {
    let url = format!("{}{}", CONFIG.common.data_db_dir, "metadata.sqlite");
    if !CONFIG.common.local_mode && std::path::Path::new(&url).exists() {
        std::fs::remove_file(&url).expect("remove file failed");
    }
    let db_opts = SqliteConnectOptions::from_str(&url)
        .expect("sqlite connect options create failed")
        .journal_mode(SqliteJournalMode::Wal)
        .synchronous(SqliteSynchronous::Normal)
        .busy_timeout(Duration::from_secs(10))
        .disable_statement_logging()
        .create_if_missing(true);

    let pool_opts = SqlitePoolOptions::new();
    let pool_opts = pool_opts.min_connections(CONFIG.limit.cpu_num as u32);
    let pool_opts = pool_opts.max_connections(CONFIG.limit.query_thread_num as u32);
    pool_opts.connect_lazy_with(db_opts)
}

pub struct SqliteDbChannel {
    pub watch_tx: EventChannel,
    pub db_tx: DbChannel,
}

impl SqliteDbChannel {
    pub fn new() -> Self {
        Self {
            watch_tx: SqliteDbChannel::handle_watch_channel(),
            db_tx: SqliteDbChannel::handle_db_channel(),
        }
    }

    fn handle_watch_channel() -> EventChannel {
        let (tx, mut rx) = mpsc::channel::<Event>(1024);
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

    fn handle_db_channel() -> DbChannel {
        let (tx, mut rx) = mpsc::channel::<DbEvent>(10000);
        let client = CLIENT.clone();
        tokio::task::spawn(async move {
            loop {
                let event = match rx.recv().await {
                    Some(v) => v,
                    None => {
                        log::info!("[SQLITE] db event channel closed");
                        break;
                    }
                };
                match event {
                    DbEvent::Meta(DbEventMeta::Put(key, value, need_watch)) => {
                        let mut err: Option<String> = None;
                        for _ in 0..DB_RETRY_TIMES {
                            match put(&client, &key, value.clone(), need_watch).await {
                                Ok(_) => {
                                    err = None;
                                    break;
                                }
                                Err(e) => {
                                    err = Some(e.to_string());
                                }
                            }
                            time::sleep(time::Duration::from_secs(1)).await;
                        }
                        if let Some(e) = err {
                            log::error!("[SQLITE] put meta error: {}", e);
                        }
                    }
                    DbEvent::Meta(DbEventMeta::Delete(key, with_prefix, need_watch)) => {
                        let mut err: Option<String> = None;
                        for _ in 0..DB_RETRY_TIMES {
                            match delete(&client, &key, with_prefix, need_watch).await {
                                Ok(_) => {
                                    err = None;
                                    break;
                                }
                                Err(e) => {
                                    err = Some(e.to_string());
                                }
                            }
                            time::sleep(time::Duration::from_secs(1)).await;
                        }
                        if let Some(e) = err {
                            log::error!("[SQLITE] delete meta error: {}", e);
                        }
                    }
                    DbEvent::FileList(DbEventFileList::Add(files)) => {
                        let mut err: Option<String> = None;
                        for _ in 0..DB_RETRY_TIMES {
                            match sqlite_file_list::batch_add(&client, &files).await {
                                Ok(_) => {
                                    err = None;
                                    break;
                                }
                                Err(e) => {
                                    err = Some(e.to_string());
                                }
                            }
                            time::sleep(time::Duration::from_secs(1)).await;
                        }
                        if let Some(e) = err {
                            log::error!("[SQLITE] batch add file_list error: {}", e);
                        }
                    }
                    DbEvent::FileList(DbEventFileList::Remove(files)) => {
                        let mut err: Option<String> = None;
                        for _ in 0..DB_RETRY_TIMES {
                            match sqlite_file_list::batch_remove(&client, &files).await {
                                Ok(_) => {
                                    err = None;
                                    break;
                                }
                                Err(e) => {
                                    err = Some(e.to_string());
                                }
                            }
                            time::sleep(time::Duration::from_secs(1)).await;
                        }
                        if let Some(e) = err {
                            log::error!("[SQLITE] batch remove file_list error: {}", e);
                        }
                    }
                    DbEvent::FileList(DbEventFileList::Initialized) => {
                        sqlite_file_list::set_initialised();
                    }
                    DbEvent::StreamStats(DbEventStreamStats::Set(org_id, streams)) => {
                        let mut err: Option<String> = None;
                        for _ in 0..DB_RETRY_TIMES {
                            match sqlite_file_list::set_stream_stats(&client, &org_id, &streams)
                                .await
                            {
                                Ok(_) => {
                                    err = None;
                                    break;
                                }
                                Err(e) => {
                                    err = Some(e.to_string());
                                }
                            }
                            time::sleep(time::Duration::from_secs(1)).await;
                        }
                        if let Some(e) = err {
                            log::error!("[SQLITE] set stream stats error: {}", e);
                        }
                    }
                    DbEvent::StreamStats(DbEventStreamStats::ResetMinTS(stream, min_ts)) => {
                        let mut err: Option<String> = None;
                        for _ in 0..DB_RETRY_TIMES {
                            match sqlite_file_list::reset_stream_stats_min_ts(
                                &client, &stream, min_ts,
                            )
                            .await
                            {
                                Ok(_) => {
                                    err = None;
                                    break;
                                }
                                Err(e) => {
                                    err = Some(e.to_string());
                                }
                            }
                            time::sleep(time::Duration::from_secs(1)).await;
                        }
                        if let Some(e) = err {
                            log::error!("[SQLITE] reset stream stats min_ts error: {}", e);
                        }
                    }
                    DbEvent::CreateTableMeta => {
                        let mut err: Option<String> = None;
                        for _ in 0..DB_RETRY_TIMES {
                            match create_table(&client).await {
                                Ok(_) => {
                                    err = None;
                                    break;
                                }
                                Err(e) => {
                                    err = Some(e.to_string());
                                }
                            }
                            time::sleep(time::Duration::from_secs(1)).await;
                        }
                        if let Some(e) = err {
                            log::error!("[SQLITE] create table meta error: {}", e);
                        }
                    }
                    DbEvent::CreateTableFileList => {
                        let mut err: Option<String> = None;
                        for _ in 0..DB_RETRY_TIMES {
                            match sqlite_file_list::create_table(&client).await {
                                Ok(_) => {
                                    err = None;
                                    break;
                                }
                                Err(e) => {
                                    err = Some(e.to_string());
                                }
                            }
                            time::sleep(time::Duration::from_secs(1)).await;
                        }
                        if let Some(e) = err {
                            log::error!("[SQLITE] create table file_list error: {}", e);
                        }
                    }
                    DbEvent::CreateTableFileListIndex => {
                        let mut err: Option<String> = None;
                        for _ in 0..DB_RETRY_TIMES {
                            match sqlite_file_list::create_table_index(&client).await {
                                Ok(_) => {
                                    err = None;
                                    break;
                                }
                                Err(e) => {
                                    err = Some(e.to_string());
                                }
                            }
                            time::sleep(time::Duration::from_secs(1)).await;
                        }
                        if let Some(e) = err {
                            log::error!("[SQLITE] create table file_list index error: {}", e);
                        }
                    }
                    DbEvent::Shutdown => {
                        DB_SHUTDOWN.store(true, std::sync::atomic::Ordering::Relaxed);
                    }
                }
            }
            log::info!("[SQLITE] db event loop exit");
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
        let tx = CHANNEL.db_tx.clone();
        tx.send(DbEvent::CreateTableMeta)
            .await
            .map_err(|e| Error::Message(e.to_string()))?;
        Ok(())
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
        let tx = CHANNEL.db_tx.clone();
        tx.send(DbEvent::Meta(DbEventMeta::Put(
            key.to_string(),
            value,
            need_watch,
        )))
        .await
        .map_err(|e| Error::Message(e.to_string()))?;
        Ok(())
    }

    async fn delete(&self, key: &str, with_prefix: bool, need_watch: bool) -> Result<()> {
        let tx = CHANNEL.db_tx.clone();
        tx.send(DbEvent::Meta(DbEventMeta::Delete(
            key.to_string(),
            with_prefix,
            need_watch,
        )))
        .await
        .map_err(|e| Error::Message(e.to_string()))?;
        Ok(())
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
        let tx = CHANNEL.db_tx.clone();
        tx.send(DbEvent::Shutdown)
            .await
            .map_err(|e| Error::Message(e.to_string()))?;
        loop {
            if DB_SHUTDOWN.load(std::sync::atomic::Ordering::Relaxed) {
                break;
            }
            time::sleep(time::Duration::from_secs(1)).await;
        }
        Ok(())
    }
}

async fn put(client: &Pool<Sqlite>, key: &str, value: Bytes, need_watch: bool) -> Result<()> {
    let (module, key1, key2) = super::parse_key(key);
    let mut tx = client.begin().await?;
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
        .bind(String::from_utf8(value.to_vec()).unwrap_or_default())
        .execute(&mut *tx)
        .await?;
    if let Err(e) = tx.commit().await {
        log::error!("[SQLITE] commit stream stats error: {}", e);
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
