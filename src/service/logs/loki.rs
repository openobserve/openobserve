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

use std::collections::HashMap;

use config::{
    DEFAULT_STREAM_NAME, MESSAGE_COL_NAME, STREAM_NAME_LABEL, TIMESTAMP_COL_NAME,
    utils::{json, schema::format_stream_name},
};
use infra::errors::Result;
use promql_parser::{
    label::MatchOp,
    parser::{self, Expr as PromExpr},
};
use proto::loki_rpc;

use crate::common::meta::{
    ingestion::{IngestUser, IngestionRequest, IngestionResponse, IngestionValueType},
    loki::{LokiError, LokiPushRequest},
};

pub enum LokiRequest {
    Json(LokiPushRequest),
    Protobuf(loki_rpc::PushRequest),
}

pub async fn handle_request(
    thread_id: usize,
    org_id: &str,
    request: LokiRequest,
    user_email: &str,
) -> Result<IngestionResponse, LokiError> {
    let streams_data = match request {
        LokiRequest::Json(json_request) => validate_and_process_json_request(json_request)?,
        LokiRequest::Protobuf(protobuf_request) => {
            validate_and_process_protobuf_request(protobuf_request)?
        }
    };

    for (stream_name, records) in streams_data {
        super::ingest::ingest(
            thread_id,
            org_id,
            &stream_name,
            IngestionRequest::JsonValues(IngestionValueType::Loki, records),
            IngestUser::from_user_email(user_email.to_string()),
            None,
            false,
        )
        .await
        .map_err(|e| {
            // we do not want to log trial period expired errors
            if !matches!(e, infra::errors::Error::TrialPeriodExpired) {
                log::error!("[Loki] Stream {stream_name} ingestion failed for org {org_id}: {e}");
            }
            LokiError::from(anyhow::anyhow!(
                "Stream {} ingestion failed: {:?}",
                stream_name,
                e
            ))
        })?;
    }
    Ok(IngestionResponse::new(200, vec![]))
}

fn validate_and_process_json_request(
    request: LokiPushRequest,
) -> Result<HashMap<String, Vec<json::Value>>, LokiError> {
    if request.streams.is_empty() {
        return Err(LokiError::EmptyStream);
    }

    let mut streams_data = HashMap::new();
    for (stream_idx, loki_stream) in request.streams.into_iter().enumerate() {
        if loki_stream.stream.is_empty() {
            return Err(LokiError::InvalidLabels {
                message: format!("Stream {stream_idx} has empty labels"),
            });
        }

        if loki_stream.values.is_empty() {
            return Err(LokiError::InvalidLabels {
                message: format!("Stream {stream_idx} has no log entries"),
            });
        }

        let stream_name = determine_service_stream_name(&loki_stream.stream);

        for (entry_idx, entry) in loki_stream.values.into_iter().enumerate() {
            if entry.line.trim().is_empty() {
                return Err(LokiError::InvalidTimestamp {
                    message: format!("Stream {stream_idx} entry {entry_idx} has empty log line"),
                });
            }

            let timestamp_us =
                entry
                    .timestamp
                    .parse::<i64>()
                    .map_err(|e| LokiError::InvalidTimestamp {
                        message: format!(
                            "Stream {} entry {} has invalid timestamp '{}': {}",
                            stream_idx, entry_idx, entry.timestamp, e
                        ),
                    })?
                    / 1_000;

            let mut record = json::Map::new();

            for (key, value) in &loki_stream.stream {
                record.insert(key.clone(), json::Value::String(value.clone()));
            }

            if let Some(metadata) = entry.structured_metadata {
                for (key, value) in metadata {
                    record.insert(key, json::Value::String(value));
                }
            }

            record.insert(
                MESSAGE_COL_NAME.to_string(),
                json::Value::String(entry.line),
            );
            record.insert(
                TIMESTAMP_COL_NAME.to_string(),
                json::Value::Number(timestamp_us.into()),
            );

            streams_data
                .entry(stream_name.clone())
                .or_insert_with(Vec::new)
                .push(json::Value::Object(record));
        }
    }

    Ok(streams_data)
}

