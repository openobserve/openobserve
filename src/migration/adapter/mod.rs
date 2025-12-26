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

mod mysql;
mod postgres;
mod sqlite;

use async_trait::async_trait;
pub use mysql::MysqlAdapter;
pub use postgres::PostgresAdapter;
pub use sqlite::SqliteAdapter;

/// Column information
#[derive(Debug, Clone)]
#[allow(dead_code)]
pub struct ColumnInfo {
    pub name: String,
    pub data_type: String,
    pub is_nullable: bool,
}

/// Generic value type for database rows
#[derive(Debug, Clone)]
#[allow(dead_code)]
pub enum Value {
    Null,
    Bool(bool),
    TinyInt(i8),
    SmallInt(i16),
    Int(i32),
    BigInt(i64),
    Float(f32),
    Double(f64),
    String(String),
    Bytes(Vec<u8>),
    /// Timestamp stored as string in format "YYYY-MM-DD HH:MM:SS"
    Timestamp(String),
}

/// A row of data
#[derive(Debug, Clone)]
pub struct Row {
    pub values: Vec<Value>,
}

/// Database adapter trait
#[async_trait]
#[allow(dead_code)]
pub trait DbAdapter: Send + Sync {
    /// Get adapter name
    fn name(&self) -> &'static str;

    /// List all tables in the database
    async fn list_tables(&self) -> Result<Vec<String>, anyhow::Error>;

    /// Get column information for a table
    async fn get_columns(&self, table: &str) -> Result<Vec<ColumnInfo>, anyhow::Error>;

    /// Get primary key columns for a table
    async fn get_primary_keys(&self, table: &str) -> Result<Vec<String>, anyhow::Error>;

    /// Count records in a table, optionally with timestamp filter
    async fn count(
        &self,
        table: &str,
        timestamp_col: Option<&str>,
        since: Option<i64>,
    ) -> Result<u64, anyhow::Error>;

    /// Select a batch of records from a table
    async fn select_batch(
        &self,
        table: &str,
        columns: &[String],
        offset: u64,
        limit: u64,
        timestamp_col: Option<&str>,
        since: Option<i64>,
    ) -> Result<Vec<Row>, anyhow::Error>;

    /// Upsert a batch of records into a table
    async fn upsert_batch(
        &self,
        table: &str,
        columns: &[String],
        primary_keys: &[String],
        rows: &[Row],
    ) -> Result<u64, anyhow::Error>;

    /// Truncate a table
    async fn truncate_table(&self, table: &str) -> Result<(), anyhow::Error>;

    /// Close the connection
    async fn close(&self) -> Result<(), anyhow::Error>;
}

/// Create a database adapter based on the database type
pub async fn create_adapter(db_type: &str) -> Result<Box<dyn DbAdapter>, anyhow::Error> {
    match db_type.to_lowercase().as_str() {
        "sqlite" => Ok(Box::new(SqliteAdapter::connect().await?)),
        "mysql" => Ok(Box::new(MysqlAdapter::connect().await?)),
        "postgresql" | "postgres" => Ok(Box::new(PostgresAdapter::connect().await?)),
        _ => Err(anyhow::anyhow!("Unsupported database type: {}", db_type)),
    }
}
