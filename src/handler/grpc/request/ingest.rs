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

use config::{
    meta::{otlp::OtlpRequestType, stream::StreamType},
    metrics,
    utils::json,
};
use http::StatusCode;
use infra::errors::{Error, Result};
use proto::cluster_rpc::{
    IngestionRequest, IngestionResponse, IngestionType, ingest_server::Ingest,
};
use tonic::{Request, Response, Status};

use crate::{
    common::meta::ingestion::{IngestUser, SystemJobType},
    service::ingestion::create_log_ingestion_req,
};

#[derive(Default)]
pub struct Ingester;

#[tonic::async_trait]
impl Ingest for Ingester {
    async fn ingest(
        &self,
        request: Request<IngestionRequest>,
    ) -> Result<Response<IngestionResponse>, Status> {
        let start = std::time::Instant::now();
        let req = request.into_inner();
        let org_id = req.org_id;
        let stream_type: StreamType = req.stream_type.into();
        let stream_name = req.stream_name;
        let in_data = req.data.unwrap_or_default();
        let is_derived = req
            .metadata
            .as_ref()
            .and_then(|m| {
                m.data
                    .get("is_derived")
                    .and_then(|v| v.parse::<bool>().ok())
            })
            .unwrap_or(false);

        let internal_user = IngestUser::SystemJob(SystemJobType::InternalGrpc);

        let resp = match stream_type {
            StreamType::Logs => {
                let log_ingestion_type = req.ingestion_type.unwrap_or_default();
                let data = bytes::Bytes::from(in_data.data);
                match create_log_ingestion_req(log_ingestion_type, data) {
                    Err(e) => Err(e),
                    Ok(ingestion_req) => crate::service::logs::ingest::ingest(
                        0,
                        &org_id,
                        &stream_name,
                        ingestion_req,
                        internal_user.clone(),
                        None,
                        is_derived,
                    )
                    .await
                    .map_or_else(Err, |_| Ok(())),
                }
            }
            StreamType::Metrics => {
                let stream_name =  if stream_name.is_empty(){
                    None
                } else {
                    Some(stream_name.as_str())
                };
                let log_ingestion_type: IngestionType = req
                    .ingestion_type
                    .unwrap_or_default()
                    .try_into()
                    .unwrap_or(IngestionType::Multi); // multi is just place holder
                if log_ingestion_type != IngestionType::Json {
                    Err(Error::IngestionError(format!(
                        "Internal gPRC metric ingestion only supports json type data, got {log_ingestion_type:?}"
                    )))
                } else {
                    let data = bytes::Bytes::from(in_data.data);
                    crate::service::metrics::json::ingest(&org_id, stream_name, data, internal_user)
                        .await
                        .map(|_| ()) // we don't care about success response
                        .map_err(|e| Error::IngestionError(format!("error in ingesting metrics {e}")))
                }
            }
            StreamType::Traces => {
                let log_ingestion_type: IngestionType = req
                    .ingestion_type
                    .unwrap_or_default()
                    .try_into()
                    .unwrap_or(IngestionType::Multi); // multi is just place holder
                if log_ingestion_type != IngestionType::Json {
                    Err(Error::IngestionError(format!(
                        "Internal gRPC trace ingestion only supports json type data, got {log_ingestion_type:?}"
                    )))
                } else {
                    let data = bytes::Bytes::from(in_data.data);
                    // internal ingestion does not require email id
                    crate::service::traces::ingest_json(&org_id, data, OtlpRequestType::Grpc, &stream_name, internal_user)
                        .await
                        .map(|_| ()) // we don't care about success response
                        .map_err(|e| Error::IngestionError(format!("error in ingesting traces {e}")))
                }
            }
            StreamType::EnrichmentTables => {
                let json_records: Vec<json::Map<String, json::Value>> =
                    json::from_slice(&in_data.data).unwrap_or({
                        let vec_value: Vec<json::Value> = json::from_slice(&in_data.data).unwrap();
                        vec_value
                            .into_iter()
                            .filter_map(|v| match v {
                                json::Value::Object(map) => Some(map),
                                _ => None,
                            })
                            .collect()
                    });
                let append_data = match req.metadata {
                    Some(metadata) => metadata
                        .data
                        .get("append_data")
                        .and_then(|v| v.parse::<bool>().ok())
                        .unwrap_or(true),
                    None => true,
                };
                match crate::service::enrichment_table::save_enrichment_data(
                    &org_id,
                    &stream_name,
                    json_records,
                    append_data,
                )
                .await
                {
                    Err(e) => Err(Error::IngestionError(format!(
                        "Internal gPRC ingestion service errors saving enrichment data: {e}"
                    ))),
                    Ok(res) => {
                        if res.status() != StatusCode::OK {
                            let status: StatusCode = res.status();
                            log::error!(
                                "Internal gPRC ingestion service errors saving enrichment data: code: {status}, body: {:?}",
                                res.into_body()
                            );
                            Err(Error::IngestionError(format!(
                                "Internal gPRC ingestion service errors saving enrichment data: http code {status}"
                            )))
                        } else {
                            Ok(())
                        }
                    }
                }
            }
            StreamType::ServiceGraph => {
                // Service graph edges - use same pattern as Logs
                let log_ingestion_type = req.ingestion_type.unwrap_or_default();
                let data = bytes::Bytes::from(in_data.data);
                match create_log_ingestion_req(log_ingestion_type, data) {
                    Err(e) => Err(e),
                    Ok(ingestion_req) => crate::service::logs::ingest::ingest(
                        0,
                        &org_id,
                        &stream_name,
                        ingestion_req,
                        internal_user,
                        None,
                        is_derived,
                    )
                    .await
                    .map_or_else(Err, |_| Ok(())),
                }
            }
            _ => Err(Error::IngestionError(
                "Internal gRPC ingestion service currently only supports Logs, EnrichmentTables, and ServiceGraph"
                    .to_string(),
            )),
        };

        let reply = match resp {
            Ok(_) => IngestionResponse {
                status_code: 200,
                message: "OK".to_string(),
            },
            Err(err) => IngestionResponse {
                status_code: 500,
                message: err.to_string(),
            },
        };

        // metrics
        let time = start.elapsed().as_secs_f64();
        metrics::GRPC_RESPONSE_TIME
            .with_label_values(&["/ingest/inner", "200", "", "", "", ""])
            .observe(time);
        metrics::GRPC_INCOMING_REQUESTS
            .with_label_values(&["/ingest/inner", "200", "", "", "", ""])
            .inc();

        Ok(Response::new(reply))
    }
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;

