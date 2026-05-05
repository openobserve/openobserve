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
    io::{BufReader, Cursor, Lines},
};

use axum::body::Bytes;
use config::utils::json;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use super::stream::SchemaRecords;

/// System job types for backend ingestion processes
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SystemJobType {
    SelfMetricsPromql,
    ServiceGraph,
    SelfReporting,
    InternalGrpc,
    AnomalyDetection,
}

impl SystemJobType {
    /// Format as email local part (before @system.local)
    pub fn as_email_local(&self) -> &'static str {
        match self {
            SystemJobType::SelfMetricsPromql => "self_metrics_promql",
            SystemJobType::ServiceGraph => "service_graph",
            SystemJobType::SelfReporting => "self_reporting",
            SystemJobType::InternalGrpc => "internal_grpc",
            SystemJobType::AnomalyDetection => "anomaly_detection",
        }
    }
}

/// User identifier for ingestion operations
///
/// This enum ensures proper tracking of who initiated an ingestion:
/// - Real user emails for API requests
/// - System job identifiers for automated backend processes
///
/// This prevents empty emails in usage reporting and makes it explicit
/// whether ingestion was user-initiated or system-initiated.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum IngestUser {
    /// Real user email from authenticated API request
    User(String),
    /// System job identifier for automated backend processes
    SystemJob(SystemJobType),
}

impl IngestUser {
    /// Convert to email string for storage and reporting
    ///
    /// - User emails are returned as-is
    /// - System jobs are formatted as `{job_name}@system.local`
    pub fn to_email(&self) -> String {
        match self {
            IngestUser::User(email) => email.clone(),
            IngestUser::SystemJob(job) => format!("{}@system.local", job.as_email_local()),
        }
    }

    /// Create from a user email string
    pub fn from_user_email(email: impl Into<String>) -> Self {
        // we use unknown@system.local if email is passed as empty string
        let email = match email.into() {
            email if email.is_empty() => "unknown@system.local".to_string(),
            email => email,
        };
        IngestUser::User(email)
    }
}

#[derive(Clone, Debug, Default, Serialize, Deserialize, ToSchema)]
pub struct RecordStatus {
    pub successful: u32,
    pub failed: u32,
    #[serde(default)]
    #[serde(skip_serializing_if = "String::is_empty")]
    pub error: String,
}

pub struct BulkStreamData {
    pub data: HashMap<String, SchemaRecords>,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize, ToSchema)]
pub struct StreamStatus {
    pub name: String,
    #[serde(flatten)]
    pub status: RecordStatus,
    #[serde(skip_serializing, skip_deserializing)]
    pub items: Vec<HashMap<String, BulkResponseItem>>,
}

impl StreamStatus {
    pub fn new(name: &str) -> Self {
        StreamStatus {
            name: name.to_string(),
            status: RecordStatus::default(),
            items: vec![],
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, ToSchema)]
pub struct IngestionResponse {
    pub code: u16,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub status: Vec<StreamStatus>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

impl IngestionResponse {
    pub fn new(code: u16, status: Vec<StreamStatus>) -> Self {
        IngestionResponse {
            code,
            status,
            error: None,
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, ToSchema)]
pub struct StreamSchemaChk {
    pub conforms: bool,
    pub has_fields: bool,
    pub has_partition_keys: bool,
    pub has_metrics_metadata: bool,
}

pub const INGESTION_EP: [&str; 16] = [
    "_bulk",
    "_json",
    "_multi",
    "traces",
    "write",
    "_kinesis_firehose",
    "_license",
    "_xpack",
    "_index_template",
    "_data_stream",
    "_sub",
    "logs",
    "metrics",
    "_json_arrow",
    "_hec",
    "push",
];

#[derive(Clone, Debug, Default, Serialize, Deserialize, ToSchema)]
pub struct BulkResponse {
    pub took: u128,
    pub errors: bool,
    pub items: Vec<HashMap<String, BulkResponseItem>>,
}

#[derive(Clone, Debug, Serialize, Deserialize, ToSchema)]
pub struct BulkResponseItem {
    pub _index: String,
    pub _id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub _version: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub _shards: Option<ShardResponse>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub _seq_no: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub _primary_term: Option<i64>,
    pub status: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<BulkResponseError>,
    #[serde(skip_serializing_if = "Option::is_none", rename = "originalRecord")]
    #[schema(value_type = Object)]
    pub original_record: Option<json::Value>,
}

pub enum IngestionStatus {
    Record(RecordStatus),
    Bulk(BulkResponse),
}

#[derive(Clone, Debug, Serialize, Deserialize, ToSchema)]
pub struct ShardResponse {
    pub total: i64,
    pub successful: i64,
    pub failed: i64,
}

#[derive(Clone, Debug, Serialize, Deserialize, ToSchema)]
pub struct BulkResponseError {
    #[serde(rename = "type")]
    pub err_type: String,
    pub reason: String,
    pub index_uuid: String,
    pub shard: String,
    pub index: String,
}

impl BulkResponseError {
    pub fn new(err_type: String, index: String, reason: String, index_uuid: String) -> Self {
        BulkResponseError {
            err_type,
            reason,
            index_uuid,
            shard: "1".to_owned(),
            index,
        }
    }
}

impl BulkResponseItem {
    pub fn new_failed(
        _index: String,
        _id: String,
        error: BulkResponseError,
        orig_record: Option<json::Value>,
        stream_name: String,
    ) -> Self {
        BulkResponseItem {
            _index: stream_name,
            _id,
            _version: None,
            result: None,
            _shards: None,
            _seq_no: None,
            _primary_term: None,
            status: 422,
            error: Some(error),
            original_record: orig_record,
        }
    }

