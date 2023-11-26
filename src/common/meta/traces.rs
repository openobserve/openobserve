// Copyright 2023 Zinc Labs Inc.
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

use ahash::AHashMap;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

use crate::common::utils::json;

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Span {
    pub trace_id: String,
    pub span_id: String,
    pub flags: u8,
    pub span_status: String,
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

//Service which has generated the trace id - span id ...in distributed tracing there can be multiple services using same trace id
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Service {
    pub name: String,
    #[serde(flatten)]
    #[serde(skip_serializing_if = "HashMap::is_empty")]
    pub attributes: AHashMap<String, Value>,
} */
