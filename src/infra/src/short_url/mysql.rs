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
use sqlx::Row;

use crate::{
    db::mysql::{create_index, CLIENT},
    errors::Result,
    short_url::{ShortUrl, ShortUrlRecord},
};

pub struct MysqlShortUrl {}

impl MysqlShortUrl {
    pub fn new() -> Self {
        Self {}
    }
}

impl Default for MysqlShortUrl {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl ShortUrl for MysqlShortUrl {
    /// Create table short_urls
    async fn create_table(&self) -> Result<()> {
        let pool = CLIENT.clone();
        let query = r#"
            CREATE TABLE IF NOT EXISTS short_urls (
                id BIGINT AUTO_INCREMENT PRIMARY KEY,
                original_url VARCHAR(2048) NOT NULL UNIQUE,
                short_id VARCHAR(32) NOT NULL UNIQUE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        "#;
        sqlx::query(query).execute(&pool).await?;
        Ok(())
    }

    /// Create index for short_urls at short_id and original_url
    async fn create_table_index(&self) -> Result<()> {
        create_index("short_id_idx", "short_urls", true, &["short_id"]).await?;
        create_index("original_url_idx", "short_urls", true, &["original_url"]).await?;
        Ok(())
    }

    /// Add a new entry to the short_urls table
    async fn add(&self, short_id: &str, original_url: &str) -> Result<()> {
        let pool = CLIENT.clone();
        let query = r#"
            INSERT INTO short_urls (original_url, short_id)
            VALUES (?, ?)
            ON DUPLICATE KEY UPDATE original_url = original_url;
        "#;

        sqlx::query(query)
            .bind(original_url)
            .bind(short_id)
            .execute(&pool)
            .await?;
        Ok(())
    }

    /// Remove an entry from the short_urls table
    async fn remove(&self, short_id: &str) -> Result<()> {
        let pool = CLIENT.clone();
        let query = r#"
            DELETE FROM short_urls
            WHERE short_id = ?;
        "#;
        sqlx::query(query).bind(short_id).execute(&pool).await?;
        Ok(())
    }

    /// Get an entry from the short_urls table
    async fn get(&self, short_id: &str) -> Result<ShortUrlRecord> {
        let pool = CLIENT.clone();
        let query = r#"
            SELECT short_id, original_url
            FROM short_urls
            WHERE short_id = ?;
        "#;
        let row = sqlx::query_as::<_, ShortUrlRecord>(query)
            .bind(short_id)
            .fetch_one(&pool)
            .await?;

        Ok(row)
    }

    /// Get an entry from the short_urls table by original_url
    async fn get_by_original_url(&self, original_url: &str) -> Result<ShortUrlRecord> {
        let pool = CLIENT.clone();
        let query = r#"
            SELECT short_id, original_url
            FROM short_urls
            WHERE original_url = ?;
        "#;
        let row = sqlx::query_as::<_, ShortUrlRecord>(query)
            .bind(original_url)
            .fetch_one(&pool)
            .await?;
        Ok(row)
    }

    /// List all entries from the short_urls table
    async fn list(&self) -> Result<Vec<ShortUrlRecord>> {
        let pool = CLIENT.clone();
        let query = r#"
            SELECT short_id, original_url
            FROM short_urls;
        "#;
        let rows = sqlx::query_as::<_, ShortUrlRecord>(query)
            .fetch_all(&pool)
            .await?;

        Ok(rows)
    }

    /// Check if an entry exists in the short_urls table
    async fn contains(&self, short_id: &str) -> Result<bool> {
        let pool = CLIENT.clone();
        let query = r#"
            SELECT EXISTS (
                SELECT 1
                FROM short_urls
                WHERE short_id = ?
            );
        "#;
        let row: (bool,) = sqlx::query_as(query)
            .bind(short_id)
            .fetch_one(&pool)
            .await?;
        Ok(row.0)
    }

    /// Get the number of entries in the short_urls table
    async fn len(&self) -> usize {
        let pool = CLIENT.clone();
        let ret = match sqlx::query(
            r#"
            SELECT COUNT(*) AS num FROM short_urls;
            "#,
        )
        .fetch_one(&pool)
        .await
        {
            Ok(r) => r,
            Err(e) => {
                log::error!("[MYSQL] short_urls len error: {}", e);
                return 0;
            }
        };

        match ret.try_get::<i64, &str>("num") {
            Ok(v) => v as usize,
            _ => 0,
        }
    }

    /// Clear all entries from the short_urls table
    async fn clear(&self) -> Result<()> {
        let pool = CLIENT.clone();
        let query = r#"
            DELETE FROM short_urls;
        "#;
        match sqlx::query(query).execute(&pool).await {
            Ok(_) => log::info!("[SHORT_URL] short_urls table cleared"),
            Err(e) => log::error!("[MYSQL] short_urls table clear error: {}", e),
        }
        Ok(())
    }

    /// Check if the short_urls table is empty
    async fn is_empty(&self) -> bool {
        self.len().await == 0
    }
}