    use proto::cluster_rpc::{IngestRequestMetadata, IngestionData};

    use super::*;

    #[test]
    fn test_ingester_struct() {
        // Test that Ingester can be created
        let ingester = Ingester;
        // Ingester is a unit struct, so its size is 0
        assert_eq!(std::mem::size_of_val(&ingester), 0);
    }

    #[test]
    fn test_ingestion_request_creation() {
        // Test creating an IngestionRequest
        let request = IngestionRequest {
            org_id: "test_org".to_string(),
            stream_type: "logs".to_string(),
            stream_name: "test_stream".to_string(),
            data: Some(IngestionData {
                data: b"test data".to_vec(),
            }),
            ingestion_type: Some(IngestionType::Json as i32),
            metadata: Some(IngestRequestMetadata {
                data: HashMap::new(),
            }),
        };

        assert_eq!(request.org_id, "test_org");
        assert_eq!(request.stream_type, "logs");
        assert_eq!(request.stream_name, "test_stream");
        assert!(request.data.is_some_and(|d| d.data == b"test data"));
    }

    #[test]
    fn test_ingestion_response_creation() {
        // Test creating an IngestionResponse
        let success_response = IngestionResponse {
            status_code: 200,
            message: "OK".to_string(),
        };

        assert_eq!(success_response.status_code, 200);
        assert_eq!(success_response.message, "OK");

        let error_response = IngestionResponse {
            status_code: 500,
            message: "Error occurred".to_string(),
        };

        assert_eq!(error_response.status_code, 500);
        assert_eq!(error_response.message, "Error occurred");
    }

    #[test]
    fn test_ingestion_data_creation() {
        // Test creating IngestionData
        let data = IngestionData {
            data: b"test log data".to_vec(),
        };

        assert_eq!(data.data, b"test log data");
        assert_eq!(data.data.len(), 13);
    }

    #[test]
    fn test_ingestion_metadata_creation() {
        // Test creating IngestRequestMetadata
        let mut metadata_map = HashMap::new();
        metadata_map.insert("is_derived".to_string(), "true".to_string());
        metadata_map.insert("append_data".to_string(), "false".to_string());

        let metadata = IngestRequestMetadata { data: metadata_map };

        assert_eq!(metadata.data.len(), 2);
        assert_eq!(metadata.data.get("is_derived"), Some(&"true".to_string()));
        assert_eq!(metadata.data.get("append_data"), Some(&"false".to_string()));
    }

