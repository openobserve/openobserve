use chrono::{DateTime, Utc};
use infra::short_url::ShortUrlRecord;

#[derive(Debug, Clone)]
pub struct ShortUrlCacheEntry {
    pub short_id: String,
    pub original_url: String,
    // denotes the time the short_url entry was created in app cache
    // does not match with the created_at field in the database
    pub timestamp: DateTime<Utc>,
}

impl ShortUrlCacheEntry {
    pub fn new(short_id: String, original_url: String) -> Self {
        Self {
            short_id,
            original_url,
            timestamp: Utc::now(),
        }
    }
}

impl From<ShortUrlRecord> for ShortUrlCacheEntry {
    fn from(record: ShortUrlRecord) -> Self {
        Self {
            short_id: record.short_id,
            original_url: record.original_url,
            timestamp: Utc::now(),
        }
    }
}
