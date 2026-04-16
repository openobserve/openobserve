// Copyright 2026 OpenObserve Inc.
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
    collections::HashSet,
    str::FromStr,
    sync::{Arc, LazyLock as Lazy},
    time::Duration,
};

use async_trait::async_trait;
use bytes::Bytes;
use config::{FxIndexMap, cluster, utils::util::zero_or};
use hashbrown::HashMap;
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
        let query = "SELECT value FROM meta WHERE module = $1 AND key1 = $2 AND key2 = $3 ORDER BY start_dt DESC;";
        let value: String = match sqlx::query_scalar(query)
            .bind(&module)
            .bind(&key1)
            .bind(&key2)
            .fetch_one(&pool)
            .await
        {
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
        let client = CLIENT_RW.clone();
        let client = client.lock().await;

        if with_prefix {
            if key1.is_empty() {
                // module = $1 [, start_dt = $2]
                if let Some(dt) = start_dt {
                    sqlx::query("DELETE FROM meta WHERE module = $1 AND start_dt = $2")
                        .bind(&module)
                        .bind(dt)
                        .execute(&*client)
                        .await?;
                } else {
                    sqlx::query("DELETE FROM meta WHERE module = $1")
                        .bind(&module)
                        .execute(&*client)
                        .await?;
                }
            } else if key2.is_empty() {
                // module = $1, key1 = $2 [, start_dt = $3]
                if let Some(dt) = start_dt {
                    sqlx::query(
                        "DELETE FROM meta WHERE module = $1 AND key1 = $2 AND start_dt = $3",
                    )
                    .bind(&module)
                    .bind(&key1)
                    .bind(dt)
                    .execute(&*client)
                    .await?;
                } else {
                    sqlx::query("DELETE FROM meta WHERE module = $1 AND key1 = $2")
                        .bind(&module)
                        .bind(&key1)
                        .execute(&*client)
                        .await?;
                }
            } else {
                // module = $1, key1 = $2, key2 = $3, key2/% = $4 [, start_dt = $5]
                if let Some(dt) = start_dt {
                    sqlx::query("DELETE FROM meta WHERE module = $1 AND key1 = $2 AND (key2 = $3 OR key2 LIKE $4) AND start_dt = $5")
                        .bind(&module)
                        .bind(&key1)
                        .bind(&key2)
                        .bind(format!("{}/%", key2))
                        .bind(dt)
                        .execute(&*client)
                        .await?;
                } else {
                    sqlx::query("DELETE FROM meta WHERE module = $1 AND key1 = $2 AND (key2 = $3 OR key2 LIKE $4)")
                        .bind(&module)
                        .bind(&key1)
                        .bind(&key2)
                        .bind(format!("{}/%", key2))
                        .execute(&*client)
                        .await?;
                }
            }
        } else {
            // module = $1, key1 = $2, key2 = $3 [, start_dt = $4]
            if let Some(dt) = start_dt {
                sqlx::query("DELETE FROM meta WHERE module = $1 AND key1 = $2 AND key2 = $3 AND start_dt = $4")
                    .bind(&module)
                    .bind(&key1)
                    .bind(&key2)
                    .bind(dt)
                    .execute(&*client)
                    .await?;
            } else {
                sqlx::query("DELETE FROM meta WHERE module = $1 AND key1 = $2 AND key2 = $3")
                    .bind(&module)
                    .bind(&key1)
                    .bind(&key2)
                    .execute(&*client)
                    .await?;
            }
        }
        Ok(())
    }

    async fn list(&self, prefix: &str) -> Result<HashMap<String, Bytes>> {
        let (module, key1, key2) = super::parse_key(prefix);
        let mut sql =
            "SELECT id, module, key1, key2, start_dt, value FROM meta WHERE 1=1".to_string();
        let mut params = Vec::new();

        if !module.is_empty() {
            sql.push_str(" AND module = $1");
            params.push(module);
        }
        if !key1.is_empty() {
            sql.push_str(&format!(" AND key1 = ${}", params.len() + 1));
            params.push(key1);
        }
        if !key2.is_empty() {
            sql.push_str(&format!(
                " AND (key2 = ${} OR key2 LIKE ${})",
                params.len() + 1,
                params.len() + 2
            ));
            let key2_prefix = format!("{}/%", key2);
            params.push(key2);
            params.push(key2_prefix);
        }
        sql.push_str(" ORDER BY start_dt ASC");

        let pool = CLIENT_RO.clone();
        let mut query = sqlx::query_as::<_, super::MetaRecord>(&sql);
        for p in params {
            query = query.bind(p);
        }
        let ret = query.fetch_all(&pool).await?;
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
        let mut sql =
            "SELECT id, module, key1, key2, start_dt, '' AS value FROM meta WHERE 1=1".to_string();
        let mut params = Vec::new();

        if !module.is_empty() {
            sql.push_str(" AND module = $1");
            params.push(module);
        }
        if !key1.is_empty() {
            sql.push_str(&format!(" AND key1 = ${}", params.len() + 1));
            params.push(key1);
        }
        if !key2.is_empty() {
            sql.push_str(&format!(
                " AND (key2 = ${} OR key2 LIKE ${})",
                params.len() + 1,
                params.len() + 2
            ));
            let key2_prefix = format!("{}/%", key2);
            params.push(key2);
            params.push(key2_prefix);
        }

        sql.push_str(" ORDER BY start_dt ASC");
        let pool = CLIENT_RO.clone();
        let mut query = sqlx::query_as::<_, super::MetaRecord>(&sql);
        for p in params {
            query = query.bind(p);
        }
        let ret = query.fetch_all(&pool).await?;
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
        let (sql, str_params) = build_list_by_start_dt_sql(prefix, min_dt, max_dt);

        let pool = CLIENT_RO.clone();
        let mut query = sqlx::query_as::<_, super::MetaRecord>(&sql);
        for p in str_params {
            query = query.bind(p);
        }
        // Bind min_dt / max_dt as i64 so SQLite receives them as INTEGER, not TEXT.
        query = query.bind(min_dt);
        query = query.bind(max_dt);
        let ret = query.fetch_all(&pool).await?;
        Ok(ret
            .into_iter()
            .map(|r| (r.start_dt, Bytes::from(r.value)))
            .collect())
    }

    async fn count(&self, prefix: &str) -> Result<i64> {
        let (module, key1, key2) = super::parse_key(prefix);
        let mut sql = "SELECT COUNT(*) AS num FROM meta WHERE 1=1".to_string();
        let mut params = Vec::new();

        if !module.is_empty() {
            sql.push_str(" AND module = $1");
            params.push(module);
        }
        if !key1.is_empty() {
            sql.push_str(&format!(" AND key1 = ${}", params.len() + 1));
            params.push(key1);
        }
        if !key2.is_empty() {
            sql.push_str(&format!(
                " AND (key2 = ${} OR key2 LIKE ${})",
                params.len() + 1,
                params.len() + 2
            ));
            let key2_prefix = format!("{}/%", key2);
            params.push(key2);
            params.push(key2_prefix);
        }

        let pool = CLIENT_RO.clone();
        let mut query = sqlx::query_scalar::<_, i64>(&sql);
        for p in params {
            query = query.bind(p);
        }
        let count: i64 = query.fetch_one(&pool).await?;
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

/// Builds the SQL string and string-typed bind parameters for `list_values_by_start_dt`.
///
/// Returns `(sql, str_params)` where `str_params` contains the string-typed positional
/// parameters (module / key1 / key2). The caller must then bind `min_dt` and `max_dt`
/// as `i64` **after** the string params so that the database receives them as INTEGER,
/// not TEXT.
///
/// Keeping this logic in a standalone function makes the SQL generation unit-testable
/// without requiring a live database connection.
pub(crate) fn build_list_by_start_dt_sql(
    prefix: &str,
    min_dt: i64,
    max_dt: i64,
) -> (String, Vec<String>) {
    let (module, key1, key2) = super::parse_key(prefix);
    let mut sql = "SELECT id, module, key1, key2, start_dt, value FROM meta WHERE 1=1".to_string();
    let mut params: Vec<String> = Vec::new();

    if !module.is_empty() {
        sql.push_str(" AND module = $1");
        params.push(module);
    }
    if !key1.is_empty() {
        sql.push_str(&format!(" AND key1 = ${}", params.len() + 1));
        params.push(key1);
    }
    if !key2.is_empty() {
        sql.push_str(&format!(
            " AND (key2 = ${} OR key2 LIKE ${})",
            params.len() + 1,
            params.len() + 2
        ));
        let key2_prefix = format!("{key2}/%");
        params.push(key2);
        params.push(key2_prefix);
    }
    // min_dt / max_dt are intentionally NOT pushed into params here.
    // The caller binds them as i64 after the string-params loop.
    let n = params.len();
    sql.push_str(&format!(
        " AND start_dt >= ${} AND start_dt <= ${}",
        n + 1,
        n + 2
    ));
    let _ = (min_dt, max_dt);
    sql.push_str(" ORDER BY start_dt ASC");

    (sql, params)
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

    // ── build_list_by_start_dt_sql unit tests ─────────────────────────────────

    #[test]
    fn test_build_list_by_start_dt_sql_full_prefix() {
        let (sql, params) = build_list_by_start_dt_sql("/module/key1/key2", 100, 200);
        assert_eq!(params.len(), 4);
        assert_eq!(params[0], "module");
        assert_eq!(params[1], "key1");
        assert_eq!(params[2], "key2");
        assert_eq!(params[3], "key2/%");
        assert!(
            sql.contains("AND module = $1"),
            "module param missing: {sql}"
        );
        assert!(sql.contains("AND key1 = $2"), "key1 param missing: {sql}");
        assert!(
            sql.contains("AND (key2 = $3 OR key2 LIKE $4)"),
            "key2 param missing: {sql}"
        );
        assert!(
            sql.contains("AND start_dt >= $5 AND start_dt <= $6"),
            "start_dt bounds wrong: {sql}"
        );
        assert!(
            sql.ends_with("ORDER BY start_dt ASC"),
            "missing ORDER BY: {sql}"
        );
    }

    #[test]
    fn test_build_list_by_start_dt_sql_module_only() {
        let (sql, params) = build_list_by_start_dt_sql("/module", 1, 999);
        assert_eq!(params.len(), 1);
        assert_eq!(params[0], "module");
        assert!(sql.contains("AND module = $1"));
        assert!(
            sql.contains("AND start_dt >= $2 AND start_dt <= $3"),
            "start_dt bounds wrong: {sql}"
        );
    }

    #[test]
    fn test_build_list_by_start_dt_sql_module_and_key1() {
        let (sql, params) = build_list_by_start_dt_sql("/module/key1", 10, 20);
        assert_eq!(params.len(), 2);
        assert_eq!(params[0], "module");
        assert_eq!(params[1], "key1");
        assert!(sql.contains("AND module = $1"));
        assert!(sql.contains("AND key1 = $2"));
        assert!(
            sql.contains("AND start_dt >= $3 AND start_dt <= $4"),
            "start_dt bounds wrong: {sql}"
        );
    }

    #[test]
    fn test_build_list_by_start_dt_sql_empty_prefix() {
        let (sql, params) = build_list_by_start_dt_sql("", 0, 9999);
        assert!(params.is_empty());
        assert!(
            sql.contains("AND start_dt >= $1 AND start_dt <= $2"),
            "start_dt bounds wrong for empty prefix: {sql}"
        );
        assert!(sql.contains("WHERE 1=1"));
    }

    #[test]
    fn test_build_list_by_start_dt_sql_key2_prefix_pattern() {
        let (sql, params) = build_list_by_start_dt_sql("/m/k1/k2", 0, 0);
        assert_eq!(params[3], "k2/%");
        assert!(sql.contains("OR key2 LIKE $4"));
    }

    #[test]
    fn test_build_list_by_start_dt_sql_starts_with_base_select() {
        let (sql, _) = build_list_by_start_dt_sql("/m/k1/k2", 1, 2);
        assert!(
            sql.starts_with("SELECT id, module, key1, key2, start_dt, value FROM meta WHERE 1=1"),
            "unexpected SQL start: {sql}"
        );
    }
}