    #[test]
    fn test_stream_type_conversion() {
        // Test converting string stream types to StreamType enum
        let logs_type: StreamType = "logs".into();
        assert_eq!(logs_type, StreamType::Logs);

        let metrics_type: StreamType = "metrics".into();
        assert_eq!(metrics_type, StreamType::Metrics);

        let traces_type: StreamType = "traces".into();
        assert_eq!(traces_type, StreamType::Traces);

        let enrichment_type: StreamType = "enrichment_tables".into();
        assert_eq!(enrichment_type, StreamType::EnrichmentTables);
    }

    #[test]
    fn test_ingestion_type_enum() {
        // Test IngestionType enum values
        assert_eq!(IngestionType::Json as i32, 0);
        assert_eq!(IngestionType::Multi as i32, 1);
        assert_eq!(IngestionType::Gcp as i32, 2);
        assert_eq!(IngestionType::Kinesisfh as i32, 3);
        assert_eq!(IngestionType::Rum as i32, 4);
        assert_eq!(IngestionType::Usage as i32, 5);
    }

    #[test]
    fn test_is_derived_parsing() {
        // Test parsing is_derived from metadata
        let mut metadata_map = HashMap::new();
        metadata_map.insert("is_derived".to_string(), "true".to_string());

        let metadata = IngestRequestMetadata { data: metadata_map };
        let is_derived = metadata
            .data
            .get("is_derived")
            .and_then(|v| v.parse::<bool>().ok())
            .unwrap_or(false);

        assert!(is_derived);

        // Test with false value
        let mut metadata_map_false = HashMap::new();
        metadata_map_false.insert("is_derived".to_string(), "false".to_string());

        let metadata_false = IngestRequestMetadata {
            data: metadata_map_false,
        };
        let is_derived_false = metadata_false
            .data
            .get("is_derived")
            .and_then(|v| v.parse::<bool>().ok())
            .unwrap_or(false);

        assert!(!is_derived_false);

        // Test with missing key
        let empty_metadata = IngestRequestMetadata {
            data: HashMap::new(),
        };
        let is_derived_missing = empty_metadata
            .data
            .get("is_derived")
            .and_then(|v| v.parse::<bool>().ok())
            .unwrap_or(false);

        assert!(!is_derived_missing);
    }

    #[test]
    fn test_append_data_parsing() {
        // Test parsing append_data from metadata
        let mut metadata_map = HashMap::new();
        metadata_map.insert("append_data".to_string(), "true".to_string());

        let metadata = IngestRequestMetadata { data: metadata_map };
        let append_data = metadata
            .data
            .get("append_data")
            .and_then(|v| v.parse::<bool>().ok())
            .unwrap_or(true);

        assert!(append_data);

        // Test with false value
        let mut metadata_map_false = HashMap::new();
        metadata_map_false.insert("append_data".to_string(), "false".to_string());

        let metadata_false = IngestRequestMetadata {
            data: metadata_map_false,
        };
        let append_data_false = metadata_false
            .data
            .get("append_data")
            .and_then(|v| v.parse::<bool>().ok())
            .unwrap_or(true);

        assert!(!append_data_false);

        // Test with missing key (defaults to true)
        let empty_metadata = IngestRequestMetadata {
            data: HashMap::new(),
        };
        let append_data_missing = empty_metadata
            .data
            .get("append_data")
            .and_then(|v| v.parse::<bool>().ok())
            .unwrap_or(true);

        assert!(append_data_missing);
    }

    #[test]
    fn test_bytes_conversion() {
        // Test converting Vec<u8> to bytes::Bytes
        let data_vec = b"test data".to_vec();
        let bytes_data = bytes::Bytes::from(data_vec.clone());

        assert_eq!(bytes_data, data_vec);
        assert_eq!(bytes_data.len(), 9);
    }

