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
    db::sqlite::{create_index, CLIENT_RO, CLIENT_RW},
    errors::Result,
    short_url::{ShortUrl, ShortUrlRecord},
};

pub struct SqliteShortUrl {}

impl SqliteShortUrl {
    pub fn new() -> Self {
        Self {}
    }
}

impl Default for SqliteShortUrl {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl ShortUrl for SqliteShortUrl {
    /// Creates the short_urls table if it does not exist
    async fn create_table(&self) -> Result<()> {
        let client = CLIENT_RW.clone();
        let client = client.lock().await;

        sqlx::query(
            r#"
                CREATE TABLE IF NOT EXISTS short_urls
                (
                    id           INTEGER PRIMARY KEY AUTOINCREMENT,
                    original_url VARCHAR(2048) NOT NULL,
                    short_id     VARCHAR(32) NOT NULL,
                    created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                );
                "#,
        )
        .execute(&*client)
        .await?;

        Ok(())
    }

    /// Creates indexes on the short_urls table
    async fn create_table_index(&self) -> Result<()> {
        create_index("short_id_idx", "short_urls", true, &["short_id"]).await?;
        create_index("original_url_idx", "short_urls", true, &["original_url"]).await?;
        Ok(())
    }

    /// Adds a new short URL entry
    async fn add(&self, short_id: &str, original_url: &str) -> Result<()> {
        let client = CLIENT_RW.clone();
        let client = client.lock().await;
        let mut tx = client.begin().await?;

        sqlx::query(
            r#"
                INSERT INTO short_urls (original_url, short_id)
                VALUES ($1, $2)
                ON CONFLICT(original_url) DO NOTHING;
                "#,
        )
        .bind(original_url)
        .bind(short_id)
        .execute(&mut *tx)
        .await?;

        Ok(())
    }

    /// Removes a short URL entry by short_id
    async fn remove(&self, short_id: &str) -> Result<()> {
        let client = CLIENT_RW.clone();
        let client = client.lock().await;

        sqlx::query(
            r#"
                DELETE FROM short_urls
                WHERE short_id = $1;
                "#,
        )
        .bind(short_id)
        .execute(&*client)
        .await?;

        Ok(())
    }

    /// Retrieves a short URL entry by short_id
    async fn get(&self, short_id: &str) -> Result<ShortUrlRecord> {
        let client = CLIENT_RO.clone();

        let query = r#"
                            SELECT short_id, original_url
                            FROM short_urls
                            WHERE short_id = $1;
                            "#;

        let row = sqlx::query_as::<_, ShortUrlRecord>(query)
            .bind(short_id)
            .fetch_one(&client)
            .await?;

        Ok(row)
    }

    /// Retrieves a short URL entry by original_url
    async fn get_by_original_url(&self, original_url: &str) -> Result<ShortUrlRecord> {
        let client = CLIENT_RO.clone();

        let query = r#"
                        SELECT short_id, original_url
                        FROM short_urls
                        WHERE original_url = $1;
                        "#;

        let row = sqlx::query_as::<_, ShortUrlRecord>(query)
            .bind(original_url)
            .fetch_one(&client)
            .await?;

        Ok(row)
    }

    /// Lists all short URL entries
    async fn list(&self) -> Result<Vec<ShortUrlRecord>> {
        let client = CLIENT_RO.clone();
        let query = r#"
                            SELECT short_id, original_url
                            FROM short_urls;
                            "#;

        let rows = sqlx::query_as::<_, ShortUrlRecord>(query)
            .fetch_all(&client)
            .await?;

        Ok(rows)
    }

    /// Checks if a short_id exists in the database
    async fn contains(&self, short_id: &str) -> Result<bool> {
        let client = CLIENT_RO.clone();

        let result: (bool,) = sqlx::query_as(
            r#"
                SELECT EXISTS (
                    SELECT 1
                    FROM short_urls
                    WHERE short_id = $1;
                );
                "#,
        )
        .bind(short_id)
        .fetch_one(&client)
        .await?;

        Ok(result.0)
    }

    /// Returns the number of entries in the short_urls table
    async fn len(&self) -> usize {
        let client = CLIENT_RO.clone();

        let result = match sqlx::query(
            r#"
                SELECT COUNT(*) as num FROM short_urls;
                "#,
        )
        .fetch_one(&client)
        .await
        {
            Ok(row) => row,
            Err(e) => {
                log::error!("[SQLITE] short_urls len error: {}", e);
                return 0;
            }
        };

        match result.try_get::<i64, &str>("num") {
            Ok(count) => count as usize,
            Err(_) => 0,
        }
    }

    /// Clears all entries from the short_urls table
    async fn clear(&self) -> Result<()> {
        let client = CLIENT_RW.clone();
        let client = client.lock().await;

        sqlx::query(r#"DELETE FROM short_urls;"#)
            .execute(&*client)
            .await?;

        Ok(())
    }

    /// Checks if the short_urls table is empty
    async fn is_empty(&self) -> bool {
        self.len().await == 0
    }
}
