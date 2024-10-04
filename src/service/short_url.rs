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

use crate::service::db;

pub struct ShortUrl {
    base_url: String,
}

impl ShortUrl {
    pub fn new(base_url: Option<String>) -> Self {
        let base_url = if let Some(base_url) = base_url {
            base_url
        } else {
            let config = get_config();
            format!("{}{}", config.common.web_url, config.common.base_uri)
        };

        Self { base_url }
    }

    /// Shortens the given original URL and stores it in the database
    pub async fn shorten(&self, original_url: &str) -> String {
        // Check if the original_url already exists in the database
        if let Some(existing_short_id) = db::short_url::get_by_original_url(original_url).await {
            return format!("{}/api/short/{}", self.base_url, existing_short_id);
        }

        let mut short_id = md5::short_hash(original_url);

        // Check if the generated short_id is already present in the database
        if db::short_url::get(short_id.as_str()).await.is_ok() {
            // Handle hash conflict - create a new hash using the timestamp
            let timestamp = Utc::now().timestamp();
            let input = format!("{}{}", original_url, timestamp);
            short_id = md5::short_hash(&input);
        }

        // Store the short_id and original_url in the database
        db::short_url::set(&short_id, original_url).await.ok();

        format!("{}/api/short/{}", self.base_url, short_id)
    }

    /// Retrieves the original URL corresponding to the given short ID
    pub async fn retrieve(&self, short_id: &str) -> Option<String> {
        db::short_url::get(short_id).await.ok()
    }

    /// Extracts the short ID from the shortened URL
    pub fn get_short_id_from_url(&self, short_url: &str) -> Option<String> {
        let prefix = format!("{}/api/short/", self.base_url);
        short_url.strip_prefix(&prefix).map(|s| s.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_shorten_and_retrieve() {
        let original_url = "https://www.example.com/some/long/url";
        let short_url_service = ShortUrl::new(None);
        let short_url = short_url_service.shorten(original_url).await;
        let short_id = short_url_service
            .get_short_id_from_url(&short_url)
            .expect("Failed to extract short_id");
        let expected_short_url = format!("http://localhost:5080/api/short/{}", short_id);
        assert_eq!(short_url, expected_short_url);

        let retrieved_url = short_url_service
            .retrieve(&short_id)
            .await
            .expect("Failed to retrieve URL");
        assert_eq!(retrieved_url, original_url);
        assert_eq!(short_id.len(), 16);
    }

    #[tokio::test]
    async fn test_retrieve_nonexistent_short_id() {
        let short_url_service = ShortUrl::new(None);
        let retrieved_url = short_url_service.retrieve("nonexistent_id").await;
        assert!(retrieved_url.is_none());
    }

    #[tokio::test]
    async fn test_unique_original_urls() {
        let original_url = "https://www.example.com/some/long/url";

        let short_url_service = ShortUrl::new(None);
        let short_url1 = short_url_service.shorten(original_url).await;
        let short_url2 = short_url_service.shorten(original_url).await;

        // Should return the same short_id
        assert_eq!(short_url1, short_url2);
    }
}
