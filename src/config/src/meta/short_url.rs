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

use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

#[derive(Clone, Debug, Default, Deserialize, ToSchema)]
pub struct ShortenUrlRequest {
    pub original_url: String,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize, ToSchema)]
pub struct ShortenUrlResponse {
    pub short_url: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_shorten_url_request_default_empty() {
        let req = ShortenUrlRequest::default();
        assert!(req.original_url.is_empty());
    }

    #[test]
    fn test_shorten_url_response_default_empty() {
        let resp = ShortenUrlResponse::default();
        assert!(resp.short_url.is_empty());
    }

    #[test]
    fn test_shorten_url_request_with_value() {
        let req = ShortenUrlRequest {
            original_url: "https://example.com/very/long/path".to_string(),
        };
        assert_eq!(req.original_url, "https://example.com/very/long/path");
    }

    #[test]
    fn test_shorten_url_response_serde_roundtrip() {
        let resp = ShortenUrlResponse {
            short_url: "https://example.com/abc".to_string(),
        };
        let json = serde_json::to_string(&resp).unwrap();
        let back: ShortenUrlResponse = serde_json::from_str(&json).unwrap();
        assert_eq!(back.short_url, resp.short_url);
    }
}
