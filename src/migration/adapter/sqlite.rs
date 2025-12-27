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
    sqlite::{SqliteConnectOptions, SqlitePool, SqlitePoolOptions, SqliteRow},
};

use super::{ColumnInfo, DbAdapter, ForeignKeyInfo, Row, Value};

pub struct SqliteAdapter {
    pool: SqlitePool,
}

impl SqliteAdapter {
    pub async fn connect() -> Result<Self, anyhow::Error> {
        let cfg = config::get_config();
        let db_path = format!("{}metadata.sqlite", cfg.common.data_db_dir);

        // Disable foreign keys in connection options so all connections in the pool
        // have foreign keys disabled. This is necessary for migration operations.
        let options = SqliteConnectOptions::new()
            .filename(&db_path)
            .create_if_missing(false)
            .read_only(false)
            .foreign_keys(false)
            .disable_statement_logging();

        let pool = SqlitePoolOptions::new()
            .max_connections(5)
            .connect_with(options)
            .await?;

        Ok(Self { pool })
    }

    fn row_to_values(
        &self,
        row: &SqliteRow,
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

            // Check if the column is boolean type based on column info
            // Match by column name, not by index
            let col_type = column_infos
                .iter()
                .find(|c| &c.name == col_name)
                .map(|c| c.data_type.to_uppercase())
                .unwrap_or_default();

            if col_type.contains("BOOL") {
                // SQLite stores boolean as 0/1, convert to bool
                if let Ok(v) = row.try_get::<i64, _>(idx) {
                    values.push(Value::Bool(v != 0));
                } else {
                    values.push(Value::Null);
                }
                continue;
            }

            // Handle JSON type - SQLite stores JSON as TEXT or BLOB
            if col_type.contains("JSON") {
                if let Ok(v) = row.try_get::<String, _>(idx) {
                    values.push(Value::Json(v));
                } else if let Ok(v) = row.try_get::<Vec<u8>, _>(idx) {
                    // Convert bytes to string for JSON
                    if let Ok(s) = String::from_utf8(v) {
                        values.push(Value::Json(s));
                    } else {
                        values.push(Value::Null);
                    }
                } else {
                    values.push(Value::Null);
                }
                continue;
            }

            // Handle TIMESTAMP type - SQLite may store as text or integer
            if col_type.contains("TIMESTAMP") || col_type.contains("DATETIME") {
                // Try to get as string first (SQLite's default CURRENT_TIMESTAMP format)
                if let Ok(v) = row.try_get::<String, _>(idx) {
                    values.push(Value::Timestamp(v));
                } else if let Ok(v) = row.try_get::<i64, _>(idx) {
                    // Unix timestamp - convert to string format
                    let dt = chrono::DateTime::from_timestamp(v, 0)
                        .map(|dt| dt.format("%Y-%m-%d %H:%M:%S").to_string())
                        .unwrap_or_default();
                    values.push(Value::Timestamp(dt));
                } else {
                    values.push(Value::Null);
                }
                continue;
            }

            // Try different types based on SQLite's dynamic typing
            // Order: i64 -> f64 -> String -> bytes
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
impl DbAdapter for SqliteAdapter {
    fn name(&self) -> &'static str {
        "sqlite"
    }

    async fn list_tables(&self) -> Result<Vec<String>, anyhow::Error> {
        let rows: Vec<(String,)> = sqlx::query_as(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
        )
        .fetch_all(&self.pool)
        .await?;

        Ok(rows.into_iter().map(|(name,)| name).collect())
    }

    async fn get_columns(&self, table: &str) -> Result<Vec<ColumnInfo>, anyhow::Error> {
        let rows: Vec<SqliteRow> = sqlx::query(&format!("PRAGMA table_info('{}')", table))
            .fetch_all(&self.pool)
            .await?;

        let mut columns = Vec::new();
        for row in rows {
            let name: String = row.try_get("name")?;
            let data_type: String = row.try_get("type")?;
            let not_null: i32 = row.try_get("notnull")?;

            columns.push(ColumnInfo {
                name,
                data_type,
                is_nullable: not_null == 0,
            });
        }

        Ok(columns)
    }

    async fn get_primary_keys(&self, table: &str) -> Result<Vec<String>, anyhow::Error> {
        let rows: Vec<SqliteRow> = sqlx::query(&format!("PRAGMA table_info('{}')", table))
            .fetch_all(&self.pool)
            .await?;

        let mut pks = Vec::new();
        for row in rows {
            let pk: i32 = row.try_get("pk")?;
            if pk > 0 {
                let name: String = row.try_get("name")?;
                pks.push(name);
            }
        }

        Ok(pks)
    }

    async fn get_foreign_keys(&self) -> Result<Vec<ForeignKeyInfo>, anyhow::Error> {
        // Get all tables first
        let tables = self.list_tables().await?;
        let mut fks = Vec::new();

        for table in tables {
            let rows: Vec<SqliteRow> =
                sqlx::query(&format!("PRAGMA foreign_key_list('{}')", table))
                    .fetch_all(&self.pool)
                    .await?;

            for row in rows {
                let referenced_table: String = row.try_get("table")?;
                fks.push(ForeignKeyInfo {
                    table: table.clone(),
                    referenced_table,
                });
            }
        }

        Ok(fks)
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
                    "SELECT COUNT(*) as cnt FROM \"{}\" WHERE \"{}\" > {}",
                    table, col, ts
                )
            }
            _ => format!("SELECT COUNT(*) as cnt FROM \"{}\"", table),
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
            .map(|c| format!("\"{}\"", c))
            .collect::<Vec<_>>()
            .join(", ");

