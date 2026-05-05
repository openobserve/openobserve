// Copyright 2026 OpenObserve Inc.
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

use serde::{Deserialize, Serialize};

/// Configuration for GitHub Data Service
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GitHubServiceConfig {
    /// Base timeout for HTTP requests (default: 30 seconds)
    pub timeout: Duration,
    /// Number of retry attempts (default: 3)
    pub retry_attempts: u32,
    /// Delay between retries in milliseconds (default: 1000ms)
    pub retry_delay_ms: u64,
    /// Default TTL for cached data in seconds (default: 3600 = 1 hour)
    pub default_ttl_secs: u64,
    /// Maximum cache size in bytes (default: 100MB)
    pub max_cache_size: usize,
}

impl Default for GitHubServiceConfig {
    fn default() -> Self {
        Self {
            timeout: Duration::from_secs(30),
            retry_attempts: 3,
            retry_delay_ms: 1000,
            default_ttl_secs: 3600,
            max_cache_size: 100_000_000, // 100MB
        }
    }
}

/// Errors that can occur when using the GitHub Data Service
#[derive(Debug, thiserror::Error)]
pub enum GitHubError {
    #[error("Network error: {0}")]
    NetworkError(String),

    #[error("Rate limit exceeded, resets at: {reset_at}")]
    RateLimitExceeded { reset_at: i64 },

    #[error("Invalid response: {0}")]
    InvalidResponse(String),

    #[error("Parse error: {0}")]
    ParseError(String),

    #[error("Cache error: {0}")]
    CacheError(String),

    #[error("Request timeout")]
    Timeout,

    #[error("HTTP error {status}: {message}")]
    HttpError { status: u16, message: String },

    #[error("Internal error: {0}")]
    Internal(String),
}

impl From<reqwest::Error> for GitHubError {
    fn from(err: reqwest::Error) -> Self {
        if err.is_timeout() {
            GitHubError::Timeout
        } else if err.is_connect() {
            GitHubError::NetworkError(err.to_string())
        } else if let Some(status) = err.status() {
            GitHubError::HttpError {
                status: status.as_u16(),
                message: err.to_string(),
            }
        } else {
            GitHubError::Internal(err.to_string())
        }
    }
}

impl From<serde_json::Error> for GitHubError {
    fn from(err: serde_json::Error) -> Self {
        GitHubError::ParseError(err.to_string())
    }
}

/// Cached data with metadata
#[derive(Debug, Clone)]
pub struct CachedData {
    pub data: bytes::Bytes,
    pub fetched_at: i64,
    pub ttl_secs: u64,
}

impl CachedData {
    pub fn new(data: bytes::Bytes, ttl_secs: u64) -> Self {
        Self {
            data,
            fetched_at: chrono::Utc::now().timestamp(),
            ttl_secs,
        }
    }

    pub fn is_expired(&self) -> bool {
        let now = chrono::Utc::now().timestamp();
        now - self.fetched_at > self.ttl_secs as i64
    }
}

#[cfg(test)]
mod tests {
    use std::time::Duration;

    use super::*;

    #[test]
    fn test_github_service_config_default_values() {
        let cfg = GitHubServiceConfig::default();
        assert_eq!(cfg.timeout, Duration::from_secs(30));
        assert_eq!(cfg.retry_attempts, 3);
        assert_eq!(cfg.retry_delay_ms, 1000);
        assert_eq!(cfg.default_ttl_secs, 3600);
        assert_eq!(cfg.max_cache_size, 100_000_000);
    }

    #[test]
    fn test_github_error_display_network() {
        let e = GitHubError::NetworkError("connection refused".to_string());
        assert_eq!(e.to_string(), "Network error: connection refused");
    }

    #[test]
    fn test_github_error_display_rate_limit() {
        let e = GitHubError::RateLimitExceeded {
            reset_at: 1700000000,
        };
        assert!(e.to_string().contains("1700000000"));
    }

    #[test]
    fn test_github_error_display_http_error() {
        let e = GitHubError::HttpError {
            status: 404,
            message: "not found".to_string(),
        };
        assert_eq!(e.to_string(), "HTTP error 404: not found");
    }

    #[test]
    fn test_github_error_display_timeout() {
        let e = GitHubError::Timeout;
        assert_eq!(e.to_string(), "Request timeout");
    }

    #[test]
    fn test_from_serde_json_error() {
        let json_err = serde_json::from_str::<serde_json::Value>("invalid json").unwrap_err();
        let gh_err = GitHubError::from(json_err);
        assert!(matches!(gh_err, GitHubError::ParseError(_)));
    }

    #[test]
    fn test_cached_data_not_expired_when_fresh() {
        let data = CachedData::new(bytes::Bytes::from("hello"), 3600);
        assert!(!data.is_expired());
    }

    #[test]
    fn test_cached_data_expired_with_old_timestamp() {
        let data = CachedData {
            data: bytes::Bytes::from("hello"),
            fetched_at: 0, // Unix epoch — definitely expired
            ttl_secs: 60,
        };
        assert!(data.is_expired());
    }

    #[test]
    fn test_cached_data_not_expired_before_ttl() {
        let now = chrono::Utc::now().timestamp();
        let data = CachedData {
            data: bytes::Bytes::from("hello"),
            fetched_at: now - 30, // 30 seconds ago
            ttl_secs: 60,         // 60s TTL
        };
        assert!(!data.is_expired());
    }
}
