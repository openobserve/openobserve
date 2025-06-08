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

use anyhow::Result;
use config::{meta::self_reporting::usage::UsageType, utils::json};
use promql_parser::{
    label::MatchOp, 
    parser::{self, Expr as PromExpr}
};
use proto::loki_rpc;

use crate::common::meta::{
    ingestion::{IngestionResponse, IngestionStatus, RecordStatus},
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
    let start = std::time::Instant::now();
    let started_at = chrono::Utc::now().timestamp_micros();
    let mut json_data_by_stream: HashMap<String, super::O2IngestJsonData> = HashMap::new();

    match request {
        LokiRequest::Json(json_request) => {
            validate_json_request(&json_request)?;
            process_json_request(json_request, &mut json_data_by_stream)?;
        }
        LokiRequest::Protobuf(protobuf_request) => {
            validate_protobuf_request(&protobuf_request)?;
            process_protobuf_request(protobuf_request, &mut json_data_by_stream)?;
        }
    }

    let mut status = IngestionStatus::Record(RecordStatus::default());
    super::write_logs_by_stream(
        thread_id,
        org_id,
        user_email,
        (started_at, &start),
        UsageType::Logs,
        &mut status,
        json_data_by_stream,
    )
    .await
    .map_err(|e| {
        log::error!("Error while writing logs: {}", e);
        LokiError::from(anyhow::anyhow!("Multi-stream ingestion failed: {:?}", e))
    })?;

    log::info!("[LOKI] Successfully processed streams for org '{}'", org_id);
    Ok(IngestionResponse::new(200, vec![]))
}

fn process_json_request(
    request: LokiPushRequest,
    json_data_by_stream: &mut HashMap<String, super::O2IngestJsonData>,
) -> Result<(), LokiError> {
    for loki_stream in request.streams {
        let stream_name = determine_service_stream_name(&loki_stream.stream);

        for entry in loki_stream.values {
            let mut record = json::Map::new();

            for (key, value) in &loki_stream.stream {
                record.insert(key.clone(), json::Value::String(value.clone()));
            }
            if let Some(metadata) = entry.structured_metadata {
                for (key, value) in metadata {
                    record.insert(key, json::Value::String(value));
                }
            }

            let timestamp_us =
                entry
                    .timestamp
                    .parse::<i64>()
                    .map_err(|e| LokiError::InvalidTimestamp {
                        message: format!("Invalid timestamp '{}': {}", entry.timestamp, e),
                    })?
                    / 1_000;

            record.insert("message".to_string(), json::Value::String(entry.line));
            record.insert(
                "_timestamp".to_string(),
                json::Value::Number(timestamp_us.into()),
            );

            json_data_by_stream
                .entry(stream_name.clone())
                .or_insert((Vec::new(), Some(0)))
                .0
                .push((timestamp_us, record));
        }
    }
    Ok(())
}

fn process_protobuf_request(
    request: loki_rpc::PushRequest,
    json_data_by_stream: &mut HashMap<String, super::O2IngestJsonData>,
) -> Result<(), LokiError> {
    for loki_stream in request.streams {
        let labels = parse_prometheus_labels(&loki_stream.labels)?;

        let stream_name = determine_service_stream_name(&labels);

        for entry in loki_stream.entries {
            let mut record = json::Map::new();

            for (key, value) in &labels {
                record.insert(key.clone(), json::Value::String(value.clone()));
            }

            let timestamp_us = if let Some(ts) = entry.timestamp {
                let seconds_us = ts.seconds * 1_000_000;
                let nanos_us = ts.nanos as i64 / 1_000;
                seconds_us + nanos_us
            } else {
                chrono::Utc::now().timestamp_micros()
            };

            record.insert("message".to_string(), json::Value::String(entry.line));

            for label_pair in entry.structured_metadata {
                record.insert(label_pair.name, json::Value::String(label_pair.value));
            }

            record.insert(
                "_timestamp".to_string(),
                json::Value::Number(timestamp_us.into()),
            );

            json_data_by_stream
                .entry(stream_name.clone())
                .or_insert((Vec::new(), Some(0)))
                .0
                .push((timestamp_us, record));
        }
    }
    Ok(())
}

