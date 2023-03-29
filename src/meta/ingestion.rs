// Copyright 2022 Zinc Labs Inc. and Contributors
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

use ahash::AHashMap;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

#[derive(Clone, Debug, Serialize, Deserialize, ToSchema)]
pub struct RecordStatus {
    pub successful: u32,
    pub failed: u32,
    #[serde(default)]
    #[serde(skip_serializing_if = "String::is_empty")]
    pub error: String,
}

pub struct StreamData {
    pub data: AHashMap<String, Vec<String>>,
    pub status: RecordStatus,
}

#[derive(Clone, Debug, Serialize, Deserialize, ToSchema)]
pub struct StreamStatus {
    pub name: String,
    #[serde(flatten)]
    pub status: RecordStatus,
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
}

pub const INGESTION_EP: [&str; 6] = ["/", "/_bulk", "/_json", "/_multi", "/traces", "/write"];
