use async_trait::async_trait;
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
    async fn get_by_original_url(&self, original_url: &str) -> Result<ShortUrlRecord>;
    async fn list(&self) -> Result<Vec<ShortUrlRecord>>;
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
pub async fn list() -> Result<Vec<ShortUrlRecord>> {
    CLIENT.list().await
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

#[derive(sqlx::FromRow, Debug, Clone, Default)]
pub struct ShortUrlRecord {
    pub short_id: String,
    pub original_url: String,
}
