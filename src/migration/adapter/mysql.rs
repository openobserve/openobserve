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

use async_trait::async_trait;
use sqlx::{
    ConnectOptions, Row as SqlxRow,
    mysql::{MySqlConnectOptions, MySqlPool, MySqlPoolOptions, MySqlRow},
};

use super::{ColumnInfo, DbAdapter, ForeignKeyInfo, Row, Value};

pub struct MysqlAdapter {
    pool: MySqlPool,
}

impl MysqlAdapter {
    pub async fn connect() -> Result<Self, anyhow::Error> {
        let cfg = config::get_config();
        let dsn = &cfg.common.meta_mysql_dsn;

        if dsn.is_empty() {
            return Err(anyhow::anyhow!(
                "MySQL DSN is not configured. Please set ZO_META_MYSQL_DSN"
            ));
        }

        let options: MySqlConnectOptions = dsn
            .parse::<MySqlConnectOptions>()?
            .disable_statement_logging();

        let pool = MySqlPoolOptions::new()
            .max_connections(5)
            .connect_with(options)
            .await?;

        Ok(Self { pool })
    }

    fn row_to_values(
        &self,
        row: &MySqlRow,
        columns: &[String],
        column_infos: &[super::ColumnInfo],
    ) -> Result<Row, anyhow::Error> {
        use sqlx::ValueRef;

        let mut values = Vec::with_capacity(columns.len());

        for (idx, col_name) in columns.iter().enumerate() {
            let raw = row.try_get_raw(idx)?;

            if raw.is_null() {
                values.push(Value::Null);
                continue;
            }

            // Get column type info - match by column name, not by index
            let col_type = column_infos
                .iter()
                .find(|c| &c.name == col_name)
                .map(|c| c.data_type.to_uppercase())
                .unwrap_or_default();

            // Handle TINYINT(1) as boolean - MySQL stores boolean as TINYINT(1)
            if col_type.contains("TINYINT") || col_type.contains("BOOL") {
                if let Ok(v) = row.try_get::<i64, _>(idx) {
                    values.push(Value::Bool(v != 0));
                } else {
                    values.push(Value::Null);
                }
                continue;
            }

            // Handle JSON type
            if col_type.contains("JSON") {
                if let Ok(v) = row.try_get::<serde_json::Value, _>(idx) {
                    values.push(Value::Json(v.to_string()));
                } else if let Ok(v) = row.try_get::<String, _>(idx) {
                    values.push(Value::Json(v));
                } else {
                    values.push(Value::Null);
                }
                continue;
            }

            // Handle TIMESTAMP/DATETIME types
            if col_type.contains("TIMESTAMP") || col_type.contains("DATETIME") || col_type == "DATE"
            {
                // MySQL TIMESTAMP -> try OffsetDateTime (time crate), DATETIME -> NaiveDateTime
                // Try time crate's OffsetDateTime first for TIMESTAMP columns
                if col_type.contains("TIMESTAMP")
                    && let Ok(v) = row.try_get::<time::OffsetDateTime, _>(idx)
                {
                    let format = time::macros::format_description!(
                        "[year]-[month]-[day] [hour]:[minute]:[second]"
                    );
                    if let Ok(s) = v.format(&format) {
                        values.push(Value::Timestamp(s.to_string()));
                        continue;
                    }
                }

                // Try NaiveDateTime for DATETIME columns (chrono)
                if let Ok(v) = row.try_get::<chrono::NaiveDateTime, _>(idx) {
                    values.push(Value::Timestamp(v.format("%Y-%m-%d %H:%M:%S").to_string()));
                    continue;
                }

                // Fallback: try as String
                if let Ok(v) = row.try_get::<String, _>(idx) {
                    values.push(Value::Timestamp(v));
                    continue;
                }

                values.push(Value::Null);
                continue;
            }

            // Try different types based on column type
            if let Ok(v) = row.try_get::<i64, _>(idx) {
                values.push(Value::BigInt(v));
            } else if let Ok(v) = row.try_get::<f64, _>(idx) {
                values.push(Value::Double(v));
            } else if let Ok(v) = row.try_get::<String, _>(idx) {
                values.push(Value::String(v));
            } else if let Ok(v) = row.try_get::<Vec<u8>, _>(idx) {
                values.push(Value::Bytes(v));
            } else {
                values.push(Value::Null);
            }
        }

        Ok(Row { values })
    }
}

