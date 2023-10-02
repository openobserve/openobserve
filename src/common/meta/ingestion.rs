// Copyright 2023 Zinc Labs Inc.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

use std::io;

use actix_web::web;
use ahash::AHashMap as HashMap;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use crate::common::utils::json;

#[derive(Clone, Debug, Default, Serialize, Deserialize, ToSchema)]
pub struct RecordStatus {
    pub successful: u32,
    pub failed: u32,
    #[serde(default)]
    #[serde(skip_serializing_if = "String::is_empty")]
    pub error: String,
}

pub struct BulkStreamData {
    pub data: HashMap<String, Vec<String>>,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize, ToSchema)]
pub struct StreamStatus {
    pub name: String,
    #[serde(flatten)]
    pub status: RecordStatus,
}

impl StreamStatus {
    pub fn new(name: &str) -> Self {
        StreamStatus {
            name: name.to_string(),
            status: RecordStatus::default(),
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

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct StreamSchemaChk {
    pub conforms: bool,
    pub has_fields: bool,
    pub has_partition_keys: bool,
    pub has_metadata: bool,
}

pub const INGESTION_EP: [&str; 13] = [
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
];

#[derive(Clone, Debug, Serialize, Deserialize, ToSchema)]
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
    #[serde(skip_serializing_if = "Option::is_none")]
    #[serde(rename = "originalRecord")]
    #[schema(value_type = Object)]
    pub original_record: Option<json::Value>,
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
        orig_record: json::Value,
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
            original_record: Some(orig_record),
        }
    }

    pub fn new(
        _index: String,
        _id: String,
        _orig_record: json::Value,
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

#[derive(Clone, Debug, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct KinesisFHData {
    pub log_events: Vec<KinesisFHLogEvent>,
    pub log_group: String,
    pub log_stream: String,
    pub message_type: String,
    pub owner: String,
    pub subscription_filters: Vec<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize, ToSchema)]
pub struct KinesisFHLogEvent {
    pub message: json::Value,
    pub id: String,
    pub timestamp: Option<i64>,
}

#[derive(Clone, Debug, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct KinesisFHIngestionResponse {
    pub request_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error_message: Option<String>,
    pub timestamp: i64,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum AWSRecordType {
    JSON,
    Cloudwatch,
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
    JSON(web::Bytes),
    Multi(web::Bytes),
    KinesisFH(KinesisFHRequest),
    GCP(GCPIngestionRequest),
}

pub enum IngestionData<'a> {
    JSON(Vec<json::Value>),
    Multi(&'a [u8]),
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

pub enum IngestionDataIter<'a> {
    JSONIter(std::slice::Iter<'a, json::Value>),
    MultiIter(io::Lines<std::io::BufReader<&'a [u8]>>),
    GCP(
        std::vec::IntoIter<json::Value>,
        Option<GCPIngestionResponse>,
    ),
    KinesisFH(
        std::vec::IntoIter<json::Value>,
        Option<KinesisFHIngestionResponse>,
    ),
}