        let sql = match (timestamp_col, since) {
            (Some(col), Some(ts)) => {
                format!(
                    "SELECT {} FROM \"{}\" WHERE \"{}\" > {} ORDER BY \"{}\" LIMIT {} OFFSET {}",
                    cols, table, col, ts, col, limit, offset
                )
            }
            _ => {
                format!(
                    "SELECT {} FROM \"{}\" LIMIT {} OFFSET {}",
                    cols, table, limit, offset
                )
            }
        };

        let rows: Vec<SqliteRow> = sqlx::query(&sql).fetch_all(&self.pool).await?;

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
        _primary_keys: &[String],
        rows: &[Row],
    ) -> Result<u64, anyhow::Error> {
        if rows.is_empty() {
            return Ok(0);
        }

        let cols = columns
            .iter()
            .map(|c| format!("\"{}\"", c))
            .collect::<Vec<_>>()
            .join(", ");

        let placeholders = (0..columns.len())
            .map(|_| "?")
            .collect::<Vec<_>>()
            .join(", ");

        let sql = format!(
            "INSERT OR REPLACE INTO \"{}\" ({}) VALUES ({})",
            table, cols, placeholders
        );

        let mut count = 0u64;
        for row in rows {
            let mut query = sqlx::query(&sql);

            for value in &row.values {
                query = match value {
                    Value::Null => query.bind(None::<String>),
                    Value::Bool(v) => query.bind(*v),
                    Value::TinyInt(v) => query.bind(*v as i32),
                    Value::SmallInt(v) => query.bind(*v as i32),
                    Value::Int(v) => query.bind(*v),
                    Value::BigInt(v) => query.bind(*v),
                    Value::Float(v) => query.bind(*v),
                    Value::Double(v) => query.bind(*v),
                    Value::String(v) => query.bind(v.clone()),
                    Value::Bytes(v) => query.bind(v.clone()),
                    Value::Timestamp(v) => query.bind(v.clone()), // SQLite stores timestamp as
                    // text
                    Value::Json(v) => query.bind(v.clone()), // SQLite stores JSON as text
                };
            }

            query.execute(&self.pool).await?;
            count += 1;
        }

        Ok(count)
    }

    async fn truncate_table(&self, table: &str) -> Result<(), anyhow::Error> {
        sqlx::query(&format!("DELETE FROM \"{}\"", table))
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    async fn close(&self) -> Result<(), anyhow::Error> {
        self.pool.close().await;
        Ok(())
    }
}
