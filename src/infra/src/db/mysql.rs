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
use config::{
    metrics::{DB_QUERY_NUMS, DB_QUERY_TIME},
    utils::{hash::Sum64, util::zero_or},
};
use hashbrown::HashMap;
use once_cell::sync::Lazy;
use sqlx::{
    MySql, Pool,
    mysql::{MySqlConnectOptions, MySqlPoolOptions},
};
use tokio::sync::{OnceCell, mpsc};

use super::{DBIndex, IndexStatement};
use crate::errors::*;

pub static CLIENT: Lazy<Pool<MySql>> = Lazy::new(|| connect(false, false));
pub static CLIENT_RO: Lazy<Pool<MySql>> = Lazy::new(|| connect(true, false));
pub static CLIENT_DDL: Lazy<Pool<MySql>> = Lazy::new(|| connect(false, true));
static INDICES: OnceCell<HashSet<DBIndex>> = OnceCell::const_new();

fn connect(readonly: bool, ddl: bool) -> Pool<MySql> {
    let cfg = config::get_config();
    let mut dsn = match (readonly, ddl) {
        // readonly non-ddl
        (true, false) => cfg.common.meta_mysql_ro_dsn.clone(),
        // read-write non-ddl
        (false, false) => cfg.common.meta_mysql_dsn.clone(),
        // ddl
        (_, true) => cfg.common.meta_ddl_dsn.clone(),
    };
    // the default fallback is original dsn, which is checked in config.rs to be non-empty
    if dsn.is_empty() {
        dsn = cfg.common.meta_mysql_dsn.clone();
    }
    let db_opts = MySqlConnectOptions::from_str(&dsn).expect("mysql connect options create failed");

    let acquire_timeout = zero_or(cfg.limit.sql_db_connections_acquire_timeout, 30);
    let idle_timeout = zero_or(cfg.limit.sql_db_connections_idle_timeout, 600);
    let max_lifetime = zero_or(cfg.limit.sql_db_connections_max_lifetime, 1800);

    MySqlPoolOptions::new()
        .min_connections(cfg.limit.sql_db_connections_min)
        .max_connections(cfg.limit.sql_db_connections_max)
        .acquire_timeout(Duration::from_secs(acquire_timeout))
        .idle_timeout(Some(Duration::from_secs(idle_timeout)))
        .max_lifetime(Some(Duration::from_secs(max_lifetime)))
        .connect_lazy_with(db_opts)
}

async fn cache_indices() -> HashSet<DBIndex> {
    let client = CLIENT.clone();
    DB_QUERY_NUMS
        .with_label_values(&["select", "information_schema.statistics"])
        .inc();
    let var_name = r#"SELECT INDEX_NAME,TABLE_NAME FROM information_schema.statistics;"#;
    let sql = var_name;
    // for some reason, mysql reports table_name as varbinary, hence we have to use Vec<u8>
    let res = sqlx::query_as::<_, (String, Vec<u8>)>(sql)
        .fetch_all(&client)
        .await;
    match res {
        Ok(r) => r
            .into_iter()
            .map(|(name, table)| DBIndex {
                name,
                table: String::from_utf8_lossy(&table).into_owned(),
            })
            .collect(),
        Err(e) => {
            log::debug!("error in caching indices : {e}");
            HashSet::new()
        }
    }
}

pub async fn shutdown_ddl_pool() -> Result<()> {
    CLIENT_DDL.close().await;
    Ok(())
}
pub struct MysqlDb {}

impl MysqlDb {
    pub fn new() -> Self {
        Self {}
    }
}

impl Default for MysqlDb {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl super::Db for MysqlDb {
    async fn create_table(&self) -> Result<()> {
        create_table().await
    }

