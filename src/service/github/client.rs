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

use std::time::Duration;

use bytes::Bytes;
use serde::de::DeserializeOwned;

use super::{
    cache::CacheManager,
    types::{CachedData, GitHubError, GitHubServiceConfig},
};

/// Generic GitHub Data Service
///
/// Provides methods to fetch raw or JSON data from GitHub with caching and retry logic.
#[derive(Clone)]
pub struct GitHubDataService {
    client: reqwest::Client,
    cache: CacheManager,
    config: GitHubServiceConfig,
}

impl GitHubDataService {
    /// Create a new GitHub Data Service with default configuration
    pub fn new() -> Self {
        Self::with_config(GitHubServiceConfig::default())
    }

    /// Create a new GitHub Data Service with custom configuration
    pub fn with_config(config: GitHubServiceConfig) -> Self {
        let client = reqwest::Client::builder()
            .timeout(config.timeout)
            .user_agent("OpenObserve")
            .build()
            .expect("Failed to create HTTP client");

        let cache = CacheManager::new(config.max_cache_size);

        Self {
            client,
            cache,
            config,
        }
    }

    /// Fetch raw bytes from URL with caching
    ///
    /// # Arguments
    /// * `url` - The URL to fetch data from
    /// * `force_refresh` - If true, bypass cache and fetch fresh data
    ///
    /// # Returns
    /// Raw bytes of the response
    pub async fn fetch_with_cache(
        &self,
        url: &str,
        force_refresh: bool,
    ) -> Result<Bytes, GitHubError> {
        let cache_key = url.to_string();

        // Check cache first unless force refresh
        if !force_refresh && let Some(cached_data) = self.cache.get(&cache_key).await {
            log::info!("Returning cached data for URL: {}", url);
            return Ok(cached_data);
        }

        // Fetch from GitHub
        log::info!("Fetching fresh data from URL: {}", url);
        let data = self.fetch_with_retry(url).await?;

        // Cache the data
        let cached_data = CachedData::new(data.clone(), self.config.default_ttl_secs);
        if let Err(e) = self.cache.set(cache_key, cached_data).await {
            log::warn!("Failed to cache data: {}", e);
            // Don't fail the request if caching fails
        }

        Ok(data)
    }

    /// Fetch and parse JSON from URL with caching
    ///
    /// # Arguments
    /// * `url` - The URL to fetch JSON from
    ///
    /// # Returns
    /// Parsed JSON data of type T
    pub async fn fetch_json<T: DeserializeOwned>(&self, url: &str) -> Result<T, GitHubError> {
        let data = self.fetch_with_cache(url, false).await?;
        let parsed = serde_json::from_slice(&data)?;
        Ok(parsed)
    }

    /// Fetch raw bytes from URL without caching
    pub async fn fetch_raw(&self, url: &str) -> Result<Bytes, GitHubError> {
        self.fetch_with_retry(url).await
    }

    /// Invalidate cache for a specific URL
    pub async fn invalidate_cache(&self, url: &str) {
        let cache_key = url.to_string();
        self.cache.invalidate(&cache_key).await;
    }

    /// Clear all cached data
    pub async fn clear_cache(&self) {
        self.cache.clear().await;
    }

    /// Fetch data with retry logic
    async fn fetch_with_retry(&self, url: &str) -> Result<Bytes, GitHubError> {
        let mut attempts = 0;
        let max_attempts = self.config.retry_attempts;

        loop {
            match self.fetch_once(url).await {
                Ok(data) => return Ok(data),
                Err(e) => {
                    attempts += 1;

                    if attempts >= max_attempts || !Self::is_retryable(&e) {
                        log::error!("Failed to fetch after {} attempts: {}", attempts, e);
                        return Err(e);
                    }

                    let delay = Self::calculate_backoff(attempts, self.config.retry_delay_ms);
                    log::warn!(
                        "Fetch attempt {} failed, retrying in {:?}. Error: {}",
                        attempts,
                        delay,
                        e
                    );
                    tokio::time::sleep(delay).await;
                }
            }
        }
    }

    /// Single fetch attempt
    async fn fetch_once(&self, url: &str) -> Result<Bytes, GitHubError> {
        let response = self.client.get(url).send().await?;

        // Check for rate limiting
        if response.status() == reqwest::StatusCode::TOO_MANY_REQUESTS {
            let reset_at = response
                .headers()
                .get("x-ratelimit-reset")
                .and_then(|v| v.to_str().ok())
                .and_then(|v| v.parse::<i64>().ok())
                .unwrap_or(0);

            return Err(GitHubError::RateLimitExceeded { reset_at });
        }

        // Check for other errors
        if !response.status().is_success() {
            return Err(GitHubError::HttpError {
                status: response.status().as_u16(),
                message: format!("HTTP error: {}", response.status()),
            });
        }

        let bytes = response.bytes().await?;
        Ok(bytes)
    }

    /// Check if an error is retryable
    fn is_retryable(error: &GitHubError) -> bool {
        match error {
            GitHubError::NetworkError(_) => true,
            GitHubError::Timeout => true,
            GitHubError::HttpError { status, .. } if *status >= 500 => true,
            _ => false,
        }
    }

    /// Calculate exponential backoff delay
    fn calculate_backoff(attempt: u32, base_delay_ms: u64) -> Duration {
        let delay_ms = base_delay_ms * 2u64.pow(attempt - 1);
        Duration::from_millis(delay_ms.min(30_000)) // Cap at 30 seconds
    }
}

impl Default for GitHubDataService {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_calculate_backoff() {
        assert_eq!(
            GitHubDataService::calculate_backoff(1, 1000),
            Duration::from_millis(1000)
        );
        assert_eq!(
            GitHubDataService::calculate_backoff(2, 1000),
            Duration::from_millis(2000)
        );
        assert_eq!(
            GitHubDataService::calculate_backoff(3, 1000),
            Duration::from_millis(4000)
        );
        // Test cap at 30 seconds
        assert_eq!(
            GitHubDataService::calculate_backoff(10, 1000),
            Duration::from_millis(30_000)
        );
    }

    #[test]
    fn test_is_retryable() {
        assert!(GitHubDataService::is_retryable(&GitHubError::NetworkError(
            "test".to_string()
        )));
        assert!(GitHubDataService::is_retryable(&GitHubError::Timeout));
        assert!(GitHubDataService::is_retryable(&GitHubError::HttpError {
            status: 500,
            message: "test".to_string()
        }));
        assert!(!GitHubDataService::is_retryable(&GitHubError::HttpError {
            status: 404,
            message: "test".to_string()
        }));
        assert!(!GitHubDataService::is_retryable(&GitHubError::ParseError(
            "test".to_string()
        )));
    }
}
