use chrono::Utc;

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

    pub fn shorten(&mut self, og_url: &str) -> String {
        // Check if the og_url already exists in cache
        if let Some(existing_short_id) = URL_MAP.iter().find_map(|entry| {
            let (k, v) = entry.pair();
            if v == og_url {
                return Some(k.clone());
            }
            None
        }) {
            return existing_short_id;
        }

        let mut short_id = self.generate_short_id(og_url);

        // Check if the generated short_id is already present
        while URL_MAP.contains_key(short_id.as_str()) {
            // Handle hash conflict - create a new hash using the timestamp
            let timestamp = Utc::now().timestamp();
            let new_input = format!("{}{}", og_url, timestamp);
            short_id = self.generate_short_id(&new_input);
        }

        // Store mapping in the in-memory cache
        {
            URL_MAP.insert(short_id.to_string(), og_url.to_string());
        }

        short_id.to_string()
    }

    pub fn generate_short_id(&self, input: &str) -> String {
        let digest = md5::compute(input.as_bytes());
        let hash_str = format!("{:x}", digest);

        // Extract middle 16 characters of the hash string
        let mid_index = hash_str.len() / 2;
        let short_id = &hash_str[mid_index - 8..mid_index + 8];
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