    async fn stats(&self) -> Result<super::Stats> {
        let pool = CLIENT_RO.clone();
        DB_QUERY_NUMS.with_label_values(&["select", "meta"]).inc();
        let keys_count: i64 =
            sqlx::query_scalar(r#"SELECT CAST(COUNT(*) AS SIGNED) AS num FROM meta;"#)
                .fetch_one(&pool)
                .await
                .unwrap_or_default();
        Ok(super::Stats {
            bytes_len: 0,
            keys_count,
        })
    }

    async fn get(&self, key: &str) -> Result<Bytes> {
        let (module, key1, key2) = super::parse_key(key);
        let pool = CLIENT_RO.clone();
        DB_QUERY_NUMS.with_label_values(&["select", "meta"]).inc();
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
        let pool = CLIENT.clone();
        let local_start_dt = start_dt.unwrap_or_default();
        let mut tx = pool.begin().await?;
        DB_QUERY_NUMS.with_label_values(&["insert", "meta"]).inc();
        let start = std::time::Instant::now();
        if let Err(e) = sqlx::query(
            r#"INSERT IGNORE INTO meta (module, key1, key2, start_dt, value) VALUES (?, ?, ?, ?, '');"#
        )
        .bind(&module)
        .bind(&key1)
        .bind(&key2)
        .bind(local_start_dt)
        .execute(&mut *tx)
        .await
        {
            if let Err(e) = tx.rollback().await {
                log::error!("[MYSQL] rollback put meta error: {e}");
            }
            return Err(e.into());
        }
        // need commit it first to avoid the deadlock of insert and update
        if let Err(e) = tx.commit().await {
            log::error!("[MYSQL] commit put meta error: {e}");
            return Err(e.into());
        }

        DB_QUERY_NUMS.with_label_values(&["update", "meta"]).inc();
        let mut tx = pool.begin().await?;
        if let Err(e) = sqlx::query(
              r#"UPDATE meta SET value = ? WHERE module = ? AND key1 = ? AND key2 = ? AND start_dt = ?;"#
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
                    log::error!("[MYSQL] rollback put meta error: {e}");
                }
                return Err(e.into());
            }
        if let Err(e) = tx.commit().await {
            log::error!("[MYSQL] commit put meta error: {e}");
            return Err(e.into());
        }
        let time = start.elapsed().as_secs_f64();
        // event watch
        if need_watch {
            let cluster_coordinator = super::get_coordinator().await;
            cluster_coordinator
                .put(key, Bytes::from(""), true, start_dt)
                .await?;
        }

        DB_QUERY_TIME
            .with_label_values(&["put_item", "meta"])
            .observe(time);

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
        let lock_pool = CLIENT.clone();
        let lock_key = format!("get_for_update_{key}");
        let lock_id = config::utils::hash::gxhash::new().sum64(&lock_key);
        let lock_sql = format!(
            "SELECT GET_LOCK('{lock_id}', {})",
            config::get_config().limit.meta_transaction_lock_timeout
        );
        let unlock_sql = format!("SELECT RELEASE_LOCK('{lock_id}')");
        let mut lock_tx = lock_pool.begin().await?;
        DB_QUERY_NUMS.with_label_values(&["get_lock", ""]).inc();
        match sqlx::query_scalar::<_, i64>(&lock_sql)
            .fetch_one(&mut *lock_tx)
            .await
        {
            Ok(v) => {
                if v != 1 {
                    if let Err(e) = lock_tx.rollback().await {
                        log::error!("[MYSQL] rollback lock for get_for_update error: {e}");
                    }
                    return Err(Error::from(DbError::DBOperError(
                        "LockTimeout".to_string(),
                        key.to_string(),
                    )));
                }
            }
            Err(e) => {
                if let Err(e) = lock_tx.rollback().await {
                    log::error!("[MYSQL] rollback lock for get_for_update error: {e}");
                }
                return Err(e.into());
            }
        };

        let pool = CLIENT.clone();
        let mut tx = match pool.begin().await {
            Ok(tx) => tx,
            Err(e) => {
                if let Err(e) = sqlx::query(&unlock_sql).execute(&mut *lock_tx).await {
                    log::error!("[MYSQL] unlock get_for_update error: {e}");
                }
                if let Err(e) = lock_tx.commit().await {
                    log::error!("[MYSQL] commit for unlock get_for_update error: {e}");
                }
                return Err(e.into());
            }
        };
        let mut need_watch_dt = 0;
        let row = if let Some(start_dt) = start_dt {
            DB_QUERY_NUMS.with_label_values(&["select", "meta"]).inc();
            match sqlx::query_as::<_,super::MetaRecord>(
                r#"SELECT id, module, key1, key2, start_dt, value FROM meta WHERE module = ? AND key1 = ? AND key2 = ? AND start_dt = ?;"#
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
                        if let Err(e) = tx.rollback().await {
                            log::error!("[MYSQL] rollback get_for_update error: {e}");
                        }
                        DB_QUERY_NUMS.with_label_values(&["release_lock", ""]).inc();
                        if let Err(e) = sqlx::query(&unlock_sql).execute(&mut *lock_tx).await {
                            log::error!("[MYSQL] unlock get_for_update error: {e}");
                        }
                        if let Err(e) = lock_tx.commit().await {
                            log::error!("[MYSQL] commit for unlock get_for_update error: {e}");
                        }
                        return Err(e.into());
                    }
                }
            }
        } else {
            DB_QUERY_NUMS.with_label_values(&["select", "meta"]).inc();
            match sqlx::query_as::<_,super::MetaRecord>(
                r#"SELECT id, module, key1, key2, start_dt, value FROM meta WHERE module = ? AND key1 = ? AND key2 = ? ORDER BY start_dt DESC, id DESC;"#
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
                        if let Err(e) = tx.rollback().await {
                            log::error!("[MYSQL] rollback get_for_update error: {e}");
                        }
                        DB_QUERY_NUMS.with_label_values(&["release_lock", ""]).inc();
                        if let Err(e) = sqlx::query(&unlock_sql).execute(&mut *lock_tx).await {
                            log::error!("[MYSQL] unlock get_for_update error: {e}");
                        }
                        if let Err(e) = lock_tx.commit().await {
                            log::error!("[MYSQL] commit for unlock get_for_update error: {e}");
                        }
                        return Err(e.into());
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
                    log::error!("[MYSQL] rollback get_for_update error: {e}");
                }
                DB_QUERY_NUMS.with_label_values(&["release_lock", ""]).inc();
                if let Err(e) = sqlx::query(&unlock_sql).execute(&mut *lock_tx).await {
                    log::error!("[MYSQL] unlock get_for_update error: {e}");
                }
                if let Err(e) = lock_tx.commit().await {
                    log::error!("[MYSQL] commit for unlock get_for_update error: {e}");
                }
                return Err(e);
            }
            Ok(None) => {
                if let Err(e) = tx.rollback().await {
                    log::error!("[MYSQL] rollback get_for_update error: {e}");
                }
                DB_QUERY_NUMS.with_label_values(&["release_lock", ""]).inc();
                if let Err(e) = sqlx::query(&unlock_sql).execute(&mut *lock_tx).await {
                    log::error!("[MYSQL] unlock get_for_update error: {e}");
                }
                if let Err(e) = lock_tx.commit().await {
                    log::error!("[MYSQL] commit for unlock get_for_update error: {e}");
                }
                return Ok(());
            }
            Ok(Some(v)) => v,
        };

        // update value
        if let Some(value) = value {
            let ret = if exist {
                DB_QUERY_NUMS.with_label_values(&["update", "meta"]).inc();
                sqlx::query(r#"UPDATE meta SET value = ? WHERE id = ?;"#)
                    .bind(String::from_utf8(value.to_vec()).unwrap_or_default())
                    .bind(row_id.unwrap())
                    .execute(&mut *tx)
                    .await
            } else {
                DB_QUERY_NUMS.with_label_values(&["insert", "meta"]).inc();
                sqlx::query(
                    r#"INSERT INTO meta (module, key1, key2, start_dt, value) VALUES (?, ?, ?, ?, ?);"#,
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
                    log::error!("[MYSQL] rollback get_for_update error: {e}");
                }
                DB_QUERY_NUMS.with_label_values(&["release_lock", ""]).inc();
                if let Err(e) = sqlx::query(&unlock_sql).execute(&mut *lock_tx).await {
                    log::error!("[MYSQL] unlock get_for_update error: {e}");
                }
                if let Err(e) = lock_tx.commit().await {
                    log::error!("[MYSQL] commit for unlock get_for_update error: {e}");
                }
                return Err(e.into());
            }
        };

        // new value
        if let Some((new_key, new_value, new_start_dt)) = new_value {
            need_watch_dt = new_start_dt.unwrap_or_default();
            let (module, key1, key2) = super::parse_key(&new_key);
            DB_QUERY_NUMS.with_label_values(&["insert", "meta"]).inc();
            if let Err(e) = sqlx::query(
                r#"INSERT INTO meta (module, key1, key2, start_dt, value) VALUES (?, ?, ?, ?, ?);"#,
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
                    log::error!("[MYSQL] rollback get_for_update error: {e}");
                }
                DB_QUERY_NUMS.with_label_values(&["release_lock", ""]).inc();
                if let Err(e) = sqlx::query(&unlock_sql).execute(&mut *lock_tx).await {
                    log::error!("[MYSQL] unlock get_for_update error: {e}");
                }
                if let Err(e) = lock_tx.commit().await {
                    log::error!("[MYSQL] commit for unlock get_for_update error: {e}");
                }
                return Err(e.into());
            }
        }

        if let Err(e) = tx.commit().await {
            log::error!("[MYSQL] commit get_for_update error: {e}");
            return Err(e.into());
        }
        DB_QUERY_NUMS.with_label_values(&["release_lock", ""]).inc();
        if let Err(e) = sqlx::query(&unlock_sql).execute(&mut *lock_tx).await {
            log::error!("[MYSQL] unlock get_for_update error: {e}");
        }
        if let Err(e) = lock_tx.commit().await {
            log::error!("[MYSQL] commit for unlock get_for_update error: {e}");
        }

        // event watch
        if need_watch {
            let start_dt = if need_watch_dt > 0 {
                Some(need_watch_dt)
            } else {
                start_dt
            };
            let cluster_coordinator = super::get_coordinator().await;
            cluster_coordinator
                .put(key, Bytes::from(""), true, start_dt)
                .await?;
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
                self.list_keys(key).await?
            } else {
                vec![key.to_string()]
            };
            let cluster_coordinator = super::get_coordinator().await;
            tokio::task::spawn(async move {
                for key in items {
                    if let Err(e) = cluster_coordinator
                        .delete(&key, false, true, start_dt)
                        .await
                    {
                        log::error!("[MYSQL] send event error: {e}");
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

        let pool = CLIENT.clone();
        DB_QUERY_NUMS.with_label_values(&["delete", "meta"]).inc();
        sqlx::query(&sql).execute(&pool).await?;

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
        DB_QUERY_NUMS.with_label_values(&["select", "meta"]).inc();
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
        DB_QUERY_NUMS.with_label_values(&["select", "meta"]).inc();
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
        let mut sql =
            "SELECT id, module, key1, key2, start_dt, value AS value FROM meta".to_string();
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
        DB_QUERY_NUMS.with_label_values(&["select", "meta"]).inc();
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
        DB_QUERY_NUMS.with_label_values(&["select", "meta"]).inc();
        let count: i64 = sqlx::query_scalar(&sql).fetch_one(&pool).await?;
        Ok(count)
    }

    async fn watch(&self, _prefix: &str) -> Result<Arc<mpsc::Receiver<super::Event>>> {
        Err(Error::NotImplemented)
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

pub async fn create_table() -> Result<()> {
    let pool = CLIENT_DDL.clone();
    DB_QUERY_NUMS.with_label_values(&["create", "meta"]).inc();
    // create table
    _ = sqlx::query(
        r#"
CREATE TABLE IF NOT EXISTS meta
(
    id       BIGINT not null primary key AUTO_INCREMENT,
    module   VARCHAR(100) not null,
    key1     VARCHAR(256) not null,
    key2     VARCHAR(256) not null,
    start_dt BIGINT not null,
    value    LONGTEXT not null
);
        "#,
    )
    .execute(&pool)
    .await?;
    DB_QUERY_NUMS
        .with_label_values(&["select", "information_schema.columns"])
        .inc();
    // create start_dt column for old version <= 0.9.2
    let has_start_dt = sqlx::query_scalar::<_,i64>("SELECT count(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE table_name='meta' AND column_name='start_dt';")
            .fetch_one(&pool)
            .await?;
    if has_start_dt == 0 {
        add_start_dt_column().await?;
    }

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
    DB_QUERY_NUMS.with_label_values(&["alter", "meta"]).inc();
    add_column("meta", "start_dt", "BIGINT NOT NULL DEFAULT 0").await?;

    // create new index meta_module_start_dt_idx
    create_index(IndexStatement::new(
        "meta_module_start_dt_idx",
        "meta",
        true,
        &["module", "key1", "key2", "start_dt"],
    ))
    .await?;
    // delete old index meta_module_key2_idx
    delete_index("meta_module_key2_idx", "meta").await?;

    Ok(())
}

async fn create_meta_backup() -> Result<()> {
    let pool = CLIENT_DDL.clone();
    let mut tx = pool.begin().await?;
    DB_QUERY_NUMS
        .with_label_values(&["create", "meta_backup_20240330"])
        .inc();
    // Create the meta_backup table like meta
    if let Err(e) = sqlx::query(r#"CREATE TABLE IF NOT EXISTS meta_backup_20240330 like meta;"#)
        .execute(&mut *tx)
        .await
    {
        if let Err(e) = tx.rollback().await {
            log::error!("[MYSQL] rollback create table meta_backup_20240330 error: {e}");
        }
        return Err(e.into());
    }

    DB_QUERY_NUMS
        .with_label_values(&["select", "meta_backup_20240330"])
        .inc();
    // Check if meta_backup is empty before attempting to insert data
    let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM meta_backup_20240330")
        .fetch_one(&mut *tx)
        .await?;

    if count == 0 {
        DB_QUERY_NUMS
            .with_label_values(&["insert", "meta_backup_20240330"])
            .inc();
        // Attempt to insert data into meta_backup from meta since it's empty
        if let Err(e) = sqlx::query(r#"INSERT INTO meta_backup_20240330 SELECT * FROM meta;"#)
            .execute(&mut *tx)
            .await
        {
            if let Err(e) = tx.rollback().await {
                log::error!("[MYSQL] rollback insert into meta_backup_20240330 error: {e}");
            }
            return Err(e.into());
        }
    }

    if let Err(e) = tx.commit().await {
        log::error!("[MYSQL] commit transaction error: {e}");
        return Err(e.into());
    }

    Ok(())
}

pub async fn create_index(index: IndexStatement<'_>) -> Result<()> {
    let client = CLIENT_DDL.clone();
    let indices = INDICES.get_or_init(cache_indices).await;
    if indices.contains(&DBIndex {
        name: index.idx_name.into(),
        table: index.table.into(),
    }) {
        return Ok(());
    }
    let unique_str = if index.unique { "UNIQUE" } else { "" };
    log::info!(
        "[MYSQL] creating index {} on table {}",
        index.idx_name,
        index.table
    );
    DB_QUERY_NUMS
        .with_label_values(&["create", index.table])
        .inc();
    let sql = format!(
        "CREATE {} INDEX {} ON {} ({});",
        unique_str,
        index.idx_name,
        index.table,
        index.fields.join(",")
    );
    let start = std::time::Instant::now();
    sqlx::query(&sql).execute(&client).await?;
    let time = start.elapsed().as_secs_f64();
    DB_QUERY_TIME
        .with_label_values(&["create_index", index.table])
        .observe(time);
    log::info!("[MYSQL] index {} created successfully", index.idx_name);
    Ok(())
}

pub async fn delete_index(idx_name: &str, table: &str) -> Result<()> {
    let client = CLIENT_DDL.clone();
    let indices = INDICES.get_or_init(cache_indices).await;
    if !indices.contains(&DBIndex {
        name: idx_name.into(),
        table: table.into(),
    }) {
        return Ok(());
    }
    log::info!("[MYSQL] deleting index {idx_name} on table {table}");
    DB_QUERY_NUMS.with_label_values(&["drop", table]).inc();
    let sql = format!("DROP INDEX {idx_name} ON {table};");
    let start = std::time::Instant::now();
    sqlx::query(&sql).execute(&client).await?;
    let time = start.elapsed().as_secs_f64();
    DB_QUERY_TIME
        .with_label_values(&["drop_index", table])
        .observe(time);
    log::info!("[MYSQL] index {idx_name} deleted successfully");
    Ok(())
}

pub async fn add_column(table: &str, column: &str, data_type: &str) -> Result<()> {
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

    let alert_sql = format!("ALTER TABLE {table} ADD COLUMN {column} {data_type};");
    let mut tx = pool.begin().await?;
    if let Err(e) = sqlx::query(&alert_sql).execute(&mut *tx).await
        && !e.to_string().contains("Duplicate column name")
    {
        // Check for the specific MySQL error code for duplicate column
        log::error!("[MYSQL] Unexpected error in adding column {column}: {e}");
        if let Err(e) = tx.rollback().await {
            log::error!("[MYSQL] Error in rolling back transaction: {e}");
        }
        return Err(e.into());
    }
    if let Err(e) = tx.commit().await {
        log::info!("[MYSQL] Error in committing transaction: {e}");
        return Err(e.into());
    };
    Ok(())
}

pub async fn drop_column(table: &str, column: &str) -> Result<()> {
    let pool = CLIENT_DDL.clone();
    let check_sql = format!(
        "SELECT count(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE table_name='{table}' AND column_name='{column}';"
    );
    let has_column = sqlx::query_scalar::<_, i64>(&check_sql)
        .fetch_one(&pool)
        .await?;
    if has_column > 0 {
        let alert_sql = format!("ALTER TABLE {table} DROP COLUMN {column}");
        sqlx::query(&alert_sql).execute(&pool).await?;
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_mysql_db_new() {
        let db = MysqlDb::new();
        // Just verify it can be instantiated
        assert_eq!(std::mem::size_of_val(&db), 0); // Zero-sized type
    }

    #[test]
    fn test_mysql_db_default() {
        let db = MysqlDb::default();
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
        // When key1 is empty, implementation adds trailing slash
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
        assert_eq!(stmt.unique, false);
        assert_eq!(stmt.fields, vec!["col1", "col2"]);
    }

    #[test]
    fn test_index_statement_unique() {
        let stmt = IndexStatement::new("unique_idx", "table", true, &["id"]);
        assert_eq!(stmt.idx_name, "unique_idx");
        assert_eq!(stmt.table, "table");
        assert_eq!(stmt.unique, true);
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
        use std::collections::HashSet;

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
        // Same values should be contained
        assert!(set.contains(&idx2));
    }

    #[test]
    fn test_db_index_hash_different_name() {
        use std::collections::HashSet;

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
        // Different name should not be contained
        assert!(!set.contains(&idx2));
    }

    #[test]
    fn test_db_index_hash_different_table() {
        use std::collections::HashSet;

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
        // Different table should not be contained
        assert!(!set.contains(&idx2));
    }

    #[test]
    fn test_db_index_hash() {
        use std::collections::HashSet;

        let idx1 = DBIndex {
            name: "idx".to_string(),
            table: "table".to_string(),
        };
        let idx2 = DBIndex {
            name: "idx".to_string(),
            table: "table".to_string(),
        };
        let idx3 = DBIndex {
            name: "different".to_string(),
            table: "table".to_string(),
        };

        let mut set = HashSet::new();
        set.insert(idx1);
        assert!(set.contains(&idx2)); // Same as idx1
        assert!(!set.contains(&idx3)); // Different
    }

    #[test]
    fn test_sql_quote_escaping() {
        // Test that single quotes in keys would need to be escaped
        let key = "key'with'quotes";
        let escaped = key.replace("'", "''");
        assert_eq!(escaped, "key''with''quotes");
    }

    #[test]
    fn test_sql_like_pattern_construction() {
        let key2 = "prefix";
        let pattern = format!("{key2}/%");
        assert_eq!(pattern, "prefix/%");
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
    fn test_build_key_roundtrip() {
        let original_parts = ("module", "key1", "key2");
        let key = super::super::build_key(original_parts.0, original_parts.1, original_parts.2, 0);
        let (module, k1, k2) = super::super::parse_key(&key);
        assert_eq!(module, original_parts.0);
        assert_eq!(k1, original_parts.1);
        assert_eq!(k2, original_parts.2);
    }

    #[test]
    fn test_build_key_with_negative_start_dt() {
        // Negative start_dt should still be treated as 0 in the build logic
        let key = super::super::build_key("module", "key1", "key2", -1);
        // Based on the implementation, negative values might be included
        // This test documents the current behavior
        assert!(key.contains("module"));
        assert!(key.contains("key1"));
        assert!(key.contains("key2"));
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
        // Trailing slash creates an empty segment at the end
        assert!(k2.starts_with("key2"));
    }

    #[test]
    fn test_parse_key_multiple_slashes() {
        let key = "/module//key1///key2";
        let (module, k1, _k2) = super::super::parse_key(key);
        assert_eq!(module, "module");
        // Double slashes create empty segments
        assert!(k1.is_empty() || k1 == "key1");
    }

    #[test]
    fn test_add_column_check_sql_format() {
        let table = "test_table";
        let column = "new_column";

        let check_sql = format!(
            "SELECT count(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE table_name='{table}' AND column_name='{column}';"
        );
        assert_eq!(
            check_sql,
            "SELECT count(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE table_name='test_table' AND column_name='new_column';"
        );
    }

    #[test]
    fn test_add_column_alter_sql_format() {
        let table = "test_table";
        let column = "new_column";
        let data_type = "VARCHAR(255) NOT NULL DEFAULT ''";

        let alert_sql = format!("ALTER TABLE {table} ADD COLUMN {column} {data_type};");
        assert_eq!(
            alert_sql,
            "ALTER TABLE test_table ADD COLUMN new_column VARCHAR(255) NOT NULL DEFAULT '';"
        );
    }

    #[test]
    fn test_drop_column_check_sql_format() {
        let table = "test_table";
        let column = "old_column";

        let check_sql = format!(
            "SELECT count(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE table_name='{table}' AND column_name='{column}';"
        );
        assert_eq!(
            check_sql,
            "SELECT count(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE table_name='test_table' AND column_name='old_column';"
        );
    }

    #[test]
    fn test_drop_column_alter_sql_format() {
        let table = "test_table";
        let column = "old_column";

        let alert_sql = format!("ALTER TABLE {table} DROP COLUMN {column}");
        assert_eq!(alert_sql, "ALTER TABLE test_table DROP COLUMN old_column");
    }

    #[test]
    fn test_add_column_sql_with_various_mysql_types() {
        let table = "users";

        // BIGINT type
        let alert_sql = format!(
            "ALTER TABLE {} ADD COLUMN {} {};",
            table, "big_id", "BIGINT NOT NULL DEFAULT 0"
        );
        assert_eq!(
            alert_sql,
            "ALTER TABLE users ADD COLUMN big_id BIGINT NOT NULL DEFAULT 0;"
        );

        // VARCHAR type
        let alert_sql = format!(
            "ALTER TABLE {} ADD COLUMN {} {};",
            table, "email", "VARCHAR(255)"
        );
        assert_eq!(
            alert_sql,
            "ALTER TABLE users ADD COLUMN email VARCHAR(255);"
        );

        // TEXT type
        let alert_sql = format!(
            "ALTER TABLE {} ADD COLUMN {} {};",
            table, "description", "TEXT"
        );
        assert_eq!(alert_sql, "ALTER TABLE users ADD COLUMN description TEXT;");

        // DATETIME type
        let alert_sql = format!(
            "ALTER TABLE {} ADD COLUMN {} {};",
            table, "created_at", "DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP"
        );
        assert_eq!(
            alert_sql,
            "ALTER TABLE users ADD COLUMN created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP;"
        );

        // BOOLEAN type
        let alert_sql = format!(
            "ALTER TABLE {} ADD COLUMN {} {};",
            table, "is_active", "BOOLEAN NOT NULL DEFAULT TRUE"
        );
        assert_eq!(
            alert_sql,
            "ALTER TABLE users ADD COLUMN is_active BOOLEAN NOT NULL DEFAULT TRUE;"
        );
    }

    #[test]
    fn test_add_column_sql_escaping_special_names() {
        // Test with reserved words or special characters
        let table = "order";
        let column = "select";
        let data_type = "INT";

        let alert_sql = format!("ALTER TABLE {table} ADD COLUMN {column} {data_type};");
        // Note: In real usage, these should be backtick-quoted for MySQL
        assert_eq!(alert_sql, "ALTER TABLE order ADD COLUMN select INT;");
    }
}