    pub fn new(
        _index: String,
        _id: String,
        _orig_record: Option<json::Value>,
        stream_name: String,
    ) -> Self {
        BulkResponseItem {
            _index: stream_name,
            _id,
            _version: Some(1),
            result: Some("created".to_owned()),
            _shards: Some(ShardResponse {
                total: 1,
                successful: 1,
                failed: 0,
            }),
            _seq_no: Some(1),
            _primary_term: Some(1),
            status: 200,
            error: None,
            original_record: None,
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct KinesisFHRequest {
    pub records: Vec<KFHRecordRequest>,
    pub request_id: String,
    pub timestamp: Option<i64>,
}

#[derive(Clone, Debug, Serialize, Deserialize, ToSchema)]
pub struct KFHRecordRequest {
    pub data: String,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct KinesisFHLogData {
    pub log_events: Vec<KinesisFHLogEvent>,
    pub log_group: String,
    pub log_stream: String,
    pub message_type: String,
    pub owner: String,
    pub subscription_filters: Vec<String>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, ToSchema)]
pub struct KinesisFHLogEvent {
    pub message: json::Value,
    pub id: String,
    pub timestamp: Option<i64>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct KinesisFHMetricData {
    #[serde(rename = "metric_stream_name")]
    pub metric_stream_name: String,
    #[serde(rename = "account_id")]
    pub account_id: String,
    pub region: String,
    pub namespace: String,
    #[serde(rename = "metric_name")]
    pub metric_name: String,
    pub dimensions: json::Value,
    pub timestamp: i64,
    pub value: KinesisFHMetricValue,
    pub unit: String,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, ToSchema)]
pub struct KinesisFHMetricValue {
    pub count: f32,
    pub sum: f32,
    pub max: f32,
    pub min: f32,
}

#[derive(Clone, Debug, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct KinesisFHIngestionResponse {
    pub request_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error_message: Option<String>,
    pub timestamp: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
#[serde(untagged)]
pub enum AWSRecordType {
    KinesisFHLogs(KinesisFHLogData),
    KinesisFHMetrics(KinesisFHMetricData),
}

#[derive(Default, Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GCPIngestionRequest {
    pub message: GCPMessage,
    pub subscription: String,
}

#[derive(Default, Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GCPMessage {
    pub attributes: GCPAttributes,
    pub data: String,
    pub message_id: String,
    #[serde(rename = "message_id")]
    pub message_id_dup: String,
    pub publish_time: String,
    #[serde(rename = "publish_time")]
    pub publish_time_dup: String,
}

#[derive(Default, Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GCPAttributes {
    #[serde(rename = "logging.googleapis.com/timestamp")]
    pub logging_googleapis_com_timestamp: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct GCPIngestionResponse {
    pub request_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error_message: Option<String>,
    pub timestamp: String,
}

pub enum IngestionRequest {
    JSON(Bytes),
    Multi(Bytes),
    JsonValues(IngestionValueType, Vec<json::Value>),
    GCP(GCPIngestionRequest),
    KinesisFH(KinesisFHRequest),
    RUM(Bytes),
    Usage(Bytes),
}

impl IngestionRequest {
    /// Returns whether usage reporting should be triggered for this request type.
    ///
    /// Returns `false` for `Usage` requests to prevent circular reporting:
    /// usage events being ingested must not generate additional usage events.
    pub fn should_report_usage(&self) -> bool {
        !matches!(self, IngestionRequest::Usage(_))
    }
}

pub enum IngestionValueType {
    Bulk,
    Hec,
    Loki,
}

pub enum IngestionData {
    JSON(Vec<json::Value>),
    Multi(bytes::Bytes),
    GCP(GCPIngestionRequest),
    KinesisFH(KinesisFHRequest),
}

#[derive(Debug)]
pub enum IngestionError {
    IoError(std::io::Error),
    JsonError(json::Error),
    AWSError(KinesisFHIngestionResponse),
    GCPError(GCPIngestionResponse),
}

impl From<json::Error> for IngestionError {
    fn from(err: json::Error) -> Self {
        IngestionError::JsonError(err)
    }
}

impl From<std::io::Error> for IngestionError {
    fn from(err: std::io::Error) -> Self {
        IngestionError::IoError(err)
    }
}

pub enum IngestionDataIter {
    JSONIter(std::vec::IntoIter<json::Value>),
    MultiIter(Lines<BufReader<Cursor<bytes::Bytes>>>),
    GCP(
        std::vec::IntoIter<json::Value>,
        Option<GCPIngestionResponse>,
    ),
    KinesisFH(
        std::vec::IntoIter<json::Value>,
        Option<KinesisFHIngestionResponse>,
    ),
}

pub enum HecStatus {
    Success,
    InvalidFormat,
    InvalidIndex,
    Custom(String, u16),
}

impl From<HecStatus> for HecResponse {
    fn from(value: HecStatus) -> Self {
        let (text, code) = match value {
            HecStatus::Success => ("Success".to_string(), 200),
            HecStatus::InvalidFormat => ("Invalid data format".to_string(), 400),
            HecStatus::InvalidIndex => ("Incorrect index".to_string(), 400),
            HecStatus::Custom(s, c) => (s, c),
        };
        Self { text, code }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, ToSchema)]
pub struct HecResponse {
    pub text: String,
    pub code: u16,
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;