#[async_trait]
impl DbAdapter for MysqlAdapter {
    fn name(&self) -> &'static str {
        "mysql"
    }

    async fn list_tables(&self) -> Result<Vec<String>, anyhow::Error> {
        // Cast to CHAR to avoid MySQL 8+ returning BLOB types from information_schema
        let rows: Vec<(String,)> = sqlx::query_as(
            "SELECT CAST(table_name AS CHAR) FROM information_schema.tables WHERE table_schema = DATABASE()",
        )
        .fetch_all(&self.pool)
        .await?;

        Ok(rows.into_iter().map(|(name,)| name).collect())
    }

    async fn get_columns(&self, table: &str) -> Result<Vec<ColumnInfo>, anyhow::Error> {
        // Cast to CHAR to avoid MySQL 8+ returning BLOB types from information_schema
        let rows: Vec<(String, String, String)> = sqlx::query_as(
            "SELECT CAST(column_name AS CHAR), CAST(data_type AS CHAR), CAST(is_nullable AS CHAR)
             FROM information_schema.columns
             WHERE table_schema = DATABASE() AND table_name = ?
             ORDER BY ordinal_position",
        )
        .bind(table)
        .fetch_all(&self.pool)
        .await?;

        Ok(rows
            .into_iter()
            .map(|(name, data_type, is_nullable)| ColumnInfo {
                name,
                data_type,
                is_nullable: is_nullable == "YES",
            })
            .collect())
    }

    async fn get_primary_keys(&self, table: &str) -> Result<Vec<String>, anyhow::Error> {
        // Cast to CHAR to avoid MySQL 8+ returning BLOB types from information_schema
        let rows: Vec<(String,)> = sqlx::query_as(
            "SELECT CAST(column_name AS CHAR) FROM information_schema.key_column_usage
             WHERE table_schema = DATABASE() AND table_name = ? AND constraint_name = 'PRIMARY'
             ORDER BY ordinal_position",
        )
        .bind(table)
        .fetch_all(&self.pool)
        .await?;

        Ok(rows.into_iter().map(|(name,)| name).collect())
    }

    async fn get_foreign_keys(&self) -> Result<Vec<ForeignKeyInfo>, anyhow::Error> {
        // Cast to CHAR to avoid MySQL 8+ returning BLOB types from information_schema
        let rows: Vec<(String, String)> = sqlx::query_as(
            "SELECT DISTINCT
                CAST(table_name AS CHAR),
                CAST(referenced_table_name AS CHAR)
             FROM information_schema.key_column_usage
             WHERE table_schema = DATABASE()
                AND referenced_table_name IS NOT NULL",
        )
        .fetch_all(&self.pool)
        .await?;

        Ok(rows
            .into_iter()
            .map(|(table, referenced_table)| ForeignKeyInfo {
                table,
                referenced_table,
            })
            .collect())
    }

    async fn count(
        &self,
        table: &str,
        timestamp_col: Option<&str>,
        since: Option<i64>,
    ) -> Result<u64, anyhow::Error> {
        let sql = match (timestamp_col, since) {
            (Some(col), Some(ts)) => {
                format!(
                    "SELECT COUNT(*) as cnt FROM `{}` WHERE `{}` > {}",
                    table, col, ts
                )
            }
            _ => format!("SELECT COUNT(*) as cnt FROM `{}`", table),
        };

        let row: (i64,) = sqlx::query_as(&sql).fetch_one(&self.pool).await?;
        Ok(row.0 as u64)
    }

    async fn select_batch(
        &self,
        table: &str,
        columns: &[String],
        offset: u64,
        limit: u64,
        timestamp_col: Option<&str>,
        since: Option<i64>,
    ) -> Result<Vec<Row>, anyhow::Error> {
        // Get column info for type conversion
        let column_infos = self.get_columns(table).await?;

        let cols = columns
            .iter()
            .map(|c| format!("`{}`", c))
            .collect::<Vec<_>>()
            .join(", ");

        let sql = match (timestamp_col, since) {
            (Some(col), Some(ts)) => {
                format!(
                    "SELECT {} FROM `{}` WHERE `{}` > {} ORDER BY `{}` LIMIT {} OFFSET {}",
                    cols, table, col, ts, col, limit, offset
                )
            }
            _ => {
                format!(
                    "SELECT {} FROM `{}` LIMIT {} OFFSET {}",
                    cols, table, limit, offset
                )
            }
        };

        let rows: Vec<MySqlRow> = sqlx::query(&sql).fetch_all(&self.pool).await?;

        let mut result = Vec::with_capacity(rows.len());
        for row in &rows {
            result.push(self.row_to_values(row, columns, &column_infos)?);
        }

        Ok(result)
    }

    async fn upsert_batch(
        &self,
        table: &str,
        columns: &[String],
        primary_keys: &[String],
        rows: &[Row],
    ) -> Result<u64, anyhow::Error> {
        if rows.is_empty() {
            return Ok(0);
        }

        let cols = columns
            .iter()
            .map(|c| format!("`{}`", c))
            .collect::<Vec<_>>()
            .join(", ");

        let placeholders = (0..columns.len())
            .map(|_| "?")
            .collect::<Vec<_>>()
            .join(", ");

        // Build ON DUPLICATE KEY UPDATE clause
        let updates = columns
            .iter()
            .filter(|c| !primary_keys.contains(c))
            .map(|c| format!("`{}` = VALUES(`{}`)", c, c))
            .collect::<Vec<_>>()
            .join(", ");

        let sql = if updates.is_empty() {
            format!(
                "INSERT IGNORE INTO `{}` ({}) VALUES ({})",
                table, cols, placeholders
            )
        } else {
            format!(
                "INSERT INTO `{}` ({}) VALUES ({}) ON DUPLICATE KEY UPDATE {}",
                table, cols, placeholders, updates
            )
        };

        // Use a dedicated connection with foreign keys disabled
        let mut conn = self.pool.acquire().await?;
        sqlx::query("SET FOREIGN_KEY_CHECKS = 0")
            .execute(&mut *conn)
            .await?;

        let mut count = 0u64;
        for row in rows {
            let mut query = sqlx::query(&sql);

            for value in &row.values {
                query = match value {
                    Value::Null => query.bind(None::<String>),
                    Value::Bool(v) => query.bind(*v),
                    Value::TinyInt(v) => query.bind(*v),
                    Value::SmallInt(v) => query.bind(*v as i32),
                    Value::Int(v) => query.bind(*v),
                    Value::BigInt(v) => query.bind(*v),
                    Value::Float(v) => query.bind(*v),
                    Value::Double(v) => query.bind(*v),
                    Value::String(v) => query.bind(v.clone()),
                    Value::Bytes(v) => query.bind(v.clone()),
                    Value::Timestamp(v) => {
                        // Parse timestamp string to NaiveDateTime for MySQL
                        let dt = chrono::NaiveDateTime::parse_from_str(v, "%Y-%m-%d %H:%M:%S").ok();
                        query.bind(dt)
                    }
                    Value::Json(v) => {
                        // MySQL accepts JSON as string
                        query.bind(v.clone())
                    }
                };
            }

            query.execute(&mut *conn).await?;
            count += 1;
        }

        sqlx::query("SET FOREIGN_KEY_CHECKS = 1")
            .execute(&mut *conn)
            .await?;

        Ok(count)
    }

    async fn truncate_table(&self, table: &str) -> Result<(), anyhow::Error> {
        // Disable foreign key checks and truncate in the same connection
        // to avoid connection pool issues
        let mut conn = self.pool.acquire().await?;
        if let Err(e) = sqlx::query("SET FOREIGN_KEY_CHECKS = 0")
            .execute(&mut *conn)
            .await
        {
            log::warn!("Failed to disable foreign key checks for table {table}: {e}");
        }
        sqlx::query(&format!("TRUNCATE TABLE `{}`", table))
            .execute(&mut *conn)
            .await?;
        if let Err(e) = sqlx::query("SET FOREIGN_KEY_CHECKS = 1")
            .execute(&mut *conn)
            .await
        {
            log::warn!("Failed to enable foreign key checks for table {table}: {e}");
        }
        Ok(())
    }

    async fn close(&self) -> Result<(), anyhow::Error> {
        self.pool.close().await;
        Ok(())
    }
}
