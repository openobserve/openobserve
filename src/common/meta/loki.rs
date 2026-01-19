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

use std::collections::HashMap;

use axum::response::IntoResponse;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

/// Internal Loki JSON types for native Loki push API format
/// Loki push request - matches native JSON format exactly
#[derive(Clone, Debug, Serialize, Deserialize, ToSchema)]
pub struct LokiPushRequest {
    /// Array of log streams, each containing labels and log entries
    pub streams: Vec<LokiStream>,
}

/// Loki stream containing labels and log entries
#[derive(Clone, Debug, Serialize, Deserialize, ToSchema)]
pub struct LokiStream {
    /// Stream labels as key-value pairs (e.g., {"service": "api", "stream_name": "logs"})
    pub stream: HashMap<String, String>,
    /// Array of log entries, each containing timestamp, message, and optional structured metadata
    pub values: Vec<LokiEntry>,
}

/// Loki log entry containing timestamp, message, and optional metadata
#[derive(Clone, Debug, Serialize, Deserialize, Default, ToSchema)]
pub struct LokiEntry {
    /// Timestamp as nanosecond unix epoch string (e.g., "1609459200000000000")
    #[serde(alias = "0")]
    pub timestamp: String,
    /// Log message content
    #[serde(alias = "1")]
    pub line: String,
    /// Optional structured metadata as key-value pairs
    #[serde(alias = "2", default, skip_serializing_if = "Option::is_none")]
    pub structured_metadata: Option<HashMap<String, String>>,
}

/// Loki Push Response (for documentation only - actual responses are 204 No Content or plain text)
#[derive(Clone, Debug, Serialize, Deserialize, ToSchema)]
pub struct LokiPushResponse {
    /// Success indicator
    pub success: bool,
}

/// Errors specific to Loki processing
#[derive(Debug, thiserror::Error)]
pub enum LokiError {
    #[error("Invalid timestamp format: {message}")]
    InvalidTimestamp { message: String },

    #[error("Invalid labels format: {message}")]
    InvalidLabels { message: String },

    #[error("Empty stream data")]
    EmptyStream,

    #[error("Unsupported content type: {content_type}")]
    UnsupportedContentType { content_type: String },

    #[error("Unsupported content encoding: {encoding}")]
    UnsupportedContentEncoding { encoding: String },

    #[error("Protobuf decode failed: {source}")]
    ProtobufDecode {
        #[from]
        #[source]
        source: prost::DecodeError,
    },

    #[error("Snappy decompression failed: {source}")]
    SnappyDecompression {
        #[from]
        #[source]
        source: snap::Error,
    },

    #[error("JSON parsing failed: {source}")]
    JsonParse {
        #[from]
        #[source]
        source: serde_json::Error,
    },

    #[error("Gzip decompression failed: {source}")]
    GzipDecompression {
        #[from]
        #[source]
        source: std::io::Error,
    },

    #[error("Ingestion failed: {source}")]
    Ingestion {
        #[from]
        #[source]
        source: anyhow::Error,
    },
}

impl IntoResponse for LokiError {
    fn into_response(self) -> axum::response::Response {
        use axum::http::{StatusCode, header};

        if let LokiError::Ingestion { .. } = &self {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                [(header::CONTENT_TYPE, "text/plain")],
                "internal server error during log ingestion",
            )
                .into_response();
        }
        let body = match self {
            LokiError::InvalidTimestamp { message } => format!("invalid timestamp: {message}"),
            LokiError::InvalidLabels { message } => format!("invalid labels: {message}"),
            LokiError::EmptyStream => "empty stream data".to_string(),
            LokiError::UnsupportedContentType { content_type } => {
                format!("unsupported content type: {content_type}")
            }
            LokiError::UnsupportedContentEncoding { encoding } => {
                format!("unsupported content encoding: {encoding}")
            }
            LokiError::ProtobufDecode { source } => {
                format!("failed to decode protobuf: {source}")
            }
            LokiError::SnappyDecompression { source } => {
                format!("failed to decompress snappy: {source}")
            }
            LokiError::JsonParse { source } => format!("failed to parse JSON: {source}"),
            LokiError::GzipDecompression { source } => {
                format!("failed to decompress gzip: {source}")
            }
            LokiError::Ingestion { .. } => unreachable!("Already tested above"),
        };

