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

use crate::common::infra::config::URL_MAP;

pub struct ShortUrl;

impl Default for ShortUrl {
    fn default() -> Self {
        Self::new()
    }
}

impl ShortUrl {
    pub fn new() -> Self {
        Self
    }

    pub fn shorten(&mut self, original_url: &str) -> String {
        // Check if the og_url already exists in cache
        if let Some(existing_short_id) = URL_MAP.iter().find_map(|entry| {
            let (k, v) = entry.pair();
            if v == original_url {
                return Some(k.clone());
            }
            None
        }) {
            return existing_short_id;
        }

        let mut short_id = md5::short_hash(original_url);

        // Check if the generated short_id is already present
        while URL_MAP.contains_key(short_id.as_str()) {
            // Handle hash conflict - create a new hash using the timestamp
            let timestamp = Utc::now().timestamp();
            let input = format!("{}{}", original_url, timestamp);
            short_id = md5::short_hash(&input);
        }

        // TODO: Call db logic
        // Store mapping in the in-memory cache
        {
            URL_MAP.insert(short_id.to_string(), original_url.to_string());
        }

        short_id.to_string()
    }

    pub fn retrieve(&self, short_id: &str) -> Option<String> {
        URL_MAP.get(short_id).map(|value| value.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_shorten_and_retrieve() {
        let mut short_url = ShortUrl::new();

        let original_url = "https://www.example.com/some/long/url";
        let short_id = short_url.shorten(original_url);

        let retrieved_url = short_url
            .retrieve(&short_id)
            .expect("Failed to retrieve URL");

        assert_eq!(retrieved_url, original_url);
        assert_eq!(short_id.len(), 16);
    }

    #[test]
    fn test_retrieve_nonexistent_short_id() {
        let short_url = ShortUrl::new();
        let retrieved_url = short_url.retrieve("nonexistent_id");
        assert!(retrieved_url.is_none());
    }

    #[test]
    fn test_unique_original_urls() {
        let mut short_url = ShortUrl::new();

        let original_url = "https://www.example.com/some/long/url";

        let short_id1 = short_url.shorten(original_url);
        let short_id2 = short_url.shorten(original_url);

        // Should return the same short_id
        assert_eq!(short_id1, short_id2);
    }
}
