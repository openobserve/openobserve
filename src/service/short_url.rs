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

use chrono::Utc;
use config::{get_config, utils::md5};

use crate::{common::meta::short_url::ShortUrlCacheEntry, service::db};

pub fn get_base_url() -> String {
    let config = get_config();
    format!("{}{}", config.common.web_url, config.common.base_uri)
}

/// Shortens the given original URL and stores it in the database
pub async fn shorten(original_url: &str) -> String {
    // Check if the original_url already exists in the database
    if let Some(existing_short_id) = db::short_url::get_by_original_url(original_url).await {
        return format!("{}/short/{}", get_base_url(), existing_short_id);
    }

    let mut short_id = md5::short_hash(original_url);

    // Check if the generated short_id is already present in the database
    if db::short_url::get(short_id.as_str()).await.is_ok() {
        // Handle hash conflict - create a new hash using the timestamp
        let timestamp = Utc::now().timestamp();
        let input = format!("{}{}", original_url, timestamp);
        short_id = md5::short_hash(&input);
    }

    let entry = ShortUrlCacheEntry::new(short_id.clone(), original_url.to_string());

    // Store the short_id and original_url in the database
    db::short_url::set(&short_id, entry.clone()).await.ok();

    format!("{}/short/{}", get_base_url(), entry.short_id)
}

/// Retrieves the original URL corresponding to the given short ID
pub async fn retrieve(short_id: &str) -> Option<String> {
    db::short_url::get(short_id).await.ok()
}

/// Extracts the short ID from the shortened URL
pub fn get_short_id_from_url(short_url: &str) -> Option<String> {
    let prefix = format!("{}/short/", get_base_url());
    short_url.strip_prefix(&prefix).map(|s| s.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_shorten_and_retrieve() {
        let original_url = "https://www.example.com/some/long/url";
        let short_url = shorten(original_url).await;
        let short_id = get_short_id_from_url(&short_url).unwrap();

        let retrieved_url = retrieve(&short_id).await.expect("Failed to retrieve URL");
        assert_eq!(retrieved_url, original_url);

        let short_id = get_short_id_from_url(&short_url).unwrap();
        assert_eq!(short_id.len(), 16);
    }

    #[tokio::test]
    async fn test_retrieve_nonexistent_short_id() {
        let retrieved_url = retrieve("nonexistent_id").await;
        assert!(retrieved_url.is_none());
    }

    #[tokio::test]
    async fn test_unique_original_urls() {
        let original_url = "https://www.example.com/some/long/url";

        let short_url1 = shorten(original_url).await;
        let short_url2 = shorten(original_url).await;

        // Should return the same short_id
        assert_eq!(short_url1, short_url2);
    }
}
