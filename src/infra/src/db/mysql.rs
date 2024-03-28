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

use std::{str::FromStr, sync::Arc};

use async_trait::async_trait;
use bytes::Bytes;
use config::{utils::json, CONFIG};
use hashbrown::HashMap;
use once_cell::sync::Lazy;
use sqlx::{
    mysql::{MySqlConnectOptions, MySqlPoolOptions},
    ConnectOptions, MySql, Pool,
};
use tokio::sync::mpsc;

use crate::errors::*;

pub static CLIENT: Lazy<Pool<MySql>> = Lazy::new(connect);

fn connect() -> Pool<MySql> {
    let db_opts = MySqlConnectOptions::from_str(&CONFIG.common.meta_mysql_dsn)
        .expect("mysql connect options create failed")
        .disable_statement_logging();

    MySqlPoolOptions::new()
        .min_connections(CONFIG.limit.sql_min_db_connections)
        .max_connections(CONFIG.limit.sql_max_db_connections)
        .connect_lazy_with(db_opts)
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
        let pool = CLIENT.clone();
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
        let pool = CLIENT.clone();
        let query = r#"SELECT value FROM meta WHERE module = ? AND key1 = ? AND key2 = ? ORDER BY start_dt DESC;"#;

        let value: String = match sqlx::query_scalar(query)
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
        let pool = CLIENT.clone();
        let local_start_dt = start_dt.unwrap_or_default();
        let mut tx = pool.begin().await?;
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
                log::error!("[MYSQL] rollback put meta error: {}", e);
            }
            return Err(e.into());
        }

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
                    log::error!("[MYSQL] rollback put meta error: {}", e);
                }
                return Err(e.into());
            }
        if let Err(e) = tx.commit().await {
            log::error!("[MYSQL] commit put meta error: {}", e);
            return Err(e.into());
        }

        // event watch
        if need_watch {
            let cluster_coordinator = super::get_coordinator().await;
            cluster_coordinator
                .put(key, Bytes::from(""), true, start_dt)
                .await?;
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
        let pool = CLIENT.clone();
        let mut tx = pool.begin().await?;
        let row = if let Some(start_dt) = start_dt {
            match sqlx::query_as::<_,super::MetaRecord>(
                r#"SELECT id, '', '', '', value FROM meta WHERE module = ? AND key1 = ? AND key2 = ? AND start_dt = ? FOR UPDATE;"#
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
                    log::error!("[MYSQL] get_for_update error: {}", e);
                    None
                }
            }
        } else {
            match sqlx::query_as::<_,super::MetaRecord>(
                r#"SELECT id, '', '', '', value FROM meta WHERE module = ? AND key1 = ? AND key2 = ? ORDER BY start_dt DESC FOR UPDATE;"#
            )
            .bind(&module)
            .bind(&key1)
            .bind(&key2)
            .fetch_one(&mut *tx)
            .await
            {
                Ok(v) => Some(v),
                Err(e) => {
                    log::error!("[MYSQL] get_for_update error: {}", e);
                    None
                }
            }
        };
        let exist = row.is_some();
        let row_id = row.as_ref().map(|r| r.id);
        let value = row.map(|r| Bytes::from(r.value));
        let (value, new_value) = match update_fn(value) {
            Err(e) => {
                if let Err(e) = tx.rollback().await {
                    log::error!("[MYSQL] rollback get_for_update error: {}", e);
                }
                return Err(e);
            }
            Ok(None) => {
                if let Err(e) = tx.rollback().await {
                    log::error!("[MYSQL] rollback get_for_update error: {}", e);
                }
                return Ok(());
            }
            Ok(Some(v)) => v,
        };

        let ret = if exist {
            sqlx::query(r#"UPDATE meta SET value = ? WHERE id = ?;"#)
                .bind(String::from_utf8(value.to_vec()).unwrap_or_default())
                .bind(row_id.unwrap())
                .execute(&mut *tx)
                .await
        } else {
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
                log::error!("[MYSQL] rollback get_for_update error: {}", e);
            }
            return Err(e.into());
        }

        // new value
        if let Some((new_key, new_value, new_start_dt)) = new_value {
            let (module, key1, key2) = super::parse_key(&new_key);
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
                    log::error!("[MYSQL] rollback get_for_update error: {}", e);
                }
                return Err(e.into());
            }
        }

        if let Err(e) = tx.commit().await {
            log::error!("[MYSQL] commit get_for_update error: {}", e);
            return Err(e.into());
        }

        // event watch
        if need_watch {
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
                        log::error!("[MYSQL] send event error: {}", e);
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

        let pool = CLIENT.clone();
        sqlx::query(&sql).execute(&pool).await?;

        Ok(())
    }

    async fn list(&self, prefix: &str) -> Result<HashMap<String, Bytes>> {
        let (module, key1, key2) = super::parse_key(prefix);
        let mut sql = "SELECT id, module, key1, key2, start_dt, value FROM meta".to_string();
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

        let pool = CLIENT.clone();
        let ret = sqlx::query_as::<_, super::MetaRecord>(&sql)
            .fetch_all(&pool)
            .await?;
        if module == "schema" {
            let mut grouped_values: HashMap<String, Vec<datafusion::arrow::datatypes::Schema>> =
                HashMap::new();
            for record in ret {
                let key = format!("/{}/{}/{}", record.module, record.key1, record.key2);
                let mut parsed: Vec<datafusion::arrow::datatypes::Schema> =
                    json::from_str(&record.value).unwrap();

                grouped_values
                    .entry(key.to_owned())
                    .or_insert_with(Vec::new)
                    .append(&mut parsed);
            }

            Ok(grouped_values
                .into_iter()
                .map(|(key, vec)| (key, json::to_vec(&vec).unwrap().into()))
                .collect())
        } else {
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
    }

    async fn list_keys(&self, prefix: &str) -> Result<Vec<String>> {
        let (module, key1, key2) = super::parse_key(prefix);
        let mut sql = "SELECT id, module, key1, key2, start_dt, '' AS value FROM meta".to_string();
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

    async fn watch(&self, _prefix: &str) -> Result<Arc<mpsc::Receiver<super::Event>>> {
        Err(Error::NotImplemented)
    }

    async fn close(&self) -> Result<()> {
        Ok(())
    }
    async fn add_start_dt_column(&self) -> Result<()> {
        add_start_dt_column().await
    }
}

pub async fn create_table() -> Result<()> {
    let pool = CLIENT.clone();
    let mut tx = pool.begin().await?;
    // create table
    if let Err(e) = sqlx::query(
        r#"
CREATE TABLE IF NOT EXISTS meta
(
    id      BIGINT not null primary key AUTO_INCREMENT,
    module  VARCHAR(100) not null,
    key1    VARCHAR(256) not null,
    key2    VARCHAR(256) not null,
    start_dt    BIGINT not null,
    value   LONGTEXT not null
);
        "#,
    )
    .execute(&mut *tx)
    .await
    {
        if let Err(e) = tx.rollback().await {
            log::error!("[MYSQL] rollback create table meta error: {}", e);
        }
        return Err(e.into());
    }
    if let Err(e) = tx.commit().await {
        log::error!("[MYSQL] commit create table meta error: {}", e);
        return Err(e.into());
    }

    // create table index
    create_index_item("CREATE INDEX meta_module_idx on meta (module);").await?;
    create_index_item("CREATE INDEX meta_module_key1_idx on meta (module, key1);").await?;

    add_col(pool).await?;

    match create_index_item(
        "CREATE UNIQUE INDEX  meta_module_start_dt_idx on meta (module, key1, key2, start_dt);",
    )
    .await
    {
        Ok(_) => {}
        Err(e) => {
            log::error!(
                "[MYSQL] create table meta meta_module_start_dt_idx error: {}",
                e
            );
        }
    }

    Ok(())
}

async fn create_index_item(sql: &str) -> Result<()> {
    let pool = CLIENT.clone();
    if let Err(e) = sqlx::query(sql).execute(&pool).await {
        if e.to_string().contains("Duplicate key") {
            // index already exists
            return Ok(());
        }
        log::error!("[MYSQL] create table meta index error: {}", e);
        return Err(e.into());
    }
    Ok(())
}

async fn add_start_dt_column() -> Result<()> {
    log::info!("[MYSQL] ENTER: add_start_dt_column");
    let pool = CLIENT.clone();
    let mut tx = pool.begin().await?;

    // Drop index if exists
    if let Err(e) = sqlx::query(
        r#"
         DROP INDEX meta_module_key2_idx ON meta;
         "#,
    )
    .execute(&mut *tx)
    .await
    {
        log::error!("[MYSQL] Error in dropping index : {}", e);

        if e.to_string().contains("Can't DROP") || e.to_string().contains("doesn't exist") {
            log::info!("[MYSQL] Index did not exist, continuing.");
        } else {
            if let Err(e) = tx.rollback().await {
                log::error!("[MYSQL] Error in rolling back transaction: {}", e);
            }

            return Err(e.into());
        }
    }

    // Commit transaction
    if let Err(e) = tx.commit().await {
        log::info!("[MYSQL] Error in committing transaction: {}", e);
        return Err(e.into());
    }
    create_meta_backup(&pool).await?;
    add_col(pool).await?;

    create_index_item(
        "CREATE UNIQUE INDEX meta_module_start_dt_idx ON meta (module, key1, key2, start_dt);",
    )
    .await?;

    log::info!("[MYSQL] EXIT: add_start_dt_column");
    Ok(())
}

async fn add_col(pool: Pool<MySql>) -> Result<()> {
    let mut tx1 = pool.begin().await?;
    if let Err(e) = sqlx::query(
        r#"
        ALTER TABLE meta ADD COLUMN start_dt BIGINT NOT NULL DEFAULT 0;
        "#,
    )
    .execute(&mut *tx1)
    .await
    {
        if e.to_string().contains("Duplicate column name") {
            log::info!("[MYSQL] start_dt Column already exists, continuing.");
        } else {
            // Check for the specific MySQL error code for duplicate column
            log::error!("[MYSQL] Unexpected error in adding column: {}", e);
            tx1.rollback().await?;
            return Err(e.into());
        }
    }
    if let Err(e) = tx1.commit().await {
        log::info!("[MYSQL] Error in committing transaction: {}", e);
        return Err(e.into());
    };
    Ok(())
}

async fn create_meta_backup(pool: &Pool<MySql>) -> Result<()> {
    let mut tx = pool.begin().await?;
    // Create the meta_backup table like meta
    if let Err(e) = sqlx::query(
        r#"
CREATE TABLE IF NOT EXISTS meta_backup LIKE meta;
        "#,
    )
    .execute(&mut *tx)
    .await
    {
        if let Err(e) = tx.rollback().await {
            log::error!("[MYSQL] rollback create table meta_backup error: {}", e);
        }
        return Err(e.into());
    }

    // Check if meta_backup is empty before attempting to insert data
    let count: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM meta_backup")
        .fetch_one(&mut *tx)
        .await?;

    if count.0 == 0 {
        // Attempt to insert data into meta_backup from meta since it's empty
        if let Err(e) = sqlx::query(
            r#"
    INSERT INTO meta_backup SELECT * FROM meta;
            "#,
        )
        .execute(&mut *tx)
        .await
        {
            if let Err(e) = tx.rollback().await {
                log::error!("[MYSQL] rollback insert into meta_backup error: {}", e);
            }
            return Err(e.into());
        }
    }

    if let Err(e) = tx.commit().await {
        log::error!("[MYSQL] commit transaction error: {}", e);
        return Err(e.into());
    }

    Ok(())
}
