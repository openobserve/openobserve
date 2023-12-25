// Copyright 2023 Zinc Labs Inc.
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

use std::{
    str::FromStr,
    sync::{atomic::AtomicBool, Arc},
    time::Duration,
};

use ahash::HashMap;
use async_trait::async_trait;
use bytes::Bytes;
use config::{FxIndexMap, CONFIG};
use once_cell::sync::Lazy;
use sqlx::{
    sqlite::{
        SqliteConnectOptions, SqliteJournalMode, SqliteLockingMode, SqlitePoolOptions,
        SqliteSynchronous,
    },
    Pool, Sqlite,
};
use tokio::{
    sync::{mpsc, RwLock},
    time,
};

use crate::common::infra::{
    cluster,
    db::{
        DbEvent, DbEventFileList, DbEventFileListDeleted, DbEventMeta, DbEventStreamStats, Event,
        EventData,
    },
    errors::*,
    file_list::sqlite as sqlite_file_list,
};

/// Database update retry times
const DB_RETRY_TIMES: usize = 5;

/// Database shutdown flag
static DB_SHUTDOWN: AtomicBool = AtomicBool::new(false);

pub static CLIENT_RO: Lazy<Pool<Sqlite>> = Lazy::new(connect_ro);
pub static CLIENT_RW: Lazy<Pool<Sqlite>> = Lazy::new(connect_rw);
pub static CHANNEL: Lazy<SqliteDbChannel> = Lazy::new(SqliteDbChannel::new);

static WATCHERS: Lazy<RwLock<FxIndexMap<String, EventChannel>>> =
    Lazy::new(|| RwLock::new(Default::default()));

type EventChannel = Arc<mpsc::Sender<Event>>;
type DbChannel = Arc<mpsc::Sender<DbEvent>>;

fn connect_rw() -> Pool<Sqlite> {
    let url = format!("{}{}", CONFIG.common.data_db_dir, "metadata.sqlite");
    if !CONFIG.common.local_mode && std::path::Path::new(&url).exists() {
        std::fs::remove_file(&url).expect("remove file sqlite failed");
        _ = std::fs::remove_file(format!("{url}-shm"));
        _ = std::fs::remove_file(format!("{url}-wal"));
    }
    let db_opts = SqliteConnectOptions::from_str(&url)
        .expect("sqlite connect options create failed")
        .journal_mode(SqliteJournalMode::Wal)
        .synchronous(SqliteSynchronous::Normal)
        .locking_mode(SqliteLockingMode::Normal)
        .busy_timeout(Duration::from_secs(30))
        // .disable_statement_logging()
        .create_if_missing(true);

    SqlitePoolOptions::new()
        .min_connections(1)
        .max_connections(1)
        .acquire_timeout(Duration::from_secs(30))
        .connect_lazy_with(db_opts)
}

fn connect_ro() -> Pool<Sqlite> {
    let url = format!("{}{}", CONFIG.common.data_db_dir, "metadata.sqlite");
    let db_opts = SqliteConnectOptions::from_str(&url)
        .expect("sqlite connect options create failed")
        .journal_mode(SqliteJournalMode::Wal)
        .synchronous(SqliteSynchronous::Normal)
        .locking_mode(SqliteLockingMode::Normal)
        .busy_timeout(Duration::from_secs(30))
        // .disable_statement_logging()
        .read_only(true);
    SqlitePoolOptions::new()
        .min_connections(10)
        .max_connections(512)
        .acquire_timeout(Duration::from_secs(30))
        .connect_lazy_with(db_opts)
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
                                let tx = tx.clone();
                                tokio::task::spawn(async move {
                                    if let Err(e) = tx.send(Event::Put(e)).await {
                                        log::error!("[SQLITE] send put event error: {}", e);
                                    }
                                });
                            }
                        }
                        Event::Delete(e) => {
                            if e.key.starts_with(prefix) {
                                let tx = tx.clone();
                                tokio::task::spawn(async move {
                                    if let Err(e) = tx.send(Event::Delete(e)).await {
                                        log::error!("[SQLITE] send delete event error: {}", e);
                                    }
                                });
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
        let (tx, mut rx) = mpsc::channel::<DbEvent>(100000);
        tokio::task::spawn(async move {
            loop {
                let event = match rx.recv().await {
                    Some(v) => v,
                    None => {
                        log::info!("[SQLITE] db event channel closed");
                        break;
                    }
                };
                if CONFIG.common.print_key_event {
                    log::info!("[SQLITE] db event: {:?}", event);
                }
                let client = CLIENT_RW.clone();
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
                    DbEvent::FileList(DbEventFileList::Add(file, meta)) => {
                        let mut err: Option<String> = None;
                        for _ in 0..DB_RETRY_TIMES {
                            match sqlite_file_list::add(&client, &file, &meta).await {
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
                            log::error!("[SQLITE] add file_list error: {}", e);
                        }
                    }
                    DbEvent::FileList(DbEventFileList::BatchAdd(files)) => {
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
                    DbEvent::FileList(DbEventFileList::BatchRemove(files)) => {
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
                    DbEvent::FileListDeleted(DbEventFileListDeleted::BatchAdd(
                        org_id,
                        created_at,
                        files,
                    )) => {
                        let mut err: Option<String> = None;
                        for _ in 0..DB_RETRY_TIMES {
                            match sqlite_file_list::batch_add_deleted(
                                &client, &org_id, created_at, &files,
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
                            log::error!("[SQLITE] batch add file_list_deleted error: {}", e);
                        }
                    }
                    DbEvent::FileListDeleted(DbEventFileListDeleted::BatchRemove(files)) => {
                        let mut err: Option<String> = None;
                        for _ in 0..DB_RETRY_TIMES {
                            match sqlite_file_list::batch_remove_deleted(&client, &files).await {
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
                            log::error!("[SQLITE] batch remove file_list_deleted error: {}", e);
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
                    DbEvent::StreamStats(DbEventStreamStats::ResetAll) => {
                        let mut err: Option<String> = None;
                        for _ in 0..DB_RETRY_TIMES {
                            match sqlite_file_list::reset_stream_stats(&client).await {
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
                            log::error!("[SQLITE] reset stream stats error: {}", e);
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
                        DB_SHUTDOWN.store(true, std::sync::atomic::Ordering::Release);
                        break;
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
        let pool = CLIENT_RO.clone();
        let keys_count: i64 = sqlx::query_scalar(r#"SELECT COUNT(*) as num FROM meta;"#)
            .fetch_one(&pool)
            .await
            .unwrap_or_default();
        let bytes_len: i64 = sqlx::query_scalar(r#"SELECT (page_count * page_size) as size FROM pragma_page_count(), pragma_page_size();"#)
        .fetch_one(&pool)
        .await.unwrap_or_default();
        Ok(super::Stats {
            bytes_len,
            keys_count,
        })
    }

    async fn get(&self, key: &str) -> Result<Bytes> {
        let (module, key1, key2) = super::parse_key(key);
        let pool = CLIENT_RO.clone();
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
        let pool = CLIENT_RO.clone();
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
        let pool = CLIENT_RO.clone();
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
        let pool = CLIENT_RO.clone();
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
            let db = super::get_db().await;
            db.list_keys(key).await?
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
