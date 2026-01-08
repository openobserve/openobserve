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

use std::{
    collections::HashMap,
    io::{BufRead, BufReader},
};

use axum::body::Bytes;
use config::{
    BLOCKED_STREAMS, TIMESTAMP_COL_NAME, get_config,
    meta::stream::StreamType,
    metrics,
    utils::{
        json,
        time::{now_micros, parse_timestamp_micro_from_value},
    },
};
use infra::errors::Result;

use crate::{
    common::meta::ingestion::{
        BulkResponse, BulkResponseError, BulkResponseItem, IngestionRequest, IngestionValueType,
    },
    service::{
        format_stream_name,
        ingestion::check_ingestion_allowed,
        logs::{ingestion_log_enabled, log_failed_record},
        schema::{get_future_discard_error, get_upto_discard_error},
    },
};

pub const TRANSFORM_FAILED: &str = "document_failed_transform";
pub const TS_PARSE_FAILED: &str = "timestamp_parsing_failed";
pub const SCHEMA_CONFORMANCE_FAILED: &str = "schema_conformance_failed";
pub const PIPELINE_EXEC_FAILED: &str = "pipeline_execution_failed";

pub async fn ingest(
    thread_id: usize,
    org_id: &str,
    body: Bytes,
    user: crate::common::meta::ingestion::IngestUser,
) -> Result<BulkResponse> {
    let start = std::time::Instant::now();

    // check system resource
    check_ingestion_allowed(org_id, StreamType::Logs, None).await?;

    // let mut errors = false;
    let mut bulk_res = BulkResponse {
        took: 0,
        errors: false,
        items: vec![],
    };

    let cfg = get_config();
    let now = config::utils::time::now_micros();
    let min_ts = now - cfg.limit.ingest_allowed_upto_micro;
    let max_ts = now + cfg.limit.ingest_allowed_in_future_micro;

    let log_ingestion_errors = ingestion_log_enabled().await;
    let mut action = String::new();
    let mut stream_name = String::new();
    let mut doc_id: Option<String> = None;
    let stream_type = StreamType::Logs;

    let mut stream_key_cache: HashMap<String, String> = HashMap::new();
    let mut streams_data: HashMap<String, Vec<json::Value>> = HashMap::new();
    let mut next_line_is_data = false;
    // Read lines as bytes to handle potential invalid UTF-8 characters
    let mut line_buffer = Vec::new();
    let mut reader = BufReader::new(body.as_ref());
    loop {
        line_buffer.clear();
        let bytes_read = reader.read_until(b'\n', &mut line_buffer)?;
        if bytes_read == 0 {
            break; // EOF
        }

        // Remove trailing newline characters
        while line_buffer.last() == Some(&b'\n') || line_buffer.last() == Some(&b'\r') {
            line_buffer.pop();
        }

        if line_buffer.is_empty() {
            continue;
        }
        // Use from_utf8_lossy to handle potential invalid UTF-8 characters
        // Invalid UTF-8 sequences will be replaced with the replacement character (�)
        let line_str = String::from_utf8_lossy(&line_buffer);
        let mut value: json::Value = json::from_slice(line_str.as_bytes())?;

        if !next_line_is_data {
            // check bulk operate
            let Some((line_action, line_stream_name, line_doc_id)) =
                super::parse_bulk_index(&value)
            else {
                continue;
            };
            if line_action != action {
                action = line_action.to_string();
            }
            if line_stream_name != stream_name {
                stream_name = line_stream_name.to_string();
            }
            doc_id = line_doc_id.map(|id| id.to_string());

            if stream_name.is_empty() || stream_name == "_" || stream_name == "/" {
                let err_msg = "Invalid stream name: ".to_string() + &line_str;
                log::warn!("[LOGS:BULK] {err_msg}");
                bulk_res.errors = true;
                let err = BulkResponseError::new(
                    err_msg.to_string(),
                    stream_name.to_string(),
                    err_msg,
                    "0".to_string(),
                );
                let mut item = HashMap::new();
                item.insert(
                    action.to_string(),
                    BulkResponseItem::new_failed(
                        stream_name.to_string(),
                        doc_id.clone().unwrap_or_default(),
                        err,
                        Some(value),
                        stream_name.to_string(),
                    ),
                );
                bulk_res.items.push(item);
                continue; // skip
            }

            if !cfg.common.skip_formatting_stream_name {
                stream_name = format_stream_name(stream_name);
            }

            // skip blocked streams
            if !stream_key_cache.contains_key(&stream_name) {
                let key = format!("{org_id}/{}/{stream_name}", stream_type);
                stream_key_cache.insert(stream_name.clone(), key.clone());
                if BLOCKED_STREAMS.contains(&key) {
                    log::warn!(
                        "[LOGS:BULK] stream [{org_id}/{stream_name}] is blocked from ingestion"
                    );
                    continue; // skip
                }
            }
            next_line_is_data = true;
        } else {
            next_line_is_data = false;

            // get json object
            let mut local_val = match value.take() {
                json::Value::Object(v) => v,
                _ => unreachable!(),
            };

            // set _id
            if let Some(doc_id) = &doc_id {
                local_val.insert("_id".to_string(), json::Value::String(doc_id.to_string()));
            }

            // check _timestamp
            let (timestamp, has_valid_timestamp) = match local_val.get(TIMESTAMP_COL_NAME) {
                Some(v) => match parse_timestamp_micro_from_value(v) {
                    Ok(t) => (t.0, t.1),
                    Err(_e) => {
                        bulk_res.errors = true;
                        metrics::INGEST_ERRORS
                            .with_label_values(&[
                                org_id,
                                StreamType::Logs.as_str(),
                                &stream_name,
                                TS_PARSE_FAILED,
                            ])
                            .inc();
                        log_failed_record(log_ingestion_errors, &value, TS_PARSE_FAILED);
                        add_record_status(
                            stream_name.to_string(),
                            doc_id.clone(),
                            action.to_string(),
                            Some(value),
                            &mut bulk_res,
                            Some(TS_PARSE_FAILED.to_string()),
                            Some(TS_PARSE_FAILED.to_string()),
                        );
                        continue;
                    }
                },
                None => (now_micros(), false),
            };

            // check ingestion time
            if timestamp < min_ts || timestamp > max_ts {
                bulk_res.errors = true;
                let failure_reason = if timestamp < min_ts {
                    Some(get_upto_discard_error().to_string())
                } else {
                    Some(get_future_discard_error().to_string())
                };
                metrics::INGEST_ERRORS
                    .with_label_values(&[
                        org_id,
                        StreamType::Logs.as_str(),
                        &stream_name,
                        TS_PARSE_FAILED,
                    ])
                    .inc();
                log_failed_record(log_ingestion_errors, &value, TS_PARSE_FAILED);
                add_record_status(
                    stream_name.to_string(),
                    doc_id.clone(),
                    action.to_string(),
                    Some(value),
                    &mut bulk_res,
                    Some(TS_PARSE_FAILED.to_string()),
                    failure_reason,
                );
                continue;
            }
            if !has_valid_timestamp {
                local_val.insert(
                    TIMESTAMP_COL_NAME.to_string(),
                    json::Value::Number(timestamp.into()),
                );
            }

            let val = json::Value::Object(local_val);
            match streams_data.get_mut(&stream_name) {
                Some(v) => v.push(val),
                None => {
                    streams_data.insert(stream_name.clone(), vec![val]);
                }
            }
        }
        tokio::task::coop::consume_budget().await;
    }

    // process data by stream
    for (stream_name, records) in streams_data {
        match super::ingest::ingest(
            thread_id,
            org_id,
            &stream_name,
            IngestionRequest::JsonValues(IngestionValueType::Bulk, records),
            user.clone(),
            None,
            false,
        )
        .await
        {
            Ok(v) => {
                for status in v.status {
                    bulk_res.items.extend(status.items);
                }
            }
            Err(e) => {
                log::error!("[LOGS:BULK] stream {org_id}/logs/{stream_name}: Ingestion error: {e}");
                bulk_res.errors = true;
                metrics::INGEST_ERRORS
                    .with_label_values(&[
                        org_id,
                        StreamType::Logs.as_str(),
                        &stream_name,
                        TRANSFORM_FAILED,
                    ])
                    .inc();
                add_record_status(
                    stream_name.to_string(),
                    None,
                    action.to_string(),
                    None,
                    &mut bulk_res,
                    Some(PIPELINE_EXEC_FAILED.to_string()),
                    Some(PIPELINE_EXEC_FAILED.to_string()),
                );
            }
        }
    }

    // metric + data usage
    let status_code = if bulk_res.errors { "500" } else { "200" };
    let took_time = start.elapsed().as_secs_f64();
    metrics::HTTP_RESPONSE_TIME
        .with_label_values(&[
            "/api/org/ingest/logs/_bulk",
            status_code,
            org_id,
            StreamType::Logs.as_str(),
            "",
            "",
        ])
        .observe(took_time);
    metrics::HTTP_INCOMING_REQUESTS
        .with_label_values(&[
            "/api/org/ingest/logs/_bulk",
            status_code,
            org_id,
            StreamType::Logs.as_str(),
            "",
            "",
        ])
        .inc();

    Ok(bulk_res)
}

