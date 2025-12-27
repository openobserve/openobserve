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
    postgres::{PgConnectOptions, PgPool, PgPoolOptions, PgRow},
};

use super::{ColumnInfo, DbAdapter, ForeignKeyInfo, Row, Value};

pub struct PostgresAdapter {
    pool: PgPool,
}

impl PostgresAdapter {
    pub async fn connect() -> Result<Self, anyhow::Error> {
        let cfg = config::get_config();
        let dsn = &cfg.common.meta_postgres_dsn;

        if dsn.is_empty() {
            return Err(anyhow::anyhow!(
                "PostgreSQL DSN is not configured. Please set ZO_META_POSTGRES_DSN"
            ));
        }

        let options: PgConnectOptions =
            dsn.parse::<PgConnectOptions>()?.disable_statement_logging();

        let pool = PgPoolOptions::new()
            .max_connections(5)
            .connect_with(options)
            .await?;

        Ok(Self { pool })
    }

    fn row_to_values(&self, row: &PgRow, columns: &[String]) -> Result<Row, anyhow::Error> {
        let mut values = Vec::with_capacity(columns.len());

        for (idx, _col_name) in columns.iter().enumerate() {
            // Try to get as different types
            if let Ok(v) = row.try_get::<Option<i64>, _>(idx) {
                match v {
                    Some(i) => values.push(Value::BigInt(i)),
                    None => values.push(Value::Null),
                }
            } else if let Ok(v) = row.try_get::<Option<i32>, _>(idx) {
                match v {
                    Some(i) => values.push(Value::Int(i)),
                    None => values.push(Value::Null),
                }
            } else if let Ok(v) = row.try_get::<Option<i16>, _>(idx) {
                match v {
                    Some(i) => values.push(Value::SmallInt(i)),
                    None => values.push(Value::Null),
                }
            } else if let Ok(v) = row.try_get::<Option<f64>, _>(idx) {
                match v {
                    Some(f) => values.push(Value::Double(f)),
                    None => values.push(Value::Null),
                }
            } else if let Ok(v) = row.try_get::<Option<f32>, _>(idx) {
                match v {
                    Some(f) => values.push(Value::Float(f)),
                    None => values.push(Value::Null),
                }
            } else if let Ok(v) = row.try_get::<Option<bool>, _>(idx) {
                match v {
                    Some(b) => values.push(Value::Bool(b)),
                    None => values.push(Value::Null),
                }
            } else if let Ok(v) = row.try_get::<Option<String>, _>(idx) {
                match v {
                    Some(s) => values.push(Value::String(s)),
                    None => values.push(Value::Null),
                }
            } else if let Ok(v) = row.try_get::<Option<Vec<u8>>, _>(idx) {
                match v {
                    Some(b) => values.push(Value::Bytes(b)),
                    None => values.push(Value::Null),
                }
            } else {
                values.push(Value::Null);
            }
        }

        Ok(Row { values })
    }
}