    use super::*;

    #[test]
    fn test_record_status() {
        let status = RecordStatus {
            successful: 10,
            failed: 2,
            error: "test error".to_string(),
        };

        assert_eq!(status.successful, 10);
        assert_eq!(status.failed, 2);
        assert_eq!(status.error, "test error");
    }

    #[test]
    fn test_record_status_default() {
        let status = RecordStatus::default();
        assert_eq!(status.successful, 0);
        assert_eq!(status.failed, 0);
        assert_eq!(status.error, "");
    }

    #[test]
    fn test_stream_status() {
        let status = StreamStatus::new("test-stream");
        assert_eq!(status.name, "test-stream");
        assert_eq!(status.status.successful, 0);
        assert_eq!(status.status.failed, 0);
        assert_eq!(status.status.error, "");
    }

    #[test]
    fn test_ingestion_response() {
        let status = StreamStatus::new("test-stream");
        let response = IngestionResponse::new(200, vec![status]);

        assert_eq!(response.code, 200);
        assert_eq!(response.status.len(), 1);
        assert_eq!(response.error, None);
    }

    #[test]
    fn test_stream_schema_chk() {
        let chk = StreamSchemaChk {
            conforms: true,
            has_fields: true,
            has_partition_keys: true,
            has_metrics_metadata: true,
        };

        assert!(chk.conforms);
        assert!(chk.has_fields);
        assert!(chk.has_partition_keys);
        assert!(chk.has_metrics_metadata);
    }

    #[test]
    fn test_bulk_response() {
        let response = BulkResponse {
            took: 100,
            errors: false,
            items: vec![HashMap::new()],
        };

        assert_eq!(response.took, 100);
        assert!(!response.errors);
        assert_eq!(response.items.len(), 1);
    }

    #[test]
    fn test_bulk_response_item() {
        let item = BulkResponseItem {
            _index: "test-index".to_string(),
            _id: "test-id".to_string(),
            _version: Some(1),
            result: Some("created".to_string()),
            _shards: Some(ShardResponse {
                total: 1,
                successful: 1,
                failed: 0,
            }),
            _seq_no: Some(1),
            _primary_term: Some(1),
            status: 201,
            error: None,
            original_record: None,
        };

        assert_eq!(item._index, "test-index");
        assert_eq!(item._id, "test-id");
        assert_eq!(item._version, Some(1));
        assert_eq!(item.result, Some("created".to_string()));
        assert_eq!(item.status, 201);
    }