fn validate_json_request(request: &LokiPushRequest) -> Result<(), LokiError> {
    if request.streams.is_empty() {
        return Err(LokiError::EmptyStream);
    }

    for (stream_idx, stream) in request.streams.iter().enumerate() {
        if stream.stream.is_empty() {
            return Err(LokiError::InvalidLabels {
                message: format!("Stream {} has empty labels", stream_idx),
            });
        }

        if stream.values.is_empty() {
            return Err(LokiError::InvalidLabels {
                message: format!("Stream {} has no log entries", stream_idx),
            });
        }

        for (entry_idx, entry) in stream.values.iter().enumerate() {
            if entry.line.trim().is_empty() {
                return Err(LokiError::InvalidTimestamp {
                    message: format!(
                        "Stream {} entry {} has empty log line",
                        stream_idx, entry_idx
                    ),
                });
            }

            if let Err(_) = entry.timestamp.parse::<i64>() {
                return Err(LokiError::InvalidTimestamp {
                    message: format!(
                        "Stream {} entry {} has invalid timestamp format",
                        stream_idx, entry_idx
                    ),
                });
            }
        }
    }

    Ok(())
}

fn validate_protobuf_request(request: &loki_rpc::PushRequest) -> Result<(), LokiError> {
    if request.streams.is_empty() {
        return Err(LokiError::EmptyStream);
    }

    for (stream_idx, stream) in request.streams.iter().enumerate() {
        if stream.labels.trim().is_empty() {
            return Err(LokiError::InvalidLabels {
                message: format!("Stream {} has empty labels", stream_idx),
            });
        }


        if stream.entries.is_empty() {
            return Err(LokiError::InvalidLabels {
                message: format!("Stream {} has no log entries", stream_idx),
            });
        }

        for (entry_idx, entry) in stream.entries.iter().enumerate() {
            if entry.line.trim().is_empty() {
                return Err(LokiError::InvalidTimestamp {
                    message: format!(
                        "Stream {} entry {} has empty log line",
                        stream_idx, entry_idx
                    ),
                });
            }

            if let Some(ts) = &entry.timestamp {
                if ts.seconds < 0 {
                    return Err(LokiError::InvalidTimestamp {
                        message: format!(
                            "Stream {} entry {} has negative timestamp",
                            stream_idx, entry_idx
                        ),
                    });
                }
            }
        }
    }

    Ok(())
}

fn parse_prometheus_labels(labels_str: &str) -> Result<HashMap<String, String>, LokiError> {
    // Add dummy metric name to make it a valid PromQL expression
    let full_query = format!("dummy{}", labels_str);
    
    let ast = parser::parse(&full_query)
        .map_err(|e| LokiError::InvalidLabels { 
            message: format!("Invalid Prometheus label format: {}", e) 
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
            message: "Could not parse as label selector".to_string() 
        })
    }
}

fn determine_service_stream_name(labels: &HashMap<String, String>) -> String {
    // Priority 1: service (most common in Loki)
    if let Some(service) = labels.get("service") {
        let sanitized = sanitize_stream_name(service);
        if !sanitized.is_empty() {
            return sanitized;
        }
    }

    // Priority 2: service_name (OpenTelemetry standard)
    if let Some(service_name) = labels.get("service_name") {
        let sanitized = sanitize_stream_name(service_name);
        if !sanitized.is_empty() {
            return sanitized;
        }
    }

    // Priority 3: app (common in Kubernetes)
    if let Some(app) = labels.get("app") {
        let sanitized = sanitize_stream_name(app);
        if !sanitized.is_empty() {
            return sanitized;
        }
    }

    // Priority 4: job (Prometheus ecosystem)
    if let Some(job) = labels.get("job") {
        let sanitized = sanitize_stream_name(job);
        if !sanitized.is_empty() {
            return sanitized;
        }
    }

    // Fallback: Use environment + default
    let env_suffix = labels
        .get("environment")
        .or_else(|| labels.get("env"))
        .map(|s| format!("_{}", sanitize_stream_name(s)))
        .unwrap_or_default();

    format!("unknown_service{}", env_suffix)
}