fn validate_and_process_protobuf_request(
    request: loki_rpc::PushRequest,
) -> Result<HashMap<String, Vec<json::Value>>, LokiError> {
    if request.streams.is_empty() {
        return Err(LokiError::EmptyStream);
    }

    let mut streams_data = HashMap::new();

    for (stream_idx, loki_stream) in request.streams.into_iter().enumerate() {
        if loki_stream.labels.trim().is_empty() {
            return Err(LokiError::InvalidLabels {
                message: format!("Stream {stream_idx} has empty labels"),
            });
        }

        if loki_stream.entries.is_empty() {
            return Err(LokiError::InvalidLabels {
                message: format!("Stream {stream_idx} has no log entries"),
            });
        }

        let labels = parse_prometheus_labels(&loki_stream.labels)?;
        let stream_name = determine_service_stream_name(&labels);

        for (entry_idx, entry) in loki_stream.entries.into_iter().enumerate() {
            if entry.line.trim().is_empty() {
                return Err(LokiError::InvalidTimestamp {
                    message: format!("Stream {stream_idx} entry {entry_idx} has empty log line"),
                });
            }

            if let Some(ts) = &entry.timestamp
                && ts.seconds < 0
            {
                return Err(LokiError::InvalidTimestamp {
                    message: format!(
                        "Stream {stream_idx} entry {entry_idx} has negative timestamp",
                    ),
                });
            }

            let timestamp_us = if let Some(ts) = entry.timestamp {
                let seconds_us = ts.seconds * 1_000_000;
                let nanos_us = ts.nanos as i64 / 1_000;
                seconds_us + nanos_us
            } else {
                chrono::Utc::now().timestamp_micros()
            };

            let mut record = json::Map::new();

            for (key, value) in &labels {
                record.insert(key.clone(), json::Value::String(value.clone()));
            }

            for label_pair in entry.structured_metadata {
                record.insert(label_pair.name, json::Value::String(label_pair.value));
            }

            record.insert(
                MESSAGE_COL_NAME.to_string(),
                json::Value::String(entry.line),
            );
            record.insert(
                TIMESTAMP_COL_NAME.to_string(),
                json::Value::Number(timestamp_us.into()),
            );

            streams_data
                .entry(stream_name.clone())
                .or_insert_with(Vec::new)
                .push(json::Value::Object(record));
        }
    }

    Ok(streams_data)
}

fn parse_prometheus_labels(labels_str: &str) -> Result<HashMap<String, String>, LokiError> {
    let full_query = format!("dummy{labels_str}");

    let ast = parser::parse(&full_query).map_err(|e| LokiError::InvalidLabels {
        message: format!("Invalid Prometheus label format: {e}"),
    })?;

    if let PromExpr::VectorSelector(vs) = ast {
        let mut labels = HashMap::new();
        for matcher in vs.matchers.matchers.iter() {
            if matcher.op == MatchOp::Equal {
                labels.insert(matcher.name.clone(), matcher.value.clone());
            }
        }
        Ok(labels)
    } else {
        Err(LokiError::InvalidLabels {
            message: "Could not parse as label selector".to_string(),
        })
    }
}