    #[test]
    fn test_json_parsing_patterns() {
        // Test JSON parsing patterns used in the code
        let json_data = r#"[{"key": "value"}, {"another": "data"}]"#;
        let parsed: Result<Vec<json::Map<String, json::Value>>, _> =
            json::from_slice(json_data.as_bytes());

        assert!(parsed.is_ok());
        let result = parsed.unwrap();
        assert_eq!(result.len(), 2);
        assert_eq!(
            result[0].get("key"),
            Some(&json::Value::String("value".to_string()))
        );
        assert_eq!(
            result[1].get("another"),
            Some(&json::Value::String("data".to_string()))
        );

        // Test fallback parsing for non-object arrays
        let mixed_json_data = r#"[{"key": "value"}, "string_value", 123]"#;
        let parsed_mixed: Result<Vec<json::Value>, _> =
            json::from_slice(mixed_json_data.as_bytes());
        assert!(parsed_mixed.is_ok());

        let mixed_result = parsed_mixed.unwrap();
        assert_eq!(mixed_result.len(), 3);
        assert!(matches!(mixed_result[0], json::Value::Object(_)));
        assert!(matches!(mixed_result[1], json::Value::String(_)));
        assert!(matches!(mixed_result[2], json::Value::Number(_)));
    }

    #[test]
    fn test_error_handling_patterns() {
        // Test error handling patterns used in the code
        let result: Result<(), Error> = Err(Error::IngestionError("test error".to_string()));

        match result {
            Ok(_) => panic!("Expected error"),
            Err(Error::IngestionError(msg)) => {
                assert_eq!(msg, "test error");
            }
            Err(_) => panic!("Expected IngestionError"),
        }
    }

    #[test]
    fn test_status_code_handling() {
        // Test status code handling patterns
        let success_status = StatusCode::OK;
        assert_eq!(success_status.as_u16(), 200);

        let error_status = StatusCode::INTERNAL_SERVER_ERROR;
        assert_eq!(error_status.as_u16(), 500);

        // Test status code comparison
        assert!(success_status != error_status);
        assert_eq!(success_status, StatusCode::OK);
    }

    #[test]
    fn test_ingestion_type_conversion() {
        // Test IngestionType conversion patterns
        let json_type = IngestionType::Json;
        let json_int: i32 = json_type as i32;
        assert_eq!(json_int, 0);

        let multi_type = IngestionType::Multi;
        let multi_int: i32 = multi_type as i32;
        assert_eq!(multi_int, 1);

        // Test try_into conversion
        let json_type_from_int: Result<IngestionType, _> = 0.try_into();
        assert!(json_type_from_int.is_ok());
        assert_eq!(json_type_from_int.unwrap(), IngestionType::Json);

        let invalid_type: Result<IngestionType, _> = 999.try_into();
        assert!(invalid_type.is_err());
    }

    #[test]
    fn test_otlp_request_type() {
        // Test OtlpRequestType enum
        assert_eq!(OtlpRequestType::Grpc as i32, 0);
        assert_eq!(OtlpRequestType::HttpJson as i32, 1);
        assert_eq!(OtlpRequestType::HttpProtobuf as i32, 2);
    }

    #[test]
    fn test_metrics_recording_patterns() {
        // Test metrics recording patterns used in the code
        let _time = 0.123f64;
        let path = "/ingest/inner";
        let status = "200";
        let org_id = "";
        let stream_type = "";
        let stream_name = "";

        // This test just ensures the metrics format is valid
        let metric_labels = [path, status, org_id, stream_type, stream_name, ""];
        assert_eq!(metric_labels.len(), 6);
        assert_eq!(metric_labels[0], "/ingest/inner");
        assert_eq!(metric_labels[1], "200");
    }

    #[test]
    fn test_logging_patterns() {
        // Test logging patterns used in the code
        let status: StatusCode = StatusCode::INTERNAL_SERVER_ERROR;
        let body = "error body";

        // This test just ensures the logging format is valid
        let log_message = format!(
            "Internal gPRC ingestion service errors saving enrichment data: code: {status}, body: {body:?}"
        );

        assert!(log_message.contains("Internal gPRC ingestion service errors"));
        assert!(log_message.contains("code: 500"));
        assert!(log_message.contains("body: \"error body\""));
    }

    #[test]
    fn test_stream_type_validation() {
        // Test stream type validation patterns
        let valid_stream_types = vec!["logs", "metrics", "traces", "enrichment_tables"];

        for stream_type in valid_stream_types {
            let converted: StreamType = stream_type.into();
            assert!(matches!(
                converted,
                StreamType::Logs
                    | StreamType::Metrics
                    | StreamType::Traces
                    | StreamType::EnrichmentTables
            ));
        }
    }

    #[test]
    fn test_ingestion_data_validation() {
        // Test ingestion data validation patterns
        let empty_data = IngestionData { data: vec![] };
        assert!(empty_data.data.is_empty());

        let non_empty_data = IngestionData {
            data: b"some data".to_vec(),
        };
        assert!(!non_empty_data.data.is_empty());
        assert_eq!(non_empty_data.data.len(), 9);
    }
}