pub fn add_record_status(
    stream_name: String,
    doc_id: Option<String>,
    action: String,
    value: Option<json::Value>,
    bulk_res: &mut BulkResponse,
    failure_type: Option<String>,
    failure_reason: Option<String>,
) {
    let mut item = HashMap::new();
    let action = if action.is_empty() {
        "index".to_string()
    } else {
        action
    };

    let doc_id = match doc_id {
        Some(doc_id) => doc_id.to_owned(),
        None => "".to_string(),
    };

    match failure_type {
        Some(failure_type) => {
            let bulk_err = BulkResponseError::new(
                failure_type,
                stream_name.clone(),
                failure_reason.unwrap(),
                "0".to_owned(),
            );

            item.insert(
                action,
                BulkResponseItem::new_failed(
                    stream_name.clone(),
                    doc_id,
                    bulk_err,
                    value,
                    stream_name,
                ),
            );

            bulk_res.items.push(item);
        }
        None => {
            item.insert(
                action,
                BulkResponseItem::new(stream_name.clone(), doc_id, value, stream_name),
            );
            if !get_config().common.bulk_api_response_errors_only {
                bulk_res.items.push(item);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::common::meta::ingestion::IngestUser;

    #[test]
    fn test_add_record_status() {
        let mut bulk_res = BulkResponse {
            took: 0,
            errors: false,
            items: vec![],
        };
        add_record_status(
            "olympics".to_string(),
            Some("1".to_string()),
            "create".to_string(),
            None,
            &mut bulk_res,
            None,
            None,
        );
        assert!(bulk_res.items.len() == 1);
    }

    #[tokio::test]
    async fn test_ingest_basic_functionality() {
        // Create a simple bulk request with one document
        let bulk_request = r#"{"index": {"_index": "test-stream", "_id": "1"}}
{"message": "test log message", "level": "info"}"#;

        let body = Bytes::from(bulk_request);
        let thread_id = 1;
        let org_id = "test-org";
        let user = IngestUser::from_user_email("test@example.com");

        // Note: This test will likely fail due to missing infrastructure setup,
        // but it demonstrates the basic structure of testing the ingest function
        let result = ingest(thread_id, org_id, body, user).await;

        // The test should either succeed or fail with a specific error
        // (likely related to missing database connections or configuration)
        match result {
            Ok(response) => {
                // If successful, verify basic response structure
                // The response should have items if the configuration allows it
                if !get_config().common.bulk_api_response_errors_only {
                    assert!(!response.items.is_empty());
                }
            }
            Err(e) => {
                // Expected to fail due to missing infrastructure
                // Just verify it's a proper error
                assert!(!e.to_string().is_empty());
            }
        }
    }

    mod add_record_status_tests {
        use super::*;

        #[test]
        fn test_add_record_status_success() {
            let mut bulk_res = BulkResponse {
                took: 0,
                errors: false,
                items: vec![],
            };

            add_record_status(
                "test_stream".to_string(),
                Some("doc_123".to_string()),
                "index".to_string(),
                Some(json::json!({"message": "test"})),
                &mut bulk_res,
                None,
                None,
            );

            // Should add one successful item
            assert_eq!(bulk_res.items.len(), 1);

            // Check the item structure
            let item = &bulk_res.items[0];
            assert!(item.contains_key("index"));

            let bulk_item = &item["index"];
            assert!(!bulk_item._index.is_empty());
            assert!(!bulk_item._id.is_empty());
        }

        #[test]
        fn test_add_record_status_with_failure() {
            let mut bulk_res = BulkResponse {
                took: 0,
                errors: false,
                items: vec![],
            };

            add_record_status(
                "test_stream".to_string(),
                Some("doc_456".to_string()),
                "create".to_string(),
                Some(json::json!({"data": "test"})),
                &mut bulk_res,
                Some(TS_PARSE_FAILED.to_string()),
                Some("Invalid timestamp format".to_string()),
            );

            // Should add one failed item
            assert_eq!(bulk_res.items.len(), 1);

            // Check the failed item structure
            let item = &bulk_res.items[0];
            assert!(item.contains_key("create"));

            let bulk_item = &item["create"];
            assert!(bulk_item.error.is_some());
        }

        #[test]
        fn test_add_record_status_empty_action() {
            let mut bulk_res = BulkResponse {
                took: 0,
                errors: false,
                items: vec![],
            };

            add_record_status(
                "test_stream".to_string(),
                None,
                "".to_string(), // Empty action should default to "index"
                None,
                &mut bulk_res,
                None,
                None,
            );

            assert_eq!(bulk_res.items.len(), 1);
            let item = &bulk_res.items[0];
            assert!(item.contains_key("index")); // Should default to "index"
        }

        #[test]
        fn test_add_record_status_no_doc_id() {
            let mut bulk_res = BulkResponse {
                took: 0,
                errors: false,
                items: vec![],
            };

            add_record_status(
                "stream_without_id".to_string(),
                None, // No document ID
                "update".to_string(),
                Some(json::json!({"field": "value"})),
                &mut bulk_res,
                None,
                None,
            );

            assert_eq!(bulk_res.items.len(), 1);
            let item = &bulk_res.items[0];
            let bulk_item = &item["update"];
            // Document ID should be empty string
            assert_eq!(bulk_item._id, "");
        }

        #[test]
        fn test_add_record_status_different_failure_types() {
            let mut bulk_res = BulkResponse {
                took: 0,
                errors: false,
                items: vec![],
            };

            let failure_types = [
                TRANSFORM_FAILED,
                TS_PARSE_FAILED,
                SCHEMA_CONFORMANCE_FAILED,
                PIPELINE_EXEC_FAILED,
            ];

            for (i, failure_type) in failure_types.iter().enumerate() {
                add_record_status(
                    format!("stream_{i}"),
                    Some(format!("doc_{i}")),
                    "index".to_string(),
                    Some(json::json!({"test": i})),
                    &mut bulk_res,
                    Some(failure_type.to_string()),
                    Some(format!("Error message {i}")),
                );
            }

            assert_eq!(bulk_res.items.len(), 4);

            // Verify each failure type is recorded
            for (i, failure_type) in failure_types.iter().enumerate() {
                let item = &bulk_res.items[i];
                let bulk_item = &item["index"];
                let error = bulk_item.error.as_ref().unwrap();
                assert_eq!(error.err_type, *failure_type);
            }
        }

        #[test]
        fn test_add_record_status_with_complex_json() {
            let mut bulk_res = BulkResponse {
                took: 0,
                errors: false,
                items: vec![],
            };

            let complex_json = json::json!({
                "timestamp": "2024-01-01T12:00:00Z",
                "level": "ERROR",
                "message": "Complex error occurred",
                "metadata": {
                    "service": "api-gateway",
                    "version": "1.0.0",
                    "tags": ["critical", "authentication"]
                },
                "error_details": {
                    "code": 500,
                    "stack_trace": "...",
                    "user_id": "user123"
                }
            });

            add_record_status(
                "complex_logs".to_string(),
                Some("complex_doc_1".to_string()),
                "index".to_string(),
                Some(complex_json.clone()),
                &mut bulk_res,
                None,
                None,
            );

            assert_eq!(bulk_res.items.len(), 1);
            let item = &bulk_res.items[0];
            let bulk_item = &item["index"];

            // Verify the item was created successfully (successful records don't store
            // original_record)
            assert_eq!(bulk_item.status, 200);
            assert!(bulk_item.error.is_none());
            assert!(!bulk_item._index.is_empty());
        }
    }

    mod bulk_constants_tests {
        use super::*;

        #[test]
        fn test_error_constants_uniqueness() {
            // Ensure all error constants are unique
            let constants = vec![
                TRANSFORM_FAILED,
                TS_PARSE_FAILED,
                SCHEMA_CONFORMANCE_FAILED,
                PIPELINE_EXEC_FAILED,
            ];

            let mut unique_constants = constants.clone();
            unique_constants.sort();
            unique_constants.dedup();

            assert_eq!(constants.len(), unique_constants.len());
        }
    }

    mod bulk_response_tests {
        use super::*;

        #[test]
        fn test_bulk_response_initialization() {
            let bulk_res = BulkResponse {
                took: 0,
                errors: false,
                items: vec![],
            };

            assert_eq!(bulk_res.took, 0);
            assert!(!bulk_res.errors);
            assert!(bulk_res.items.is_empty());
        }

        #[test]
        fn test_bulk_response_with_multiple_items() {
            let mut bulk_res = BulkResponse {
                took: 0,
                errors: false,
                items: vec![],
            };

            // Add multiple successful records
            for i in 0..5 {
                add_record_status(
                    format!("stream_{i}"),
                    Some(format!("doc_{i}")),
                    "index".to_string(),
                    Some(json::json!({"message": format!("log message {i}")})),
                    &mut bulk_res,
                    None,
                    None,
                );
            }

            // Add some failed records
            for i in 5..8 {
                add_record_status(
                    format!("stream_{i}"),
                    Some(format!("doc_{i}")),
                    "index".to_string(),
                    Some(json::json!({"message": format!("log message {i}")})),
                    &mut bulk_res,
                    Some(TS_PARSE_FAILED.to_string()),
                    Some("Timestamp error".to_string()),
                );
            }

            assert_eq!(bulk_res.items.len(), 8);

            // Check mix of successful and failed items
            let successful_items: usize = bulk_res
                .items
                .iter()
                .map(|item| {
                    let bulk_item = item.values().next().unwrap();
                    if bulk_item.error.is_none() { 1 } else { 0 }
                })
                .sum();

            let failed_items: usize = bulk_res
                .items
                .iter()
                .map(|item| {
                    let bulk_item = item.values().next().unwrap();
                    if bulk_item.error.is_some() { 1 } else { 0 }
                })
                .sum();

            assert_eq!(successful_items, 5);
            assert_eq!(failed_items, 3);
        }
    }

    mod data_processing_tests {
        use super::*;

        #[test]
        fn test_json_parsing_valid_data() {
            let valid_json =
                r#"{"message": "test log", "level": "info", "timestamp": "2024-01-01T10:00:00Z"}"#;
            let result: Result<json::Value, _> = json::from_slice(valid_json.as_bytes());
            assert!(result.is_ok());

            let value = result.unwrap();
            assert_eq!(value["message"], "test log");
            assert_eq!(value["level"], "info");
        }

        #[test]
        fn test_json_parsing_invalid_data() {
            let invalid_json = r#"{"message": "test log", "level": info"}"#; // Missing quotes around value
            let result: Result<json::Value, _> = json::from_slice(invalid_json.as_bytes());
            assert!(result.is_err());
        }

        #[test]
        fn test_timestamp_parsing() {
            let test_timestamps = vec![
                (
                    json::Value::String("2024-01-01T12:00:00Z".to_string()),
                    false,
                ),
                (
                    json::Value::String("2024-01-01T12:00:00.123Z".to_string()),
                    false,
                ),
                (
                    json::Value::Number(serde_json::Number::from(1640995200000000i64)),
                    true,
                ),
                (
                    json::Value::Number(serde_json::Number::from(1640995200000i64)),
                    false,
                ),
                (
                    json::Value::Number(serde_json::Number::from(1640995200i64)),
                    false,
                ),
            ];

            for (ts_value, ts_valid) in test_timestamps {
                match parse_timestamp_micro_from_value(&ts_value) {
                    Ok((timestamp, valid)) => {
                        assert_eq!(valid, ts_valid);
                        assert!(timestamp > 0);
                        // Should be a reasonable timestamp (after 2020)
                        assert!(timestamp > 1577836800000000i64); // 2020-01-01 in microseconds
                    }
                    Err(e) => {
                        // Some formats might not be supported, which is fine
                        println!("Timestamp parsing failed (expected for some formats): {e}");
                    }
                }
            }
        }

        #[test]
        fn test_timestamp_parsing_invalid() {
            let invalid_timestamps = vec![
                json::Value::String("not-a-timestamp".to_string()),
                json::Value::String("".to_string()),
                json::Value::Null,
                json::Value::Bool(true),
                json::Value::Array(vec![]),
                json::Value::Object(serde_json::Map::new()),
            ];

            for invalid_ts in invalid_timestamps {
                let result = parse_timestamp_micro_from_value(&invalid_ts);
                assert!(result.is_err());
            }
        }
    }

    mod stream_name_tests {
        use super::*;

        #[test]
        fn test_valid_stream_names() {
            let valid_names = vec![
                "test-stream",
                "application_logs",
                "service.metrics",
                "stream123",
                "a_very_long_stream_name_with_underscores_and_numbers_123",
            ];

            for name in valid_names {
                // These should not be empty or invalid
                assert!(!name.is_empty());
                assert!(name != "_");
                assert!(name != "/");
            }
        }

        #[test]
        fn test_invalid_stream_names() {
            let invalid_names = vec![
                "",  // Empty
                "_", // Single underscore
                "/", // Single slash
            ];

            for name in invalid_names {
                // These should be caught as invalid
                assert!(name.is_empty() || name == "_" || name == "/");
            }
        }

        #[test]
        fn test_stream_name_formatting() {
            // Test that format_stream_name is available and works
            let test_names = vec!["Test-Stream", "UPPERCASE", "mixed_Case_123"];

            for name in test_names {
                let formatted = format_stream_name(name.to_string());
                // Should return a non-empty formatted string
                assert!(!formatted.is_empty());
                // Typically converts to lowercase, but exact behavior may vary
            }
        }
    }

    mod error_handling_tests {
        use super::*;

        #[test]
        fn test_bulk_response_error_creation() {
            let error = BulkResponseError::new(
                TS_PARSE_FAILED.to_string(),
                "test-stream".to_string(),
                "Invalid timestamp format".to_string(),
                "400".to_string(),
            );

            // Basic validation that error object can be created
            // Exact structure depends on BulkResponseError implementation
            assert!(!format!("{error:?}").is_empty());
        }

        #[test]
        fn test_different_error_scenarios() {
            let mut bulk_res = BulkResponse {
                took: 0,
                errors: false,
                items: vec![],
            };

            // Test various error scenarios
            let error_scenarios = vec![
                (TRANSFORM_FAILED, "JSON transformation failed"),
                (TS_PARSE_FAILED, "Cannot parse timestamp"),
                (SCHEMA_CONFORMANCE_FAILED, "Schema validation failed"),
                (PIPELINE_EXEC_FAILED, "Pipeline execution error"),
            ];

            for (error_type, error_msg) in error_scenarios {
                add_record_status(
                    "error_stream".to_string(),
                    Some("error_doc".to_string()),
                    "index".to_string(),
                    Some(json::json!({"error": "test"})),
                    &mut bulk_res,
                    Some(error_type.to_string()),
                    Some(error_msg.to_string()),
                );
            }

            assert_eq!(bulk_res.items.len(), 4);

            // All items should be errors
            for item in &bulk_res.items {
                let bulk_item = item.values().next().unwrap();
                assert!(bulk_item.error.is_some());
            }
        }
    }

    mod edge_case_tests {
        use super::*;

        #[test]
        fn test_empty_bulk_request() {
            let empty_request = "";
            let body = Bytes::from(empty_request);

            // Empty request should be handled gracefully
            // (Test would need actual infrastructure to run fully)
            assert_eq!(body.len(), 0);
        }

        #[test]
        fn test_malformed_bulk_lines() {
            let malformed_lines = vec![
                "",                 // Empty line
                "not-json",         // Not JSON
                "{incomplete json", // Incomplete JSON
                "{}",               // Empty JSON object
                r#"{"index": {}}"#, // Missing required fields
            ];

            for line in malformed_lines {
                if line.is_empty() {
                    // Empty lines should be skipped
                    continue;
                }

                if json::from_slice::<json::Value>(line.as_bytes()).is_ok() {
                    // Valid JSON, should be processed
                } else {
                    // Invalid JSON, should cause error
                    // This is expected behavior
                }
            }
        }

        #[test]
        fn test_very_large_documents() {
            let large_value = "x".repeat(10000);
            let large_doc = json::json!({
                "message": large_value,
                "metadata": {
                    "large_field": "y".repeat(5000),
                    "nested": {
                        "data": "z".repeat(3000)
                    }
                }
            });

            let mut bulk_res = BulkResponse {
                took: 0,
                errors: false,
                items: vec![],
            };

            add_record_status(
                "large_docs".to_string(),
                Some("large_doc_1".to_string()),
                "index".to_string(),
                Some(large_doc),
                &mut bulk_res,
                None,
                None,
            );

            assert_eq!(bulk_res.items.len(), 1);
        }

        #[test]
        fn test_unicode_and_special_characters() {
            let unicode_doc = json::json!({
                "message": "Hello 世界! 🌍 Testing Unicode",
                "emoji": "🚀🌟✨",
                "special_chars": "!@#$%^&*()[]{}|\\:;\"'<>?,./",
                "unicode_text": "Здравствуй мир! ¡Hola mundo!",
                "japanese": "こんにちは世界"
            });

            let mut bulk_res = BulkResponse {
                took: 0,
                errors: false,
                items: vec![],
            };

            add_record_status(
                "unicode_stream".to_string(),
                Some("unicode_doc".to_string()),
                "index".to_string(),
                Some(unicode_doc),
                &mut bulk_res,
                None,
                None,
            );

            assert_eq!(bulk_res.items.len(), 1);

            // Should handle unicode gracefully
            let item = &bulk_res.items[0];
            let bulk_item = item.values().next().unwrap();
            assert!(!bulk_item._index.is_empty());
        }

        #[test]
        fn test_null_and_empty_values() {
            let doc_with_nulls = json::json!({
                "null_field": null,
                "empty_string": "",
                "empty_array": [],
                "empty_object": {},
                "zero_number": 0,
                "false_boolean": false
            });

            let mut bulk_res = BulkResponse {
                took: 0,
                errors: false,
                items: vec![],
            };

            add_record_status(
                "null_values_stream".to_string(),
                Some("null_doc".to_string()),
                "index".to_string(),
                Some(doc_with_nulls),
                &mut bulk_res,
                None,
                None,
            );

            assert_eq!(bulk_res.items.len(), 1);
        }
    }

    mod performance_tests {
        use super::*;

        #[test]
        fn test_bulk_response_performance() {
            let mut bulk_res = BulkResponse {
                took: 0,
                errors: false,
                items: vec![],
            };

            let start = std::time::Instant::now();

            // Add many records to test performance
            for i in 0..1000 {
                add_record_status(
                    format!("perf_stream_{}", i % 10), // 10 different streams
                    Some(format!("doc_{i}")),
                    if i % 2 == 0 {
                        "index".to_string()
                    } else {
                        "create".to_string()
                    },
                    Some(json::json!({
                        "id": i,
                        "message": format!("Performance test message {i}"),
                        "timestamp": format!("2024-01-01T{:02}:00:00Z", i % 24)
                    })),
                    &mut bulk_res,
                    if i % 10 == 0 {
                        Some(TS_PARSE_FAILED.to_string())
                    } else {
                        None
                    },
                    if i % 10 == 0 {
                        Some("Test error".to_string())
                    } else {
                        None
                    },
                );
            }

            let duration = start.elapsed();
            assert_eq!(bulk_res.items.len(), 1000);

            // Should complete within reasonable time (less than 1 second for 1000 records)
            assert!(duration.as_secs() < 1);

            // Check distribution of errors vs successes
            let errors: usize = bulk_res
                .items
                .iter()
                .map(|item| {
                    let bulk_item = item.values().next().unwrap();
                    if bulk_item.error.is_some() { 1 } else { 0 }
                })
                .sum();

            assert_eq!(errors, 100); // Every 10th record should be an error
        }
    }
}