#[async_trait]
impl DbAdapter for PostgresAdapter {
    fn name(&self) -> &'static str {
        "postgresql"
    }

    async fn list_tables(&self) -> Result<Vec<String>, anyhow::Error> {
        let rows: Vec<(String,)> =
            sqlx::query_as("SELECT tablename FROM pg_tables WHERE schemaname = 'public'")
                .fetch_all(&self.pool)
                .await?;

        Ok(rows.into_iter().map(|(name,)| name).collect())
    }

    async fn get_columns(&self, table: &str) -> Result<Vec<ColumnInfo>, anyhow::Error> {
        let rows: Vec<(String, String, String)> = sqlx::query_as(
            "SELECT column_name, data_type, is_nullable
             FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = $1
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
        let rows: Vec<(String,)> = sqlx::query_as(
            "SELECT a.attname
             FROM pg_index i
             JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
             WHERE i.indrelid = $1::regclass AND i.indisprimary
             ORDER BY array_position(i.indkey, a.attnum)",
        )
        .bind(table)
        .fetch_all(&self.pool)
        .await?;

        Ok(rows.into_iter().map(|(name,)| name).collect())
    }

    async fn get_foreign_keys(&self) -> Result<Vec<ForeignKeyInfo>, anyhow::Error> {
        let rows: Vec<(String, String)> = sqlx::query_as(
            "SELECT DISTINCT
                tc.table_name,
                ccu.table_name AS referenced_table
             FROM information_schema.table_constraints AS tc
             JOIN information_schema.constraint_column_usage AS ccu
                ON ccu.constraint_name = tc.constraint_name
                AND ccu.table_schema = tc.table_schema
             WHERE tc.constraint_type = 'FOREIGN KEY'
                AND tc.table_schema = 'public'",
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

        let rows: Vec<PgRow> = sqlx::query(&sql).fetch_all(&self.pool).await?;

        let mut result = Vec::with_capacity(rows.len());
        for row in &rows {
            result.push(self.row_to_values(row, columns)?);
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

        // Get column info for proper null type binding
        let column_infos = self.get_columns(table).await?;

        let cols = columns
            .iter()
            .map(|c| format!("\"{}\"", c))
            .collect::<Vec<_>>()
            .join(", ");

        let placeholders = (1..=columns.len())
            .map(|i| format!("${}", i))
            .collect::<Vec<_>>()
            .join(", ");

        let pk_cols = primary_keys
            .iter()
            .map(|c| format!("\"{}\"", c))
            .collect::<Vec<_>>()
            .join(", ");

        // Build DO UPDATE SET clause
        let updates = columns
            .iter()
            .filter(|c| !primary_keys.contains(c))
            .map(|c| format!("\"{}\" = EXCLUDED.\"{}\"", c, c))
            .collect::<Vec<_>>()
            .join(", ");

        // Use OVERRIDING SYSTEM VALUE to allow inserting into IDENTITY columns
        let sql = if updates.is_empty() {
            format!(
                "INSERT INTO \"{}\" ({}) OVERRIDING SYSTEM VALUE VALUES ({}) ON CONFLICT ({}) DO NOTHING",
                table, cols, placeholders, pk_cols
            )
        } else {
            format!(
                "INSERT INTO \"{}\" ({}) OVERRIDING SYSTEM VALUE VALUES ({}) ON CONFLICT ({}) DO UPDATE SET {}",
                table, cols, placeholders, pk_cols, updates
            )
        };

        let mut count = 0u64;
        for row in rows {
            let mut query = sqlx::query(&sql);

            for (idx, value) in row.values.iter().enumerate() {
                // Get column type for proper null binding
                let col_name = &columns[idx];
                let col_type = column_infos
                    .iter()
                    .find(|c| &c.name == col_name)
                    .map(|c| c.data_type.to_uppercase())
                    .unwrap_or_default();

                query = match value {
                    Value::Null => {
                        // Bind null with the correct type based on column definition
                        if col_type.contains("INT") {
                            query.bind(None::<i64>)
                        } else if col_type.contains("BOOL") {
                            query.bind(None::<bool>)
                        } else if col_type.contains("FLOAT")
                            || col_type.contains("DOUBLE")
                            || col_type.contains("REAL")
                            || col_type.contains("NUMERIC")
                        {
                            query.bind(None::<f64>)
                        } else if col_type.contains("TIMESTAMP") || col_type.contains("DATE") {
                            query.bind(None::<chrono::NaiveDateTime>)
                        } else if col_type.contains("JSON") {
                            query.bind(None::<serde_json::Value>)
                        } else if col_type.contains("BYTEA") {
                            query.bind(None::<Vec<u8>>)
                        } else {
                            query.bind(None::<String>)
                        }
                    }
                    Value::Bool(v) => query.bind(*v),
                    Value::TinyInt(v) => query.bind(*v as i16),
                    Value::SmallInt(v) => query.bind(*v),
                    Value::Int(v) => query.bind(*v),
                    Value::BigInt(v) => query.bind(*v),
                    Value::Float(v) => query.bind(*v),
                    Value::Double(v) => query.bind(*v),
                    Value::String(v) => {
                        // Check if target column is JSON type (e.g., MySQL LONGTEXT -> PG JSON)
                        if col_type.contains("JSON") {
                            let json: Option<serde_json::Value> = serde_json::from_str(v).ok();
                            query.bind(json)
                        } else {
                            query.bind(v.clone())
                        }
                    }
                    Value::Bytes(v) => {
                        // Check if target column is JSON type (source might store JSON as bytes)
                        if col_type.contains("JSON") {
                            // Try to parse bytes as UTF-8 string, then as JSON
                            let json: Option<serde_json::Value> = String::from_utf8(v.clone())
                                .ok()
                                .and_then(|s| serde_json::from_str(&s).ok());
                            query.bind(json)
                        } else {
                            query.bind(v.clone())
                        }
                    }
                    Value::Timestamp(v) => {
                        // Parse timestamp string to NaiveDateTime for PostgreSQL
                        let dt = chrono::NaiveDateTime::parse_from_str(v, "%Y-%m-%d %H:%M:%S").ok();
                        query.bind(dt)
                    }
                    Value::Json(v) => {
                        // Parse JSON string to serde_json::Value for PostgreSQL
                        let json: Option<serde_json::Value> = serde_json::from_str(v).ok();
                        query.bind(json)
                    }
                };
            }

            query.execute(&self.pool).await?;
            count += 1;
        }

        Ok(count)
    }

    async fn truncate_table(&self, table: &str) -> Result<(), anyhow::Error> {
        // Use CASCADE to handle foreign key constraints
        sqlx::query(&format!("TRUNCATE TABLE \"{}\" CASCADE", table))
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    async fn close(&self) -> Result<(), anyhow::Error> {
        self.pool.close().await;
        Ok(())
    }
}
