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
    postgres::{PgConnectOptions, PgPoolOptions},
    ConnectOptions, Pool, Postgres,
};
use tokio::sync::mpsc;

use crate::errors::*;

pub static CLIENT: Lazy<Pool<Postgres>> = Lazy::new(connect);

fn connect() -> Pool<Postgres> {
    let db_opts = PgConnectOptions::from_str(&CONFIG.common.meta_postgres_dsn)
        .expect("postgres connect options create failed")
        .disable_statement_logging();

    PgPoolOptions::new()
        .min_connections(CONFIG.limit.sql_min_db_connections)
        .max_connections(CONFIG.limit.sql_max_db_connections)
        .connect_lazy_with(db_opts)
}

pub struct PostgresDb {}

impl PostgresDb {
    pub fn new() -> Self {
        Self {}
    }
}

impl Default for PostgresDb {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl super::Db for PostgresDb {
    async fn create_table(&self) -> Result<()> {
        create_table().await
    }

    async fn stats(&self) -> Result<super::Stats> {
        let pool = CLIENT.clone();
        let keys_count: i64 = sqlx::query_scalar(r#"SELECT COUNT(*)::BIGINT AS num FROM meta;"#)
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

        let query = r#"SELECT value FROM meta WHERE module = $1 AND key1 = $2 AND key2 = $3 ORDER BY start_dt DESC;"#;

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
        let local_start_dt = start_dt.unwrap_or(0);
        let mut tx = pool.begin().await?;
        if let Err(e) = sqlx::query(
            r#"INSERT INTO meta (module, key1, key2, start_dt, value) VALUES ($1, $2, $3, $4, '') ON CONFLICT DO NOTHING;"#,
        )
        .bind(&module)
        .bind(&key1)
        .bind(&key2)
        .bind(local_start_dt)
        .execute(&mut *tx)
        .await
        {
            if let Err(e) = tx.rollback().await {
                log::error!("[POSTGRES] rollback put meta error: {}", e);
            }
            return Err(e.into());
        }
        if module == "schema" {
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
                    log::error!("[POSTGRES] rollback put meta error: {}", e);
                }
                return Err(e.into());
            }
            if let Err(e) = tx.commit().await {
                log::error!("[POSTGRES] commit put meta error: {}", e);
                return Err(e.into());
            }
        } else {
            if let Err(e) = sqlx::query(
                r#"UPDATE meta SET value=$4 WHERE module = $1 AND key1 = $2 AND key2 = $3;"#,
            )
            .bind(&module)
            .bind(&key1)
            .bind(&key2)
            .bind(String::from_utf8(value.to_vec()).unwrap_or_default())
            .execute(&mut *tx)
            .await
            {
                if let Err(e) = tx.rollback().await {
                    log::error!("[POSTGRES] rollback put meta error: {}", e);
                }
                return Err(e.into());
            }
            if let Err(e) = tx.commit().await {
                log::error!("[POSTGRES] commit put meta error: {}", e);
                return Err(e.into());
            }
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
                        log::error!("[POSTGRES] send event error: {}", e);
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
        let mut sql = "SELECT module, key1, key2,  start_dt, value FROM meta".to_string();
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
        let mut sql = "SELECT module, key1, key2,  start_dt, '' AS value FROM meta ".to_string();
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
        create_meta_backup().await?;
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
    id      BIGINT GENERATED ALWAYS AS IDENTITY,
    module  VARCHAR(100) not null,
    key1    VARCHAR(256) not null,
    key2    VARCHAR(256) not null,
    start_dt    BIGINT not null,
    value   TEXT not null
);
        "#,
    )
    .execute(&mut *tx)
    .await
    {
        if let Err(e) = tx.rollback().await {
            log::error!("[POSTGRES] rollback create table meta error: {}", e);
        }
        return Err(e.into());
    }
    if let Err(e) = tx.commit().await {
        log::error!("[POSTGRES] commit create table meta error: {}", e);
        return Err(e.into());
    }

    // create table index
    create_index_item("CREATE INDEX IF NOT EXISTS meta_module_idx on meta (module);").await?;
    create_index_item("CREATE INDEX IF NOT EXISTS meta_module_key1_idx on meta (key1, module);")
        .await?;

    add_col(pool).await?;

    match create_index_item(
        "CREATE UNIQUE INDEX IF NOT EXISTS meta_module_start_dt_idx on meta (start_dt,key2, key1, module);",
    )
    .await{
        Ok(_) => {}
        Err(e) => {
            log::error!("[POSTGRES] create table meta meta_module_start_dt_idx error: {}", e);
        }
    }

    Ok(())
}

async fn create_index_item(sql: &str) -> Result<()> {
    let pool = CLIENT.clone();
    if let Err(e) = sqlx::query(sql).execute(&pool).await {
        log::error!("[POSTGRES] create table meta index error: {}", e);
        return Err(e.into());
    }
    Ok(())
}

async fn add_start_dt_column() -> Result<()> {
    log::info!("[POSTGRES] ENTER: add_start_dt_column");
    let pool = CLIENT.clone();
    let mut tx = pool.begin().await?;

    // Drop index if exists
    if let Err(e) = sqlx::query(
        r#"
        DROP INDEX IF EXISTS meta_module_key2_idx;
        "#,
    )
    .execute(&mut *tx)
    .await
    {
        log::error!("[POSTGRES] Error in dropping index : {}", e);
        if let Err(e) = tx.rollback().await {
            log::error!("[POSTGRES] Error in rolling back transaction: {}", e);
        }
        return Err(e.into());
    }

    // Commit transaction
    if let Err(e) = tx.commit().await {
        log::info!("[POSTGRES] Error in committing transaction: {}", e);
        return Err(e.into());
    }

    add_col(pool).await?;

    create_index_item(
        "CREATE UNIQUE INDEX IF NOT EXISTS meta_module_start_dt_idx ON meta (start_dt, key2, key1, module);",
    ).await?;

    log::info!("[POSTGRES] EXIT: add_start_dt_column");
    Ok(())
}

async fn add_col(pool: Pool<Postgres>) -> Result<()> {
    let mut tx1 = pool.begin().await?;
    if let Err(e) = sqlx::query(
        r#"
        ALTER TABLE meta ADD COLUMN IF NOT EXISTS start_dt BIGINT NOT NULL DEFAULT 0;
        "#,
    )
    .execute(&mut *tx1)
    .await
    {
        log::error!("[POSTGRES] Error in  adding column: {}", e);
        if let Err(e) = tx1.rollback().await {
            log::error!("[POSTGRES] Error in rolling back transaction: {}", e);
        }
        return Err(e.into());
    }
    if let Err(e) = tx1.commit().await {
        log::info!("[POSTGRES] Error in committing transaction: {}", e);
        return Err(e.into());
    };
    Ok(())
}

async fn create_meta_backup() -> Result<()> {
    let pool = CLIENT.clone();
    let mut tx = pool.begin().await?;
    if let Err(e) = sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS meta_backup AS SELECT * FROM meta;
        "#,
    )
    .execute(&mut *tx)
    .await
    {
        if let Err(e) = tx.rollback().await {
            log::error!("[POSTGRES] rollback create table meta_backup error: {}", e);
        }
        return Err(e.into());
    }
    if let Err(e) = tx.commit().await {
        log::error!("[POSTGRES] commit create table meta_backup error: {}", e);
        return Err(e.into());
    }
    Ok(())
}
