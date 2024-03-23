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

use std::{str::FromStr, sync::Arc, time::Duration};

use async_trait::async_trait;
use bytes::Bytes;
use config::{cluster, FxIndexMap, CONFIG};
use hashbrown::HashMap;
use once_cell::sync::Lazy;
use sqlx::{
    sqlite::{
        SqliteConnectOptions, SqliteJournalMode, SqliteLockingMode, SqlitePoolOptions,
        SqliteSynchronous,
    },
    Pool, Sqlite,
};
use tokio::sync::{mpsc, Mutex, RwLock};

use crate::{
    db::{Event, EventData},
    errors::*,
};

pub static CLIENT_RO: Lazy<Pool<Sqlite>> = Lazy::new(connect_ro);
pub static CLIENT_RW: Lazy<Arc<Mutex<Pool<Sqlite>>>> =
    Lazy::new(|| Arc::new(Mutex::new(connect_rw())));
pub static CHANNEL: Lazy<SqliteDbChannel> = Lazy::new(SqliteDbChannel::new);

static WATCHERS: Lazy<RwLock<FxIndexMap<String, EventChannel>>> =
    Lazy::new(|| RwLock::new(Default::default()));

type EventChannel = Arc<mpsc::Sender<Event>>;

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
        .min_connections(CONFIG.limit.sql_min_db_connections)
        .max_connections(CONFIG.limit.sql_max_db_connections)
        .acquire_timeout(Duration::from_secs(30))
        .connect_lazy_with(db_opts)
}

pub struct SqliteDbChannel {
    pub watch_tx: EventChannel,
}

impl SqliteDbChannel {
    pub fn new() -> Self {
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
        create_table().await
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
            r#"SELECT value FROM meta WHERE module = $1 AND key1 = $2 AND key2 = $3 ORDER BY start_dt DESC;"#,
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

    async fn put(
        &self,
        key: &str,
        value: Bytes,
        need_watch: bool,
        start_dt: Option<i64>,
    ) -> Result<()> {
        let (module, key1, key2) = super::parse_key(key);
        let local_start_dt = start_dt.unwrap_or(0);
        let client = CLIENT_RW.clone();
        let client = client.lock().await;
        let mut tx = client.begin().await?;
        if let Err(e) = sqlx::query(
            r#"INSERT OR IGNORE INTO meta (module, key1, key2,  start_dt, value) VALUES ($1, $2, $3,  $4, '');"#,
        )
        .bind(&module)
        .bind(&key1)
        .bind(&key2)
        .bind(local_start_dt)
        .execute(&mut *tx)
        .await
        {
            if let Err(e) = tx.rollback().await {
                log::error!("[SQLITE] rollback put meta error: {}", e);
            }
            return Err(e.into());
        }
        if let Err(e) = sqlx::query(
            r#"UPDATE meta SET value=$5 WHERE module = $1 AND key1 = $2 AND key2 = $3 AND start_dt = $4;"#,
        )
        .bind(&module)
        .bind(&key1)
        .bind(&key2)
        .bind(local_start_dt)
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

        // release lock
        drop(client);

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
        &self,
        key: &str,
        with_prefix: bool,
        need_watch: bool,
        start_dt: Option<i64>,
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

        let sql = if let Some(start_dt) = start_dt {
            sql.replace(';', &format!(" AND start_dt = {};", start_dt))
        } else {
            sql
        };

        let client = CLIENT_RW.clone();
        let client = client.lock().await;
        sqlx::query(&sql).execute(&*client).await?;
        Ok(())
    }

    async fn list(&self, prefix: &str) -> Result<HashMap<String, Bytes>> {
        let (module, key1, key2) = super::parse_key(prefix);
        let mut sql = "SELECT module, key1, key2, start_dt, value FROM meta".to_string();
        if !module.is_empty() {
            sql = format!("{} WHERE module = '{}'", sql, module);
        }
        if !key1.is_empty() {
            sql = format!("{} AND key1 = '{}'", sql, key1);
        }
        if !key2.is_empty() {
            sql = format!("{} AND key2 LIKE '{}%'", sql, key2);
        }
        sql = format!("{} ORDER BY start_dt DESC ", sql);
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
        let mut sql = "SELECT module, key1, key2, start_dt, '' AS value FROM meta".to_string();
        if !module.is_empty() {
            sql = format!("{} WHERE module = '{}'", sql, module);
        }
        if !key1.is_empty() {
            sql = format!("{} AND key1 = '{}'", sql, key1);
        }
        if !key2.is_empty() {
            sql = format!("{} AND key2 LIKE '{}%'", sql, key2);
        }

        sql = format!("{} ORDER BY start_dt DESC ", sql);
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
        Ok(())
    }

    async fn add_start_dt_column(&self) -> Result<()> {
        let client = CLIENT_RW.clone();
        let client = client.lock().await;
        println!("[SQLITE] ENTER: add_start_dt_column");

        add_col(&client).await?;

        // Proceed to drop the index if it exists and create a new one if it does not exist
        sqlx::query(
        r#"
        DROP INDEX IF EXISTS meta_module_key2_idx;
        CREATE UNIQUE INDEX IF NOT EXISTS meta_module_start_dt_idx ON meta (start_dt, key2, key1, module);
        "#
    )
    .execute(&*client)
    .await?;

        println!("[SQLITE] EXIT: add_start_dt_column");
        Ok(())
    }
}

async fn create_table() -> Result<()> {
    let client = CLIENT_RW.clone();
    let client = client.lock().await;
    // create table
    sqlx::query(
        r#"
CREATE TABLE IF NOT EXISTS meta
(
    id      INTEGER  not null primary key autoincrement,
    module  VARCHAR  not null,
    key1    VARCHAR not null,
    key2    VARCHAR not null,
    start_dt    INTEGER not null,
    value   TEXT not null
);
        "#,
    )
    .execute(&*client)
    .await?;
    // create table index
    sqlx::query(
        r#"
CREATE INDEX IF NOT EXISTS meta_module_idx on meta (module);
CREATE INDEX IF NOT EXISTS meta_module_key1_idx on meta (key1, module);
        "#,
    )
    .execute(&*client)
    .await?;

    add_col(&client).await?;

    match sqlx::query(
        r#"
CREATE UNIQUE INDEX IF NOT EXISTS meta_module_start_dt_idx on meta (start_dt, key2, key1, module);
        "#,
    )
    .execute(&*client)
    .await
    {
        Ok(_) => {}
        Err(e) => {
            log::error!(
                "[SQLITE] create meta_module_start_dt_idx index error: {}",
                e
            );
        }
    }
    Ok(())
}

async fn add_col(client: &Pool<Sqlite>) -> Result<()> {
    // Attempt to add the column, ignoring the error if the column already exists
    let add_column_result = sqlx::query(
        r#"
        ALTER TABLE meta ADD COLUMN start_dt INTEGER NOT NULL DEFAULT 0;
        "#,
    )
    .execute(client)
    .await;

    match add_column_result {
        Ok(_) => {
            println!("[SQLITE] Column added or already exists.");
            Ok(())
        }
        Err(e) => {
            // Check if the error is about the duplicate column
            if e.to_string().contains("duplicate column name") {
                // Ignore the duplicate column error and proceed
                println!("[SQLITE] start_dt Column already exists, proceeding.");
                Ok(())
            } else {
                // If the error is not about the duplicate column, return it
                Err(e.into())
            }
        }
    }
}
