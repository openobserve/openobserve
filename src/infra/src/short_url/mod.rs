// Copyright 2024 Zinc Labs Inc.
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
use chrono::{DateTime, NaiveDateTime, Utc};
use config::meta::meta_store::MetaStore;
use once_cell::sync::Lazy;

use crate::errors::{Error, Result};

pub mod mysql;
pub mod postgres;
pub mod sqlite;

static CLIENT: Lazy<Box<dyn ShortUrl>> = Lazy::new(connect_default);

pub fn connect_default() -> Box<dyn ShortUrl> {
    match config::get_config().common.meta_store.as_str().into() {
        MetaStore::MySQL => Box::<mysql::MysqlShortUrl>::default(),
        MetaStore::PostgreSQL => Box::<postgres::PostgresShortUrl>::default(),
        _ => Box::<sqlite::SqliteShortUrl>::default(),
    }
}

#[async_trait]
pub trait ShortUrl: Sync + Send + 'static {
    async fn create_table(&self) -> Result<()>;
    async fn create_table_index(&self) -> Result<()>;
    async fn add(&self, short_id: &str, original_url: &str) -> Result<()>;
    async fn remove(&self, short_id: &str) -> Result<()>;
    async fn get(&self, short_id: &str) -> Result<ShortUrlRecord>;
    async fn list(&self, limit: Option<i64>) -> Result<Vec<ShortUrlRecord>>;
    async fn contains(&self, short_id: &str) -> Result<bool>;
    async fn len(&self) -> usize;
    async fn clear(&self) -> Result<()>;
    async fn is_empty(&self) -> bool;
}

pub async fn init() -> Result<()> {
    CLIENT.create_table().await?;
    CLIENT.create_table_index().await?;
    Ok(())
}

pub async fn create_table() -> Result<()> {
    CLIENT.create_table().await
}

pub async fn create_table_index() -> Result<()> {
    CLIENT.create_table_index().await
}

#[inline]
pub async fn add(short_id: &str, original_url: &str) -> Result<()> {
    CLIENT.add(short_id, original_url).await
}

#[inline]
pub async fn remove(short_id: &str) -> Result<()> {
    CLIENT.remove(short_id).await
}

#[inline]
pub async fn get(short_id: &str) -> Result<ShortUrlRecord> {
    CLIENT.get(short_id).await
}

#[inline]
pub async fn list(limit: Option<i64>) -> Result<Vec<ShortUrlRecord>> {
    CLIENT.list(limit).await
}

#[inline]
pub async fn contains(short_id: &str) -> Result<bool> {
    CLIENT.contains(short_id).await
}

#[inline]
pub async fn len() -> usize {
    CLIENT.len().await
}

#[inline]
pub async fn clear() -> Result<()> {
    CLIENT.clear().await
}

#[inline]
pub async fn is_empty() -> bool {
    CLIENT.is_empty().await
}

#[derive(sqlx::FromRow, Debug, Clone)]
pub struct SqliteShortUrlRecord {
    pub short_id: String,
    pub original_url: String,
    // SQLite often stores timestamps as strings
    pub created_at: String,
}

#[derive(sqlx::FromRow, Debug, Clone, Default)]
pub struct ShortUrlRecord {
    pub short_id: String,
    pub original_url: String,
    pub created_at: DateTime<Utc>,
}

#[derive(sqlx::FromRow, Debug, Clone, Default)]
pub struct PgShortUrlRecord {
    pub short_id: String,
    pub original_url: String,
    pub created_at: NaiveDateTime,
}

impl ShortUrlRecord {
    pub fn new(short_id: String, original_url: String) -> Self {
        Self {
            short_id,
            original_url,
            created_at: Utc::now(),
        }
    }
}

impl From<PgShortUrlRecord> for ShortUrlRecord {
    fn from(record: PgShortUrlRecord) -> Self {
        Self {
            short_id: record.short_id,
            original_url: record.original_url,
            created_at: DateTime::<Utc>::from_naive_utc_and_offset(record.created_at, Utc),
        }
    }
}

impl TryFrom<SqliteShortUrlRecord> for ShortUrlRecord {
    type Error = Error;

    fn try_from(record: SqliteShortUrlRecord) -> std::result::Result<Self, Self::Error> {
        // Parse the `created_at` string into a NaiveDateTime first (without timezone)
        match NaiveDateTime::parse_from_str(&record.created_at, "%Y-%m-%d %H:%M:%S") {
            Ok(naive_dt) => {
                // Convert NaiveDateTime to DateTime<Utc>
                let utc_dt = DateTime::<Utc>::from_naive_utc_and_offset(naive_dt, Utc);
                Ok(ShortUrlRecord {
                    short_id: record.short_id,
                    original_url: record.original_url,
                    created_at: utc_dt,
                })
            }
            Err(_) => Err(Error::Message(format!(
                "Failed to parse created_at timestamp: {}",
                record.created_at
            ))),
        }
    }
}

#[cfg(test)]
mod tests {
    use chrono::{NaiveDate, NaiveTime, Utc};

    use super::*;

    #[test]
    fn test_sqlite_short_url_record_conversion_success() {
        // Example of a valid SQLite record with a correct timestamp format
        let sqlite_record = SqliteShortUrlRecord {
            short_id: "abc123".to_string(),
            original_url: "https://example.com".to_string(),
            created_at: "2024-10-05 21:39:43".to_string(),
        };

        // Attempt to convert the SQLite record to ShortUrlRecord
        let result = ShortUrlRecord::try_from(sqlite_record);

        // Assert that the conversion was successful
        assert!(result.is_ok());

        // Extract the ShortUrlRecord and verify its fields
        let short_url_record = result.unwrap();
        assert_eq!(short_url_record.short_id, "abc123");
        assert_eq!(short_url_record.original_url, "https://example.com");

        // Verify the `created_at` timestamp
        let expected_naive_date = NaiveDate::from_ymd_opt(2024, 10, 5).expect("Invalid date");
        let expected_naive_time = NaiveTime::from_hms_opt(21, 39, 43).expect("Invalid time");
        let expected_naive_datetime = expected_naive_date.and_time(expected_naive_time);

        let expected_datetime =
            DateTime::<Utc>::from_naive_utc_and_offset(expected_naive_datetime, Utc);
        assert_eq!(short_url_record.created_at, expected_datetime);
    }
}
