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
use ingestion_common::{IngestUser, SYSTEM_JOB_TYPE_METADATA_KEY, SystemJobType};
use proto::cluster_rpc::{
    IngestRequestMetadata, IngestionRequest, IngestionResponse, IngestionType,
    ingest_server::Ingest,
};
use tonic::{Request, Response, Status};

use crate::service::ingestion::create_log_ingestion_req;

#[derive(Default)]
pub struct Ingester;

/// Records `logs::ingest` rejected individually while still answering 200 overall.
struct RecordFailures {
    failed: u64,
    reason: String,
}

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

        let internal_user =
            IngestUser::SystemJob(system_job_type_from_metadata(req.metadata.as_ref()));

        let mut metrics_reply: Option<IngestionResponse> = None;
        let resp = match stream_type {
            StreamType::Logs => {
                ingest_logs(
                    req.ingestion_type,
                    in_data.data,
                    &org_id,
                    &stream_name,
                    internal_user.clone(),
                    is_derived,
                )
                .await
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
                    openobserve_core::metrics::json::ingest(&org_id, stream_name, data, internal_user)
                        .await
                        .map(|resp| {
                            metrics_reply = Some(encode_metrics_reply(&resp));
                            None
                        })
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
                    openobserve_core::traces::ingest_json(&org_id, data, OtlpRequestType::Grpc, &stream_name, internal_user)
                        .await
                        .map(|_| None) // traces do not report per-record status
                        .map_err(|e| Error::IngestionError(format!("error in ingesting traces {e}")))
                }
            }
            StreamType::EnrichmentTables => {
                let json_records = parse_enrichment_records(&in_data.data);
                let append_data = match req.metadata {
                    Some(metadata) => metadata
                        .data
                        .get("append_data")
                        .and_then(|v| v.parse::<bool>().ok())
                        .unwrap_or(true),
                    None => true,
                };
                match enrichment_data::enrichment_table::save_enrichment_data(
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
                            Ok(None)
                        }
                    }
                }
            }
            StreamType::ServiceGraph => {
                ingest_logs(
                    req.ingestion_type,
                    in_data.data,
                    &org_id,
                    &stream_name,
                    internal_user,
                    is_derived,
                )
                .await
            }
            _ => Err(Error::IngestionError(
                "Internal gRPC ingestion service currently only supports Logs, Metrics, Traces, EnrichmentTables, and ServiceGraph"
                    .to_string(),
            )),
        };

        let reply = match resp {
            Ok(failures) => metrics_reply.unwrap_or_else(|| success_reply(failures)),
            Err(err) => IngestionResponse {
                status_code: 500,
                message: err.to_string(),
                failed_records: None,
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

fn ok_reply() -> IngestionResponse {
    IngestionResponse {
        status_code: 200,
        message: "OK".to_string(),
        failed_records: None,
    }
}

fn parse_enrichment_records(data: &[u8]) -> Vec<json::Map<String, json::Value>> {
    json::from_slice(data).unwrap_or_else(|_| {
        let vec_value: Vec<json::Value> = json::from_slice(data).unwrap();
        vec_value
            .into_iter()
            .filter_map(|v| match v {
                json::Value::Object(map) => Some(map),
                _ => None,
            })
            .collect()
    })
}

/// The proto has only `status_code` + `message`, so `207` carries the partial-failure JSON.
fn encode_metrics_reply(resp: &ingestion_common::IngestionResponse) -> IngestionResponse {
    if resp.code != 200 {
        return IngestionResponse {
            status_code: i32::from(resp.code),
            message: resp.error.clone().unwrap_or_default(),
            failed_records: None,
        };
    }
    if resp.status.iter().any(|s| s.status.failed > 0) {
        return IngestionResponse {
            status_code: 207,
            message: json::to_string(resp).unwrap_or_default(),
            failed_records: None,
        };
    }
    ok_reply()
}

async fn ingest_logs(
    ingestion_type: Option<i32>,
    data: Vec<u8>,
    org_id: &str,
    stream_name: &str,
    user: IngestUser,
    is_derived: bool,
) -> Result<Option<RecordFailures>> {
    let ingestion_req =
        create_log_ingestion_req(ingestion_type.unwrap_or_default(), bytes::Bytes::from(data))?;
    let res = openobserve_core::logs::ingest::ingest(
        0,
        org_id,
        stream_name,
        ingestion_req,
        user,
        None,
        is_derived,
    )
    .await?;
    Ok(Some(record_failures(&res)))
}

/// `RecordStatus::error` holds the last error a stream hit, not every one of them.
fn record_failures(res: &ingestion_common::IngestionResponse) -> RecordFailures {
    RecordFailures {
        failed: res.status.iter().map(|s| u64::from(s.status.failed)).sum(),
        reason: res
            .status
            .iter()
            .filter(|s| s.status.failed > 0 && !s.status.error.is_empty())
            .map(|s| format!("{}: {}", s.name, s.status.error))
            .collect::<Vec<_>>()
            .join("; "),
    }
}

/// `None` means the path reports no per-record status, which is not the same as none failed.
fn success_reply(failures: Option<RecordFailures>) -> IngestionResponse {
    let failed_records = failures.as_ref().map(|f| f.failed);
    let message = match failures.filter(|f| f.failed > 0) {
        Some(f) if f.reason.is_empty() => format!("{} records rejected", f.failed),
        Some(f) => format!("{} records rejected: {}", f.failed, f.reason),
        None => "OK".to_string(),
    };
    IngestionResponse {
        status_code: 200,
        message,
        failed_records,
    }
}

/// Absent, empty or unrecognised values keep today's `InternalGrpc` attribution.
fn system_job_type_from_metadata(metadata: Option<&IngestRequestMetadata>) -> SystemJobType {
    metadata
        .and_then(|m| {
            m.data
                .get(SYSTEM_JOB_TYPE_METADATA_KEY)
                .and_then(|v| v.parse::<SystemJobType>().ok())
        })
        .unwrap_or(SystemJobType::InternalGrpc)
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;

    use ingestion_common::{RecordStatus, StreamStatus};
    use proto::cluster_rpc::{IngestRequestMetadata, IngestionData};

    use super::*;

    fn metrics_resp(
        code: u16,
        failed: u32,
        error: Option<&str>,
    ) -> ingestion_common::IngestionResponse {
        let mut resp = ingestion_common::IngestionResponse::new(
            code,
            vec![StreamStatus {
                name: "m".to_string(),
                status: RecordStatus {
                    successful: 1,
                    failed,
                    ..Default::default()
                },
                items: vec![],
            }],
        );
        resp.error = error.map(str::to_string);
        resp
    }

    #[test]
    fn test_parse_enrichment_records_object_array() {
        let records =
            parse_enrichment_records(br#"[{"id": 1}, {"id": 2, "nested": {"ok": true}}]"#);
        assert_eq!(
            json::to_value(records).unwrap(),
            json::json!([
                {"id": 1}, {"id": 2, "nested": {"ok": true}}
            ])
        );
        assert!(parse_enrichment_records(b"[]").is_empty());
    }

    #[test]
    fn test_parse_enrichment_records_mixed_array() {
        let records =
            parse_enrichment_records(br#"[null, {"id": 1}, 2, "text", false, [], {"id": 2}]"#);
        assert_eq!(
            json::to_value(records).unwrap(),
            json::json!([{"id": 1}, {"id": 2}])
        );
        assert!(parse_enrichment_records(b"[null, 1, false]").is_empty());
    }

    #[test]
    #[should_panic]
    fn test_parse_enrichment_records_rejects_non_array() {
        parse_enrichment_records(br#"{"id": 1}"#);
    }

    #[test]
    fn test_encode_metrics_reply_rejection_keeps_code() {
        let reply = encode_metrics_reply(&metrics_resp(503, 0, Some("blocked")));
        assert_eq!(reply.status_code, 503);
        assert_eq!(reply.message, "blocked");
        let reply = encode_metrics_reply(&metrics_resp(429, 0, None));
        assert_eq!(reply.status_code, 429);
        assert_eq!(reply.message, "");
    }

    #[test]
    fn test_encode_metrics_reply_partial_failure_is_207_with_body() {
        let reply = encode_metrics_reply(&metrics_resp(200, 2, None));
        assert_eq!(reply.status_code, 207);
        let body: ingestion_common::IngestionResponse = json::from_str(&reply.message).unwrap();
        assert_eq!(body.status[0].status.failed, 2);
    }

    #[test]
    fn test_encode_metrics_reply_success_is_200_ok() {
        let reply = encode_metrics_reply(&metrics_resp(200, 0, None));
        assert_eq!(reply.status_code, 200);
        assert_eq!(reply.message, "OK");
    }

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
            failed_records: None,
        };

        assert_eq!(success_response.status_code, 200);
        assert_eq!(success_response.message, "OK");

        let error_response = IngestionResponse {
            status_code: 500,
            message: "Error occurred".to_string(),
            failed_records: None,
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
    fn test_system_job_type_defaults_to_internal_grpc_without_metadata() {
        assert_eq!(
            system_job_type_from_metadata(None),
            SystemJobType::InternalGrpc
        );
    }

    #[test]
    fn test_system_job_type_defaults_to_internal_grpc_when_key_is_absent() {
        let metadata = IngestRequestMetadata {
            data: HashMap::from([("is_derived".to_string(), "true".to_string())]),
        };
        assert_eq!(
            system_job_type_from_metadata(Some(&metadata)),
            SystemJobType::InternalGrpc
        );
    }

    #[test]
    fn test_system_job_type_defaults_to_internal_grpc_for_unknown_or_empty_values() {
        for value in [
            "",
            "alert_hygiene",
            "AlertHygieneDigest",
            "internal grpc",
            " alert_hygiene_digest",
        ] {
            let metadata = IngestRequestMetadata {
                data: HashMap::from([("system_job_type".to_string(), value.to_string())]),
            };
            assert_eq!(
                system_job_type_from_metadata(Some(&metadata)),
                SystemJobType::InternalGrpc,
                "'{value}' must not change how an internal ingest is attributed"
            );
        }
    }

    #[test]
    fn test_system_job_type_metadata_is_honoured_for_every_variant() {
        for job in [
            SystemJobType::SelfMetricsPromql,
            SystemJobType::ServiceGraph,
            SystemJobType::SelfReporting,
            SystemJobType::InternalGrpc,
            SystemJobType::AnomalyDetection,
            SystemJobType::AlertHygieneDigest,
        ] {
            let metadata = IngestRequestMetadata {
                data: job.as_ingest_metadata(),
            };
            assert_eq!(system_job_type_from_metadata(Some(&metadata)), job);
        }
    }

    #[test]
    fn test_alert_hygiene_digest_metadata_attributes_the_write_to_the_digest_job() {
        let metadata = IngestRequestMetadata {
            data: SystemJobType::AlertHygieneDigest.as_ingest_metadata(),
        };
        let job = system_job_type_from_metadata(Some(&metadata));
        assert_eq!(job, SystemJobType::AlertHygieneDigest);
        assert_eq!(
            IngestUser::SystemJob(job).to_email(),
            "alert_hygiene_digest@system.local"
        );
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

    fn stream_status(name: &str, successful: u32, failed: u32, error: &str) -> StreamStatus {
        StreamStatus {
            name: name.to_string(),
            status: RecordStatus {
                successful,
                failed,
                error: error.to_string(),
            },
            items: vec![],
        }
    }

    fn core_response(status: Vec<StreamStatus>) -> ingestion_common::IngestionResponse {
        ingestion_common::IngestionResponse::new(200, status)
    }

    #[test]
    fn test_record_failures_sums_failed_across_every_entry_of_the_status_vector() {
        let res = core_response(vec![
            stream_status("a", 10, 3, "bad timestamp"),
            stream_status("b", 5, 0, ""),
            stream_status("c", 1, 7, "schema conflict"),
        ]);
        assert_eq!(record_failures(&res).failed, 10);
    }

    #[test]
    fn test_record_failures_reports_zero_when_every_stream_accepted_its_records() {
        let res = core_response(vec![
            stream_status("a", 10, 0, ""),
            stream_status("b", 5, 0, ""),
        ]);
        let failures = record_failures(&res);
        assert_eq!(failures.failed, 0);
        assert!(failures.reason.is_empty());
    }

    #[test]
    fn test_record_failures_collects_a_reason_only_from_the_streams_that_lost_records() {
        let res = core_response(vec![
            stream_status("a", 10, 3, "bad timestamp"),
            stream_status("b", 5, 0, "stale error from a clean stream"),
            stream_status("c", 1, 7, "schema conflict"),
        ]);
        assert_eq!(
            record_failures(&res).reason,
            "a: bad timestamp; c: schema conflict"
        );
    }

    #[test]
    fn test_an_arm_that_does_not_report_per_record_status_answers_200_ok_with_no_count() {
        let reply = success_reply(None);
        assert_eq!(reply.status_code, 200);
        assert_eq!(reply.message, "OK");
        assert_eq!(reply.failed_records, None);
    }

    #[test]
    fn test_a_clean_reported_write_answers_200_ok_with_an_explicit_zero() {
        let reply = success_reply(Some(RecordFailures {
            failed: 0,
            reason: String::new(),
        }));
        assert_eq!(reply.status_code, 200);
        assert_eq!(reply.message, "OK");
        assert_eq!(reply.failed_records, Some(0));
    }

    #[test]
    fn test_a_partial_failure_stays_200_and_carries_the_count_and_the_reason() {
        let reply = success_reply(Some(RecordFailures {
            failed: 3,
            reason: "a: bad timestamp".to_string(),
        }));
        assert_eq!(reply.status_code, 200);
        assert_eq!(reply.message, "3 records rejected: a: bad timestamp");
        assert_eq!(reply.failed_records, Some(3));
    }

    #[test]
    fn test_a_partial_failure_without_a_recorded_reason_still_carries_the_count() {
        let reply = success_reply(Some(RecordFailures {
            failed: 2,
            reason: String::new(),
        }));
        assert_eq!(reply.message, "2 records rejected");
        assert_eq!(reply.failed_records, Some(2));
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
