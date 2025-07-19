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

use chrono::Utc;
use config::{get_config, utils::md5};
use infra::{
    errors::{DbError, Error},
    table::short_urls::ShortUrlRecord,
};

use crate::service::db;

const SHORT_URL_WEB_PATH: &str = "short/";

pub fn get_base_url() -> String {
    let config = get_config();
    format!("{}{}", config.common.web_url, config.common.base_uri)
}

pub fn construct_short_url(org_id: &str, short_id: &str) -> String {
    format!(
        "{}/{}/{}{}?org_identifier={}",
        get_base_url(),
        "web",
        SHORT_URL_WEB_PATH,
        short_id,
        org_id,
    )
}

async fn store_short_url(
    org_id: &str,
    short_id: &str,
    original_url: &str,
) -> Result<String, anyhow::Error> {
    let entry = ShortUrlRecord::new(short_id, original_url);
    db::short_url::set(short_id, entry).await?;
    Ok(construct_short_url(org_id, short_id))
}

fn generate_short_id(original_url: &str, timestamp: Option<i64>) -> String {
    match timestamp {
        Some(ts) => {
            let input = format!("{original_url}{ts}");
            md5::short_hash(&input)
        }
        None => md5::short_hash(original_url),
    }
}

/// Shortens the given original URL and stores it in the database
pub async fn shorten(org_id: &str, original_url: &str) -> Result<String, anyhow::Error> {
    let mut short_id = generate_short_id(original_url, None);

    if let Ok(existing_url) = db::short_url::get(&short_id).await
        && existing_url == original_url
    {
        return Ok(construct_short_url(org_id, &short_id));
    }

    let result = store_short_url(org_id, &short_id, original_url).await;
    match result {
        Ok(url) => Ok(url),
        Err(e) => {
            if let Some(infra_error) = e.downcast_ref::<Error>() {
                match infra_error {
                    Error::DbError(DbError::UniqueViolation) => {
                        let timestamp = Utc::now().timestamp_micros();
                        short_id = generate_short_id(original_url, Some(timestamp));
                        store_short_url(org_id, &short_id, original_url).await
                    }
                    _ => Err(e),
                }
            } else {
                Err(e)
            }
        }
    }
}

/// Retrieves the original URL corresponding to the given short ID
pub async fn retrieve(short_id: &str) -> Option<String> {
    db::short_url::get(short_id).await.ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Extracts the short ID from the shortened URL
    fn get_short_id_from_url(org_id: &str, short_url: &str) -> Option<String> {
        let prefix = format!("{}api/{}{}", get_base_url(), org_id, SHORT_URL_WEB_PATH);
        short_url.strip_prefix(&prefix).map(|s| s.to_string())
    }

    #[test]
    fn test_get_base_url() {
        let base_url = get_base_url();
        // Should contain the web URL and base URI from config
        assert!(!base_url.is_empty());
        // Should end with the base URI
        assert!(base_url.ends_with(&get_config().common.base_uri));
    }

    #[test]
    fn test_construct_short_url() {
        let org_id = "test_org";
        let short_id = "abc123def456";
        let short_url = construct_short_url(org_id, short_id);

        // Should contain the base URL
        assert!(short_url.starts_with(&get_base_url()));
        // Should contain the web path
        assert!(short_url.contains("/web/"));
        // Should contain the short URL path
        assert!(short_url.contains(SHORT_URL_WEB_PATH));
        // Should contain the short ID
        assert!(short_url.contains(short_id));
        // Should contain the org identifier
        assert!(short_url.contains(&format!("org_identifier={}", org_id)));
    }

    #[test]
    fn test_generate_short_id() {
        let original_url = "https://www.example.com/some/long/url";
        let short_id = generate_short_id(original_url, None);
        assert_eq!(short_id.len(), 16);
        let timestamp = Utc::now().timestamp_micros();
        let short_id2 = generate_short_id(original_url, Some(timestamp));
        assert_eq!(short_id2.len(), 16);
        assert_ne!(short_id, short_id2);
    }

    #[test]
    fn test_generate_short_id_with_timestamp() {
        let original_url = "https://www.example.com/some/long/url";
        let timestamp = 1672575000000000;
        let short_id = generate_short_id(original_url, Some(timestamp));
        assert_eq!(short_id.len(), 16);

        // Same URL with same timestamp should generate same ID
        let short_id2 = generate_short_id(original_url, Some(timestamp));
        assert_eq!(short_id, short_id2);

        // Same URL with different timestamp should generate different ID
        let short_id3 = generate_short_id(original_url, Some(timestamp + 1));
        assert_ne!(short_id, short_id3);
    }

    #[test]
    fn test_generate_short_id_different_urls() {
        let url1 = "https://www.example.com/url1";
        let url2 = "https://www.example.com/url2";

        let short_id1 = generate_short_id(url1, None);
        let short_id2 = generate_short_id(url2, None);

        assert_ne!(short_id1, short_id2);
        assert_eq!(short_id1.len(), 16);
        assert_eq!(short_id2.len(), 16);
    }

    #[test]
    fn test_generate_short_id_empty_url() {
        let empty_url = "";
        let short_id = generate_short_id(empty_url, None);
        assert_eq!(short_id.len(), 16);

        let short_id2 = generate_short_id(empty_url, Some(123));
        assert_eq!(short_id2.len(), 16);
        assert_ne!(short_id, short_id2);
    }

    #[tokio::test]
    #[ignore]
    async fn test_shorten_and_retrieve() {
        let original_url = "https://www.example.com/some/long/url";
        let short_url = shorten("default", original_url).await.unwrap();
        let short_id = get_short_id_from_url("default", &short_url).unwrap();

        let retrieved_url = retrieve(&short_id).await.expect("Failed to retrieve URL");
        assert_eq!(retrieved_url, original_url);

        let short_id = get_short_id_from_url("default", &short_url).unwrap();
        assert_eq!(short_id.len(), 16);
    }

    #[tokio::test]
    #[ignore]
    async fn test_retrieve_nonexistent_short_id() {
        let retrieved_url = retrieve("nonexistent_id").await;
        assert!(retrieved_url.is_none());
    }

    #[tokio::test]
    #[ignore]
    async fn test_unique_original_urls() {
        let original_url = "https://www.example.com/some/long/url";

        let short_url1 = shorten("default", original_url).await.unwrap();
        let short_url2 = shorten("default", original_url).await.unwrap();

        // Should return the same short_id
        assert_eq!(short_url1, short_url2);
    }

    #[tokio::test]
    async fn test_generate_short_id_async() {
        let original_url = "https://www.example.com/some/long/url";
        let short_id = generate_short_id(original_url, None);
        assert_eq!(short_id.len(), 16);
        let timestamp = Utc::now().timestamp_micros();
        let short_id2 = generate_short_id(original_url, Some(timestamp));
        assert_eq!(short_id2.len(), 16);
        assert_ne!(short_id, short_id2);
    }
}
