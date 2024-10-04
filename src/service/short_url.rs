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
use config::utils::md5;

use crate::service::db;

pub async fn shorten(original_url: &str) -> Option<String> {
    // Check if the original_url already exists in db
    if let Some(existing_short_id) = db::short_url::get_by_original_url(original_url).await {
        return Some(existing_short_id);
    }

    let mut short_id = md5::short_hash(original_url);

    // Check if the generated short_id is already present in db
    if db::short_url::get(short_id.as_str()).await.is_ok() {
        // Handle hash conflict - create a new hash using the timestamp
        let timestamp = Utc::now().timestamp();
        let input = format!("{}{}", original_url, timestamp);
        short_id = md5::short_hash(&input);
    }

    db::short_url::set(&short_id, original_url).await.ok();

    Some(short_id.to_string())
}

pub async fn retrieve(short_id: &str) -> Option<String> {
    db::short_url::get(short_id).await.ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_shorten_and_retrieve() {
        let original_url = "https://www.example.com/some/long/url";
        let short_id = shorten(original_url).await.unwrap();

        let retrieved_url = retrieve(&short_id).await.expect("Failed to retrieve URL");

        assert_eq!(retrieved_url, original_url);
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

        let short_id1 = shorten(original_url).await;
        let short_id2 = shorten(original_url).await;

        // Should return the same short_id
        assert_eq!(short_id1, short_id2);
    }
}