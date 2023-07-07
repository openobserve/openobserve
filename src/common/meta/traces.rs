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
use std::collections::HashMap;

use crate::common::json;

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Span {
    pub trace_id: String,
    pub span_id: String,
    pub flags: u8,
    pub span_kind: String,
    pub operation_name: String,
    pub start_time: u64,
    pub end_time: u64,
    pub duration: u64,
    #[serde(flatten)]
    #[serde(skip_serializing_if = "HashMap::is_empty")]
    pub reference: AHashMap<String, String>,
    pub service_name: String,
    #[serde(flatten)]
    #[serde(skip_serializing_if = "HashMap::is_empty")]
    pub attributes: AHashMap<String, json::Value>,
    #[serde(flatten)]
    #[serde(skip_serializing_if = "HashMap::is_empty")]
    pub service: AHashMap<String, json::Value>,
    pub events: String,
}

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq, Serialize, Deserialize)]
pub enum SpanRefType {
    #[default]
    #[serde(rename = "CHILD_OF")]
    ChildOf,
    #[serde(rename = "PARENT_OF")]
    ParentOf,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Event {
    pub name: String,
    pub _timestamp: u64,
    #[serde(flatten)]
    #[serde(skip_serializing_if = "HashMap::is_empty")]
    pub attributes: AHashMap<String, json::Value>,
}
/* #[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct SpanReference {
    pub parent_trace_id: String,
    pub parent_span_id: String,
    pub ref_type: SpanRefType,
}

//Service which has generated the trace id - span id ...in distrubited tracing there can be multiple services using same trace id
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Service {
    pub name: String,
    #[serde(flatten)]
    #[serde(skip_serializing_if = "HashMap::is_empty")]
    pub attributes: AHashMap<String, Value>,
} */