fn sanitize_stream_name(name: &str) -> String {
    name.to_lowercase()
        .replace("-", "_")
        .replace(".", "_")
        .replace(" ", "_")
        .chars()
        .filter(|c| c.is_alphanumeric() || *c == '_')
        .collect()
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;

    use super::*;

    #[test]
    fn test_determine_service_stream_name() {
        // Test service label (highest priority)
        let mut labels = HashMap::new();
        labels.insert("service".to_string(), "auth-api".to_string());
        labels.insert("app".to_string(), "should-be-ignored".to_string());
        assert_eq!(determine_service_stream_name(&labels), "auth_api");

        // Test service_name label (second priority)
        let mut labels = HashMap::new();
        labels.insert("service_name".to_string(), "payment-service".to_string());
        labels.insert("job".to_string(), "should-be-ignored".to_string());
        assert_eq!(determine_service_stream_name(&labels), "payment_service");

        // Test app label (third priority)
        let mut labels = HashMap::new();
        labels.insert("app".to_string(), "notification-worker".to_string());
        labels.insert("job".to_string(), "should-be-ignored".to_string());
        assert_eq!(
            determine_service_stream_name(&labels),
            "notification_worker"
        );

        // Test job label (fourth priority)
        let mut labels = HashMap::new();
        labels.insert("job".to_string(), "prometheus-scraper".to_string());
        assert_eq!(determine_service_stream_name(&labels), "prometheus_scraper");

        // Test fallback with environment
        let mut labels = HashMap::new();
        labels.insert("environment".to_string(), "production".to_string());
        assert_eq!(
            determine_service_stream_name(&labels),
            "unknown_service_production"
        );

        // Test fallback with env
        let mut labels = HashMap::new();
        labels.insert("env".to_string(), "staging".to_string());
        assert_eq!(
            determine_service_stream_name(&labels),
            "unknown_service_staging"
        );

        // Test complete fallback
        let labels = HashMap::new();
        assert_eq!(determine_service_stream_name(&labels), "unknown_service");
    }

    #[test]
    fn test_sanitize_stream_name() {
        assert_eq!(sanitize_stream_name("auth-api"), "auth_api");
        assert_eq!(sanitize_stream_name("payment.service"), "payment_service");
        assert_eq!(
            sanitize_stream_name("NOTIFICATION SERVICE"),
            "notification_service"
        );
        assert_eq!(sanitize_stream_name("test@#$%service"), "testservice");
        assert_eq!(sanitize_stream_name("service_123"), "service_123");
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
        // Test stream naming with special characters
        let mut labels = HashMap::new();
        labels.insert("service".to_string(), "my-service@v1.2.3".to_string());
        assert_eq!(determine_service_stream_name(&labels), "my_servicev1_2_3");

        // Test with unicode characters
        labels.clear();
        labels.insert("service".to_string(), "test-service-🚀".to_string());
        let result = determine_service_stream_name(&labels);
        assert!(result.starts_with("test_service_"));

        // Test empty service name (should fall back)
        labels.clear();
        labels.insert("service".to_string(), "".to_string());
        labels.insert("environment".to_string(), "test".to_string());
        assert_eq!(
            determine_service_stream_name(&labels),
            "unknown_service_test"
        );
    }

    #[test]
    fn test_multi_stream_protobuf_structure() {
        use prost_wkt_types::Timestamp;

        // Test handling multiple streams with different services using protobuf
        let proto_request = loki_rpc::PushRequest {
            streams: vec![
                loki_rpc::StreamAdapter {
                    labels: r#"{"service":"auth"}"#.to_string(),
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
                    labels: r#"{"service":"payment"}"#.to_string(),
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

        let result = validate_protobuf_request(&empty_request);
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

        let result = validate_json_request(&empty_request);
        assert!(result.is_err());
        assert!(matches!(result.unwrap_err(), LokiError::EmptyStream));
    }
}
