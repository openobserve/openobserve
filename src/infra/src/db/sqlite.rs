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

use std::{collections::HashSet, str::FromStr, sync::Arc, time::Duration};

use async_trait::async_trait;
use bytes::Bytes;
use config::{FxIndexMap, cluster, utils::util::zero_or};
use hashbrown::HashMap;
use once_cell::sync::Lazy;
use sqlx::{
    Pool, Sqlite,
    sqlite::{
        SqliteConnectOptions, SqliteJournalMode, SqliteLockingMode, SqlitePoolOptions,
        SqliteSynchronous,
    },
};
use tokio::sync::{Mutex, OnceCell, RwLock, mpsc};

use super::{DBIndex, IndexStatement};
use crate::{
    db::{Event, EventData},
    errors::*,
};

pub static CLIENT_RO: Lazy<Pool<Sqlite>> = Lazy::new(connect_ro);
pub static CLIENT_RW: Lazy<Arc<Mutex<Pool<Sqlite>>>> =
    Lazy::new(|| Arc::new(Mutex::new(connect_rw())));
static INDICES: OnceCell<HashSet<DBIndex>> = OnceCell::const_new();

pub static CHANNEL: Lazy<SqliteDbChannel> = Lazy::new(SqliteDbChannel::new);

static WATCHERS: Lazy<RwLock<FxIndexMap<String, EventChannel>>> =
    Lazy::new(|| RwLock::new(Default::default()));

type EventChannel = Arc<mpsc::Sender<Event>>;

fn connect_rw() -> Pool<Sqlite> {
    let cfg = config::get_config();
    let url = format!("{}{}", cfg.common.data_db_dir, "metadata.sqlite");
    if !cfg.common.local_mode && std::path::Path::new(&url).exists() {
        std::fs::remove_file(&url).expect("remove file sqlite failed");
        _ = std::fs::remove_file(format!("{url}-shm"));
        _ = std::fs::remove_file(format!("{url}-wal"));
    }

    let acquire_timeout = zero_or(cfg.limit.sql_db_connections_acquire_timeout, 30);
    let idle_timeout = zero_or(cfg.limit.sql_db_connections_idle_timeout, 600);
    let max_lifetime = zero_or(cfg.limit.sql_db_connections_max_lifetime, 1800);

    let db_opts = SqliteConnectOptions::from_str(&url)
        .expect("sqlite connect options create failed")
        .journal_mode(SqliteJournalMode::Wal)
        .synchronous(SqliteSynchronous::Normal)
        .locking_mode(SqliteLockingMode::Normal)
        .busy_timeout(Duration::from_secs(acquire_timeout))
        .create_if_missing(true);

    SqlitePoolOptions::new()
        .min_connections(cfg.limit.sql_db_connections_min)
        .max_connections(cfg.limit.sql_db_connections_max)
        .acquire_timeout(Duration::from_secs(acquire_timeout))
        .idle_timeout(Some(Duration::from_secs(idle_timeout)))
        .max_lifetime(Some(Duration::from_secs(max_lifetime)))
        .connect_lazy_with(db_opts)
}

fn connect_ro() -> Pool<Sqlite> {
    let cfg = config::get_config();

    let url = format!("{}{}", cfg.common.data_db_dir, "metadata.sqlite");
    let db_opts = SqliteConnectOptions::from_str(&url)
        .expect("sqlite connect options create failed")
        .journal_mode(SqliteJournalMode::Wal)
        .synchronous(SqliteSynchronous::Normal)
        .locking_mode(SqliteLockingMode::Normal)
        .busy_timeout(Duration::from_secs(30))
        // .disable_statement_logging()
        .read_only(true);

    let max_lifetime = if cfg.limit.sql_db_connections_max_lifetime > 0 {
        Some(std::time::Duration::from_secs(
            cfg.limit.sql_db_connections_max_lifetime,
        ))
    } else {
        None
    };
    SqlitePoolOptions::new()
        .min_connections(cfg.limit.sql_db_connections_min)
        .max_connections(cfg.limit.sql_db_connections_max)
        .max_lifetime(max_lifetime)
        .acquire_timeout(Duration::from_secs(30))
        .connect_lazy_with(db_opts)
}

