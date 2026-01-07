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

use axum::{
    Json,
    extract::FromRequestParts,
    http::{StatusCode, header::HeaderMap, request::Parts},
    response::{IntoResponse, Response},
};
use serde::de::DeserializeOwned;

/// Wrapper extractor to deserialize headers into a struct
pub struct Headers<T>(pub T);

/// Rejection type for Headers extractor
pub struct HeadersRejection {
    message: String,
}

impl IntoResponse for HeadersRejection {
    fn into_response(self) -> Response {
        (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({
                "code": 400,
                "message": self.message
            })),
        )
            .into_response()
    }
}

impl<S, T> FromRequestParts<S> for Headers<T>
where
    S: Send + Sync,
    T: DeserializeOwned + Send + Sync + 'static,
{
    type Rejection = HeadersRejection;

    async fn from_request_parts(parts: &mut Parts, _state: &S) -> Result<Self, Self::Rejection> {
        let headers = &parts.headers;

        match deserialize_headers::<T>(headers) {
            Ok(inner) => Ok(Headers(inner)),
            Err(e) => Err(HeadersRejection { message: e }),
        }
    }
}

fn deserialize_headers<T: DeserializeOwned>(headers: &HeaderMap) -> Result<T, String> {
    let iter = headers.iter().filter_map(|(k, v)| {
        v.to_str()
            .ok()
            .map(|s| (k.as_str().to_string(), serde_json::json!(s)))
    });

    let map = serde_json::Map::from_iter(iter);

    let val = serde_json::json!(map);
    serde_json::from_value(val).map_err(|e| format!("Header deserialization error: {e}"))
}

#[cfg(test)]
mod tests {
    use http::header::{HeaderMap, HeaderName, HeaderValue};
    use serde::Deserialize;

    use super::*;

    #[derive(Debug, Deserialize, PartialEq)]
    struct TestHeaders {
        #[serde(rename = "x-api-key")]
        api_key: String,
        #[serde(rename = "user-agent")]
        user_agent: String,
    }

    #[test]
    fn test_deserialize_headers_success() {
        let mut headers = HeaderMap::new();
        headers.insert(
            HeaderName::from_static("x-api-key"),
            HeaderValue::from_static("test-key-123"),
        );
        headers.insert(
            HeaderName::from_static("user-agent"),
            HeaderValue::from_static("Mozilla/5.0"),
        );

        let result: Result<TestHeaders, String> = deserialize_headers(&headers);
        assert!(result.is_ok());
        let test_headers = result.unwrap();
        assert_eq!(test_headers.api_key, "test-key-123");
        assert_eq!(test_headers.user_agent, "Mozilla/5.0");
    }

    #[test]
    fn test_deserialize_headers_missing_field() {
        let mut headers = HeaderMap::new();
        headers.insert(
            HeaderName::from_static("x-api-key"),
            HeaderValue::from_static("test-key-123"),
        );
        // Missing user-agent header

        let result: Result<TestHeaders, String> = deserialize_headers(&headers);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("deserialization error"));
    }

    #[test]
    fn test_deserialize_headers_empty() {
        let headers = HeaderMap::new();

        let result: Result<TestHeaders, String> = deserialize_headers(&headers);
        assert!(result.is_err());
    }

    #[derive(Debug, Deserialize, PartialEq)]
    struct OptionalHeaders {
        #[serde(rename = "x-api-key")]
        api_key: Option<String>,
        #[serde(rename = "user-agent")]
        user_agent: Option<String>,
    }

    #[test]
    fn test_deserialize_headers_optional_fields() {
        let mut headers = HeaderMap::new();
        headers.insert(
            HeaderName::from_static("x-api-key"),
            HeaderValue::from_static("test-key-123"),
        );

        let result: Result<OptionalHeaders, String> = deserialize_headers(&headers);
        assert!(result.is_ok());
        let test_headers = result.unwrap();
        assert_eq!(test_headers.api_key, Some("test-key-123".to_string()));
        assert_eq!(test_headers.user_agent, None);
    }

    #[test]
    fn test_deserialize_headers_special_characters() {
        #[derive(Debug, Deserialize, PartialEq)]
        struct SpecialHeaders {
            #[serde(rename = "x-custom-header")]
            custom: String,
        }

        let mut headers = HeaderMap::new();
        headers.insert(
            HeaderName::from_static("x-custom-header"),
            HeaderValue::from_static("value-with-dashes"),
        );

        let result: Result<SpecialHeaders, String> = deserialize_headers(&headers);
        assert!(result.is_ok());
        let special_headers = result.unwrap();
        assert_eq!(special_headers.custom, "value-with-dashes");
    }

    #[test]
    fn test_deserialize_headers_multiple_values() {
        #[derive(Debug, Deserialize, PartialEq)]
        struct MultiHeaders {
            authorization: String,
            #[serde(rename = "content-type")]
            content_type: String,
            accept: String,
        }

        let mut headers = HeaderMap::new();
        headers.insert(
            HeaderName::from_static("authorization"),
            HeaderValue::from_static("Bearer token123"),
        );
        headers.insert(
            HeaderName::from_static("content-type"),
            HeaderValue::from_static("application/json"),
        );
        headers.insert(
            HeaderName::from_static("accept"),
            HeaderValue::from_static("*/*"),
        );

        let result: Result<MultiHeaders, String> = deserialize_headers(&headers);
        assert!(result.is_ok());
        let multi_headers = result.unwrap();
        assert_eq!(multi_headers.authorization, "Bearer token123");
        assert_eq!(multi_headers.content_type, "application/json");
        assert_eq!(multi_headers.accept, "*/*");
    }
}
