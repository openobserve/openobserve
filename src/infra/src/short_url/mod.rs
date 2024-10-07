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
use chrono::{DateTime, Utc};
use config::meta::meta_store::MetaStore;
use once_cell::sync::Lazy;

use crate::errors::Result;

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
    async fn get_expired(
        &self,
        expired_before: DateTime<Utc>,
        limit: Option<i64>,
    ) -> Result<Vec<String>>;
    async fn batch_remove(&self, short_ids: Vec<String>) -> Result<()>;
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

#[inline]
pub async fn get_expired(expired_before: DateTime<Utc>, limit: Option<i64>) -> Result<Vec<String>> {
    CLIENT.get_expired(expired_before, limit).await
}

#[inline]
pub async fn batch_remove(short_ids: Vec<String>) -> Result<()> {
    CLIENT.batch_remove(short_ids).await
}

#[derive(Debug, sqlx::FromRow)]
pub struct ShortUrlRecord {
    pub short_id: String,
    pub original_url: String,
}

impl ShortUrlRecord {
    pub fn new(short_id: &str, original_url: &str) -> Self {
        Self {
            short_id: short_id.to_string(),
            original_url: original_url.to_string(),
        }
    }
}
