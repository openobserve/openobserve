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

use config::utils::json;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

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
    pub reference: HashMap<String, String>,
    pub service_name: String,
    #[serde(flatten)]
    #[serde(skip_serializing_if = "HashMap::is_empty")]
    pub attributes: HashMap<String, json::Value>,
    #[serde(flatten)]
    #[serde(skip_serializing_if = "HashMap::is_empty")]
    pub service: HashMap<String, json::Value>,
    pub events: String,
    pub links: String,
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
    pub attributes: HashMap<String, json::Value>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SpanLinkContext {
    pub trace_id: String,
    pub span_id: String,
    #[serde(default)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub trace_flags: Option<u32>,
    #[serde(default)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub trace_state: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SpanLink {
    pub context: SpanLinkContext,
    #[serde(flatten)]
    #[serde(skip_serializing_if = "HashMap::is_empty")]
    pub attributes: HashMap<String, json::Value>,
    #[serde(default)]
    pub dropped_attributes_count: u32,
}

#[derive(Debug, Default, Serialize, Deserialize, ToSchema)]
pub struct ExportTraceServiceResponse {
    // The details of a partially successful export request.
    //
    // If the request is only partially accepted
    // (i.e. when the server accepts only parts of the data and rejects the rest)
    // the server MUST initialize the `partial_success` field and MUST
    // set the `rejected_<signal>` with the number of items it rejected.
    //
    // Servers MAY also make use of the `partial_success` field to convey
    // warnings/suggestions to senders even when the request was fully accepted.
    // In such cases, the `rejected_<signal>` MUST have a value of `0` and
    // the `error_message` MUST be non-empty.
    //
    // A `partial_success` message with an empty value (rejected_<signal> = 0 and
    // `error_message` = "") is equivalent to it not being set/present. Senders
    // SHOULD interpret it the same way as in the full success case.
    pub partial_success: Option<ExportTracePartialSuccess>,
}

#[derive(Debug, Default, Serialize, Deserialize, ToSchema)]
pub struct ExportTracePartialSuccess {
    // The number of rejected spans.
    //
    // A `rejected_<signal>` field holding a `0` value indicates that the
    // request was fully accepted.
    pub rejected_spans: i64,

    // A developer-facing human-readable message in English. It should be used
    // either to explain why the server rejected parts of the data during a partial
    // success or to convey warnings/suggestions during a full success. The message
    // should offer guidance on how users can address such issues.
    //
    // error_message is an optional field. An error_message with an empty value
    // is equivalent to it not being set.
    pub error_message: String,
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;

    use super::*;

    #[test]
    fn test_span() {
        let mut attributes = HashMap::new();
        attributes.insert("key".to_string(), json::json!("value"));

        let mut service = HashMap::new();
        service.insert("version".to_string(), json::json!("1.0"));

        let mut reference = HashMap::new();
        reference.insert("parent".to_string(), "parent-id".to_string());

        let span = Span {
            trace_id: "trace-1".to_string(),
            span_id: "span-1".to_string(),
            flags: 1,
            span_status: "OK".to_string(),
            span_kind: "SERVER".to_string(),
            operation_name: "test-operation".to_string(),
            start_time: 1000,
            end_time: 2000,
            duration: 1000,
            reference,
            service_name: "test-service".to_string(),
            attributes,
            service,
            events: "[]".to_string(),
            links: "[]".to_string(),
        };

        assert_eq!(span.trace_id, "trace-1");
        assert_eq!(span.span_id, "span-1");
        assert_eq!(span.flags, 1);
        assert_eq!(span.span_status, "OK");
        assert_eq!(span.span_kind, "SERVER");
        assert_eq!(span.operation_name, "test-operation");
        assert_eq!(span.start_time, 1000);
        assert_eq!(span.end_time, 2000);
        assert_eq!(span.duration, 1000);
        assert_eq!(span.service_name, "test-service");
        assert_eq!(span.events, "[]");
        assert_eq!(span.links, "[]");
    }

    #[test]
    fn test_event() {
        let mut attributes = HashMap::new();
        attributes.insert("key".to_string(), json::json!("value"));

        let event = Event {
            name: "test-event".to_string(),
            _timestamp: 1000,
            attributes,
        };

        assert_eq!(event.name, "test-event");
        assert_eq!(event._timestamp, 1000);
    }

    #[test]
    fn test_span_link_context() {
        let context = SpanLinkContext {
            trace_id: "trace-1".to_string(),
            span_id: "span-1".to_string(),
            trace_flags: Some(1),
            trace_state: Some("state".to_string()),
        };

        assert_eq!(context.trace_id, "trace-1");
        assert_eq!(context.span_id, "span-1");
        assert_eq!(context.trace_flags, Some(1));
        assert_eq!(context.trace_state, Some("state".to_string()));
    }

    #[test]
    fn test_span_link() {
        let mut attributes = HashMap::new();
        attributes.insert("key".to_string(), json::json!("value"));

        let link = SpanLink {
            context: SpanLinkContext {
                trace_id: "trace-1".to_string(),
                span_id: "span-1".to_string(),
                trace_flags: None,
                trace_state: None,
            },
            attributes,
            dropped_attributes_count: 0,
        };

        assert_eq!(link.context.trace_id, "trace-1");
        assert_eq!(link.context.span_id, "span-1");
        assert_eq!(link.dropped_attributes_count, 0);
    }

    #[test]
    fn test_export_trace_service_response() {
        let response = ExportTraceServiceResponse {
            partial_success: Some(ExportTracePartialSuccess {
                rejected_spans: 0,
                error_message: "".to_string(),
            }),
        };

        assert!(response.partial_success.is_some());
        let partial = response.partial_success.unwrap();
        assert_eq!(partial.rejected_spans, 0);
        assert_eq!(partial.error_message, "");
    }

    #[test]
    fn test_export_trace_partial_success() {
        let partial = ExportTracePartialSuccess {
            rejected_spans: 5,
            error_message: "test error".to_string(),
        };

        assert_eq!(partial.rejected_spans, 5);
        assert_eq!(partial.error_message, "test error");
    }
}