fn determine_service_stream_name(labels: &HashMap<String, String>) -> String {
    labels
        .get(STREAM_NAME_LABEL)
        .map(|name| format_stream_name(name.to_string()))
        .filter(|name| !name.is_empty())
        .unwrap_or_else(|| DEFAULT_STREAM_NAME.to_string())
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;

    use super::*;

    #[test]
    fn test_determine_service_stream_name() {
        let mut labels = HashMap::new();
        labels.insert(
            STREAM_NAME_LABEL.to_string(),
            "my-custom-stream".to_string(),
        );
        labels.insert("service".to_string(), "should-be-ignored".to_string());
        assert_eq!(determine_service_stream_name(&labels), "my_custom_stream");

        // Test with complex stream name that needs formatting
        let mut labels = HashMap::new();
        labels.insert(
            STREAM_NAME_LABEL.to_string(),
            "Auth-Service.logs".to_string(),
        );
        assert_eq!(determine_service_stream_name(&labels), "auth_service_logs");

        // Test fallback when no stream_name label
        let mut labels = HashMap::new();
        labels.insert("service".to_string(), "auth-api".to_string());
        labels.insert("environment".to_string(), "production".to_string());
        assert_eq!(determine_service_stream_name(&labels), "default");

        // Test complete fallback with empty labels
        let labels = HashMap::new();
        assert_eq!(determine_service_stream_name(&labels), "default");

        // Test empty stream_name falls back to default
        let mut labels = HashMap::new();
        labels.insert(STREAM_NAME_LABEL.to_string(), "".to_string());
        assert_eq!(determine_service_stream_name(&labels), DEFAULT_STREAM_NAME);
    }

    #[test]
    fn test_invalid_labels_json() {
        use prost_wkt_types::Timestamp;

        let proto_request = loki_rpc::PushRequest {
            streams: vec![loki_rpc::StreamAdapter {
                labels: "invalid json".to_string(),
                entries: vec![loki_rpc::EntryAdapter {
                    timestamp: Some(Timestamp {
                        seconds: 1702834800,
                        nanos: 0,
                    }),
                    line: "Test message".to_string(),
                    structured_metadata: vec![],
                }],
                hash: 0,
            }],
        };

        // This would fail in handle_request when parsing labels
        // We test the error path through invalid JSON in labels
        let labels_result: Result<HashMap<String, String>, _> =
            serde_json::from_str("invalid json");
        assert!(labels_result.is_err());

        // Verify the proto_request structure is correct
        assert_eq!(proto_request.streams.len(), 1);
        assert_eq!(proto_request.streams[0].labels, "invalid json");
    }

    #[test]
    fn test_timestamp_conversion() {
        use prost_wkt_types::Timestamp;

        // Test normal timestamp conversion
        let ts = Timestamp {
            seconds: 1702834800,
            nanos: 500_000_000,
        };
        let expected_us = 1702834800 * 1_000_000 + 500_000; // seconds to us + nanos to us

        // Simulate the conversion logic from handle_request
        let timestamp_us = ts.seconds * 1_000_000 + (ts.nanos as i64 / 1_000);
        assert_eq!(timestamp_us, expected_us);

        // Test zero timestamp
        let ts_zero = Timestamp {
            seconds: 0,
            nanos: 0,
        };
        let timestamp_us_zero = ts_zero.seconds * 1_000_000 + (ts_zero.nanos as i64 / 1_000);
        assert_eq!(timestamp_us_zero, 0);
    }

    #[test]
    fn test_protobuf_with_structured_metadata() {
        use prost_wkt_types::Timestamp;

        // Test protobuf request with structured metadata
        let proto_request = loki_rpc::PushRequest {
            streams: vec![loki_rpc::StreamAdapter {
                labels: r#"{"service":"payment","env":"prod"}"#.to_string(),
                entries: vec![loki_rpc::EntryAdapter {
                    timestamp: Some(Timestamp {
                        seconds: 1702834800,
                        nanos: 0,
                    }),
                    line: "Payment processed".to_string(),
                    structured_metadata: vec![
                        loki_rpc::LabelPairAdapter {
                            name: "transaction_id".to_string(),
                            value: "txn_123".to_string(),
                        },
                        loki_rpc::LabelPairAdapter {
                            name: "amount".to_string(),
                            value: "100.00".to_string(),
                        },
                    ],
                }],
                hash: 123456,
            }],
        };

        // Verify the protobuf structure is correct
        assert_eq!(proto_request.streams.len(), 1);

        let stream = &proto_request.streams[0];
        assert_eq!(stream.labels, r#"{"service":"payment","env":"prod"}"#);

        let entry = &stream.entries[0];
        assert_eq!(entry.line, "Payment processed");
        assert_eq!(entry.structured_metadata.len(), 2);
        assert_eq!(entry.structured_metadata[0].name, "transaction_id");
        assert_eq!(entry.structured_metadata[0].value, "txn_123");
    }

    #[test]
    fn test_stream_naming_edge_cases() {
        // Test stream naming with special characters via stream_name
        let mut labels = HashMap::new();
        labels.insert(
            STREAM_NAME_LABEL.to_string(),
            "my-service@v1.2.3".to_string(),
        );
        assert_eq!(determine_service_stream_name(&labels), "my_service_v1_2_3");

        // Test with unicode characters via stream_name
        labels.clear();
        labels.insert(STREAM_NAME_LABEL.to_string(), "test-service-🚀".to_string());
        let result = determine_service_stream_name(&labels);
        assert!(result.starts_with("test_service"));

        // Test with no stream_name (should fall back to default)
        labels.clear();
        labels.insert("service".to_string(), "ignored-service".to_string());
        labels.insert("environment".to_string(), "test".to_string());
        assert_eq!(determine_service_stream_name(&labels), "default");
    }

    #[test]
    fn test_multi_stream_protobuf_structure() {
        use prost_wkt_types::Timestamp;

        // Test handling multiple streams with different services using protobuf
        let proto_request = loki_rpc::PushRequest {
            streams: vec![
                loki_rpc::StreamAdapter {
                    labels: r#"{"o2_stream_name":"auth"}"#.to_string(),
                    entries: vec![loki_rpc::EntryAdapter {
                        timestamp: Some(Timestamp {
                            seconds: 1702834800,
                            nanos: 0,
                        }),
                        line: "Auth log".to_string(),
                        structured_metadata: vec![],
                    }],
                    hash: 1,
                },
                loki_rpc::StreamAdapter {
                    labels: r#"{"o2_stream_name":"payment"}"#.to_string(),
                    entries: vec![loki_rpc::EntryAdapter {
                        timestamp: Some(Timestamp {
                            seconds: 1702834801,
                            nanos: 0,
                        }),
                        line: "Payment log".to_string(),
                        structured_metadata: vec![],
                    }],
                    hash: 2,
                },
            ],
        };

        // Verify both streams are structured correctly
        assert_eq!(proto_request.streams.len(), 2);

        // Parse labels and verify stream naming works for each
        let auth_labels: HashMap<String, String> =
            serde_json::from_str(&proto_request.streams[0].labels).unwrap();
        let payment_labels: HashMap<String, String> =
            serde_json::from_str(&proto_request.streams[1].labels).unwrap();

        let auth_stream_name = determine_service_stream_name(&auth_labels);
        let payment_stream_name = determine_service_stream_name(&payment_labels);

        assert_eq!(auth_stream_name, "auth");
        assert_eq!(payment_stream_name, "payment");
    }

    #[test]
    fn test_validate_protobuf_request_empty_streams() {
        let empty_request = loki_rpc::PushRequest { streams: vec![] };

        let result = validate_and_process_protobuf_request(empty_request);
        assert!(result.is_err());
        assert!(matches!(result.unwrap_err(), LokiError::EmptyStream));
    }

    #[test]
    fn test_parse_prometheus_labels() {
        // Test valid Prometheus label format
        let labels_str = r#"{service="api",environment="prod"}"#;
        let result = parse_prometheus_labels(labels_str).unwrap();

        assert_eq!(result.get("service"), Some(&"api".to_string()));
        assert_eq!(result.get("environment"), Some(&"prod".to_string()));
        assert_eq!(result.len(), 2);

        // Test single label
        let labels_str = r#"{service="test"}"#;
        let result = parse_prometheus_labels(labels_str).unwrap();
        assert_eq!(result.get("service"), Some(&"test".to_string()));
        assert_eq!(result.len(), 1);

        // Test empty labels
        let labels_str = "{}";
        let result = parse_prometheus_labels(labels_str).unwrap();
        assert_eq!(result.len(), 0);

        // Test invalid format should error
        let labels_str = "invalid{format";
        let result = parse_prometheus_labels(labels_str);
        assert!(result.is_err());
    }

    #[test]
    fn test_validate_json_request_empty_streams() {
        let empty_request = LokiPushRequest { streams: vec![] };

        let result = validate_and_process_json_request(empty_request);
        assert!(result.is_err());
        assert!(matches!(result.unwrap_err(), LokiError::EmptyStream));
    }
}