async fn cache_indices() -> HashSet<DBIndex> {
    let client = CLIENT_RO.clone();
    let sql = r#"SELECT name,tbl_name FROM sqlite_master where type = 'index';"#;
    let res = sqlx::query_as::<_, (String, String)>(sql)
        .fetch_all(&client)
        .await;
    match res {
        Ok(r) => r
            .into_iter()
            .map(|(name, table)| DBIndex { name, table })
            .collect(),
        Err(_) => HashSet::new(),
    }
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
                if config::get_config().common.print_key_event {
                    log::info!("[SQLITE] watch event: {event:?}");
                }
                for (prefix, tx) in WATCHERS.read().await.iter() {
                    match event.clone() {
                        Event::Put(e) => {
                            if e.key.starts_with(prefix) {
                                let tx = tx.clone();
                                tokio::task::spawn(async move {
                                    if let Err(e) = tx.send(Event::Put(e)).await {
                                        log::error!("[SQLITE] send put event error: {e}");
                                    }
                                });
                            }
                        }
                        Event::Delete(e) => {
                            if e.key.starts_with(prefix) {
                                let tx = tx.clone();
                                tokio::task::spawn(async move {
                                    if let Err(e) = tx.send(Event::Delete(e)).await {
                                        log::error!("[SQLITE] send delete event error: {e}");
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
        let query = format!(
            "SELECT value FROM meta WHERE module = '{module}' AND key1 = '{key1}' AND key2 = '{key2}' ORDER BY start_dt DESC;"
        );
        let value: String = match sqlx::query_scalar(&query).fetch_one(&pool).await {
            Ok(v) => v,
            Err(e) => {
                if let sqlx::Error::RowNotFound = e {
                    return Err(Error::from(DbError::KeyNotExists(key.to_string())));
                } else {
                    return Err(Error::from(DbError::DBOperError(
                        e.to_string(),
                        key.to_string(),
                    )));
                }
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
        let local_start_dt = start_dt.unwrap_or_default();
        let client = CLIENT_RW.clone();
        let client = client.lock().await;
        let mut tx = client.begin().await?;
        if let Err(e) = sqlx::query(
            r#"INSERT OR IGNORE INTO meta (module, key1, key2, start_dt, value) VALUES ($1, $2, $3, $4, '');"#
        )
        .bind(&module)
        .bind(&key1)
        .bind(&key2)
        .bind(local_start_dt)
        .execute(&mut *tx)
        .await
        {
            if let Err(e) = tx.rollback().await {
                log::error!("[SQLITE] rollback put meta error: {e}");
            }
            return Err(e.into());
        }
        // need commit it first to avoid the deadlock of insert and update
        if let Err(e) = tx.commit().await {
            log::error!("[SQLITE] commit put meta error: {e}");
            return Err(e.into());
        }

        let mut tx = client.begin().await?;
        if let Err(e) = sqlx::query(
            r#"UPDATE meta SET value = $1 WHERE module = $2 AND key1 = $3 AND key2 = $4 AND start_dt = $5;"#
        )
        .bind(String::from_utf8(value.to_vec()).unwrap_or_default())
        .bind(&module)
        .bind(&key1)
        .bind(&key2)
        .bind(local_start_dt)
        .execute(&mut *tx)
        .await
        {
            if let Err(e) = tx.rollback().await {
                log::error!("[SQLITE] rollback put meta error: {e}");
            }
            return Err(e.into());
        }
        if let Err(e) = tx.commit().await {
            log::error!("[SQLITE] commit put meta error: {e}");
            return Err(e.into());
        }

        // release lock
        drop(client);

        // event watch
        if need_watch
            && let Err(e) = CHANNEL
                .watch_tx
                .clone()
                .send(Event::Put(EventData {
                    key: key.to_string(),
                    value: Some(value),
                    start_dt,
                }))
                .await
        {
            log::error!("[SQLITE] send event error: {e}");
        }

        Ok(())
    }

    async fn get_for_update(
        &self,
        key: &str,
        need_watch: bool,
        start_dt: Option<i64>,
        update_fn: Box<super::UpdateFn>,
    ) -> Result<()> {
        let (module, key1, key2) = super::parse_key(key);
        let client = CLIENT_RW.clone();
        let client = client.lock().await;
        let mut tx = client.begin().await?;
        let mut need_watch_dt = 0;
        let row = if let Some(start_dt) = start_dt {
            match sqlx::query_as::<_,super::MetaRecord>(
                r#"SELECT id, module, key1, key2, start_dt, value FROM meta WHERE module = $1 AND key1 = $2 AND key2 = $3 AND start_dt = $4;"#
            )
              .bind(&module)
              .bind(&key1)
              .bind(&key2)
            .bind(start_dt)
            .fetch_one(&mut *tx)
            .await
            {
                Ok(v) => Some(v),
                Err(e) => {
                    if e.to_string().contains("no rows returned") {
                        None
                    } else {
                        return Err(Error::Message(format!("[SQLITE] get_for_update error: {e}"))); 
                    }
                }
            }
        } else {
            match sqlx::query_as::<_,super::MetaRecord>(
                r#"SELECT id, module, key1, key2, start_dt, value FROM meta WHERE module = $1 AND key1 = $2 AND key2 = $3 ORDER BY start_dt DESC, id DESC;"#
            )
            .bind(&module)
            .bind(&key1)
            .bind(&key2)
            .fetch_one(&mut *tx)
            .await
            {
                Ok(v) => Some(v),
                Err(e) => {
                    if e.to_string().contains("no rows returned") {
                        None
                    } else {
                        return Err(Error::Message(format!("[SQLITE] get_for_update error: {e}"))); 
                    }
                }
            }
        };
        let exist = row.is_some();
        let row_id = row.as_ref().map(|r| r.id);
        let value = row.map(|r| Bytes::from(r.value));
        let (value, new_value) = match update_fn(value) {
            Err(e) => {
                if let Err(e) = tx.rollback().await {
                    log::error!("[SQLITE] rollback get_for_update error: {e}");
                }
                return Err(e);
            }
            Ok(None) => {
                if let Err(e) = tx.rollback().await {
                    log::error!("[SQLITE] rollback get_for_update error: {e}");
                }
                return Ok(());
            }
            Ok(Some(v)) => v,
        };

        // update value
        if let Some(value) = value.as_ref() {
            let ret = if exist {
                sqlx::query(r#"UPDATE meta SET value = $1 WHERE id = $2;"#)
                    .bind(String::from_utf8(value.to_vec()).unwrap_or_default())
                    .bind(row_id.unwrap())
                    .execute(&mut *tx)
                    .await
            } else {
                sqlx::query(
                r#"INSERT INTO meta (module, key1, key2, start_dt, value) VALUES ($1, $2, $3, $4, $5);"#
            )
            .bind(&module)
            .bind(&key1)
            .bind(&key2)
            .bind(start_dt.unwrap_or_default())
            .bind(String::from_utf8(value.to_vec()).unwrap_or_default())
            .execute(&mut *tx)
            .await
            };
            if let Err(e) = ret {
                if let Err(e) = tx.rollback().await {
                    log::error!("[SQLITE] rollback get_for_update error: {e}");
                }
                return Err(e.into());
            }
        }

        // new value
        if let Some((new_key, new_value, new_start_dt)) = new_value.as_ref() {
            need_watch_dt = new_start_dt.unwrap_or_default();
            let (module, key1, key2) = super::parse_key(new_key);
            if let Err(e) = sqlx::query(
                r#"INSERT INTO meta (module, key1, key2, start_dt, value) VALUES ($1, $2, $3, $4, $5);"#
            )
            .bind(&module)
            .bind(&key1)
            .bind(&key2)
            .bind(new_start_dt.unwrap_or_default())
            .bind(String::from_utf8(new_value.to_vec()).unwrap_or_default())
            .execute(&mut *tx)
            .await
            {
                if let Err(e) = tx.rollback().await {
                    log::error!("[POSTGRES] rollback get_for_update error: {e}");
                }
                return Err(e.into());
            }
        }

        if let Err(e) = tx.commit().await {
            log::error!("[SQLITE] commit get_for_update error: {e}");
            return Err(e.into());
        }

        // release lock
        drop(client);

        // event watch
        if need_watch {
            let start_dt = if need_watch_dt > 0 {
                Some(need_watch_dt)
            } else {
                None
            };
            if (new_value.is_some() || value.is_some())
                && let Err(e) = CHANNEL
                    .watch_tx
                    .clone()
                    .send(Event::Put(EventData {
                        key: key.to_string(),
                        value: Some(Bytes::from("")),
                        start_dt,
                    }))
                    .await
            {
                log::error!("[SQLITE] send event error: {e}");
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
            let with_prefix = if start_dt.is_some() {
                false
            } else {
                with_prefix
            };
            let new_key = if let Some(start_dt) = start_dt {
                format!("{}/{}", key, start_dt)
            } else {
                key.to_string()
            };
            // find all keys then send event
            let items = if with_prefix {
                let db = super::get_db().await;
                db.list_keys(key).await?
            } else {
                vec![new_key.to_string()]
            };
            let tx = CHANNEL.watch_tx.clone();
            tokio::task::spawn(async move {
                for key in items {
                    if let Err(e) = tx
                        .send(Event::Delete(EventData {
                            key: key.to_string(),
                            value: None,
                            start_dt,
                        }))
                        .await
                    {
                        log::error!("[SQLITE] send event error: {e}");
                    }
                }
            });
        }

        let (module, key1, key2) = super::parse_key(key);
        // Escape ' (single quote) character with ''
        let (key1, key2) = (key1.replace("'", "''"), key2.replace("'", "''"));
        let sql = if with_prefix {
            if key1.is_empty() {
                format!(r#"DELETE FROM meta WHERE module = '{module}';"#)
            } else if key2.is_empty() {
                format!(r#"DELETE FROM meta WHERE module = '{module}' AND key1 = '{key1}';"#)
            } else {
                format!(
                    r#"DELETE FROM meta WHERE module = '{module}' AND key1 = '{key1}' AND (key2 = '{key2}' OR key2 LIKE '{key2}/%');"#
                )
            }
        } else {
            format!(
                r#"DELETE FROM meta WHERE module = '{module}' AND key1 = '{key1}' AND key2 = '{key2}';"#
            )
        };

        let sql = if let Some(start_dt) = start_dt {
            sql.replace(';', &format!(" AND start_dt = {start_dt};"))
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
        let mut sql = "SELECT id, module, key1, key2, start_dt, value FROM meta".to_string();
        if !module.is_empty() {
            sql = format!("{sql} WHERE module = '{module}'");
        }
        if !key1.is_empty() {
            sql = format!("{sql} AND key1 = '{key1}'");
        }
        if !key2.is_empty() {
            sql = format!("{sql} AND (key2 = '{key2}' OR key2 LIKE '{key2}/%')");
        }
        sql = format!("{sql} ORDER BY start_dt ASC");

        let pool = CLIENT_RO.clone();
        let ret = sqlx::query_as::<_, super::MetaRecord>(&sql)
            .fetch_all(&pool)
            .await?;
        Ok(ret
            .into_iter()
            .map(|r| {
                (
                    super::build_key(&r.module, &r.key1, &r.key2, r.start_dt),
                    Bytes::from(r.value),
                )
            })
            .collect())
    }

    async fn list_keys(&self, prefix: &str) -> Result<Vec<String>> {
        let (module, key1, key2) = super::parse_key(prefix);
        let mut sql = "SELECT id, module, key1, key2, start_dt, '' AS value FROM meta".to_string();
        if !module.is_empty() {
            sql = format!("{sql} WHERE module = '{module}'");
        }
        if !key1.is_empty() {
            sql = format!("{sql} AND key1 = '{key1}'");
        }
        if !key2.is_empty() {
            sql = format!("{sql} AND (key2 = '{key2}' OR key2 LIKE '{key2}/%')");
        }

        sql = format!("{sql} ORDER BY start_dt ASC");
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
        let mut items = self.list(prefix).await?;
        let mut keys = items.keys().map(|k| k.to_string()).collect::<Vec<_>>();
        keys.sort();
        Ok(keys
            .into_iter()
            .map(|k| items.remove(&k).unwrap())
            .collect())
    }

    async fn list_values_by_start_dt(
        &self,
        prefix: &str,
        start_dt: Option<(i64, i64)>,
    ) -> Result<Vec<(i64, Bytes)>> {
        if start_dt.is_none() || start_dt == Some((0, 0)) {
            let vals = self.list_values(prefix).await?;
            return Ok(vals.into_iter().map(|v| (0, v)).collect());
        }

        let (min_dt, max_dt) = start_dt.unwrap();
        let (module, key1, key2) = super::parse_key(prefix);
        let mut sql = "SELECT id, module, key1, key2, start_dt, value FROM meta".to_string();
        if !module.is_empty() {
            sql = format!("{sql} WHERE module = '{module}'");
        }
        if !key1.is_empty() {
            sql = format!("{sql} AND key1 = '{key1}'");
        }
        if !key2.is_empty() {
            sql = format!("{sql} AND (key2 = '{key2}' OR key2 LIKE '{key2}/%')");
        }
        sql = format!("{sql} AND start_dt >= {min_dt} AND start_dt <= {max_dt}");
        sql = format!("{sql} ORDER BY start_dt ASC");

        let pool = CLIENT_RO.clone();
        let ret = sqlx::query_as::<_, super::MetaRecord>(&sql)
            .fetch_all(&pool)
            .await?;
        Ok(ret
            .into_iter()
            .map(|r| (r.start_dt, Bytes::from(r.value)))
            .collect())
    }

    async fn count(&self, prefix: &str) -> Result<i64> {
        let (module, key1, key2) = super::parse_key(prefix);
        let mut sql = "SELECT COUNT(*) AS num FROM meta".to_string();
        if !module.is_empty() {
            sql = format!("{sql} WHERE module = '{module}'");
        }
        if !key1.is_empty() {
            sql = format!("{sql} AND key1 = '{key1}'");
        }
        if !key2.is_empty() {
            sql = format!("{sql} AND (key2 = '{key2}' OR key2 LIKE '{key2}/%')");
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
        create_meta_backup().await?;
        add_start_dt_column().await?;
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
    id       INTEGER not null primary key autoincrement,
    module   VARCHAR not null,
    key1     VARCHAR not null,
    key2     VARCHAR not null,
    start_dt INTEGER not null,
    value    TEXT not null
);
        "#,
    )
    .execute(&*client)
    .await?;
    drop(client);

    // create start_dt column for old version <= 0.9.2
    add_start_dt_column().await?;

    // create table index
    create_index(IndexStatement::new(
        "meta_module_idx",
        "meta",
        false,
        &["module"],
    ))
    .await?;
    create_index(IndexStatement::new(
        "meta_module_key1_idx",
        "meta",
        false,
        &["module", "key1"],
    ))
    .await?;
    create_index(IndexStatement::new(
        "meta_module_start_dt_idx",
        "meta",
        true,
        &["module", "key1", "key2", "start_dt"],
    ))
    .await?;

    Ok(())
}

async fn add_start_dt_column() -> Result<()> {
    let client = CLIENT_RW.clone();
    let client = client.lock().await;

    add_column(&client, "meta", "start_dt", "INTEGER NOT NULL DEFAULT 0").await?;
    drop(client);

    // Proceed to drop the index if it exists and create a new one if it does not exist
    create_index(IndexStatement::new(
        "meta_module_start_dt_idx",
        "meta",
        true,
        &["module", "key1", "key2", "start_dt"],
    ))
    .await?;
    delete_index("meta_module_key2_idx", "meta").await?;
    Ok(())
}

async fn create_meta_backup() -> Result<()> {
    let client = CLIENT_RW.clone();
    let client = client.lock().await;
    let mut tx = client.begin().await?;
    if let Err(e) =
        sqlx::query(r#"CREATE TABLE IF NOT EXISTS meta_backup_20240330 AS SELECT * FROM meta;"#)
            .execute(&mut *tx)
            .await
    {
        if let Err(e) = tx.rollback().await {
            log::error!("[SQLITE] rollback create table meta_backup_20240330 error: {e}");
        }
        return Err(e.into());
    }
    if let Err(e) = tx.commit().await {
        log::error!("[SQLITE] commit create table meta_backup_20240330 error: {e}");
        return Err(e.into());
    }
    Ok(())
}

pub async fn create_index(index: IndexStatement<'_>) -> Result<()> {
    let client = CLIENT_RW.clone();
    let client = client.lock().await;
    let indices = INDICES.get_or_init(cache_indices).await;
    if indices.contains(&DBIndex {
        name: index.idx_name.into(),
        table: index.table.into(),
    }) {
        return Ok(());
    }
    let unique_str = if index.unique { "UNIQUE" } else { "" };
    log::info!(
        "[SQLITE] creating index {} on table {}",
        index.idx_name,
        index.table
    );
    let sql = format!(
        "CREATE {} INDEX IF NOT EXISTS {} ON {} ({});",
        unique_str,
        index.idx_name,
        index.table,
        index.fields.join(",")
    );
    sqlx::query(&sql).execute(&*client).await?;
    log::info!("[SQLITE] index {} created successfully", index.idx_name);
    Ok(())
}

pub async fn delete_index(idx_name: &str, table: &str) -> Result<()> {
    let client = CLIENT_RW.clone();
    let client = client.lock().await;
    let indices = INDICES.get_or_init(cache_indices).await;
    if !indices.contains(&DBIndex {
        name: idx_name.into(),
        table: table.into(),
    }) {
        return Ok(());
    }
    log::info!("[SQLITE] deleting index {idx_name} on table {table}");
    let sql = format!("DROP INDEX IF EXISTS {idx_name};");
    sqlx::query(&sql).execute(&*client).await?;
    log::info!("[SQLITE] index {idx_name} deleted successfully");
    Ok(())
}

pub async fn add_column(
    client: &Pool<Sqlite>,
    table: &str,
    column: &str,
    data_type: &str,
) -> Result<()> {
    // Check if the column exists using PRAGMA table_info
    let check_sql = format!("PRAGMA table_info({table});");
    let columns: Vec<(i64, String, String, i64, Option<String>, i64)> =
        sqlx::query_as(&check_sql).fetch_all(client).await?;
    let has_column = columns.iter().any(|(_, name, ..)| name == column);
    if !has_column {
        let alter_sql = format!("ALTER TABLE {table} ADD COLUMN {column} {data_type};");
        sqlx::query(&alter_sql).execute(client).await?;
    }
    Ok(())
}

pub async fn drop_column(client: &Pool<Sqlite>, table: &str, column: &str) -> Result<()> {
    // Check if the column exists using PRAGMA table_info
    let check_sql = format!("PRAGMA table_info({table});");
    let columns: Vec<(i64, String, String, i64, Option<String>, i64)> =
        sqlx::query_as(&check_sql).fetch_all(client).await?;
    let has_column = columns.iter().any(|(_, name, ..)| name == column);
    if has_column {
        let alter_sql = format!("ALTER TABLE {table} DROP COLUMN {column};");
        sqlx::query(&alter_sql).execute(client).await?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_sqlite_db_new() {
        let db = SqliteDb::new();
        assert_eq!(std::mem::size_of_val(&db), 0);
    }

    #[test]
    fn test_sqlite_db_default() {
        let db = SqliteDb::default();
        assert_eq!(std::mem::size_of_val(&db), 0);
    }

    #[test]
    fn test_parse_key_full() {
        let key = "/module/key1/key2";
        let (module, k1, k2) = super::super::parse_key(key);
        assert_eq!(module, "module");
        assert_eq!(k1, "key1");
        assert_eq!(k2, "key2");
    }

    #[test]
    fn test_parse_key_no_leading_slash() {
        let key = "module/key1/key2";
        let (module, k1, k2) = super::super::parse_key(key);
        assert_eq!(module, "module");
        assert_eq!(k1, "key1");
        assert_eq!(k2, "key2");
    }

    #[test]
    fn test_parse_key_module_only() {
        let key = "/module";
        let (module, k1, k2) = super::super::parse_key(key);
        assert_eq!(module, "module");
        assert_eq!(k1, "");
        assert_eq!(k2, "");
    }

    #[test]
    fn test_parse_key_module_and_key1() {
        let key = "/module/key1";
        let (module, k1, k2) = super::super::parse_key(key);
        assert_eq!(module, "module");
        assert_eq!(k1, "key1");
        assert_eq!(k2, "");
    }

    #[test]
    fn test_parse_key_with_slashes_in_key2() {
        let key = "/module/key1/key2/subkey/subsubkey";
        let (module, k1, k2) = super::super::parse_key(key);
        assert_eq!(module, "module");
        assert_eq!(k1, "key1");
        assert_eq!(k2, "key2/subkey/subsubkey");
    }

    #[test]
    fn test_parse_key_empty() {
        let key = "";
        let (module, k1, k2) = super::super::parse_key(key);
        assert_eq!(module, "");
        assert_eq!(k1, "");
        assert_eq!(k2, "");
    }

    #[test]
    fn test_build_key_without_start_dt() {
        let key = super::super::build_key("module", "key1", "key2", 0);
        assert_eq!(key, "/module/key1/key2");
    }

    #[test]
    fn test_build_key_with_start_dt() {
        let key = super::super::build_key("module", "key1", "key2", 1234567890);
        assert_eq!(key, "/module/key1/key2/1234567890");
    }

    #[test]
    fn test_build_key_empty_parts() {
        let key = super::super::build_key("", "", "", 0);
        assert_eq!(key, "//");
    }

    #[test]
    fn test_build_key_with_special_chars() {
        let key = super::super::build_key("mod-ule", "key_1", "key.2", 0);
        assert_eq!(key, "/mod-ule/key_1/key.2");
    }

    #[test]
    fn test_index_statement_new() {
        let stmt = IndexStatement::new("test_idx", "test_table", false, &["col1", "col2"]);
        assert_eq!(stmt.idx_name, "test_idx");
        assert_eq!(stmt.table, "test_table");
        assert!(!stmt.unique);
        assert_eq!(stmt.fields, vec!["col1", "col2"]);
    }

    #[test]
    fn test_index_statement_unique() {
        let stmt = IndexStatement::new("unique_idx", "table", true, &["id"]);
        assert_eq!(stmt.idx_name, "unique_idx");
        assert_eq!(stmt.table, "table");
        assert!(stmt.unique);
        assert_eq!(stmt.fields, vec!["id"]);
    }

    #[test]
    fn test_index_statement_single_field() {
        let stmt = IndexStatement::new("single_idx", "table", false, &["field"]);
        assert_eq!(stmt.fields.len(), 1);
        assert_eq!(stmt.fields[0], "field");
    }

    #[test]
    fn test_index_statement_multiple_fields() {
        let stmt = IndexStatement::new("multi_idx", "table", false, &["f1", "f2", "f3", "f4"]);
        assert_eq!(stmt.fields.len(), 4);
    }

    #[test]
    fn test_db_index_hash_same() {
        let idx1 = DBIndex {
            name: "test_idx".to_string(),
            table: "test_table".to_string(),
        };
        let idx2 = DBIndex {
            name: "test_idx".to_string(),
            table: "test_table".to_string(),
        };

        let mut set = HashSet::new();
        set.insert(idx1);
        assert!(set.contains(&idx2));
    }

    #[test]
    fn test_db_index_hash_different_name() {
        let idx1 = DBIndex {
            name: "idx1".to_string(),
            table: "table".to_string(),
        };
        let idx2 = DBIndex {
            name: "idx2".to_string(),
            table: "table".to_string(),
        };

        let mut set = HashSet::new();
        set.insert(idx1);
        assert!(!set.contains(&idx2));
    }

    #[test]
    fn test_db_index_hash_different_table() {
        let idx1 = DBIndex {
            name: "idx".to_string(),
            table: "table1".to_string(),
        };
        let idx2 = DBIndex {
            name: "idx".to_string(),
            table: "table2".to_string(),
        };

        let mut set = HashSet::new();
        set.insert(idx1);
        assert!(!set.contains(&idx2));
    }

    #[test]
    fn test_sql_quote_escaping() {
        let key = "key'with'quotes";
        let escaped = key.replace('\'', "''");
        assert_eq!(escaped, "key''with''quotes");
    }

    #[test]
    fn test_sql_like_pattern_construction() {
        let key2 = "prefix";
        let pattern = format!("{key2}/%");
        assert_eq!(pattern, "prefix/%");
    }

    #[test]
    fn test_add_column_sql_format() {
        let table = "test_table";
        let column = "new_column";
        let data_type = "TEXT NOT NULL DEFAULT ''";

        let check_sql = format!("PRAGMA table_info({table});");
        assert_eq!(check_sql, "PRAGMA table_info(test_table);");

        let alter_sql = format!("ALTER TABLE {table} ADD COLUMN {column} {data_type};");
        assert_eq!(
            alter_sql,
            "ALTER TABLE test_table ADD COLUMN new_column TEXT NOT NULL DEFAULT '';"
        );
    }

    #[test]
    fn test_drop_column_sql_format() {
        let table = "test_table";
        let column = "old_column";

        let check_sql = format!("PRAGMA table_info({table});");
        assert_eq!(check_sql, "PRAGMA table_info(test_table);");

        let alter_sql = format!("ALTER TABLE {table} DROP COLUMN {column};");
        assert_eq!(alter_sql, "ALTER TABLE test_table DROP COLUMN old_column;");
    }

    #[test]
    fn test_add_column_sql_with_various_types() {
        let table = "users";

        // INTEGER type
        let alter_sql = format!(
            "ALTER TABLE {} ADD COLUMN {} {};",
            table, "age", "INTEGER NOT NULL DEFAULT 0"
        );
        assert_eq!(
            alter_sql,
            "ALTER TABLE users ADD COLUMN age INTEGER NOT NULL DEFAULT 0;"
        );

        // TEXT type
        let alter_sql = format!("ALTER TABLE {} ADD COLUMN {} {};", table, "name", "TEXT");
        assert_eq!(alter_sql, "ALTER TABLE users ADD COLUMN name TEXT;");

        // BLOB type
        let alter_sql = format!("ALTER TABLE {} ADD COLUMN {} {};", table, "data", "BLOB");
        assert_eq!(alter_sql, "ALTER TABLE users ADD COLUMN data BLOB;");

        // REAL type
        let alter_sql = format!(
            "ALTER TABLE {} ADD COLUMN {} {};",
            table, "score", "REAL NOT NULL DEFAULT 0.0"
        );
        assert_eq!(
            alter_sql,
            "ALTER TABLE users ADD COLUMN score REAL NOT NULL DEFAULT 0.0;"
        );
    }

    #[test]
    fn test_build_key_roundtrip() {
        let original_parts = ("module", "key1", "key2");
        let key = super::super::build_key(original_parts.0, original_parts.1, original_parts.2, 0);
        let (module, k1, k2) = super::super::parse_key(&key);
        assert_eq!(module, original_parts.0);
        assert_eq!(k1, original_parts.1);
        assert_eq!(k2, original_parts.2);
    }

    #[test]
    fn test_parse_key_with_numbers() {
        let key = "/123/456/789";
        let (module, k1, k2) = super::super::parse_key(key);
        assert_eq!(module, "123");
        assert_eq!(k1, "456");
        assert_eq!(k2, "789");
    }

    #[test]
    fn test_parse_key_with_hyphens_underscores() {
        let key = "/test-module/test_key1/test-key-2";
        let (module, k1, k2) = super::super::parse_key(key);
        assert_eq!(module, "test-module");
        assert_eq!(k1, "test_key1");
        assert_eq!(k2, "test-key-2");
    }

    #[test]
    fn test_index_statement_empty_fields() {
        let stmt = IndexStatement::new("empty_idx", "table", false, &[]);
        assert_eq!(stmt.fields.len(), 0);
    }

    #[test]
    fn test_parse_key_trailing_slash() {
        let key = "/module/key1/key2/";
        let (module, k1, k2) = super::super::parse_key(key);
        assert_eq!(module, "module");
        assert_eq!(k1, "key1");
        assert!(k2.starts_with("key2"));
    }
}