    #[test]
    fn test_bulk_response_item_new() {
        let item = BulkResponseItem::new(
            "test-index".to_string(),
            "test-id".to_string(),
            None,
            "test-stream".to_string(),
        );

        assert_eq!(item._index, "test-stream");
        assert_eq!(item._id, "test-id");
        assert_eq!(item._version, Some(1));
        assert_eq!(item.result, Some("created".to_string()));
        assert_eq!(item.status, 200);
    }

    #[test]
    fn test_bulk_response_item_new_failed() {
        let error = BulkResponseError::new(
            "test-error".to_string(),
            "test-index".to_string(),
            "test-reason".to_string(),
            "test-uuid".to_string(),
        );

        let item = BulkResponseItem::new_failed(
            "test-index".to_string(),
            "test-id".to_string(),
            error,
            None,
            "test-stream".to_string(),
        );

        assert_eq!(item._index, "test-stream");
        assert_eq!(item._id, "test-id");
        assert_eq!(item.status, 422);
        assert!(item.error.is_some());
    }

    #[test]
    fn test_shard_response() {
        let shard = ShardResponse {
            total: 2,
            successful: 1,
            failed: 1,
        };

        assert_eq!(shard.total, 2);
        assert_eq!(shard.successful, 1);
        assert_eq!(shard.failed, 1);
    }

    #[test]
    fn test_bulk_response_error() {
        let error = BulkResponseError::new(
            "test-error".to_string(),
            "test-index".to_string(),
            "test-reason".to_string(),
            "test-uuid".to_string(),
        );

        assert_eq!(error.err_type, "test-error");
        assert_eq!(error.index, "test-index");
        assert_eq!(error.reason, "test-reason");
        assert_eq!(error.index_uuid, "test-uuid");
        assert_eq!(error.shard, "1");
    }

    #[test]
    fn test_kinesis_fh_request() {
        let request = KinesisFHRequest {
            records: vec![KFHRecordRequest {
                data: "test-data".to_string(),
            }],
            request_id: "test-request".to_string(),
            timestamp: Some(1234567890),
        };

        assert_eq!(request.records.len(), 1);
        assert_eq!(request.request_id, "test-request");
        assert_eq!(request.timestamp, Some(1234567890));
    }

    #[test]
    fn test_kinesis_fh_log_data() {
        let log_data = KinesisFHLogData {
            log_events: vec![KinesisFHLogEvent {
                message: json::json!({"test": "value"}),
                id: "test-id".to_string(),
                timestamp: Some(1234567890),
            }],
            log_group: "test-group".to_string(),
            log_stream: "test-stream".to_string(),
            message_type: "test-type".to_string(),
            owner: "test-owner".to_string(),
            subscription_filters: vec!["test-filter".to_string()],
        };

        assert_eq!(log_data.log_events.len(), 1);
        assert_eq!(log_data.log_group, "test-group");
        assert_eq!(log_data.log_stream, "test-stream");
        assert_eq!(log_data.message_type, "test-type");
        assert_eq!(log_data.owner, "test-owner");
        assert_eq!(log_data.subscription_filters.len(), 1);
    }

    #[test]
    fn test_kinesis_fh_metric_data() {
        let metric_data = KinesisFHMetricData {
            metric_stream_name: "test-stream".to_string(),
            account_id: "test-account".to_string(),
            region: "test-region".to_string(),
            namespace: "test-namespace".to_string(),
            metric_name: "test-metric".to_string(),
            dimensions: json::json!({"test": "value"}),
            timestamp: 1234567890,
            value: KinesisFHMetricValue {
                count: 1.0,
                sum: 10.0,
                max: 10.0,
                min: 10.0,
            },
            unit: "test-unit".to_string(),
        };

        assert_eq!(metric_data.metric_stream_name, "test-stream");
        assert_eq!(metric_data.account_id, "test-account");
        assert_eq!(metric_data.region, "test-region");
        assert_eq!(metric_data.namespace, "test-namespace");
        assert_eq!(metric_data.metric_name, "test-metric");
        assert_eq!(metric_data.timestamp, 1234567890);
        assert_eq!(metric_data.unit, "test-unit");
    }

