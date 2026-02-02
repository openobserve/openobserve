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
    /// JSON stored as string
    Json(String),
}

/// A row of data
#[derive(Debug, Clone)]
pub struct Row {
    pub values: Vec<Value>,
}

/// Foreign key information
#[derive(Debug, Clone)]
pub struct ForeignKeyInfo {
    pub table: String,
    pub referenced_table: String,
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

    /// Get foreign key dependencies for all tables
    async fn get_foreign_keys(&self) -> Result<Vec<ForeignKeyInfo>, anyhow::Error>;

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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_column_info_creation() {
        let col = ColumnInfo {
            name: "id".to_string(),
            data_type: "INTEGER".to_string(),
            is_nullable: false,
        };

        assert_eq!(col.name, "id");
        assert_eq!(col.data_type, "INTEGER");
        assert!(!col.is_nullable);
    }

    #[test]
    fn test_column_info_nullable() {
        let col = ColumnInfo {
            name: "description".to_string(),
            data_type: "TEXT".to_string(),
            is_nullable: true,
        };

        assert!(col.is_nullable);
    }

    #[test]
    fn test_value_null() {
        let val = Value::Null;
        assert!(matches!(val, Value::Null));
    }

    #[test]
    fn test_value_bool() {
        let val_true = Value::Bool(true);
        let val_false = Value::Bool(false);

        assert!(matches!(val_true, Value::Bool(true)));
        assert!(matches!(val_false, Value::Bool(false)));
    }

    #[test]
    fn test_value_integers() {
        let tiny = Value::TinyInt(127);
        let small = Value::SmallInt(32767);
        let int = Value::Int(2147483647);
        let big = Value::BigInt(9223372036854775807);

        assert!(matches!(tiny, Value::TinyInt(127)));
        assert!(matches!(small, Value::SmallInt(32767)));
        assert!(matches!(int, Value::Int(2147483647)));
        assert!(matches!(big, Value::BigInt(9223372036854775807)));
    }

    #[test]
    fn test_value_floats() {
        let float = Value::Float(1.23);
        let double = Value::Double(1.23459265358979);

        assert!(matches!(float, Value::Float(_)));
        assert!(matches!(double, Value::Double(_)));
    }

    #[test]
    fn test_value_string() {
        let val = Value::String("hello".to_string());
        assert!(matches!(val, Value::String(s) if s == "hello"));
    }

    #[test]
    fn test_value_bytes() {
        let val = Value::Bytes(vec![1, 2, 3, 4]);
        assert!(matches!(val, Value::Bytes(b) if b == vec![1, 2, 3, 4]));
    }

    #[test]
    fn test_value_timestamp() {
        let val = Value::Timestamp("2024-01-15 10:30:00".to_string());
        assert!(matches!(val, Value::Timestamp(s) if s == "2024-01-15 10:30:00"));
    }

    #[test]
    fn test_row_creation() {
        let row = Row {
            values: vec![
                Value::BigInt(1),
                Value::String("test".to_string()),
                Value::Bool(true),
            ],
        };

        assert_eq!(row.values.len(), 3);
        assert!(matches!(&row.values[0], Value::BigInt(1)));
        assert!(matches!(&row.values[1], Value::String(s) if s == "test"));
        assert!(matches!(&row.values[2], Value::Bool(true)));
    }

    #[test]
    fn test_row_empty() {
        let row = Row { values: vec![] };
        assert!(row.values.is_empty());
    }

    #[test]
    fn test_value_clone() {
        let original = Value::String("test".to_string());
        let cloned = original.clone();
        assert!(matches!(cloned, Value::String(s) if s == "test"));
    }

    #[test]
    fn test_row_clone() {
        let original = Row {
            values: vec![Value::BigInt(42), Value::String("hello".to_string())],
        };
        let cloned = original.clone();

        assert_eq!(cloned.values.len(), 2);
        assert!(matches!(&cloned.values[0], Value::BigInt(42)));
    }

    #[test]
    fn test_column_info_clone() {
        let original = ColumnInfo {
            name: "test".to_string(),
            data_type: "TEXT".to_string(),
            is_nullable: true,
        };
        let cloned = original.clone();

        assert_eq!(cloned.name, "test");
        assert_eq!(cloned.data_type, "TEXT");
        assert!(cloned.is_nullable);
    }

    #[test]
    fn test_value_debug() {
        let val = Value::BigInt(42);
        let debug_str = format!("{:?}", val);
        assert!(debug_str.contains("BigInt"));
        assert!(debug_str.contains("42"));
    }

    #[test]
    fn test_row_debug() {
        let row = Row {
            values: vec![Value::Null],
        };
        let debug_str = format!("{:?}", row);
        assert!(debug_str.contains("Row"));
        assert!(debug_str.contains("Null"));
    }
}