        (
            StatusCode::BAD_REQUEST,
            [(header::CONTENT_TYPE, "text/plain")],
            body,
        )
            .into_response()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_loki_push_response_for_documentation() {
        let response = LokiPushResponse { success: true };

        let json = serde_json::to_string(&response).unwrap();
        assert!(json.contains("\"success\":true"));
    }

    #[test]
    fn test_loki_error_conversions() {
        let json_error = serde_json::from_str::<serde_json::Value>("invalid json").unwrap_err();
        let loki_error: LokiError = json_error.into();
        assert!(matches!(loki_error, LokiError::JsonParse { .. }));

        let anyhow_error = anyhow::anyhow!("test error");
        let loki_error: LokiError = anyhow_error.into();
        assert!(matches!(loki_error, LokiError::Ingestion { .. }));
    }

    #[test]
    fn test_error_to_http_response() {
        let error = LokiError::InvalidTimestamp {
            message: "bad timestamp".to_string(),
        };
        let response = error.into_response();
        assert_eq!(response.status(), axum::http::StatusCode::BAD_REQUEST);

        let error = LokiError::EmptyStream;
        let response = error.into_response();
        assert_eq!(response.status(), axum::http::StatusCode::BAD_REQUEST);
    }

    #[test]
    fn test_client_vs_server_errors() {
        let client_errors = vec![
            LokiError::InvalidTimestamp {
                message: "test".to_string(),
            },
            LokiError::InvalidLabels {
                message: "test".to_string(),
            },
            LokiError::EmptyStream,
            LokiError::UnsupportedContentType {
                content_type: "test".to_string(),
            },
        ];

        for error in client_errors {
            let response = error.into_response();
            assert_eq!(response.status(), axum::http::StatusCode::BAD_REQUEST);
        }

        let server_error = LokiError::Ingestion {
            source: anyhow::anyhow!("internal error"),
        };
        let response = server_error.into_response();
        assert_eq!(
            response.status(),
            axum::http::StatusCode::INTERNAL_SERVER_ERROR
        );
    }

    #[test]
    fn test_protobuf_decode_error() {
        let decode_error = prost::DecodeError::new("test decode error");
        let loki_error: LokiError = decode_error.into();
        assert!(matches!(loki_error, LokiError::ProtobufDecode { .. }));

        let response = loki_error.into_response();
        assert_eq!(response.status(), axum::http::StatusCode::BAD_REQUEST);
    }

    #[test]
    fn test_loki_entry_deserialize_array_formats() {
        // Test 2-element array
        let entry: LokiEntry =
            serde_json::from_str(r#"["1609459200000000000", "test message"]"#).unwrap();
        assert_eq!(entry.timestamp, "1609459200000000000");
        assert_eq!(entry.line, "test message");
        assert!(entry.structured_metadata.is_none());

        // Test 3-element array with metadata
        let entry: LokiEntry =
            serde_json::from_str(r#"["1609459200000000000", "test message", {"trace": "123"}]"#)
                .unwrap();
        assert_eq!(entry.timestamp, "1609459200000000000");
        assert_eq!(entry.line, "test message");
        assert_eq!(
            entry.structured_metadata.unwrap().get("trace"),
            Some(&"123".to_string())
        );
    }

    #[test]
    fn test_loki_push_request_deserialize() {
        let json = r#"{"streams":[{"stream":{"service":"test"},"values":[["1609459200000000000","log message",{"trace":"123"}]]}]}"#;
        let request: LokiPushRequest = serde_json::from_str(json).unwrap();
        assert_eq!(request.streams.len(), 1);
        assert_eq!(request.streams[0].values[0].line, "log message");
        assert!(request.streams[0].values[0].structured_metadata.is_some());
    }

    #[test]
    fn test_loki_stream_structure() {
        let mut labels = HashMap::new();
        labels.insert("service".to_string(), "api".to_string());

        let entry = LokiEntry {
            timestamp: "123".to_string(),
            line: "log".to_string(),
            structured_metadata: None,
        };

        let stream = LokiStream {
            stream: labels.clone(),
            values: vec![entry],
        };

        assert_eq!(stream.stream, labels);
        assert_eq!(stream.values.len(), 1);
    }
}