    #[test]
    fn test_gcp_ingestion_request() {
        let request = GCPIngestionRequest {
            message: GCPMessage {
                attributes: GCPAttributes {
                    logging_googleapis_com_timestamp: "2023-01-01T00:00:00Z".to_string(),
                },
                data: "test-data".to_string(),
                message_id: "test-id".to_string(),
                message_id_dup: "test-id".to_string(),
                publish_time: "2023-01-01T00:00:00Z".to_string(),
                publish_time_dup: "2023-01-01T00:00:00Z".to_string(),
            },
            subscription: "test-subscription".to_string(),
        };

        assert_eq!(request.message.data, "test-data");
        assert_eq!(request.message.message_id, "test-id");
        assert_eq!(request.subscription, "test-subscription");
    }

    #[test]
    fn test_ingestion_response_skip_empty_status_and_error() {
        let response = IngestionResponse {
            code: 200,
            status: vec![],
            error: None,
        };
        let serialized = serde_json::to_string(&response).unwrap();
        assert!(!serialized.contains("status"));
        assert!(!serialized.contains("error"));
    }

    #[test]
    fn test_record_status_skip_empty_error() {
        let status = RecordStatus {
            successful: 1,
            failed: 0,
            error: "".to_string(),
        };
        let serialized = serde_json::to_string(&status).unwrap();
        assert!(!serialized.contains("error"));
    }

    #[test]
    fn test_hec_status_conversion() {
        // Test all variants
        let success: HecResponse = HecStatus::Success.into();
        assert_eq!(success.text, "Success");
        assert_eq!(success.code, 200);

        let invalid_format: HecResponse = HecStatus::InvalidFormat.into();
        assert_eq!(invalid_format.text, "Invalid data format");
        assert_eq!(invalid_format.code, 400);

        let invalid_index: HecResponse = HecStatus::InvalidIndex.into();
        assert_eq!(invalid_index.text, "Incorrect index");
        assert_eq!(invalid_index.code, 400);

        let custom: HecResponse = HecStatus::Custom("Test error".to_string(), 418).into();
        assert_eq!(custom.text, "Test error");
        assert_eq!(custom.code, 418);
    }

    /// Verifies that `IngestionRequest::Usage` does NOT trigger usage reporting,
    /// preventing circular reporting where usage events generate more usage events.
    #[test]
    fn test_usage_request_does_not_trigger_usage_reporting() {
        let req = IngestionRequest::Usage(Bytes::from("[]"));
        assert!(
            !req.should_report_usage(),
            "IngestionRequest::Usage must not trigger usage reporting to prevent circular reporting"
        );
    }

    /// Verifies that all non-Usage request types DO trigger usage reporting.
    #[test]
    fn test_non_usage_requests_trigger_usage_reporting() {
        let json_req = IngestionRequest::JSON(Bytes::from("[]"));
        assert!(
            json_req.should_report_usage(),
            "JSON requests should trigger usage reporting"
        );

        let multi_req = IngestionRequest::Multi(Bytes::from(""));
        assert!(
            multi_req.should_report_usage(),
            "Multi requests should trigger usage reporting"
        );

        let rum_req = IngestionRequest::RUM(Bytes::from(""));
        assert!(
            rum_req.should_report_usage(),
            "RUM requests should trigger usage reporting"
        );

        let json_values_req = IngestionRequest::JsonValues(IngestionValueType::Bulk, vec![]);
        assert!(
            json_values_req.should_report_usage(),
            "JsonValues requests should trigger usage reporting"
        );
    }

    /// Verifies the fn_num contract: when should_report_usage() is false,
    /// the resulting fn_num is None, which prevents report_request_usage_stats()
    /// from being called in write_logs_by_stream().
    #[test]
    fn test_usage_request_produces_none_fn_num() {
        let req = IngestionRequest::Usage(Bytes::from("[]"));
        let need_usage_report = req.should_report_usage();
        let fn_num: Option<usize> = need_usage_report.then_some(0);
        assert!(
            fn_num.is_none(),
            "fn_num must be None for Usage requests so write_logs_by_stream skips usage reporting"
        );
    }

    #[test]
    fn test_json_request_produces_some_fn_num() {
        let req = IngestionRequest::JSON(Bytes::from("[]"));
        let need_usage_report = req.should_report_usage();
        let fn_num: Option<usize> = need_usage_report.then_some(0);
        assert!(
            fn_num.is_some(),
            "fn_num must be Some for non-Usage requests to enable usage reporting"
        );
    }

    #[test]
    fn test_system_job_type_as_email_local() {
        assert_eq!(
            SystemJobType::SelfMetricsPromql.as_email_local(),
            "self_metrics_promql"
        );
        assert_eq!(
            SystemJobType::ServiceGraph.as_email_local(),
            "service_graph"
        );
        assert_eq!(
            SystemJobType::SelfReporting.as_email_local(),
            "self_reporting"
        );
        assert_eq!(
            SystemJobType::InternalGrpc.as_email_local(),
            "internal_grpc"
        );
        assert_eq!(
            SystemJobType::AnomalyDetection.as_email_local(),
            "anomaly_detection"
        );
    }

    #[test]
    fn test_ingest_user_to_email_user() {
        let user = IngestUser::User("alice@example.com".to_string());
        assert_eq!(user.to_email(), "alice@example.com");
    }

    #[test]
    fn test_ingest_user_to_email_system_job() {
        let user = IngestUser::SystemJob(SystemJobType::AnomalyDetection);
        assert_eq!(user.to_email(), "anomaly_detection@system.local");
    }

    #[test]
    fn test_ingest_user_from_user_email_normal() {
        let user = IngestUser::from_user_email("bob@example.com");
        assert_eq!(user, IngestUser::User("bob@example.com".to_string()));
    }

    #[test]
    fn test_ingest_user_from_user_email_empty_becomes_unknown() {
        let user = IngestUser::from_user_email("");
        assert_eq!(user, IngestUser::User("unknown@system.local".to_string()));
    }

    #[test]
    fn test_hec_status_from_success() {
        let resp = HecResponse::from(HecStatus::Success);
        assert_eq!(resp.text, "Success");
        assert_eq!(resp.code, 200);
    }

    #[test]
    fn test_hec_status_from_invalid_format() {
        let resp = HecResponse::from(HecStatus::InvalidFormat);
        assert_eq!(resp.text, "Invalid data format");
        assert_eq!(resp.code, 400);
    }

    #[test]
    fn test_hec_status_from_invalid_index() {
        let resp = HecResponse::from(HecStatus::InvalidIndex);
        assert_eq!(resp.text, "Incorrect index");
        assert_eq!(resp.code, 400);
    }

    #[test]
    fn test_hec_status_from_custom() {
        let resp = HecResponse::from(HecStatus::Custom("my error".to_string(), 422));
        assert_eq!(resp.text, "my error");
        assert_eq!(resp.code, 422);
    }

    #[test]
    fn test_bulk_response_item_optional_fields_absent_when_none() {
        let item = BulkResponseItem {
            _index: "idx".to_string(),
            _id: "id1".to_string(),
            _version: None,
            result: None,
            _shards: None,
            _seq_no: None,
            _primary_term: None,
            status: 200,
            error: None,
            original_record: None,
        };
        let json = serde_json::to_value(&item).unwrap();
        let obj = json.as_object().unwrap();
        assert!(!obj.contains_key("_version"));
        assert!(!obj.contains_key("result"));
        assert!(!obj.contains_key("_shards"));
        assert!(!obj.contains_key("_seq_no"));
        assert!(!obj.contains_key("_primary_term"));
        assert!(!obj.contains_key("error"));
        assert!(!obj.contains_key("originalRecord"));
    }

    #[test]
    fn test_bulk_response_item_optional_fields_present_when_some() {
        let item = BulkResponseItem {
            _index: "idx".to_string(),
            _id: "id1".to_string(),
            _version: Some(1),
            result: Some("created".to_string()),
            _shards: Some(ShardResponse {
                total: 1,
                successful: 1,
                failed: 0,
            }),
            _seq_no: Some(0),
            _primary_term: Some(1),
            status: 201,
            error: None,
            original_record: Some(json::json!({"key": "val"})),
        };
        let json = serde_json::to_value(&item).unwrap();
        let obj = json.as_object().unwrap();
        assert!(obj.contains_key("_version"));
        assert!(obj.contains_key("result"));
        assert!(obj.contains_key("_shards"));
        assert!(obj.contains_key("_seq_no"));
        assert!(obj.contains_key("_primary_term"));
        assert!(obj.contains_key("originalRecord"));
    }
}
